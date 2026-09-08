import { computeFee, applyRepeatDiscount } from "./_lib/pricing.js";
import { getContactPaidHistory } from "./_lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const projectCost = Number(req.query.projectCost) || 0;
  const reportType = req.query.reportType === "cma" ? "cma" : "dpr";
  const contact = typeof req.query.contact === "string" ? req.query.contact : "";

  const normalFee = computeFee(projectCost);
  const history = contact ? await getContactPaidHistory(contact) : null;
  const { fee, discount } = applyRepeatDiscount(normalFee, reportType, history);

  // Razorpay issues test keys as "rzp_test_..." and live keys as
  // "rzp_live_...". Until your Razorpay account's website review clears,
  // only test keys exist — this lets the frontend know that, so it can
  // hide the "Pay online" button instead of showing customers a payment
  // flow that can never actually complete (test mode never sends a real
  // bank OTP). The moment you swap in live keys and redeploy, this flips
  // to true automatically — no other code change needed.
  const razorpayLive = Boolean(process.env.RAZORPAY_KEY_ID?.startsWith("rzp_live_"));

  res.status(200).json({ fee, normalFee, discount, projectCost, razorpayLive });
}
