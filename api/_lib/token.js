import crypto from "crypto";

// A minimal signed token (not a full JWT library) so the frontend can prove
// to itself "I was actually granted access" without storing anything in a
// database. Good enough for gating a single-page tool; if you later want
// sessions that persist across days/devices, swap this for real JWTs + a
// datastore.
export function signAccessToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ACCESS_TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAccessToken(token, maxAgeMs = null) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", process.env.ACCESS_TOKEN_SECRET).update(body).digest("base64url");
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (maxAgeMs && (Date.now() - payload.iat > maxAgeMs)) return null; // expired
    return payload;
  } catch {
    return null;
  }
}
