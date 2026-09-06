// Tiered pricing based on the customer's entered project cost. Configured
// entirely through the PRICING_TIERS environment variable — only whoever
// has Vercel dashboard access (the super admin) can change prices.
//
// Format: "maxProjectCost:feeInRupees,maxProjectCost:feeInRupees,..."
// e.g. "100000:99,200000:199,500000:299,1000000:499,2500000:799,5000000:1299"
// means: project cost up to ₹1,00,000 → ₹99 fee; up to ₹2,00,000 → ₹199; etc.
// Anything above the highest bracket uses that top bracket's fee.
const DEFAULT_TIERS = "100000:99,200000:199,500000:299,1000000:499,2500000:799,5000000:1299,10000000:1999";

export function getTiers() {
  const raw = process.env.PRICING_TIERS || DEFAULT_TIERS;
  return raw
    .split(",")
    .map((pair) => {
      const [maxCost, fee] = pair.split(":").map(Number);
      return { maxCost, fee };
    })
    .filter((t) => Number.isFinite(t.maxCost) && Number.isFinite(t.fee))
    .sort((a, b) => a.maxCost - b.maxCost);
}

export function computeFee(projectCost) {
  const tiers = getTiers();
  if (tiers.length === 0) return 499; // safety fallback if PRICING_TIERS is malformed
  const cost = Number(projectCost) || 0;
  for (const t of tiers) {
    if (cost <= t.maxCost) return t.fee;
  }
  return tiers[tiers.length - 1].fee; // above the highest bracket — use the top tier's fee
}
