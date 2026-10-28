import { verifyAccessToken, signAccessToken } from "./_lib/token.js";
import { PARTNER_SESSION_MS, ADMIN_SESSION_MS } from "./_lib/constants.js";
import {
  savePartnerApplication,
  listPartnerApplications,
  updatePartnerApplicationStatus,
  createPartner,
  getPartner,
  setPartnerActive,
  indexPartnerCode,
  listPartners,
  getPartnerHistory,
  notify,
  checkRateLimit,
  getClientIp,
} from "./_lib/store.js";
import { sendPartnerApprovalEmail, sendAdminPartnerApplicationAlert } from "./_lib/email.js";

// One endpoint, several actions — consolidated to stay within Vercel's
// 12-function Hobby limit. Public: apply, login. Partner-only: session,
// history. Admin-only: list-applications, approve, reject, list-partners,
// set-active.
function requireAdmin(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const payload = verifyAccessToken(token, ADMIN_SESSION_MS);
  return payload?.mode === "admin";
}

function requirePartner(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const payload = verifyAccessToken(token, PARTNER_SESSION_MS);
  return payload?.mode === "partner" ? payload : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action } = req.body || {};

  if (action === "apply") {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`partner-apply:${ip}`, 3, 60 * 60);
    if (!allowed) return res.status(429).json({ ok: false, error: "Too many applications from this device. Please try again later." });

    const { name, business, email, mobile } = req.body || {};
    if (!name || !business || !email || !mobile) {
      return res.status(400).json({ ok: false, error: "Please fill in all fields." });
    }
    const app = await savePartnerApplication({ name, business, email, mobile });
    await notify({ event: "partner_application_submitted", name, business, email, mobile });
    // Email the admin even if saving failed, so an application is never lost
    // silently. Best-effort: a failed email must not fail the application.
    await sendAdminPartnerApplicationAlert({ name, business, email, mobile }).catch(() => {});
    return res.status(200).json({ ok: Boolean(app) });
  }

  if (action === "login") {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(`partner-login:${ip}`, 8, 15 * 60);
    if (!allowed) return res.status(429).json({ ok: false, error: "Too many attempts. Please wait 15 minutes and try again." });

    const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
    const partner = await getPartner(code);
    if (!partner || !partner.active) {
      return res.status(200).json({ ok: false, error: "Invalid or inactive partner code." });
    }
    const accessToken = signAccessToken({ mode: "partner", partnerCode: partner.code, name: partner.name, business: partner.business });
    return res.status(200).json({ ok: true, accessToken, partner: { name: partner.name, business: partner.business, code: partner.code } });
  }

  if (action === "session") {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const payload = verifyAccessToken(token, PARTNER_SESSION_MS);
    if (payload?.mode !== "partner") return res.status(200).json({ ok: false });
    const partner = await getPartner(payload.partnerCode);
    if (!partner || !partner.active) return res.status(200).json({ ok: false });
    return res.status(200).json({ ok: true, partner: { name: partner.name, business: partner.business, code: partner.code } });
  }

  if (action === "history") {
    const partnerPayload = requirePartner(req);
    if (!partnerPayload) return res.status(401).json({ ok: false, error: "Not authorized" });
    const history = await getPartnerHistory(partnerPayload.partnerCode);
    return res.status(200).json({ ok: true, history });
  }

  // ---- Admin-only actions below ----
  if (!requireAdmin(req)) return res.status(401).json({ ok: false, error: "Not authorized" });

  if (action === "list-applications") {
    const apps = await listPartnerApplications();
    return res.status(200).json({ ok: true, apps });
  }

  if (action === "approve") {
    const { id, name, business, email, mobile } = req.body || {};
    if (!id || !email) return res.status(400).json({ ok: false, error: "Missing application details." });

    const partner = await createPartner({ name, business, email, mobile });
    if (!partner) return res.status(500).json({ ok: false, error: "Could not create partner — is storage configured?" });

    await indexPartnerCode(partner.code);
    await updatePartnerApplicationStatus(id, "approved");
    const emailResult = await sendPartnerApprovalEmail({ to: email, name, code: partner.code });
    await notify({ event: "partner_approved", name, business, email, code: partner.code });

    return res.status(200).json({ ok: true, code: partner.code, emailSent: emailResult.sent });
  }

  if (action === "reject") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: "Missing application id." });
    await updatePartnerApplicationStatus(id, "rejected");
    return res.status(200).json({ ok: true });
  }

  if (action === "list-partners") {
    const partners = await listPartners();
    return res.status(200).json({ ok: true, partners });
  }

  if (action === "set-active") {
    const { code, active } = req.body || {};
    if (!code) return res.status(400).json({ ok: false, error: "Missing partner code." });
    await setPartnerActive(code, Boolean(active));
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: "Unknown action." });
}
