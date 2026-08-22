import { verifyAccessToken, signAccessToken } from "./_lib/token.js";

// Only someone holding a valid admin token (issued by /api/verify-admin,
// which requires ADMIN_CODE) can call this. It mints a "paid" access token
// for a specific customer and hands back a link — no database involved.
//
// Not a full audit trail: this doesn't record who approved what or prevent
// the same link being opened on multiple devices. Fine for a low-volume
// manual-approval flow; if that ever matters, this is the piece to upgrade
// first (needs a real datastore).
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const adminToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const adminPayload = verifyAccessToken(adminToken, 24 * 60 * 60 * 1000); // admin session valid 24h

  if (!adminPayload || adminPayload.mode !== "admin") {
    return res.status(401).json({ error: "Not authorized" });
  }

  const { contact, utr } = req.body || {};
  if (!contact) return res.status(400).json({ error: "Missing contact" });

  // Access link is valid for 7 days from generation — plenty of time for the
  // customer to open it, but not forever.
  const accessToken = signAccessToken({ mode: "paid", approvedFor: contact, utr: utr || null });

  res.status(200).json({ ok: true, accessToken });
}
