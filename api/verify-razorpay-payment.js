import crypto from "crypto";
import Razorpay from "razorpay";
import { signAccessToken } from "./_lib/token.js";
import { recordTransaction, notify } from "./_lib/store.js";

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

  // Look up the actual charged amount AND the report type from Razorpay
  // itself (authoritative — never trust anything claimed by the browser at
  // this point) so the access token is locked to what was actually paid
  // for, and activity tracking shows exactly what happened.
  let amountRupees = null;
  let projectCost = null;
  let reportType = "dpr";
  try {
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    const order = await razorpay.orders.fetch(razorpay_order_id);
    amountRupees = order.amount / 100;
    projectCost = order.notes?.projectCost || null;
    reportType = order.notes?.reportType === "cma" ? "cma" : "dpr";
  } catch (err) {
    console.error("Could not fetch order for amount record:", err);
  }

  // The token is bound to this specific report type. A payment made while
  // looking at the DPR tool cannot later be used to unlock a CMA download
  // (or vice versa) by switching tabs after paying — enforced again
  // server-side in consume-access.js, not just in the UI.
  const accessToken = signAccessToken({
    mode: "paid",
    reportType,
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
  });

  await recordTransaction({ method: "razorpay", utr: razorpay_payment_id, amount: amountRupees, status: "completed", reportType });
  await notify({
    event: "payment_completed",
    method: "razorpay",
    paymentId: razorpay_payment_id,
    orderId: razorpay_order_id,
    amount: amountRupees,
    projectCost,
    reportType,
  });

  res.status(200).json({ ok: true, accessToken, reportType });
}
