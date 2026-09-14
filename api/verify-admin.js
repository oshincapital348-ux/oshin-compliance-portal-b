import { signAccessToken } from "./_lib/token.js";
import { checkRateLimit, getClientIp } from "./_lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Brute-force protection: at most 5 attempts per IP every 15 minutes.
  // Without this, anyone could script thousands of guesses per minute
  // against a short admin code — a real risk once public ad traffic means
  // strangers (not just you) are hitting this endpoint.
  const ip = getClientIp(req);
  const allowed = await checkRateLimit(`admin-login:${ip}`, 5, 15 * 60);
  if (!allowed) {
    return res.status(429).json({ ok: false, error: "Too many attempts. Please wait 15 minutes and try again." });
  }

  const { code } = req.body || {};
  const submitted = typeof code === "string" ? code.trim() : "";
  const expected = typeof process.env.ADMIN_CODE === "string" ? process.env.ADMIN_CODE.trim() : "";

  // The real code lives in an environment variable on Vercel (Project
  // Settings → Environment Variables), never in this repo. Set ADMIN_CODE
  // there.
  if (!submitted || !expected || submitted !== expected) {
    return res.status(200).json({ ok: false });
  }

  const accessToken = signAccessToken({ mode: "admin" });
  res.status(200).json({ ok: true, accessToken });
}
