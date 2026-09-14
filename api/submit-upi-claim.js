import { recordTransaction, notify, checkRateLimit, getClientIp } from "./_lib/store.js";
import { sendAdminClaimAlert } from "./_lib/email.js";

// A UPI claim is the customer SAYING they paid — not proof. It gets recorded
// as "pending" (doesn't count toward the report total) and triggers a
// notification so the admin knows to check their bank app and approve it
// from the admin panel.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // A real customer submits this once per payment — 5 per hour is generous,
  // but stops someone spamming your alert inbox with fake claims.
  const ip = getClientIp(req);
  const allowed = await checkRateLimit(`upi-claim:${ip}`, 5, 60 * 60);
  if (!allowed) {
    return res.status(429).json({ error: "Too many submissions. Please contact support directly if you need help." });
  }

  const { utr, contact, amount, reportType } = req.body || {};
  if (!utr || !contact) return res.status(400).json({ error: "Missing fields" });

  const cleanReportType = reportType === "cma" ? "cma" : "dpr";

  await recordTransaction({ method: "upi-claim", utr, contact, amount: amount || null, status: "pending", reportType: cleanReportType });
  await notify({ event: "upi_claim_submitted", utr, contact, amount, reportType: cleanReportType });
  // Best-effort — if this fails, the claim is still recorded and visible in
  // the admin panel, it just means you have to notice it there instead.
  await sendAdminClaimAlert({ utr, contact, amount, reportType: cleanReportType }).catch(() => {});

  res.status(200).json({ ok: true });
}
