// Cloudflare Pages Function — contact form submission
// Route: POST /api/contact
//
// Required env vars (Cloudflare Pages Dashboard > Settings > Environment Variables):
//   RESEND_API_KEY   — re_... (never sent to the browser, never logged)
//   FROM_EMAIL       — sender address for both emails this endpoint sends
//   SUPPORT_EMAIL    — where the customer's message is delivered
//   REPLY_TO_EMAIL   — optional; if unset, SUPPORT_EMAIL is used as reply-to
//
// Flow:
//   1. Validate + spam-check the submission.
//   2. Send the message to SUPPORT_EMAIL.
//   3. Send a short acknowledgment to the customer.
// Step 3 only runs if step 2 succeeds — no point acknowledging a message the
// team never received. If step 3 fails, the submission is still reported as
// successful to the browser (the important delivery already happened); the
// failure is only logged server-side.

import { sendEmail, stableIdempotencyKey } from '../_lib/resend.js';

const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_ORDER = 40;
const MIN_MESSAGE = 10;
const MAX_MESSAGE = 5000;
const THROTTLE_SECONDS = 30;

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }

  if (!env.RESEND_API_KEY || !env.FROM_EMAIL || !env.SUPPORT_EMAIL) {
    console.error('[contact] Missing required env var (RESEND_API_KEY / FROM_EMAIL / SUPPORT_EMAIL)');
    return json({ error: 'Contact form is not configured — email us directly.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  // ── Honeypot ────────────────────────────────────────────────────────────────
  // Real users never see or fill this field (hidden via CSS in contact.html).
  // Bots that blindly fill every input do. Pretend success without sending
  // anything, so the bot gets no signal that it was caught.
  if (String(body.company || '').trim() !== '') {
    return json({ ok: true }, 200);
  }

  let fields;
  try {
    fields = validate(body);
  } catch (err) {
    if (err instanceof ValidationError) return json({ error: err.message }, 400);
    throw err;
  }

  // ── Basic rate limiting ──────────────────────────────────────────────────────
  // Best-effort, same-edge only (Cache API — no extra bindings). One
  // submission per IP per THROTTLE_SECONDS. Not a substitute for real abuse
  // protection at scale, but enough to stop naive repeat-submit spam.
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (await isThrottled(ip)) {
    return json({ error: 'Please wait a moment before sending another message.' }, 429);
  }
  await markThrottled(ip);

  // ── Send to support ───────────────────────────────────────────────────────────
  const supportResult = await sendEmail({
    env,
    to: env.SUPPORT_EMAIL,
    replyTo: fields.email,
    subject: `Contact form: ${fields.name}${fields.orderNumber ? ' (' + fields.orderNumber + ')' : ''}`,
    html: supportNotificationHtml(fields),
    text: supportNotificationText(fields),
  });

  if (!supportResult.ok) {
    console.error('[contact] Failed to deliver to support:', supportResult.error);
    return json({ error: 'Could not send your message right now — please email support@thedeangeloseries.com directly.' }, 502);
  }

  // ── Acknowledge to the customer ───────────────────────────────────────────────
  // Only attempted after the team's copy is confirmed sent. A failure here is
  // logged, not surfaced — the message still reached support.
  const ackKey = await stableIdempotencyKey(['contact-ack', fields.email, fields.message], THROTTLE_SECONDS);
  const ackResult = await sendEmail({
    env,
    to: fields.email,
    subject: 'We received your message — The DeAngelo Series',
    html: acknowledgmentHtml(fields),
    text: acknowledgmentText(fields),
    idempotencyKey: ackKey,
  });
  if (!ackResult.ok) {
    console.error('[contact] Support copy sent, but acknowledgment to customer failed:', ackResult.error);
  }

  return json({ ok: true }, 200);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
class ValidationError extends Error {}

function validate(body) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const orderNumber = String(body.order_number || '').trim();
  const message = String(body.message || '').trim();

  if (!name) throw new ValidationError('Name is required.');
  if (name.length > MAX_NAME) throw new ValidationError('Name is too long.');

  if (!email || email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('A valid email address is required.');
  }

  if (orderNumber.length > MAX_ORDER) throw new ValidationError('Order number is too long.');

  if (!message || message.length < MIN_MESSAGE) {
    throw new ValidationError('Message is too short.');
  }
  if (message.length > MAX_MESSAGE) throw new ValidationError('Message is too long.');

  return { name, email, orderNumber, message };
}

// ---------------------------------------------------------------------------
// Email content
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function supportNotificationHtml(f) {
  return `<div style="font-family:-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#0A0A0A;">
    <p><strong>Name:</strong> ${escapeHtml(f.name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(f.email)}</p>
    ${f.orderNumber ? `<p><strong>Order number:</strong> ${escapeHtml(f.orderNumber)}</p>` : ''}
    <p><strong>Message:</strong></p>
    <p style="white-space:pre-wrap;">${escapeHtml(f.message)}</p>
  </div>`;
}
function supportNotificationText(f) {
  return `Name: ${f.name}\nEmail: ${f.email}\n${f.orderNumber ? 'Order number: ' + f.orderNumber + '\n' : ''}\nMessage:\n${f.message}`;
}

function acknowledgmentHtml(f) {
  return `<div style="font-family:-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#0A0A0A;">
    <p>Hi ${escapeHtml(f.name)},</p>
    <p>Thanks for reaching out to The DeAngelo Series. We've received your message and will reply within one business day.</p>
    <p style="color:#6b6b66;">For reference, here's what you sent:</p>
    <p style="white-space:pre-wrap;color:#6b6b66;border-left:2px solid #e5e4dd;padding-left:12px;">${escapeHtml(f.message)}</p>
  </div>`;
}
function acknowledgmentText(f) {
  return `Hi ${f.name},\n\nThanks for reaching out to The DeAngelo Series. We've received your message and will reply within one business day.\n\nFor reference, here's what you sent:\n${f.message}`;
}

// ---------------------------------------------------------------------------
// Rate limiting — Cache API, same pattern as stripe-webhook.js's idempotency.
// ---------------------------------------------------------------------------
function throttleKey(ip) {
  return new Request('https://internal.invalid/contact-throttle/' + encodeURIComponent(ip));
}
async function isThrottled(ip) {
  return !!(await caches.default.match(throttleKey(ip)));
}
async function markThrottled(ip) {
  const marker = new Response('1', { headers: { 'Cache-Control': `max-age=${THROTTLE_SECONDS}` } });
  await caches.default.put(throttleKey(ip), marker);
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
