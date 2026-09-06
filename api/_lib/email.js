// Sends the access link to a customer automatically the moment the admin
// approves their payment — using Resend (resend.com), which has a free tier
// generous enough for this use case and needs no domain verification to get
// started (though verifying your own domain later improves deliverability
// and stops emails landing in spam).
//
// Setup: sign up free at resend.com, grab an API key, set RESEND_API_KEY in
// Vercel. Optionally set RESEND_FROM_EMAIL once you verify your own domain
// there (until then it falls back to Resend's shared test sender, which
// works but is more likely to be flagged as spam by some inboxes).
//
// If RESEND_API_KEY isn't set, this silently does nothing — the admin panel
// falls back to showing the link for manual copy/send, so nothing breaks.
export async function sendAccessLinkEmail({ to, link, reportType }) {
  if (!process.env.RESEND_API_KEY) return { sent: false, reason: "not-configured" };

  const reportLabel = reportType === "cma" ? "CMA / Working Capital" : "Project Report (DPR)";
  // Defaults to your real support address. This only actually works once
  // oshin-capital.com is verified on Resend (see setup notes) — until then,
  // Resend will reject sends from an unverified domain. Override with
  // RESEND_FROM_EMAIL=Oshin Capital <onboarding@resend.dev> temporarily
  // while verification is pending, if you want emails flowing immediately.
  const from = process.env.RESEND_FROM_EMAIL || "Oshin Capital <support@oshin-capital.com>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        reply_to: "support@oshin-capital.com",
        subject: `Your ${reportLabel} report is ready to generate`,
        html: `
          <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
            <h2 style="margin-bottom: 4px;">Payment confirmed</h2>
            <p>Thanks — we've confirmed your payment. Click below to generate your <b>${reportLabel}</b> report:</p>
            <p style="margin: 24px 0;">
              <a href="${link}" style="background:#c9a24b;color:#1a1a1a;padding:12px 20px;text-decoration:none;border-radius:4px;font-weight:bold;display:inline-block;">
                Open your report
              </a>
            </p>
            <p style="font-size: 13px; color: #666;">This link is valid for 24 hours and can be used once. If you have any trouble, reply to this email or WhatsApp us at +91 95039 45982.</p>
          </div>
        `,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("Resend email failed:", res.status, errText);
      return { sent: false, reason: "send-failed" };
    }
    return { sent: true };
  } catch (err) {
    console.error("Resend email error:", err);
    return { sent: false, reason: "network-error" };
  }
}
