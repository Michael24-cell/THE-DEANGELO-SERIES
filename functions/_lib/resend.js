// Shared server-side Resend email helper.
// Lives under functions/_lib/ — Cloudflare Pages excludes any `_`-prefixed
// path from routing, so this file is never itself reachable as an endpoint.
// It is imported by functions/api/*.js route handlers.
//
// Required env vars (Cloudflare Pages Dashboard > Settings > Environment Variables):
//   RESEND_API_KEY   — re_... (never sent to the browser, never logged)
//   FROM_EMAIL       — e.g. orders@thedeangeloseries.com (the From: address)
// One of, for the Reply-To address (REPLY_TO_EMAIL takes priority):
//   REPLY_TO_EMAIL
//   SUPPORT_EMAIL
//
// sendEmail() never throws — every failure mode (missing config, network
// error, non-2xx from Resend) returns { ok: false, error } instead. This is
// deliberate: callers that trigger email as a side effect of something more
// important (an order webhook, a payment confirmation) must be able to
// `await sendEmail(...)` without a try/catch and safely ignore a failed
// result — an email failure must never throw, retry the caller, or block/
// duplicate the thing that triggered the email (e.g. an order record).

/**
 * @param {object} args
 * @param {object} args.env - context.env from a Pages Function
 * @param {string|string[]} args.to
 * @param {string} args.subject
 * @param {string} args.html
 * @param {string} [args.text]
 * @param {string} [args.replyTo] - overrides REPLY_TO_EMAIL/SUPPORT_EMAIL if provided
 * @param {string} [args.idempotencyKey] - pass the same key on retry to dedupe on Resend's side
 * @returns {Promise<{ok: true, id: string} | {ok: false, error: string, status?: number}>}
 */
export async function sendEmail({ env, to, subject, html, text, replyTo, idempotencyKey }) {
  if (!env?.RESEND_API_KEY) {
    console.error('[resend] Missing env var: RESEND_API_KEY');
    return { ok: false, error: 'Email is not configured (missing API key).' };
  }
  if (!env?.FROM_EMAIL) {
    console.error('[resend] Missing env var: FROM_EMAIL');
    return { ok: false, error: 'Email is not configured (missing From address).' };
  }
  if (!to || !subject || !html) {
    return { ok: false, error: 'sendEmail requires to, subject, and html.' };
  }

  const reply = replyTo || env.REPLY_TO_EMAIL || env.SUPPORT_EMAIL || undefined;

  const payload = {
    from: env.FROM_EMAIL,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (text) payload.text = text;
  if (reply) payload.reply_to = reply;

  const headers = {
    Authorization: 'Bearer ' + env.RESEND_API_KEY,
    'Content-Type': 'application/json',
  };
  // Lets Resend collapse genuine retries of the same logical email into a
  // single send instead of mailing the customer twice.
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[resend] Network error sending email:', err.message);
    return { ok: false, error: 'Network error contacting Resend.' };
  }

  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error body — fall through */ }

  if (!res.ok) {
    // Log Resend's diagnostic message, never the Authorization header/API key.
    console.error('[resend] Send failed:', res.status, data?.message || data?.name || 'unknown error');
    return { ok: false, status: res.status, error: data?.message || 'Resend rejected the request.' };
  }

  return { ok: true, id: data.id };
}

/**
 * Derives a stable idempotency key from request content so accidental
 * double-submits (double-click, a client retry) within `windowSeconds`
 * collapse to the same Resend Idempotency-Key instead of sending twice.
 * Not cryptographic — just a stable, short digest.
 */
export async function stableIdempotencyKey(parts, windowSeconds = 60) {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const input = [...parts, bucket].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
