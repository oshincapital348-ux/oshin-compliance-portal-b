import Razorpay from "razorpay";
import { computeFee, applyRepeatDiscount } from "./_lib/pricing.js";
import { getContactPaidHistory } from "./_lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return res.status(500).json({ error: "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." });
  }

  // The fee is computed HERE, server-side, from the tier the customer's
  // project cost falls into — never trust a fee amount sent from the
  // browser. The client only tells us the project cost; we decide the price.
  const projectCost = Number(req.body?.projectCost) || 0;
  const reportType = req.body?.reportType === "cma" ? "cma" : "dpr";
  const contact = typeof req.body?.contact === "string" ? req.body.contact : "";

  // A customer who already paid for the other report type on this contact
  // gets the difference credited — computed server-side from real payment
  // history, never trusted from the browser, same principle as the tier fee.
  const normalFee = computeFee(projectCost);
  const history = contact ? await getContactPaidHistory(contact) : null;
  const { fee: feeRupees } = applyRepeatDiscount(normalFee, reportType, history);
  const feePaise = Math.round(feeRupees * 100);

  try {
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const order = await razorpay.orders.create({
      amount: feePaise,
      currency: "INR",
      receipt: `report_${Date.now()}`,
      notes: { projectCost: String(projectCost), reportType, contact: contact || "" },
    });

    res.status(200).json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      feeRupees,
    });
  } catch (err) {
    // Log the real Razorpay error server-side (visible via `vercel logs`)
    // so a bad-key problem is diagnosable, without leaking details to the browser.
    console.error("Razorpay order creation failed:", err?.error || err);
    res.status(500).json({ error: "Could not create order" });
  }
}
