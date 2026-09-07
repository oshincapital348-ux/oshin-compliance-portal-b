import { getTiers } from "./_lib/pricing.js";

// Returns the exact same tiers computeFee() uses, so the price list shown
// on the page can never drift out of sync with what a customer is actually
// charged — there's only one source of truth (PRICING_TIERS in Vercel).
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  res.status(200).json({ tiers: getTiers() });
}
