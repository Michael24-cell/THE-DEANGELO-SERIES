// Cloudflare Pages Function — Printify webhook
// Route: POST /api/printify-webhook
//
// Handles: order:sent-to-production, order:updated (status=in-production or
//          status=canceled), order:shipment:created, order:shipment:delivered
//
// Required env vars:
//   PRINTIFY_WEBHOOK_SECRET — HMAC-SHA256 signing secret for this endpoint,
//   from Printify Dashboard > Webhooks > (this endpoint) > Secret.
//   FAIL-CLOSED: if this is not set, every request is rejected with 503
//   before the body is even parsed. This endpoint never accepts an unsigned
//   event — there is no "skip verification" fallback. (An earlier version of
//   this file did allow unsigned requests when the secret was unset; that
//   was a safety bug and has been removed.)
// Also needs D1 (`DB` binding) and the Resend vars (functions/_lib/resend.js).
//
// The header name and HMAC scheme here follow Printify's documented webhook
// signing (X-Pfy-Signature: hex HMAC-SHA256 of the raw body) — reconfirm
// against a real delivery once a webhook is registered, since it hasn't been
// possible to observe one in this environment (no PRINTIFY_API_TOKEN).
//
// Printify's webhook payload shape (per developers.printify.com — Events
// section, read directly, not guessed):
//   { id, type, created_at, resource: { id, type, data: {...} } }
// `resource.id` is the Printify order ID. `resource.data`'s shape below is
// copied verbatim from Printify's documented "Resource data examples":
//   order:updated             -> { shop_id, status }
//   order:shipment:created    -> { shop_id, shipped_at, carrier: { code, tracking_number, tracking_url }, skus: [...] }
//   order:shipment:delivered  -> { shop_id, delivered_at, carrier: { code, tracking_number, tracking_url }, skus: [...] }
//   order:sent-to-production  -> no resource data
// There is no dedicated "canceled" webhook topic and no shipment-id field
// anywhere in these payloads — see markCanceled()/deriveShipmentKey() below
// for how each of those is handled using only what's actually documented.
//
// "In production" email trigger: `order:updated` carrying `status:
// "in-production"` and `order:sent-to-production` are both handled and both
// route to the same 'in_production' email claim, so whichever arrives first
// wins and the second is a no-op via the email_events unique constraint —
// never two emails.
//
// Cancellation: `order:updated` carrying `status: "canceled"` — see
// markCanceled() for the full rationale (this is a real, documented order
// status, not an invented event).
//
// Fulfillment-cost capture: the create-order response only ever returns an
// id — real cost data (never estimated) is only available via a follow-up
// GET on the order, see refreshPrintifyCosts(). That refresh runs on both
// `order:sent-to-production` and every `order:updated`, since Printify costs
// an order asynchronously and neither event guarantees the cost is final by
// the time it fires — see PENDING_COST_STATUSES in functions/_lib/printify.js.
// scripts/reconcile-financials.mjs is the backstop for orders whose costs
// never get filled in by a live webhook.

import {
  claimWebhookEvent, findOrderByPrintifyOrderId, updateOrder, updateOrderFinancials,
  recordStatusEvent, sendOrderEmailOnce, insertShipment, allShipmentsDelivered,
} from '../_lib/orders-db.js';
import { inProductionTemplate, shippedTemplate, deliveredTemplate, printifyFailureAlertTemplate } from '../_lib/email-templates.js';
import { getPrintifyOrder, extractPrintifyCosts } from '../_lib/printify.js';

const HANDLED_EVENTS = new Set([
  'order:sent-to-production',
  'order:updated',
  'order:shipment:created',
  'order:shipment:delivered',
]);

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }
  if (!env.DB) {
    console.error('[printify-webhook] Missing D1 binding: DB');
    return json({ error: 'Server misconfiguration — contact site owner' }, 500);
  }

  // ── Fail closed ──────────────────────────────────────────────────────────────
  // No secret configured means we cannot verify any sender. Reject everything
  // rather than silently trusting an unsigned request. This is deliberate and
  // must not be relaxed with a "development mode" bypass.
  if (!env.PRINTIFY_WEBHOOK_SECRET) {
    console.error('[printify-webhook] PRINTIFY_WEBHOOK_SECRET not configured — refusing all requests (fail closed)');
    return json({ error: 'Webhook receiver is not configured.' }, 503);
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-pfy-signature') || request.headers.get('X-Pfy-Signature');
  if (!signature) {
    console.warn('[printify-webhook] Missing X-Pfy-Signature header');
    return json({ error: 'Missing signature' }, 400);
  }
  const validSig = await verifyPrintifySignature(rawBody, signature, env.PRINTIFY_WEBHOOK_SECRET);
  if (!validSig) {
    console.warn('[printify-webhook] Signature verification failed');
    return json({ error: 'Invalid signature' }, 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const eventId = event?.id;
  const eventType = event?.type;
  const printifyOrderId = event?.resource?.id;

  if (!eventId || !eventType) {
    console.warn('[printify-webhook] Payload missing id/type — ignoring');
    return json({ received: true, handled: false }, 200);
  }

  if (!HANDLED_EVENTS.has(eventType)) {
    console.log(`[printify-webhook] Ignored event type: ${eventType}`);
    return json({ received: true, handled: false, type: eventType }, 200);
  }

  const claimed = await claimWebhookEvent(env, 'printify', eventId, eventType);
  if (!claimed) {
    console.log(`[printify-webhook] Duplicate delivery ignored: ${eventId}`);
    return json({ received: true, duplicate: true }, 200);
  }

  if (!printifyOrderId) {
    console.warn(`[printify-webhook] Event ${eventId} (${eventType}) has no resource.id — cannot match an order`);
    await recordStatusEvent(env, {
      orderId: null, source: 'printify', externalEventId: eventId, eventType,
      safeSummary: { error: 'missing_resource_id' },
    });
    return json({ received: true, matched: false }, 200);
  }

  const order = await findOrderByPrintifyOrderId(env, printifyOrderId);
  if (!order) {
    console.warn(`[printify-webhook] No D1 order found for Printify order ${printifyOrderId} (event ${eventType})`);
    await recordStatusEvent(env, {
      orderId: null, source: 'printify', externalEventId: eventId, eventType,
      safeSummary: { error: 'order_not_found', printifyOrderId },
    });
    return json({ received: true, matched: false }, 200);
  }

  await recordStatusEvent(env, {
    orderId: order.id, source: 'printify', externalEventId: eventId, eventType,
    safeSummary: { printifyOrderId, orderNumber: order.public_order_number },
  });

  if (eventType === 'order:sent-to-production') {
    await markInProduction(env, order);
    await refreshPrintifyCosts(env, order);
  } else if (eventType === 'order:updated') {
    const status = extractStatus(event.resource?.data);
    if (status === 'in-production') {
      await markInProduction(env, order);
    } else if (status === 'canceled') {
      await markCanceled(env, order, event.resource?.data);
    } else {
      console.log(`[printify-webhook] order:updated for ${order.public_order_number} with status="${status}" — no action mapped`);
    }
    // Refreshed for every order:updated, not just in-production/canceled —
    // any status change is a reasonable point to re-check whether Printify
    // has finished costing the order (see PENDING_COST_STATUSES).
    await refreshPrintifyCosts(env, order);
  } else if (eventType === 'order:shipment:created') {
    const shipment = extractShipmentInfo(event.resource?.data);
    const shipmentKey = deriveShipmentKey(event.resource?.data, shipment);
    // One row per shipment — an order can ship in multiple packages.
    await insertShipment(env, {
      orderId: order.id,
      printifyShipmentId: shipmentKey,
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      status: 'shipped',
    });
    await updateOrder(env, order.id, {
      fulfillment_status: 'shipped',
      carrier: shipment.carrier,
      tracking_number: shipment.trackingNumber,
      tracking_url: shipment.trackingUrl,
    });
    // Per-shipment claim key — a split shipment's second package must send
    // its own email, not be silently swallowed by a flat 'shipped' claim
    // that the first package already used. See deriveShipmentKey().
    await emailOnce(env, order, `shipped_${shipmentKey}`, () => shippedTemplate({
      orderNumber: order.public_order_number,
      customerName: order.customer_name || undefined,
      carrier: shipment.carrier || 'Carrier not provided',
      trackingNumber: shipment.trackingNumber || 'Not provided',
      trackingUrl: shipment.trackingUrl || 'https://thedeangeloseries.com/contact.html',
    }));
  } else if (eventType === 'order:shipment:delivered') {
    const shipment = extractShipmentInfo(event.resource?.data);
    const shipmentKey = deriveShipmentKey(event.resource?.data, shipment);
    await insertShipment(env, {
      orderId: order.id,
      printifyShipmentId: shipmentKey,
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      status: 'delivered',
    });
    // Only mark the whole order delivered once every known shipment has
    // reported delivered — a split shipment isn't fully delivered until
    // its last package arrives.
    const allDelivered = await allShipmentsDelivered(env, order.id);
    if (allDelivered) {
      await updateOrder(env, order.id, { fulfillment_status: 'delivered' });
      await emailOnce(env, order, 'delivered', () => deliveredTemplate({
        orderNumber: order.public_order_number,
        customerName: order.customer_name || undefined,
      }));
    } else {
      console.log(`[printify-webhook] Shipment delivered for ${order.public_order_number}, but other shipments are still outstanding — order not yet marked delivered`);
    }
  }

  return json({ received: true, orderNumber: order.public_order_number }, 200);
}

async function markInProduction(env, order) {
  await updateOrder(env, order.id, { production_status: 'in_production', fulfillment_status: 'in_production' });
  await emailOnce(env, order, 'in_production', () => inProductionTemplate({
    orderNumber: order.public_order_number,
    customerName: order.customer_name || undefined,
  }));
}

// ---------------------------------------------------------------------------
// Cancellation — confirmed via Printify's official docs (developers.printify.com,
// Events > Order events > order:updated): there is no separate "canceled"
// webhook topic, but order:updated's payload carries `data.status`, and
// "canceled" is a documented, first-class order-level status value (distinct
// from a canceled *line item*). This is the same order:updated event already
// handled above for "in-production" — just a different status value, not a
// new/invented event.
//
// Terminal, not auto-retried: sets fulfillment_status to 'printify_canceled'
// (a clear, greppable state distinct from 'awaiting_manual_review') and
// leaves it for a human. Never touches shipped/delivered email claims — a
// cancellation arriving after a shipped/delivered email already sent means
// the physical item already went out, which is a real-world edge case for a
// human to sort out, not something this handler should try to paper over.
// ---------------------------------------------------------------------------
async function markCanceled(env, order, data) {
  const reason = extractCancelReason(data);
  await updateOrder(env, order.id, { fulfillment_status: 'printify_canceled', fulfillment_error: reason });

  if (!env.SUPPORT_EMAIL) {
    console.error(`[printify-webhook] Order ${order.public_order_number} canceled by Printify but SUPPORT_EMAIL is not configured — no alert sent`);
    return;
  }
  // Sent to SUPPORT_EMAIL, not the customer — reuses sendOrderEmailOnce
  // directly (not the emailOnce() wrapper below, which always addresses
  // order.customer_email) so this can never become a misleading customer
  // "shipped"/"delivered" email.
  const result = await sendOrderEmailOnce(env, {
    orderId: order.id,
    emailType: 'printify_canceled_alert',
    to: env.SUPPORT_EMAIL,
    buildTemplate: () => printifyFailureAlertTemplate({
      orderNumber: order.public_order_number,
      orderId: order.id,
      reason: `Printify canceled this order. ${reason}`,
    }),
  });
  if (result.sent) {
    console.log(`[printify-webhook] Cancellation alert sent for ${order.public_order_number}`);
  } else if (result.reason !== 'duplicate') {
    console.error(`[printify-webhook] Cancellation alert not sent for ${order.public_order_number}: ${result.reason}`);
  }
}

function extractCancelReason(data) {
  return data?.reason || data?.message || data?.status_note
    || 'Printify marked this order canceled; no reason field was present in the webhook payload.';
}

// ---------------------------------------------------------------------------
// Real Printify fulfillment-cost capture — never estimated. The order-create
// response only ever returns an id (functions/_lib/printify.js), so this is
// the only place actual costs get read, via a follow-up GET on the order.
// Best-effort: a fetch failure or a still-pending cost status just means
// "try again on the next webhook or via scripts/reconcile-financials.mjs" —
// never blocks or fails the webhook itself.
// ---------------------------------------------------------------------------
async function refreshPrintifyCosts(env, order) {
  if (!order.printify_order_id) return;

  let printifyOrder;
  try {
    printifyOrder = await getPrintifyOrder(env, order.printify_order_id);
  } catch (err) {
    console.error(`[printify-webhook] Could not fetch Printify order for cost refresh (${order.public_order_number}):`, err.message);
    return;
  }

  const costs = extractPrintifyCosts(printifyOrder);
  if (!costs.known) {
    console.log(`[printify-webhook] Printify costs not yet available for ${order.public_order_number} (order status: ${printifyOrder?.status})`);
    return;
  }

  await updateOrderFinancials(env, order.id, {
    printify_product_cost: costs.productCost,
    printify_shipping_cost: costs.shippingCost,
    printify_tax_amount: costs.taxAmount,
    printify_total_cost: costs.totalCost,
  });
  console.log(`[printify-webhook] Printify costs captured for ${order.public_order_number}: product=${costs.productCost} shipping=${costs.shippingCost} tax=${costs.taxAmount}`);
}

async function emailOnce(env, order, emailType, buildTemplate) {
  if (!order.customer_email) return;
  const result = await sendOrderEmailOnce(env, { orderId: order.id, emailType, to: order.customer_email, buildTemplate });
  if (result.sent) {
    console.log(`[printify-webhook] "${emailType}" email sent for ${order.public_order_number}`);
  } else if (result.reason !== 'duplicate') {
    console.error(`[printify-webhook] "${emailType}" email not sent for ${order.public_order_number}: ${result.reason}`);
  }
}

// ---------------------------------------------------------------------------
// Defensive extraction — see the module-level note on why these aren't
// verified against a real Printify payload yet.
// ---------------------------------------------------------------------------
function extractStatus(data) {
  return data?.status ?? data?.order_status ?? null;
}

// Confirmed against Printify's official docs (Events > Order events >
// order:shipment:created/delivered, Resource data examples): the payload is
// `data: { shop_id, shipped_at|delivered_at, carrier: { code, tracking_number,
// tracking_url }, skus: [...] }`. Notably there is NO shipment-id field
// anywhere in the documented payload — see deriveShipmentKey() below for how
// that's handled.
function extractShipmentInfo(data) {
  const carrier = data?.carrier ?? {};
  const carrierCode = carrier.code ?? null;
  const trackingNumber = carrier.tracking_number ?? null;
  const trackingUrl = carrier.tracking_url ?? null;
  const skus = Array.isArray(data?.skus) ? data.skus : [];

  if (!carrierCode && !trackingNumber && !trackingUrl) {
    console.warn('[printify-webhook] Could not find carrier/tracking fields in shipment payload — storing nulls:', JSON.stringify(data).slice(0, 500));
  }

  return { carrier: carrierCode, trackingNumber, trackingUrl, skus };
}

// Printify's documented shipment payload has no shipment ID, so this derives
// a stable per-shipment key used both as the `shipments.printify_shipment_id`
// upsert key and as the per-shipment email claim suffix
// (`shipped_${shipmentKey}`) — this is what lets a second physical package
// send its own "shipped" email instead of colliding with the first.
//
// Primary key: the carrier tracking number. Each physical package gets its
// own tracking number from the carrier, so two distinct shipments on the
// same order will always have different values here — this is not a guess,
// it's how shipment identity actually works in the real world.
//
// Fallback (only when a payload genuinely omits tracking_number — not seen
// in any documented or observed example, but not contractually guaranteed
// either): a deterministic key built from carrier code + sorted SKUs +
// event timestamp. This is NOT collision-proof in theory (two distinct
// trackingNumber-less shipments with identical carrier/SKUs/timestamp would
// collide) — but it is never the only thing standing between a customer and
// a duplicate email: claimWebhookEvent() already made this specific webhook
// delivery (by event.id) exactly-once before this code runs at all, so this
// fallback only matters for genuinely distinct shipment events, and a flat
// constant (the bug being fixed here) would have collided every single time
// instead of only in this narrow, undocumented edge case.
function deriveShipmentKey(data, shipment) {
  if (shipment.trackingNumber) return shipment.trackingNumber;
  const timestamp = data?.shipped_at || data?.delivered_at || '';
  const skuPart = shipment.skus.slice().sort().join('-') || 'no-skus';
  return `no-tracking:${shipment.carrier || 'unknown-carrier'}:${skuPart}:${timestamp}`;
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 signature check, same Web Crypto approach as stripe-webhook.js.
// Printify's documented scheme signs the raw body and sends the hex digest
// directly (no timestamp/comma-separated format like Stripe's). Constant-time
// comparison to avoid a timing side channel.
// ---------------------------------------------------------------------------
async function verifyPrintifySignature(rawBody, signatureHeader, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const computed = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const sig = signatureHeader.trim().toLowerCase();
  if (sig.length !== computed.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ computed.charCodeAt(i);
  return diff === 0;
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
