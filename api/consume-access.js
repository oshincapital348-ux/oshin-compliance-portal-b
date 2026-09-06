import crypto from "crypto";
import { verifyAccessToken } from "./_lib/token.js";
import { isConsumed, markConsumed } from "./_lib/store.js";
import { ADMIN_SESSION_MS, CUSTOMER_LINK_MS } from "./_lib/constants.js";

// Called right before the frontend actually generates a PDF/Excel download.
// Admin sessions pass through freely (not tied to a payment). Paid sessions
// get marked consumed on their first successful call here — any further
// call with the same token (a reload, reopening the link, a second report)
// is rejected, and the customer needs to pay again.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { token, reportType } = req.body || {};
  const unchecked = verifyAccessToken(token, null);
  if (!unchecked) return res.status(200).json({ ok: false, reason: "invalid" });

  const maxAge = unchecked.mode === "admin" ? ADMIN_SESSION_MS : CUSTOMER_LINK_MS;
  const payload = verifyAccessToken(token, maxAge);
  if (!payload) return res.status(200).json({ ok: false, reason: "expired" });

  if (payload.mode === "admin") {
    return res.status(200).json({ ok: true }); // admins aren't rate-limited per payment
  }

  // This is the actual spend point — the moment a report gets generated.
  // A DPR payment must never be spendable on a CMA download or vice versa,
  // even if something upstream in the UI let the toggle get switched.
  // Older tokens minted before this existed are treated as "dpr".
  const boundType = payload.reportType === "cma" ? "cma" : "dpr";
  if (reportType && reportType !== boundType) {
    return res.status(200).json({ ok: false, reason: "wrong-report-type", reportType: boundType });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  if (await isConsumed(tokenHash)) {
    return res.status(200).json({ ok: false, reason: "already-used" });
  }

  const remainingSeconds = Math.max(1, Math.round((maxAge - (Date.now() - payload.iat)) / 1000));
  await markConsumed(tokenHash, remainingSeconds);

  res.status(200).json({ ok: true });
}
