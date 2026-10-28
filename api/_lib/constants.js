// Single source of truth for how long different access tokens stay valid.
// Change these here — every endpoint that checks expiry imports from this file.
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours
// 72 hours, not 24 — the chat assistant lets customers refine their report
// over multiple sessions (fill in details, download, ask for changes, want
// to re-download the corrected version), which can reasonably span a
// couple of days. 24h was too tight for that real workflow.
export const CUSTOMER_LINK_MS = 72 * 60 * 60 * 1000; // 72 hours
// Partners log in once and come back repeatedly to generate reports for
// their own customers — a week-long session avoids making them re-enter
// their code constantly, while still expiring eventually.
export const PARTNER_SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
