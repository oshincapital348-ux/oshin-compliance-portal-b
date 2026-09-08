import { computeFee, applyRepeatDiscount } from "./_lib/pricing.js";
import { getContactPaidHistory } from "./_lib/store.js";

// Returns the payment details the frontend needs to build the UPI QR code.
// The UPI ID lives only in Vercel environment variables — nobody can change
// where money goes without dashboard access, which only the super admin has.
// The amount is computed from the tiered pricing based on the customer's
// entered project cost, minus any repeat-customer discount they've earned.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const upiId = process.env.UPI_ID;
  const payeeName = process.env.PAYEE_NAME || "Oshin Capital";
  const projectCost = Number(req.query.projectCost) || 0;
  const reportType = req.query.reportType === "cma" ? "cma" : "dpr";
  const contact = typeof req.query.contact === "string" ? req.query.contact : "";

  const normalFee = computeFee(projectCost);
  const history = contact ? await getContactPaidHistory(contact) : null;
  const { fee: amount, discount } = applyRepeatDiscount(normalFee, reportType, history);

  if (!upiId) {
    return res.status(500).json({ error: "Payment is not configured yet. Set UPI_ID in environment variables." });
  }

  res.status(200).json({ upiId, amount, normalFee, discount, payeeName });
}
