// Zero-cost path: no payment API is called here. The user submits their UTR,
// and this just needs to land somewhere you'll see it — email, Slack, a
// spreadsheet, whatever you already use. Wire ONE of the options below.
//
// Cheapest/simplest for a solo operator: a free email-forwarding webhook
// (e.g. Formspree free tier) or logging to a free Google Sheet via Apps
// Script. Both cost nothing and need no server of your own.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { utr, contact } = req.body || {};
  if (!utr || !contact) return res.status(400).json({ error: "Missing fields" });

  // TODO: replace with a real notification, e.g.:
  // await fetch(process.env.NOTIFY_WEBHOOK_URL, {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify({ utr, contact, at: new Date().toISOString() }),
  // });

  console.log("UPI claim received:", { utr, contact, at: new Date().toISOString() });

  res.status(200).json({ ok: true });
}
