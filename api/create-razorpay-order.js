import Razorpay from "razorpay";
import { computeFee, applyRepeatDiscount, applyPartnerRate } from "./_lib/pricing.js";
import { getContactPaidHistory, getPartner, checkRateLimit, getClientIp } from "./_lib/store.js";
import { verifyAccessToken } from "./_lib/token.js";
import { PARTNER_SESSION_MS } from "./_lib/constants.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return res.status(500).json({ error: "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." });
  }

  // A real customer creates one order per attempted payment — this just
  // stops a script from spamming Razorpay order creation.
  const ip = getClientIp(req);
  const allowed = await checkRateLimit(`razorpay-order:${ip}`, 15, 10 * 60);
  if (!allowed) {
    return res.status(429).json({ error: "Too many payment attempts. Please wait a few minutes and try again." });
  }

  // The fee is computed HERE, server-side, from the tier the customer's
  // project cost falls into — never trust a fee amount sent from the
  // browser. The client only tells us the project cost; we decide the price.
  const projectCost = Number(req.body?.projectCost) || 0;
  const reportType = req.body?.reportType === "cma" ? "cma" : "dpr";
  const contact = typeof req.body?.contact === "string" ? req.body.contact : "";
  const partnerToken = typeof req.body?.partnerToken === "string" ? req.body.partnerToken : "";

  const normalFee = computeFee(projectCost);

  // An ACTIVE partner gets the 60% rate instead of the normal price and the
  // repeat-customer discount — verified server-side from the signed token and
  // the live partner record, same principle as every other price here.
  let feeRupees, partnerCode = null;
  const partnerPayload = partnerToken ? verifyAccessToken(partnerToken, PARTNER_SESSION_MS) : null;
  if (partnerPayload?.mode === "partner") {
    const partnerRecord = await getPartner(partnerPayload.partnerCode);
    if (partnerRecord?.active) {
      feeRupees = applyPartnerRate(normalFee);
      partnerCode = partnerRecord.code;
    }
  }
  if (feeRupees === undefined) {
    // A customer who already paid for the other report type on this contact
    // gets the difference credited — computed server-side from real payment history.
    const history = contact ? await getContactPaidHistory(contact) : null;
    feeRupees = applyRepeatDiscount(normalFee, reportType, history).fee;
  }
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
      notes: { projectCost: String(projectCost), reportType, contact: contact || "", partnerCode: partnerCode || "" },
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
