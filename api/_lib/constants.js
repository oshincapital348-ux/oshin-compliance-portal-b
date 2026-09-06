// Single source of truth for how long different access tokens stay valid.
// Change these here — every endpoint that checks expiry imports from this file.
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours
export const CUSTOMER_LINK_MS = 24 * 60 * 60 * 1000; // 24 hours
