// Cloudflare Pages Function — Stripe webhook
// Route: POST /api/stripe-webhook
// Event: checkout.session.completed
//
// Required secrets (Cloudflare Pages Dashboard > Settings > Environment Variables):
//   STRIPE_SECRET_KEY       — sk_test_... (test) or sk_live_... (live)
//   STRIPE_WEBHOOK_SECRET   — whsec_... from Stripe Dashboard > Webhooks > endpoint secret
//
// Stripe webhook endpoint URL: https://thedeangeloseries.com/api/stripe-webhook
// Selected event: checkout.session.completed

import Stripe from 'stripe';

export async function onRequest({ request, env }) {
  // ── Method guard ──────────────────────────────────────────────────────────────
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }

  // ── Env guard ─────────────────────────────────────────────────────────────────
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe-webhook] Missing required environment variables');
    return json({ error: 'Server misconfiguration — contact site owner' }, 500);
  }

  // ── Signature check ───────────────────────────────────────────────────────────
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    console.warn('[stripe-webhook] Missing stripe-signature header');
    return json({ error: 'Missing stripe-signature header' }, 400);
  }

  // Read raw body — must not be consumed before signature verification
  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return json({ error: 'Failed to read request body' }, 400);
  }

  // ── Verify signature (Web Crypto — Workers-compatible, no Node.js crypto) ─────
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
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

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
