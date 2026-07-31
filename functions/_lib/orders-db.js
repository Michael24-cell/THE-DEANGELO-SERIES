// Shared D1 helpers for order tracking, webhook idempotency, and
// exactly-once transactional email.
// Lives under functions/_lib/ — Cloudflare Pages excludes any `_`-prefixed
// path from routing, so this file is never itself reachable as an endpoint.
//
// Requires the `DB` D1 binding (wrangler.toml) — every export here takes
// `env` and reads `env.DB`. Schema: migrations/0001_init_commerce_schema.sql.
//
// Idempotency pattern used throughout: SQLite's `INSERT OR IGNORE` against a
// UNIQUE/PRIMARY KEY constraint is atomic — D1's `meta.changes` tells us
// whether the row was actually new (1) or already existed (0). That single
// fact is what "claims" a webhook event or an email send, so two concurrent
// or retried deliveries can never both proceed.

import { sendEmail } from './resend.js';

// ---------------------------------------------------------------------------
// Webhook idempotency (processed_webhooks) — durable replacement for the
// Cache-API best-effort dedup used before the D1 migration existed.
// ---------------------------------------------------------------------------

/**
 * Attempts to claim a webhook event for processing. Returns true if this
 * call is the first to see this (source, externalEventId) pair — the caller
 * should process the event. Returns false if it's a duplicate delivery —
 * the caller should skip processing and return a 200 to stop retries.
 */
export async function claimWebhookEvent(env, source, externalEventId, eventType) {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO processed_webhooks (source, external_event_id, event_type, processed_at) VALUES (?, ?, ?, ?)`,
  ).bind(source, externalEventId, eventType || null, new Date().toISOString()).run();
  return result.meta.changes === 1;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function findOrderByStripeSession(env, sessionId) {
  return env.DB.prepare(`SELECT * FROM orders WHERE stripe_checkout_session_id = ?`).bind(sessionId).first();
}

export async function findOrderByPrintifyOrderId(env, printifyOrderId) {
  return env.DB.prepare(`SELECT * FROM orders WHERE printify_order_id = ?`).bind(printifyOrderId).first();
}

export async function findOrderById(env, orderId) {
  return env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first();
}

/**
 * Inserts a new order row. Idempotent against retries via the UNIQUE
 * constraint on stripe_checkout_session_id — callers should check
 * findOrderByStripeSession() first and skip calling this if one already
 * exists (cheaper than relying on the constraint to fail).
 */
export async function insertOrder(env, order) {
  await env.DB.prepare(
    `INSERT INTO orders (
      id, public_order_number, stripe_checkout_session_id, stripe_payment_intent_id,
      customer_email, customer_name,
      shipping_name, shipping_address_line1, shipping_address_line2, shipping_city,
      shipping_state, shipping_postal_code, shipping_country,
      currency, subtotal_amount, shipping_amount, tax_amount, total_amount,
      payment_status, fulfillment_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    order.id, order.publicOrderNumber, order.stripeCheckoutSessionId, order.stripePaymentIntentId ?? null,
    order.customerEmail, order.customerName ?? null,
    order.shippingName ?? null, order.shippingAddressLine1 ?? null, order.shippingAddressLine2 ?? null, order.shippingCity ?? null,
    order.shippingState ?? null, order.shippingPostalCode ?? null, order.shippingCountry ?? null,
    order.currency, order.subtotalAmount, order.shippingAmount ?? 0, order.taxAmount ?? 0, order.totalAmount,
    order.paymentStatus, order.fulfillmentStatus ?? 'unfulfilled', order.createdAt, order.updatedAt,
  ).run();
}

export async function insertOrderItems(env, orderId, items) {
  const stmt = env.DB.prepare(
    `INSERT INTO order_items (
      id, order_id, product_slug, product_name, size, color, quantity, unit_price,
      printify_product_id, printify_variant_id, sku
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const batch = items.map((it) => stmt.bind(
    it.id, orderId, it.productSlug, it.productName, it.size ?? null, it.color ?? null, it.quantity, it.unitPrice,
    it.printifyProductId ?? null, it.printifyVariantId ?? null, it.sku ?? null,
  ));
  await env.DB.batch(batch);
}

/**
 * Partial update — pass only the columns being changed. Always stamps
 * updated_at. Column names are from a fixed allow-list, never built from
 * caller-supplied keys, so this can't become a SQL-injection surface.
 */
const UPDATABLE_ORDER_COLUMNS = new Set([
  'stripe_payment_intent_id', 'printify_order_id', 'payment_status',
  'fulfillment_status', 'production_status', 'carrier', 'tracking_number',
  'tracking_url', 'fulfillment_error',
]);

export async function updateOrder(env, orderId, fields) {
  const keys = Object.keys(fields).filter((k) => UPDATABLE_ORDER_COLUMNS.has(k));
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(', ') + ', updated_at = ?';
  const values = keys.map((k) => fields[k]);
  await env.DB.prepare(`UPDATE orders SET ${setClause} WHERE id = ?`)
    .bind(...values, new Date().toISOString(), orderId)
    .run();
}

// ---------------------------------------------------------------------------
// Shipments — one row per physical package. An order can have more than one
// (split shipment); the order isn't "delivered" until every known shipment
// is. See migrations/0002_add_shipments_table.sql.
// ---------------------------------------------------------------------------

/**
 * Records a shipment event. If `printifyShipmentId` is known and a row
 * already exists for (orderId, printifyShipmentId), updates it in place
 * (e.g. the same package moving from shipped -> delivered) instead of
 * inserting a second row. If the shipment ID is unknown/absent, always
 * inserts a new row — the caller's webhook-level idempotency (event.id) is
 * what prevents that from happening twice for the same real-world event.
 */
export async function insertShipment(env, { orderId, printifyShipmentId, carrier, trackingNumber, trackingUrl, status }) {
  const now = new Date().toISOString();

  if (printifyShipmentId) {
    const existing = await env.DB.prepare(
      `SELECT id FROM shipments WHERE order_id = ? AND printify_shipment_id = ?`,
    ).bind(orderId, printifyShipmentId).first();

    if (existing) {
      await env.DB.prepare(
        `UPDATE shipments SET carrier = ?, tracking_number = ?, tracking_url = ?, status = ?, updated_at = ? WHERE id = ?`,
      ).bind(carrier ?? null, trackingNumber ?? null, trackingUrl ?? null, status, now, existing.id).run();
      return;
    }
  }

  await env.DB.prepare(
    `INSERT INTO shipments (id, order_id, printify_shipment_id, carrier, tracking_number, tracking_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), orderId, printifyShipmentId ?? null, carrier ?? null, trackingNumber ?? null, trackingUrl ?? null,
    status, now, now,
  ).run();
}

/**
 * True only if the order has at least one known shipment AND every one of
 * them is 'delivered'. False (not "all delivered") if no shipment exists
 * yet — an order with zero recorded shipments has nothing to confirm.
 */
export async function allShipmentsDelivered(env, orderId) {
  const { results } = await env.DB.prepare(`SELECT status FROM shipments WHERE order_id = ?`).bind(orderId).all();
  if (results.length === 0) return false;
  return results.every((r) => r.status === 'delivered');
}

// ---------------------------------------------------------------------------
// Status events — append-only audit trail. Never store raw webhook bodies;
// safeSummary should be a small, already-redacted plain object.
// ---------------------------------------------------------------------------

export async function recordStatusEvent(env, { orderId, source, externalEventId, eventType, safeSummary }) {
  await env.DB.prepare(
    `INSERT INTO status_events (id, order_id, source, external_event_id, event_type, safe_summary_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), orderId ?? null, source, externalEventId ?? null, eventType,
    safeSummary ? JSON.stringify(safeSummary) : null, new Date().toISOString(),
  ).run();
}

// ---------------------------------------------------------------------------
// Exactly-once transactional email. The UNIQUE(order_id, email_type)
// constraint on email_events is what makes this safe under concurrent or
// retried webhook deliveries: only one caller can ever successfully claim a
// given (order, email type) pair.
// ---------------------------------------------------------------------------

/**
 * Sends an order-status email at most once per (orderId, emailType).
 * `buildTemplate` is a zero-arg function returning { subject, html, text } —
 * it's only called if this delivery actually wins the claim, so template
 * construction never happens for a duplicate.
 *
 * Returns one of:
 *   { sent: true, id }              — this call sent it
 *   { sent: false, reason: 'duplicate' }   — another delivery already claimed it
 *   { sent: false, reason: 'send_failed', error } — claimed it but Resend failed
 */
export async function sendOrderEmailOnce(env, { orderId, emailType, to, buildTemplate }) {
  const claim = await env.DB.prepare(
    `INSERT OR IGNORE INTO email_events (id, order_id, email_type, status, created_at) VALUES (?, ?, ?, 'pending', ?)`,
  ).bind(crypto.randomUUID(), orderId, emailType, new Date().toISOString()).run();

  if (claim.meta.changes !== 1) {
    return { sent: false, reason: 'duplicate' };
  }

  const template = buildTemplate();
  const result = await sendEmail({ env, to, subject: template.subject, html: template.html, text: template.text });

  await env.DB.prepare(
    `UPDATE email_events SET status = ?, resend_email_id = ?, error_message = ?, sent_at = ? WHERE order_id = ? AND email_type = ?`,
  ).bind(
    result.ok ? 'sent' : 'failed',
    result.ok ? result.id : null,
    result.ok ? null : result.error,
    result.ok ? new Date().toISOString() : null,
    orderId, emailType,
  ).run();

  if (!result.ok) {
    console.error(`[orders-db] Email "${emailType}" failed for order ${orderId}:`, result.error);
    return { sent: false, reason: 'send_failed', error: result.error };
  }
  return { sent: true, id: result.id };
}

/**
 * Generates a short, human-readable order number tied 1:1 to the Stripe
 * Checkout Session ID (so recomputing it for the same session — e.g. on a
 * webhook retry that reaches this point before the D1 write commits — always
 * yields the same value).
 */
export function orderNumberFromSession(sessionId) {
  return 'DS-' + sessionId.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase();
}
