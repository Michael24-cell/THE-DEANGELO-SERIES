// Pure helpers for the product-reviews system — token generation/hashing and
// moderation-link signing. No D1, no fetch, no env (except where a secret is
// explicitly passed in) — mirrors functions/_lib/financials.js's "pure
// helpers live separately from the D1 calls" split. The D1 queries that use
// these live in functions/_lib/orders-db.js; the email templates that embed
// their output live in functions/_lib/email-templates.js.

/**
 * A new one-time review token. 32 random bytes, hex-encoded (256 bits of
 * entropy — unguessable). The RAW value goes in the email link; only its
 * hash (see hashToken) is ever stored, per review_tokens' own schema
 * comment ("Store a hash of the token, never the token itself").
 */
export function generateReviewToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex digest — one-way, so a leaked database row never reveals a usable token. */
export async function hashToken(rawToken) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(rawToken));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * HMAC-SHA256 signature for a one-click moderation link, so
 * /api/moderate-review can't be driven by anyone who merely guesses a
 * review id — same fail-closed, signed-link approach as the rest of this
 * codebase's webhook verification. Signs `${reviewId}.${action}`.
 */
export async function signModerationAction(reviewId, action, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${reviewId}.${action}`));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time verification of signModerationAction's output. */
export async function verifyModerationAction(reviewId, action, signature, secret) {
  if (!signature) return false;
  const expected = await signModerationAction(reviewId, action, secret);
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < signature.length; i++) diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
