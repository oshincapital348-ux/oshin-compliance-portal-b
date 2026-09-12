import { Redis } from "@upstash/redis";

// Free tier (Upstash Redis, via Vercel's Storage tab) is what makes "how many
// reports have been generated" and "recent activity" possible at all —
// serverless functions have no memory between requests on their own.
//
// Vercel's Upstash integration names these env vars KV_REST_API_URL /
// KV_REST_API_TOKEN (newer Marketplace flow) or UPSTASH_REDIS_REST_URL /
// UPSTASH_REDIS_REST_TOKEN (older direct integration) depending on how it
// was connected — check both so either setup works without manual renaming.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// If neither pair is set yet, every function here quietly does nothing
// instead of crashing — so the rest of the app (payments, QR, admin login)
// keeps working while you set this up.
let redis = null;
if (REDIS_URL && REDIS_TOKEN) {
  redis = new Redis({
    url: REDIS_URL,
    token: REDIS_TOKEN,
  });
}

const TX_LIST_KEY = "oshin:transactions";
const COUNT_KEY = "oshin:reportCount";
const REVENUE_KEY = "oshin:revenueRupees";
const MAX_STORED = 200; // keep the list bounded — recent history, not infinite

export async function recordTransaction({ method, contact, utr, amount, status, reportType }) {
  if (!redis) return; // storage not configured — silently skip

  const entry = {
    method, // "razorpay" | "upi-claim" | "upi-approved"
    contact: contact || null,
    utr: utr || null,
    amount: amount || null,
    status: status || "completed",
    reportType: reportType === "cma" ? "cma" : reportType === "dpr" ? "dpr" : null,
    at: new Date().toISOString(),
  };

  try {
    await redis.lpush(TX_LIST_KEY, JSON.stringify(entry));
    await redis.ltrim(TX_LIST_KEY, 0, MAX_STORED - 1);
    if (status === "completed") {
      await redis.incr(COUNT_KEY);
      if (amount) {
        await redis.incrby(REVENUE_KEY, Math.round(Number(amount)));
      }
    }
  } catch (err) {
    console.error("Failed to record transaction:", err);
  }
}

export async function getStats(limit = 50) {
  if (!redis) return { configured: false, count: 0, revenue: 0, recent: [] };

  try {
    const [count, revenue, rawEntries] = await Promise.all([
      redis.get(COUNT_KEY),
      redis.get(REVENUE_KEY),
      redis.lrange(TX_LIST_KEY, 0, limit - 1),
    ]);
    const recent = (rawEntries || []).map((e) => (typeof e === "string" ? JSON.parse(e) : e));
    return { configured: true, count: Number(count) || 0, revenue: Number(revenue) || 0, recent };
  } catch (err) {
    console.error("Failed to read stats:", err);
    return { configured: true, count: 0, revenue: 0, recent: [], error: true };
  }
}

// Fires a webhook (if configured) so the admin gets notified outside the
// app too — e.g. wired to a free Google Apps Script, Slack webhook, or
// Make.com/Pipedream free-tier automation that forwards to email/WhatsApp.
export async function notify(event) {
  if (!process.env.NOTIFY_WEBHOOK_URL) return;
  try {
    await fetch(process.env.NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, at: new Date().toISOString() }),
    });
  } catch (err) {
    console.error("Notify webhook failed:", err);
  }
}

// A "paid" access link is meant to cover exactly one report. The first time
// it's used to actually generate a report, it gets marked consumed here —
// any later attempt to reuse the same link (reload, reopen, share it again)
// gets rejected, and the customer has to pay again. Admin sessions are
// never tracked this way — an admin isn't consuming a payment.
export async function isConsumed(tokenHash) {
  if (!redis) return false; // no storage configured — can't enforce, so allow (fails open)
  try {
    const val = await redis.get(`oshin:consumed:${tokenHash}`);
    return !!val;
  } catch (err) {
    console.error("Failed to check consumed status:", err);
    return false;
  }
}

export async function markConsumed(tokenHash, ttlSeconds) {
  if (!redis) return;
  try {
    await redis.set(`oshin:consumed:${tokenHash}`, "1", { ex: ttlSeconds });
  } catch (err) {
    console.error("Failed to mark token consumed:", err);
  }
}

// Which Gemini model actually works on this API key, found once and reused
// forever after (until it stops working). This matters a lot on a free
// tier: an in-memory-only cache gets wiped every time the serverless
// function cold-starts, which happens often on light traffic — without
// persistent storage, nearly every message would re-discover the model
// from scratch, burning several real API calls against a tight free-tier
// quota just to answer one question. A week-long TTL is generous — model
// availability doesn't change that often, and a stale entry just costs one
// extra discovery round the next time it's wrong.
const GEMINI_MODEL_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function getCachedGeminiModel() {
  if (!redis) return null;
  try {
    return await redis.get("oshin:geminiModel");
  } catch (err) {
    console.error("Failed to read cached Gemini model:", err);
    return null;
  }
}

export async function setCachedGeminiModel(model) {
  if (!redis || !model) return;
  try {
    await redis.set("oshin:geminiModel", model, { ex: GEMINI_MODEL_TTL_SECONDS });
  } catch (err) {
    console.error("Failed to cache Gemini model:", err);
  }
}

// How long a payment counts toward the "don't charge the same customer
// twice" discount on the OTHER report type. 15 days — enough to cover the
// realistic gap between getting one report done and a bank asking for the
// other on the same project shortly after, without becoming an indefinite
// freebie for an unrelated purchase much later.
const CONTACT_DISCOUNT_WINDOW_SECONDS = 15 * 24 * 60 * 60;

function normalizeContact(contact) {
  return typeof contact === "string" ? contact.trim().toLowerCase() : "";
}

// Records that this contact paid `amount` for `reportType`, so if they come
// back for the OTHER report type within the window, they're only charged
// the difference (or nothing, if the new tier costs the same or less) —
// never full price twice for the same underlying project.
export async function recordContactPaid(contact, reportType, amount) {
  const normalized = normalizeContact(contact);
  if (!redis || !normalized || !amount) return; // no contact or no real amount — nothing to credit
  const key = `oshin:contactPaid:${normalized}`;
  try {
    const existingRaw = await redis.get(key);
    const existing = existingRaw ? (typeof existingRaw === "string" ? JSON.parse(existingRaw) : existingRaw) : {};
    existing[reportType] = { amount: Number(amount), at: new Date().toISOString() };
    await redis.set(key, JSON.stringify(existing), { ex: CONTACT_DISCOUNT_WINDOW_SECONDS });
  } catch (err) {
    console.error("Failed to record contact payment history:", err);
  }
}

// Looks up what this contact has already paid, if anything, for either
// report type — used to compute a repeat-customer discount before showing
// a price. Returns null if there's no history or storage isn't configured.
export async function getContactPaidHistory(contact) {
  const normalized = normalizeContact(contact);
  if (!redis || !normalized) return null;
  try {
    const raw = await redis.get(`oshin:contactPaid:${normalized}`);
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    console.error("Failed to read contact payment history:", err);
    return null;
  }
}
