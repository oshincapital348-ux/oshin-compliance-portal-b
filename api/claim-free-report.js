import { signAccessToken } from "./_lib/token.js";
import { computeFee, applyRepeatDiscount } from "./_lib/pricing.js";
import { getContactPaidHistory, recordTransaction, recordContactPaid, notify } from "./_lib/store.js";

// When a repeat-customer discount brings the fee all the way to ₹0, there's
// nothing to actually charge — Razorpay has a minimum order amount, and a
// "scan this QR to pay ₹0" doesn't make sense. This mints the access token
// directly, but ONLY after recomputing the discount server-side and
// confirming it really is zero — the amount is never trusted from the browser.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { projectCost, reportType, contact } = req.body || {};
  const cleanReportType = reportType === "cma" ? "cma" : "dpr";
  const cleanContact = typeof contact === "string" ? contact : "";

  const normalFee = computeFee(Number(projectCost) || 0);
  const history = cleanContact ? await getContactPaidHistory(cleanContact) : null;
  const { fee } = applyRepeatDiscount(normalFee, cleanReportType, history);

  if (fee > 0) {
    // Someone tried to call this directly without actually qualifying for a
    // full discount — refuse, don't just trust the client's claim.
    return res.status(400).json({ ok: false, error: "This report is not fully covered by a previous payment." });
  }

  const accessToken = signAccessToken({ mode: "paid", reportType: cleanReportType, approvedFor: cleanContact || null, freeViaDiscount: true });

  await recordTransaction({ method: "repeat-discount", contact: cleanContact, amount: 0, status: "completed", reportType: cleanReportType });
  // Still record it (at ₹0) — keeps the discount history chain intact in
  // case they come back a third time for a re-download or another tier.
  await recordContactPaid(cleanContact, cleanReportType, 0);
  await notify({ event: "free_report_claimed_via_discount", contact: cleanContact, reportType: cleanReportType });

  res.status(200).json({ ok: true, accessToken, reportType: cleanReportType });
}
