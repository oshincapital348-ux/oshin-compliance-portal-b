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

export async function recordTransaction({ method, contact, utr, amount, status, reportType, partnerCode }) {
  if (!redis) return; // storage not configured — silently skip

  const entry = {
    method, // "razorpay" | "upi-claim" | "upi-approved"
    contact: contact || null,
    utr: utr || null,
    amount: amount || null,
    status: status || "completed",
    reportType: reportType === "cma" ? "cma" : reportType === "dpr" ? "dpr" : null,
    partnerCode: partnerCode || null,
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
// A paid token is no longer strictly single-use — the chat assistant makes
// it completely normal to download once, ask for changes, and want to
// re-download the corrected version, sometimes more than once. This caps
// reuse generously (enough for real iteration) rather than blocking after
// exactly one download, while still meaning a leaked/shared link can't be
// used indefinitely by strangers — it's capped and time-boxed either way.
const MAX_DOWNLOADS_PER_TOKEN = 15;

export async function isConsumed(tokenHash) {
  if (!redis) return false; // no storage configured — can't enforce, so allow (fails open)
  try {
    const count = await redis.get(`oshin:consumed:${tokenHash}`);
    return Number(count || 0) >= MAX_DOWNLOADS_PER_TOKEN;
  } catch (err) {
    console.error("Failed to check consumed status:", err);
    return false;
  }
}

export async function markConsumed(tokenHash, ttlSeconds) {
  if (!redis) return;
  try {
    const key = `oshin:consumed:${tokenHash}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, ttlSeconds);
    }
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
//
// The ":v2" suffix in the key name is a version bump — whenever the
// candidate-selection LOGIC changes (e.g. now preferring "lite" models for
// their higher free quota), bumping this forces every deployment to
// re-discover fresh instead of keeping whatever was cached under the old
// logic. Bump it again in the future if the selection logic changes again.
const GEMINI_MODEL_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function getCachedGeminiModel() {
  if (!redis) return null;
  try {
    return await redis.get("oshin:geminiModel:v2");
  } catch (err) {
    console.error("Failed to read cached Gemini model:", err);
    return null;
  }
}

export async function setCachedGeminiModel(model) {
  if (!redis || !model) return;
  try {
    await redis.set("oshin:geminiModel:v2", model, { ex: GEMINI_MODEL_TTL_SECONDS });
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

// Generic rate limiter for public endpoints, keyed by whatever the caller
// passes (usually "endpointName:ipAddress"). Returns true if the request
// should be ALLOWED, false if the limit's been hit. If Redis isn't
// configured, this fails open (allows everything) rather than breaking the
// site — rate limiting is a hardening layer, not something that should be
// able to take the whole app down if storage is briefly unavailable.
export async function checkRateLimit(key, maxRequests, windowSeconds) {
  if (!redis) return true;
  try {
    const redisKey = `oshin:ratelimit:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
    }
    return count <= maxRequests;
  } catch (err) {
    console.error("Rate limit check failed (allowing request):", err);
    return true;
  }
}

// Best-effort real client IP behind Vercel's proxy — good enough for abuse
// throttling, not meant to be a precise/spoof-proof identity.
export function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// --- Partner program ---
// Anyone can apply; only the super admin can approve. An approved partner
// gets a unique login code (mailed to them) and buys reports at 60% of the
// normal price.
const PARTNER_APPS_LIST_KEY = "oshin:partnerApps";
const MAX_PARTNER_APPS = 200;

export async function savePartnerApplication(app) {
  if (!redis) return null;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = { id, ...app, status: "pending", appliedAt: new Date().toISOString() };
  try {
    await redis.lpush(PARTNER_APPS_LIST_KEY, JSON.stringify(entry));
    await redis.ltrim(PARTNER_APPS_LIST_KEY, 0, MAX_PARTNER_APPS - 1);
    return entry;
  } catch (err) {
    console.error("Failed to save partner application:", err);
    return null;
  }
}

export async function listPartnerApplications(limit = 50) {
  if (!redis) return [];
  try {
    const raw = await redis.lrange(PARTNER_APPS_LIST_KEY, 0, limit - 1);
    return raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));
  } catch (err) {
    console.error("Failed to list partner applications:", err);
    return [];
  }
}

// Applications live in a small capped list, so changing one's status just
// rewrites that list with the entry updated (order preserved).
export async function updatePartnerApplicationStatus(id, status) {
  if (!redis) return;
  try {
    const raw = await redis.lrange(PARTNER_APPS_LIST_KEY, 0, MAX_PARTNER_APPS - 1);
    const apps = raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));
    const updated = apps.map((a) => (a.id === id ? { ...a, status } : a));
    await redis.del(PARTNER_APPS_LIST_KEY);
    if (updated.length > 0) {
      await redis.lpush(PARTNER_APPS_LIST_KEY, ...updated.reverse().map((a) => JSON.stringify(a)));
    }
  } catch (err) {
    console.error("Failed to update partner application status:", err);
  }
}

function generatePartnerCode() {
  return `PARTNER-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function createPartner({ name, business, email, mobile }) {
  if (!redis) return null;
  const code = generatePartnerCode();
  const partner = { code, name, business, email, mobile, active: true, approvedAt: new Date().toISOString() };
  try {
    await redis.set(`oshin:partner:${code}`, JSON.stringify(partner));
    return partner;
  } catch (err) {
    console.error("Failed to create partner:", err);
    return null;
  }
}

export async function getPartner(code) {
  if (!redis || !code) return null;
  try {
    const raw = await redis.get(`oshin:partner:${code}`);
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    console.error("Failed to read partner:", err);
    return null;
  }
}

export async function setPartnerActive(code, active) {
  const partner = await getPartner(code);
  if (!partner || !redis) return;
  try {
    await redis.set(`oshin:partner:${code}`, JSON.stringify({ ...partner, active }));
  } catch (err) {
    console.error("Failed to update partner active status:", err);
  }
}

// Approved partner codes are tracked in one small index list (the record
// itself lives at its own key and stays the source of truth for "active").
const PARTNER_INDEX_KEY = "oshin:partnerIndex";

export async function indexPartnerCode(code) {
  if (!redis) return;
  try {
    await redis.lpush(PARTNER_INDEX_KEY, code);
  } catch (err) {
    console.error("Failed to index partner code:", err);
  }
}

export async function listPartners() {
  if (!redis) return [];
  try {
    const codes = await redis.lrange(PARTNER_INDEX_KEY, 0, 500);
    const partners = await Promise.all(codes.map((c) => getPartner(c)));
    return partners.filter(Boolean);
  } catch (err) {
    console.error("Failed to list partners:", err);
    return [];
  }
}

export async function getPartnerHistory(code, limit = 50) {
  const stats = await getStats(200);
  return (stats.recent || []).filter((tx) => tx.partnerCode === code).slice(0, limit);
}
