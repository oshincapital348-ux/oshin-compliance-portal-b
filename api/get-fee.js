import { computeFee } from "./_lib/pricing.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const projectCost = Number(req.query.projectCost) || 0;
  const fee = computeFee(projectCost);

  // Razorpay issues test keys as "rzp_test_..." and live keys as
  // "rzp_live_...". Until your Razorpay account's website review clears,
  // only test keys exist — this lets the frontend know that, so it can
  // hide the "Pay online" button instead of showing customers a payment
  // flow that can never actually complete (test mode never sends a real
  // bank OTP). The moment you swap in live keys and redeploy, this flips
  // to true automatically — no other code change needed.
  const razorpayLive = Boolean(process.env.RAZORPAY_KEY_ID?.startsWith("rzp_live_"));

  res.status(200).json({ fee, projectCost, razorpayLive });
}
