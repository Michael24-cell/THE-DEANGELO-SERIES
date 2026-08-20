// Cloudflare Pages Function — Stripe webhook
// Route: POST /api/stripe-webhook
// Event handled: checkout.session.completed
//
// Zero npm dependencies — uses Web Crypto API (HMAC-SHA256) for signature verification.
// This is the same algorithm stripe.webhooks.constructEvent() uses internally.
//
// Required secrets (Cloudflare Pages Dashboard > Settings > Environment Variables):
//   STRIPE_SECRET_KEY       — sk_test_... (test) or sk_live_... (live) — used to
//                             re-fetch the session with expanded line items
//   STRIPE_WEBHOOK_SECRET   — whsec_... from Stripe Dashboard > Webhooks > endpoint secret
// Requires the `DB` D1 binding (see wrangler.toml) and the Printify/Resend env
// vars documented in functions/_lib/printify.js and functions/_lib/resend.js.
//
// Stripe webhook endpoint URL: https://thedeangeloseries.com/api/stripe-webhook
//
// On checkout.session.completed:
//   1. Claim the event in D1 (processed_webhooks) — durable idempotency,
//      replaces the earlier Cache-API-only approach.
//   2. Re-fetch the session from Stripe with line_items expanded (the
//      webhook payload itself doesn't include them).
//   3. Insert the order + order_items into D1 (skipped if this session
//      already has an order — defense in depth alongside step 1). This
//      happens regardless of payment_status — even an unpaid session gets a
//      durable record — but nothing downstream (email, Printify) proceeds
//      until step 4 confirms payment.
//   4. Explicit paid gate: inspect fullSession.payment_status directly. If
//      it is not "paid", record a status event explaining fulfillment is
//      awaiting payment and return 200 — no Printify order, no confirmation
//      email. Only once payment_status === "paid" does anything below run.
//   5. Stamp orders.paid_at (once) and send the "order received" email — as
//      soon as the order is confirmed paid and durably stored. A customer
//      whose card was charged must always get a receipt, regardless of what
//      happens with Printify next.
//   6. Best-effort capture of the REAL Stripe fee/net (never estimated) by
//      resolving PaymentIntent -> Charge -> BalanceTransaction — see
//      functions/_lib/stripe.js. If not yet available, financial fields stay
//      null and scripts/reconcile-financials.mjs fills them in later.
//   7. Attempt to create the order in Printify (registers it; does NOT send
//      it to production — see functions/_lib/printify.js). Every product's
//      Printify mapping is unconfirmed as of this pass, so this step will
//      fail cleanly. On failure: store why in orders.fulfillment_error and
//      send an internal alert to SUPPORT_EMAIL (once per order) — the
//      customer is not notified of this failure, support is.
//   Note: the "in production" email is NOT sent from here. It only fires
//   from functions/api/printify-webhook.js, driven by a real signal from
//   Printify (order:sent-to-production or order:updated status=in-production)
//   — this file has no way to know when that actually happens. That same
//   file is also where Printify's real fulfillment costs get captured/
//   refreshed (never estimated) — see its module header.
// Always returns 200 once the event is durably recorded, regardless of
// Printify/email outcome — those failures must not cause Stripe to retry an
// event that's already been correctly recorded.

import { CATALOG, printifyMappingForColor } from '../_lib/catalog.js';
import { createPrintifyOrder, PrintifyConfigError, PrintifyApiError } from '../_lib/printify.js';
import { fetchExpandedCheckoutSession, fetchStripeFeeAndNet } from '../_lib/stripe.js';
import { orderConfirmedTemplate, printifyFailureAlertTemplate } from '../_lib/email-templates.js';
import { tryNormalizeUSState } from '../_lib/address.js';
import {
  claimWebhookEvent, findOrderByStripeSession, insertOrder, insertOrderItems,
  updateOrder, updateOrderFinancials, recordStatusEvent, sendOrderEmailOnce, orderNumberFromSession,
} from '../_lib/orders-db.js';

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
  if (!env.DB) {
    console.error('[stripe-webhook] Missing D1 binding: DB');
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

  // ── Durable idempotency (D1) ─────────────────────────────────────────────────
  const claimed = await claimWebhookEvent(env, 'stripe', event.id, event.type);
  if (!claimed) {
    console.log(`[stripe-webhook] Duplicate delivery ignored: ${event.id}`);
    return json({ received: true, duplicate: true }, 200);
  }

  const session = event.data.object;

  // ── Re-fetch the session with line items expanded ───────────────────────────
  // The checkout.session.completed payload doesn't include line_items by
  // default, and price_data-created Products only exist as ephemeral objects
  // reachable via this expansion.
  let fullSession;
  try {
    fullSession = await fetchExpandedCheckoutSession(env, session.id);
  } catch (err) {
    // We've already durably claimed this event — do not throw and cause a
    // Stripe retry storm. Record what we can and stop; a real order will be
    // missing until this is investigated, which is preferable to a silent
    // guess at what was purchased.
    console.error('[stripe-webhook] Failed to expand session:', err.message);
    await recordStatusEvent(env, {
      orderId: null, source: 'stripe', externalEventId: event.id,
      eventType: event.type, safeSummary: { error: 'session_expand_failed', sessionId: session.id },
    });
    return json({ received: true, error: 'Could not expand session line items' }, 200);
  }

  const orderNumber = orderNumberFromSession(session.id);
  let order = await findOrderByStripeSession(env, session.id);

  if (!order) {
    const lineItems = (fullSession.line_items?.data || []).map((li) => {
      const meta = li.price?.product?.metadata || {};
      const entry = CATALOG[meta.slug];
      const printifyMap = printifyMappingForColor(entry, meta.color);
      return {
        id: crypto.randomUUID(),
        productSlug: meta.slug || 'unknown',
        productName: li.price?.product?.name || li.description || 'Unknown item',
        size: meta.size || null,
        color: meta.color || null,
        quantity: li.quantity,
        unitPrice: li.price?.unit_amount ?? 0,
        printifyProductId: printifyMap?.productId ?? null,
        printifyVariantId: printifyMap?.variantIdBySize?.[meta.size] ?? null,
        sku: printifyMap?.skuBySize?.[meta.size] ?? null,
      };
    });

    const shipping = fullSession.shipping_details || fullSession.customer_details;
    const address = shipping?.address || {};

    const newOrder = {
      id: crypto.randomUUID(),
      publicOrderNumber: orderNumber,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: fullSession.payment_intent || null,
      customerEmail: fullSession.customer_details?.email || fullSession.customer_email || '',
      customerName: fullSession.customer_details?.name || null,
      shippingName: shipping?.name || null,
      shippingAddressLine1: address.line1 || null,
      shippingAddressLine2: address.line2 || null,
      shippingCity: address.city || null,
      shippingState: address.state || null,
      shippingPostalCode: address.postal_code || null,
      shippingCountry: address.country || null,
      currency: fullSession.currency || 'usd',
      // All four amounts come straight from Stripe's own completed-session
      // object — never from browser input, cart metadata, or a re-computation
      // on our side. shipping_cost.amount_total is Stripe's canonical
      // shipping charge (falls back to total_details.amount_shipping for
      // older API responses where shipping_cost might be absent).
      subtotalAmount: fullSession.amount_subtotal ?? 0,
      shippingAmount: fullSession.shipping_cost?.amount_total ?? fullSession.total_details?.amount_shipping ?? 0,
      taxAmount: fullSession.total_details?.amount_tax ?? 0,
      totalAmount: fullSession.amount_total ?? 0,
      paymentStatus: fullSession.payment_status,
      fulfillmentStatus: 'unfulfilled',
      createdAt: new Date(session.created * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await insertOrder(env, newOrder);
    await insertOrderItems(env, newOrder.id, lineItems);
    await recordStatusEvent(env, {
      orderId: newOrder.id, source: 'stripe', externalEventId: event.id,
      eventType: event.type,
      safeSummary: { orderNumber, amountTotal: newOrder.totalAmount, itemCount: lineItems.length },
    });

    order = await findOrderByStripeSession(env, session.id);
    console.log(`[stripe-webhook] Order ${orderNumber} recorded (${lineItems.length} item(s), ${newOrder.totalAmount} ${newOrder.currency})`);
  } else {
    console.log(`[stripe-webhook] Order ${order.public_order_number} already recorded — continuing to fulfillment/email steps`);
  }

  // ── Explicit paid gate ───────────────────────────────────────────────────────
  // fullSession.payment_status is the authoritative signal — checked directly
  // here, not assumed from the fact that checkout.session.completed fired.
  // "Completed" means the customer finished the checkout UI; it does NOT by
  // itself mean the charge succeeded for every possible payment method.
  //
  // Today's create-checkout-session.js does not set payment_method_types, so
  // this Checkout Session uses Stripe's default/Dashboard-configured methods.
  // As of this pass that resolves to card-only, and card charges resolve
  // synchronously — payment_status is essentially always "paid" by the time
  // this webhook fires. But that is a Dashboard-configurable fact, not a
  // code guarantee, and delayed-settlement methods (bank debits, some
  // wallets) report "unpaid" here and only become "paid" via a LATER,
  // different event (checkout.session.async_payment_succeeded), which this
  // endpoint does not yet handle. This gate makes today's assumption
  // explicit and safe regardless of what the Dashboard allows tomorrow; it
  // does not by itself add the async-succeeded event handler.
  const paymentStatus = fullSession.payment_status;
  if (paymentStatus !== 'paid') {
    console.warn(`[stripe-webhook] Order ${order.public_order_number} has payment_status="${paymentStatus}" — withholding Printify fulfillment and the confirmation email until payment is confirmed paid.`);
    await recordStatusEvent(env, {
      orderId: order.id, source: 'stripe', externalEventId: event.id, eventType: event.type,
      safeSummary: { orderNumber: order.public_order_number, paymentStatus, note: 'fulfillment_awaiting_payment' },
    });
    // Durably recorded already — return 200 so Stripe does not retry an
    // event that was correctly received; nothing further to do until (if
    // ever) a real payment-succeeded signal for this session arrives.
    return json({ received: true, orderNumber: order.public_order_number, awaitingPayment: true }, 200);
  }

  // First time we've observed this order as paid — stamp paid_at once,
  // never overwritten on a later retry/duplicate delivery of the same or a
  // different event for this same session.
  if (!order.paid_at) {
    await updateOrder(env, order.id, { paid_at: new Date().toISOString() });
    order.paid_at = new Date().toISOString();
  }

  // ── Order received email — sent once payment is confirmed paid, as soon ────
  // as the order is durably stored. Must NOT be suppressed by a later
  // Printify failure — the customer paid; they get a receipt regardless of
  // fulfillment status. (Deliberately gated on the paid check above — an
  // unpaid order gets no "we've received your order" receipt, since that
  // would misrepresent a payment that hasn't actually succeeded.)
  if (order.customer_email) {
    const emailResult = await sendOrderEmailOnce(env, {
      orderId: order.id,
      emailType: 'order_confirmed',
      to: order.customer_email,
      buildTemplate: () => orderConfirmedTemplate({
        orderNumber: order.public_order_number,
        customerName: order.customer_name || undefined,
        items: [], // TODO: populate from order_items once a formatted-amount helper exists
        total: formatCents(order.total_amount, order.currency),
      }),
    });
    if (emailResult.sent) {
      console.log(`[stripe-webhook] Order received email sent for ${order.public_order_number}`);
    } else if (emailResult.reason !== 'duplicate') {
      console.error(`[stripe-webhook] Order received email not sent for ${order.public_order_number}: ${emailResult.reason}`);
    }
  } else {
    console.warn(`[stripe-webhook] No customer email on file for ${order.public_order_number} — order received email not sent`);
  }

  // ── Stripe fee/net capture ──────────────────────────────────────────────────
  // Best-effort, never blocks fulfillment. The real balance transaction may
  // not be attached yet even for a paid order (see fetchStripeFeeAndNet's own
  // doc comment) — if so, the financial fields simply stay null here and
  // scripts/reconcile-financials.mjs is what fills them in later. Skipped
  // entirely once already captured (idempotent — no reason to re-fetch on a
  // later duplicate/retry delivery for this same order).
  if (!order.stripe_balance_transaction_id) {
    const feeInfo = await fetchStripeFeeAndNet(env, { paymentIntentId: order.stripe_payment_intent_id });
    if (feeInfo.known) {
      await updateOrderFinancials(env, order.id, {
        stripe_balance_transaction_id: feeInfo.balanceTransactionId,
        stripe_fee_amount: feeInfo.feeAmount,
        stripe_net_amount: feeInfo.netAmount,
      });
      console.log(`[stripe-webhook] Stripe fee/net captured for ${order.public_order_number}`);
    } else {
      console.log(`[stripe-webhook] Stripe fee/net not yet available for ${order.public_order_number} — will be captured by reconciliation later`);
    }
  }

  // ── Attempt Printify order creation ─────────────────────────────────────────
  // send_to_production is never called here — see functions/_lib/printify.js.
  // PRINTIFY_AUTO_SEND_TO_PRODUCTION stays irrelevant to this step; it only
  // gates the separate, unused-by-default sendPrintifyOrderToProduction().
  // Failure here no longer withholds the customer's receipt (sent above) —
  // it instead alerts support so a human can follow up.
  if (!order.printify_order_id) {
    const mismatch = detectAddressMismatch(fullSession, order);
    if (mismatch) {
      await handleAddressMismatch(env, order, mismatch);
    } else {
      await attemptPrintifyOrderCreation(env, order, fullSession);
    }
  }

  return json({ received: true, orderNumber: order.public_order_number }, 200);
}

// ---------------------------------------------------------------------------
// create-checkout-session.js quotes shipping against a specific address
// (stored on the Session as metadata.shipping_quote_*) and attaches that
// verified amount to the Session — but Stripe's own hosted page also
// collects a shipping address, and Stripe gives no way to lock that
// collection to match what was quoted. If what Stripe actually collected
// doesn't match, the charged shipping amount may not correspond to where
// this is shipping. Returns a description string if mismatched, else null.
// ---------------------------------------------------------------------------
function detectAddressMismatch(fullSession, order) {
  const quotedCountry = fullSession.metadata?.shipping_quote_country || '';
  const quotedRegionRaw = fullSession.metadata?.shipping_quote_region || '';
  const quotedZip5 = (fullSession.metadata?.shipping_quote_zip || '').slice(0, 5);
  const actualCountry = order.shipping_country || '';
  const actualRegionRaw = order.shipping_state || '';
  const actualZip5 = (order.shipping_postal_code || '').slice(0, 5);

  if (!quotedCountry) return null; // no quote metadata (e.g. an older/legacy session) — nothing to compare

  // Normalize both sides through the same US-state table create-checkout-
  // session.js's validateAddress() already normalizes the quoted side with —
  // "California" vs "CA" is the same real state and must not be treated as a
  // mismatch. tryNormalizeUSState() never throws: if either side isn't a
  // recognized US state/territory (e.g. a non-US region slipping through),
  // it falls back to a plain case-insensitive string compare rather than
  // crashing the webhook.
  const quotedRegion = tryNormalizeUSState(quotedRegionRaw) ?? quotedRegionRaw.trim().toUpperCase();
  const actualRegion = tryNormalizeUSState(actualRegionRaw) ?? actualRegionRaw.trim().toUpperCase();

  const mismatched = quotedCountry !== actualCountry || quotedRegion !== actualRegion || quotedZip5 !== actualZip5;
  if (!mismatched) return null;

  return `Shipping was quoted for ${quotedCountry}/${quotedRegion}/${quotedZip5} but Stripe collected ${actualCountry}/${actualRegion}/${actualZip5} — refusing to auto-fulfill at a possibly-wrong rate.`;
}

// ---------------------------------------------------------------------------
// Never auto-fulfills on a detected address mismatch — flags the order for
// manual review and alerts support instead (same alert channel/template as
// a Printify failure, just a different reason).
// ---------------------------------------------------------------------------
async function handleAddressMismatch(env, order, reason) {
  console.error(`[stripe-webhook] Address mismatch for ${order.public_order_number}: ${reason}`);
  await updateOrder(env, order.id, {
    fulfillment_status: 'awaiting_manual_review',
    fulfillment_error: reason,
  });

  if (!env.SUPPORT_EMAIL) {
    console.error('[stripe-webhook] SUPPORT_EMAIL not configured — could not send address-mismatch alert');
    return;
  }
  const alertResult = await sendOrderEmailOnce(env, {
    orderId: order.id,
    emailType: 'printify_failure_alert',
    to: env.SUPPORT_EMAIL,
    buildTemplate: () => printifyFailureAlertTemplate({
      orderNumber: order.public_order_number, orderId: order.id, reason,
    }),
  });
  if (alertResult.sent) {
    console.log(`[stripe-webhook] Support alerted (address mismatch) for ${order.public_order_number}`);
  } else if (alertResult.reason !== 'duplicate') {
    console.error(`[stripe-webhook] Support alert not sent for ${order.public_order_number}: ${alertResult.reason}`);
  }
}

// ---------------------------------------------------------------------------
// send_to_production is never called here — see functions/_lib/printify.js.
// PRINTIFY_AUTO_SEND_TO_PRODUCTION stays irrelevant to this step; it only
// gates the separate, unused-by-default sendPrintifyOrderToProduction().
// Failure here no longer withholds the customer's receipt (sent earlier in
// onRequest) — it instead alerts support so a human can follow up.
// ---------------------------------------------------------------------------
async function attemptPrintifyOrderCreation(env, order, fullSession) {
  try {
    // Confirms Printify is being asked to fulfill with the same shipping
    // method Stripe actually charged for (requirement: "Printify receives
    // the same selected method used by Stripe"). PRINTIFY_SHIPPING_METHOD_ID
    // is a single global env var today because 'standard' is the only
    // method ever offered (getShippingRates() filters everything else out
    // before it can reach create-checkout-session.js) — if a second method
    // (e.g. 'economy') is ever exposed, this needs a real per-option
    // mapping instead of one global ID.
    const shippingOptionId = fullSession.metadata?.shipping_option_id;
    if (shippingOptionId && shippingOptionId !== 'standard') {
      console.warn(`[stripe-webhook] Order ${order.public_order_number} was charged for shipping method "${shippingOptionId}", but Printify fulfillment still uses the single PRINTIFY_SHIPPING_METHOD_ID env var — verify these match.`);
    }

    const itemsForPrintify = await loadOrderItemsForPrintify(env, order.id);
    const shippingForPrintify = {
      firstName: (order.shipping_name || '').split(' ')[0] || '',
      lastName: (order.shipping_name || '').split(' ').slice(1).join(' ') || '',
      country: order.shipping_country,
      region: order.shipping_state,
      address1: order.shipping_address_line1,
      address2: order.shipping_address_line2,
      city: order.shipping_city,
      zip: order.shipping_postal_code,
    };
    const result = await createPrintifyOrder(env, {
      orderNumber: order.public_order_number,
      items: itemsForPrintify,
      shipping: shippingForPrintify,
      email: order.customer_email,
    });
    await updateOrder(env, order.id, {
      printify_order_id: result.printifyOrderId,
      fulfillment_status: 'submitted_to_printify',
    });
    console.log(`[stripe-webhook] Printify order ${result.printifyOrderId} created for ${order.public_order_number}`);
  } catch (err) {
    const reason = (err instanceof PrintifyConfigError || err instanceof PrintifyApiError)
      ? err.message
      : 'Unexpected error creating Printify order';
    console.error(`[stripe-webhook] Printify order creation failed for ${order.public_order_number}:`, reason);
    await updateOrder(env, order.id, {
      fulfillment_status: 'awaiting_printify_setup',
      fulfillment_error: reason,
    });

    if (!env.SUPPORT_EMAIL) {
      console.error('[stripe-webhook] SUPPORT_EMAIL not configured — could not send Printify failure alert');
      return;
    }
    const alertResult = await sendOrderEmailOnce(env, {
      orderId: order.id,
      emailType: 'printify_failure_alert',
      to: env.SUPPORT_EMAIL,
      buildTemplate: () => printifyFailureAlertTemplate({
        orderNumber: order.public_order_number, orderId: order.id, reason,
      }),
    });
    if (alertResult.sent) {
      console.log(`[stripe-webhook] Support alerted for ${order.public_order_number}`);
    } else if (alertResult.reason !== 'duplicate') {
      console.error(`[stripe-webhook] Support alert not sent for ${order.public_order_number}: ${alertResult.reason}`);
    }
  }
}

async function loadOrderItemsForPrintify(env, orderId) {
  const { results } = await env.DB.prepare(`SELECT * FROM order_items WHERE order_id = ?`).bind(orderId).all();
  return results.map((row) => ({
    slug: row.product_slug,
    size: row.size,
    quantity: row.quantity,
    printify: { productId: row.printify_product_id, variantId: row.printify_variant_id },
  }));
}

function formatCents(cents, currency) {
  const amount = (Number(cents) / 100).toFixed(2);
  return currency && currency.toUpperCase() !== 'USD' ? `${amount} ${currency.toUpperCase()}` : `$${amount}`;
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
