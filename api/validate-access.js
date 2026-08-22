import { verifyAccessToken } from "./_lib/token.js";

// Called automatically when the app loads with a saved/linked token.
// Confirms it's genuine and not expired before the frontend unlocks.
// Admin sessions expire faster than customer access links — an elevated
// login shouldn't quietly stay valid in a browser for a full week.
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours
const CUSTOMER_LINK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { token } = req.body || {};

  // First decode without an age limit just to see which mode this token
  // claims to be, so we know which expiry window to apply.
  const unchecked = verifyAccessToken(token, null);
  if (!unchecked) return res.status(200).json({ ok: false });

  const maxAge = unchecked.mode === "admin" ? ADMIN_SESSION_MS : CUSTOMER_LINK_MS;
  const payload = verifyAccessToken(token, maxAge);

  if (!payload || (payload.mode !== "paid" && payload.mode !== "admin")) {
    return res.status(200).json({ ok: false });
  }

  res.status(200).json({ ok: true, mode: payload.mode });
}
