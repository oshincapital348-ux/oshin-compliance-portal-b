import { verifyAccessToken } from "./_lib/token.js";
import { getStats } from "./_lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization || "";
  const adminToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const adminPayload = verifyAccessToken(adminToken, 12 * 60 * 60 * 1000);

  if (!adminPayload || adminPayload.mode !== "admin") {
    return res.status(401).json({ error: "Not authorized" });
  }

  const stats = await getStats(50);
  res.status(200).json(stats);
}
