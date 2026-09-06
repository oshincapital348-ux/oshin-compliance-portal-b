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
