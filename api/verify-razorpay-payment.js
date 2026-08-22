import crypto from "crypto";
import { signAccessToken } from "./_lib/token.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ ok: false, error: "Missing fields" });
  }

  // Recompute the expected signature server-side using your secret key.
  // This is the ONLY trustworthy way to confirm a Razorpay payment succeeded —
  // never trust a client saying "payment done" without this check.
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expected !== razorpay_signature) {
    return res.status(400).json({ ok: false, error: "Signature mismatch" });
  }

  const accessToken = signAccessToken({ mode: "paid", orderId: razorpay_order_id, paymentId: razorpay_payment_id });
  res.status(200).json({ ok: true, accessToken });
}
