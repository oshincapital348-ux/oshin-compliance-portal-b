import { signAccessToken } from "./_lib/token.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { code } = req.body || {};
  const submitted = typeof code === "string" ? code.trim() : "";
  const expected = typeof process.env.ADMIN_CODE === "string" ? process.env.ADMIN_CODE.trim() : "";

  // The real code lives in an environment variable on Vercel (Project
  // Settings → Environment Variables), never in this repo. Set ADMIN_CODE
  // there. This still isn't a full auth system (no rate limiting, no
  // rotation) — fine for one internal admin, not for a real login system.
  if (!submitted || !expected || submitted !== expected) {
    return res.status(200).json({ ok: false });
  }

  const accessToken = signAccessToken({ mode: "admin" });
  res.status(200).json({ ok: true, accessToken });
}
