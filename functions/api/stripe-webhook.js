// Cloudflare Pages Function — Stripe webhook
// Route: POST /api/stripe-webhook
// Event: checkout.session.completed
//
// Zero npm dependencies — uses Web Crypto API (HMAC-SHA256) for signature verification.
// This is the same algorithm stripe.webhooks.constructEvent() uses internally.
//
// Required secrets (Cloudflare Pages Dashboard > Settings > Environment Variables):
//   STRIPE_SECRET_KEY       — sk_test_... (test) or sk_live_... (live)
//   STRIPE_WEBHOOK_SECRET   — whsec_... from Stripe Dashboard > Webhooks > endpoint secret
//
// Stripe webhook endpoint URL: https://thedeangeloseries.com/api/stripe-webhook
// Selected event: checkout.session.completed

export async function onRequest({ request, env }) {
  // ── Method guard ──────────────────────────────────────────────────────────────
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }

  // ── Env guard ─────────────────────────────────────────────────────────────────
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe-webhook] Missing env var: STRIPE_WEBHOOK_SECRET');
    return json({ error: 'Server misconfiguration — contact site owner' }, 500);
  }

  // ── Signature check ───────────────────────────────────────────────────────────
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    console.warn('[stripe-webhook] Missing stripe-signature header');
    return json({ error: 'Missing stripe-signature header' }, 400);
  }

  // ── Read raw body before any other processing ─────────────────────────────────
  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return json({ error: 'Failed to read request body' }, 400);
  }

  // ── Verify signature (Web Crypto HMAC-SHA256 — no npm package needed) ─────────
  let event;
  try {
    event = await verifyStripeWebhook(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return json({ error: `Webhook error: ${err.message}` }, 400);
  }

  // ── Route by event type ───────────────────────────────────────────────────────
  if (event.type !== 'checkout.session.completed') {
    console.log(`[stripe-webhook] Ignored event type: ${event.type}`);
    return json({ received: true, handled: false, type: event.type }, 200);
  }

  // ── checkout.session.completed ────────────────────────────────────────────────
  const session = event.data.object;

  const order = {
    sessionId:       session.id,
    paymentStatus:   session.payment_status,
    customerEmail:   session.customer_details?.email  ?? session.customer_email ?? null,
    customerName:    session.customer_details?.name   ?? null,
    amountTotal:     session.amount_total,   // smallest currency unit (cents for USD)
    currency:        session.currency?.toUpperCase() ?? null,
    shippingDetails: session.shipping_details
      ? { name: session.shipping_details.name, address: session.shipping_details.address }
      : null,
    metadata:        session.metadata  ?? {},
    createdAt:       new Date(session.created * 1000).toISOString(),
  };

  console.log('[stripe-webhook] checkout.session.completed\n', JSON.stringify(order, null, 2));

  // ── TODO: Printify order creation ─────────────────────────────────────────────
  // Wire after: PRINTIFY_API_TOKEN, PRINTIFY_SHOP_ID, product/variant IDs confirmed
  // Do NOT submit to Printify while in Stripe test mode
  // Check env.PRINTIFY_AUTO_SEND_TO_PRODUCTION before submitting
  // const printifyId = await createPrintifyOrder(order, env);

  // ── TODO: Order confirmation email (Resend) ───────────────────────────────────
  // Wire after: RESEND_API_KEY and email templates are configured
  // await sendOrderConfirmationEmail(order, env);

  return json({ received: true }, 200);
}

// ---------------------------------------------------------------------------
// Stripe HMAC-SHA256 signature verification using Web Crypto API.
// Equivalent to stripe.webhooks.constructEvent() but with zero dependencies.
//
// Stripe signs: HMAC-SHA256(secret, "{timestamp}.{rawBody}")
// Header format: stripe-signature: t=1234567890,v1=<hex_digest>[,v1=...]
// ---------------------------------------------------------------------------
async function verifyStripeWebhook(rawBody, signatureHeader, secret) {
  // Parse "t=timestamp,v1=hash" pairs
  const pairs = {};
  for (const part of signatureHeader.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    (pairs[k] ??= []).push(v);
  }

  const timestamp = pairs.t?.[0];
  const v1Sigs    = pairs.v1 ?? [];

  if (!timestamp || v1Sigs.length === 0) {
    throw new Error('Invalid stripe-signature header format');
  }

  // Reject replayed events older than 5 minutes
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parseInt(timestamp, 10)) > 300) {
    throw new Error('Webhook timestamp outside tolerance window');
  }

  // Compute HMAC-SHA256 of "{timestamp}.{rawBody}"
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`));
  const computed = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison across all v1 signatures (prevents timing attacks)
  const valid = v1Sigs.some(sig => {
    if (sig.length !== computed.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ computed.charCodeAt(i);
    return diff === 0;
  });

  if (!valid) throw new Error('No matching v1 signature found');

  return JSON.parse(rawBody);
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
