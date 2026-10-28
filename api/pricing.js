import { computeFee, applyRepeatDiscount, applyPartnerRate, getTiers } from "./_lib/pricing.js";
import { getContactPaidHistory, getPartner } from "./_lib/store.js";
import { verifyAccessToken } from "./_lib/token.js";
import { PARTNER_SESSION_MS } from "./_lib/constants.js";

// Merges what used to be three separate endpoints (get-fee, get-payment-
// details, get-price-list) into one — Vercel's free Hobby plan caps a
// deployment at 12 serverless functions, and adding the chat assistant
// pushed the project to 13. Consolidating here instead of the alternative
// (paying for Vercel Pro) keeps everything free.
//
// ?mode=fee (default)  — the fee for a given project cost/report/contact
// ?mode=qr              — same, plus the UPI QR payment details
// ?mode=list             — the full tier table (no other params needed)
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const mode = req.query.mode === "qr" ? "qr" : req.query.mode === "list" ? "list" : "fee";

  if (mode === "list") {
    return res.status(200).json({ tiers: getTiers() });
  }

  const projectCost = Number(req.query.projectCost) || 0;
  const reportType = req.query.reportType === "cma" ? "cma" : "dpr";
  const contact = typeof req.query.contact === "string" ? req.query.contact : "";
  const partnerToken = typeof req.query.partnerToken === "string" ? req.query.partnerToken : "";

  const normalFee = computeFee(projectCost);

  // A valid, ACTIVE partner gets the 60% rate instead of the tiered price and
  // repeat-customer discount — verified server-side from the signed token and
  // the live partner record, never from a browser claim.
  let fee, discount, partner = null;
  const partnerPayload = partnerToken ? verifyAccessToken(partnerToken, PARTNER_SESSION_MS) : null;
  if (partnerPayload?.mode === "partner") {
    const partnerRecord = await getPartner(partnerPayload.partnerCode);
    if (partnerRecord?.active) {
      partner = { name: partnerRecord.name, business: partnerRecord.business };
      fee = applyPartnerRate(normalFee);
      discount = null;
    }
  }
  if (fee === undefined) {
    const history = contact ? await getContactPaidHistory(contact) : null;
    ({ fee, discount } = applyRepeatDiscount(normalFee, reportType, history));
  }

  if (mode === "qr") {
    const upiId = process.env.UPI_ID;
    const payeeName = process.env.PAYEE_NAME || "Oshin Capital";
    if (!upiId) {
      return res.status(500).json({ error: "Payment is not configured yet. Set UPI_ID in environment variables." });
    }
    return res.status(200).json({ upiId, amount: fee, normalFee, discount, partner, payeeName });
  }

  // mode === "fee"
  // Razorpay issues test keys as "rzp_test_..." and live keys as
  // "rzp_live_...". Until your Razorpay account's website review clears,
  // only test keys exist — this lets the frontend know that, so it can
  // hide the "Pay online" button instead of showing customers a payment
  // flow that can never actually complete (test mode never sends a real
  // bank OTP). The moment you swap in live keys and redeploy, this flips
  // to true automatically — no other code change needed.
  const razorpayLive = Boolean(process.env.RAZORPAY_KEY_ID?.startsWith("rzp_live_"));
  res.status(200).json({ fee, normalFee, discount, partner, projectCost, razorpayLive });
}
