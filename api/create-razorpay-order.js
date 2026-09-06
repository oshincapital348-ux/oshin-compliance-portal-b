import Razorpay from "razorpay";
import { computeFee } from "./_lib/pricing.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return res.status(500).json({ error: "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." });
  }

  // The fee is computed HERE, server-side, from the tier the customer's
  // project cost falls into — never trust a fee amount sent from the
  // browser. The client only tells us the project cost; we decide the price.
  const projectCost = Number(req.body?.projectCost) || 0;
  const feeRupees = computeFee(projectCost);
  const feePaise = Math.round(feeRupees * 100);

  // Which report this payment is for ("dpr" | "cma"). Stored on the Razorpay
  // order itself (authoritative, fetched fresh at verify time) so the access
  // token minted after payment can be locked to this report type — a DPR
  // payment can never be used to unlock a CMA download, or vice versa.
  const reportType = req.body?.reportType === "cma" ? "cma" : "dpr";

  try {
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const order = await razorpay.orders.create({
      amount: feePaise,
      currency: "INR",
      receipt: `report_${Date.now()}`,
      notes: { projectCost: String(projectCost), reportType },
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
