import { verifyAccessToken, signAccessToken } from "./_lib/token.js";
import { recordTransaction, notify } from "./_lib/store.js";
import { sendAccessLinkEmail } from "./_lib/email.js";

// Only someone holding a valid admin token (issued by /api/verify-admin,
// which requires ADMIN_CODE) can call this. It mints a "paid" access token
// for a specific customer, hands back a link, and — if the customer left an
// email address — tries to send it to them automatically so the admin
// doesn't have to copy/paste and forward it by hand.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const adminToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const adminPayload = verifyAccessToken(adminToken, 24 * 60 * 60 * 1000); // admin session valid 24h

  if (!adminPayload || adminPayload.mode !== "admin") {
    return res.status(401).json({ error: "Not authorized" });
  }

  const { contact, utr, amount, reportType } = req.body || {};
  if (!contact) return res.status(400).json({ error: "Missing contact" });

  // Which report this approval covers ("dpr" | "cma") — the admin picks this
  // when generating the link (defaulting to whichever the pending claim was
  // for, if any). Baked into the token itself so the link can only ever be
  // consumed against that one report type, enforced again in consume-access.js.
  const cleanReportType = reportType === "cma" ? "cma" : "dpr";

  // Access link is valid for 24 hours from generation, and is single-use —
  // once the customer generates their report with it, it's spent (enforced
  // in consume-access.js). A new report needs a new payment/approval.
  const accessToken = signAccessToken({ mode: "paid", reportType: cleanReportType, approvedFor: contact, utr: utr || null });

  // Built here (not just client-side) so it can be put straight into an
  // email. req.headers.host is Vercel's own domain unless a custom domain
  // is attached — reflects whatever the admin is actually browsing on.
  const origin = `https://${req.headers.host}`;
  const link = `${origin}/?access=${accessToken}`;

  const isEmail = typeof contact === "string" && contact.includes("@");
  let emailResult = { sent: false, reason: "not-an-email" };
  if (isEmail) {
    emailResult = await sendAccessLinkEmail({ to: contact, link, reportType: cleanReportType });
  }

  await recordTransaction({ method: "upi-approved", contact, utr, amount: amount || null, status: "completed", reportType: cleanReportType });
  await notify({
    event: "upi_payment_approved",
    contact,
    utr,
    amount,
    reportType: cleanReportType,
    emailSent: emailResult.sent,
  });

  res.status(200).json({ ok: true, accessToken, link, emailSent: emailResult.sent, isEmail });
}
