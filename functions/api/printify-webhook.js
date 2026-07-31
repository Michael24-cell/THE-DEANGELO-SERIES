// Cloudflare Pages Function — Printify webhook
// Route: POST /api/printify-webhook
//
// Handles: order:sent-to-production, order:updated (status=in-production),
//          order:shipment:created, order:shipment:delivered
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
// Printify's webhook payload shape (per their public docs):
//   { id, type, created_at, resource: { id, type, data: {...} } }
// `resource.id` is the Printify order ID. `resource.data`'s shape is NOT
// verified against a real payload in this pass — extraction helpers below
// read a few plausible field names defensively and log a warning if they
// can't find what they expect, rather than silently storing wrong data.
//
// "In production" email trigger: per spec, `order:updated` carrying
// `status: "in-production"` is the authoritative signal, not
// `order:sent-to-production` alone (Printify's own docs are ambiguous about
// which fires reliably). Both event types are handled and both route to the
// same 'in_production' email claim, so whichever arrives first wins and the
// second is a no-op via the email_events unique constraint — never two
// emails.

import {
  claimWebhookEvent, findOrderByPrintifyOrderId, updateOrder,
  recordStatusEvent, sendOrderEmailOnce, insertShipment, allShipmentsDelivered,
} from '../_lib/orders-db.js';
import { inProductionTemplate, shippedTemplate, deliveredTemplate } from '../_lib/email-templates.js';

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
  } else if (eventType === 'order:updated') {
    const status = extractStatus(event.resource?.data);
    if (status === 'in-production') {
      await markInProduction(env, order);
    } else {
      console.log(`[printify-webhook] order:updated for ${order.public_order_number} with status="${status}" — no action mapped`);
    }
  } else if (eventType === 'order:shipment:created') {
    const shipment = extractShipmentInfo(event.resource?.data);
    // One row per shipment — an order can ship in multiple packages.
    await insertShipment(env, {
      orderId: order.id,
      printifyShipmentId: shipment.shipmentId,
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
    await emailOnce(env, order, 'shipped', () => shippedTemplate({
      orderNumber: order.public_order_number,
      customerName: order.customer_name || undefined,
      carrier: shipment.carrier || 'Carrier not provided',
      trackingNumber: shipment.trackingNumber || 'Not provided',
      trackingUrl: shipment.trackingUrl || 'https://thedeangeloseries.com/contact.html',
    }));
  } else if (eventType === 'order:shipment:delivered') {
    const shipment = extractShipmentInfo(event.resource?.data);
    await insertShipment(env, {
      orderId: order.id,
      printifyShipmentId: shipment.shipmentId,
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

function extractShipmentInfo(data) {
  const shipment = Array.isArray(data?.shipments) ? data.shipments[0] : data;
  const shipmentId = shipment?.id ?? shipment?.shipment_id ?? null;
  const carrier = shipment?.carrier ?? shipment?.carrier_name ?? null;
  const trackingNumber = shipment?.tracking_number ?? shipment?.number ?? null;
  const trackingUrl = shipment?.tracking_url ?? shipment?.url ?? null;

  if (!carrier && !trackingNumber && !trackingUrl) {
    console.warn('[printify-webhook] Could not find carrier/tracking fields in shipment payload — storing nulls. Payload shape needs reconfirming against a real Printify delivery:', JSON.stringify(data).slice(0, 500));
  }

  return { shipmentId, carrier, trackingNumber, trackingUrl };
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
