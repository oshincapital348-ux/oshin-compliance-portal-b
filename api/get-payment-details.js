// Returns the payment details the frontend needs to build the UPI QR code.
// The UPI ID and amount live only in Vercel environment variables — nobody
// can change where money goes or how much is charged without dashboard
// access, which only the super admin has. Update these anytime in
// Vercel → Project → Settings → Environment Variables, then redeploy.

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const upiId = process.env.UPI_ID;
  const amount = process.env.REPORT_FEE_RUPEES || "499";
  const payeeName = process.env.PAYEE_NAME || "Oshin Capital";

  if (!upiId) {
    return res.status(500).json({ error: "Payment is not configured yet. Set UPI_ID in environment variables." });
  }

  res.status(200).json({ upiId, amount, payeeName });
}
