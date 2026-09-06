import crypto from "crypto";
import { verifyAccessToken } from "./_lib/token.js";
import { isConsumed } from "./_lib/store.js";
import { ADMIN_SESSION_MS, CUSTOMER_LINK_MS } from "./_lib/constants.js";

// Called automatically when the app loads with a saved/linked token.
// Confirms it's genuine, not expired, and — for paid links — not already
// used up for a previous report, before the frontend unlocks.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { token, reportType } = req.body || {};

  // First decode without an age limit just to see which mode this token
  // claims to be, so we know which expiry window to apply.
  const unchecked = verifyAccessToken(token, null);
  if (!unchecked) return res.status(200).json({ ok: false });

  const maxAge = unchecked.mode === "admin" ? ADMIN_SESSION_MS : CUSTOMER_LINK_MS;
  const payload = verifyAccessToken(token, maxAge);

  if (!payload || (payload.mode !== "paid" && payload.mode !== "admin")) {
    return res.status(200).json({ ok: false, reason: "expired" });
  }

  if (payload.mode === "paid") {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    if (await isConsumed(tokenHash)) {
      return res.status(200).json({ ok: false, reason: "already-used" });
    }

    // Older tokens minted before report-type binding existed have no
    // reportType at all — treat those as "dpr" for backward compatibility
    // (they're short-lived, 24h, so this only matters for a brief window).
    const boundType = payload.reportType === "cma" ? "cma" : "dpr";

    // If the caller tells us which report it actually wants to check
    // against, enforce the match here too — not just at consume time —
    // so the frontend can immediately steer the UI to the right report
    // instead of letting someone browse a report they didn't pay for.
    if (reportType && reportType !== boundType) {
      return res.status(200).json({ ok: false, reason: "wrong-report-type", reportType: boundType });
    }

    return res.status(200).json({ ok: true, mode: payload.mode, reportType: boundType });
  }

  res.status(200).json({ ok: true, mode: payload.mode });
}
