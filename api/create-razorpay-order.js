import Razorpay from "razorpay";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return res.status(500).json({ error: "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." });
  }

  // Same fee setting the free QR path uses — one place to change the price
  // for both payment methods. REPORT_FEE_RUPEES is in whole rupees; Razorpay
  // wants paise (rupees × 100).
  const feeRupees = Number(process.env.REPORT_FEE_RUPEES) || 499;
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
    });

    res.status(200).json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    // Log the real Razorpay error server-side (visible via `vercel logs`)
    // so a bad-key problem is diagnosable, without leaking details to the browser.
    console.error("Razorpay order creation failed:", err?.error || err);
    res.status(500).json({ error: "Could not create order" });
  }
}
