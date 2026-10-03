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
import { computeEstimatedMargin } from './financials.js';

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
      payment_status, fulfillment_status, marketing_opt_in, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    order.id, order.publicOrderNumber, order.stripeCheckoutSessionId, order.stripePaymentIntentId ?? null,
    order.customerEmail, order.customerName ?? null,
    order.shippingName ?? null, order.shippingAddressLine1 ?? null, order.shippingAddressLine2 ?? null, order.shippingCity ?? null,
    order.shippingState ?? null, order.shippingPostalCode ?? null, order.shippingCountry ?? null,
    order.currency, order.subtotalAmount, order.shippingAmount ?? 0, order.taxAmount ?? 0, order.totalAmount,
    order.paymentStatus, order.fulfillmentStatus ?? 'unfulfilled',
    // Tri-state, not a plain boolean default: NULL means "unknown/predates
    // this field," which must never be treated as consent. Only an
    // explicit true/false from Stripe Session metadata (set at checkout)
    // resolves to 1/0 here.
    order.marketingOptIn === true ? 1 : order.marketingOptIn === false ? 0 : null,
    order.createdAt, order.updatedAt,
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

export async function findOrderItemById(env, orderItemId) {
  return env.DB.prepare(`SELECT * FROM order_items WHERE id = ?`).bind(orderItemId).first();
}

export async function getOrderItems(env, orderId) {
  const { results } = await env.DB.prepare(
    `SELECT product_name, size, color, quantity FROM order_items WHERE order_id = ?`,
  ).bind(orderId).all();
  return results;
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
  // Financial ledger — migrations/0003_add_financial_ledger_fields.sql.
  // Prefer updateOrderFinancials() below for the cost/fee fields (it keeps
  // estimated_margin_amount in sync); this allow-list entry exists so
  // updateOrder() itself can still write any of them directly if needed
  // (e.g. paid_at, which has no margin dependency).
  'stripe_balance_transaction_id', 'stripe_fee_amount', 'stripe_net_amount', 'paid_at',
  'printify_product_cost', 'printify_shipping_cost', 'printify_tax_amount', 'printify_total_cost',
  'estimated_margin_amount', 'financials_updated_at',
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

// Only the raw, upstream-sourced financial fields — never estimated_margin_amount
// or financials_updated_at themselves, which updateOrderFinancials() below
// always derives fresh rather than accepting from a caller.
const RAW_FINANCIAL_COLUMNS = new Set([
  'stripe_balance_transaction_id', 'stripe_fee_amount', 'stripe_net_amount',
  'printify_product_cost', 'printify_shipping_cost', 'printify_tax_amount', 'printify_total_cost',
]);

/**
 * Writes real (never estimated) financial fields for an order, then
 * recomputes and stores estimated_margin_amount from the order's current
 * full state, and stamps financials_updated_at. This is the one place the
 * margin formula gets applied (see computeEstimatedMargin in financials.js)
 * — callers (functions/api/stripe-webhook.js, functions/api/printify-webhook.js,
 * scripts/reconcile-financials.mjs) never compute margin themselves, so it
 * can never drift out of sync with a partial update.
 *
 * Safe to call with any subset of RAW_FINANCIAL_COLUMNS (including none, to
 * just force a margin recompute after some other change). Returns the
 * recomputed margin (or null if still not fully known).
 */
export async function updateOrderFinancials(env, orderId, fields) {
  const patch = Object.fromEntries(
    Object.entries(fields || {}).filter(([k]) => RAW_FINANCIAL_COLUMNS.has(k)),
  );
  if (Object.keys(patch).length > 0) {
    await updateOrder(env, orderId, patch);
  }

  const order = await findOrderById(env, orderId);
  if (!order) return null;

  const margin = computeEstimatedMargin(order);
  await updateOrder(env, orderId, {
    estimated_margin_amount: margin,
    financials_updated_at: new Date().toISOString(),
  });
  return margin;
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

/**
 * Existing shipment rows for an order, in the shape
 * functions/_lib/shipment-reconciliation.js's planShipmentReconciliation()
 * expects as `existingShipments` — used by both
 * functions/api/printify-webhook.js's cost-refresh path (indirectly, via
 * allShipmentsDelivered above) and workers/reconcile-shipments.js, which
 * needs the full existing-state view the pure planner requires.
 */
export async function listShipmentsForOrder(env, orderId) {
  const { results } = await env.DB.prepare(
    `SELECT printify_shipment_id, status FROM shipments WHERE order_id = ?`,
  ).bind(orderId).all();
  return results;
}

/**
 * Whether an (orderId, emailType) row already exists in email_events — used
 * as the `hasEmail` callback the pure planner takes. This is a read used
 * only to decide whether it's worth attempting a send at all; the actual
 * exactly-once guarantee is still the atomic INSERT OR IGNORE inside
 * sendOrderEmailOnce() above (same table, same UNIQUE constraint), so a
 * stale/racy read here can never cause a duplicate — only, at worst, one
 * redundant sendOrderEmailOnce() call that itself resolves to `duplicate`.
 */
export async function hasEmailEvent(env, orderId, emailType) {
  const row = await env.DB.prepare(
    `SELECT id FROM email_events WHERE order_id = ? AND email_type = ?`,
  ).bind(orderId, emailType).first();
  return !!row;
}

/**
 * Active, Printify-backed orders eligible for the shipment/delivery/
 * cancellation reconciliation fallback (workers/reconcile-shipments.js and
 * scripts/reconcile-printify-orders.mjs's pass 2). "Active" = has a
 * printify_order_id (nothing to poll otherwise — that's pass 1's job) and
 * isn't already in one of the two terminal states this reconciliation can
 * reach, so a fully-settled order is never re-polled forever.
 * `limit` bounds a single run's Printify API + D1 load as the order volume
 * grows — callers should pass something sane for current store size (a
 * scheduled Worker on a 15-minute cadence has no reason to process
 * thousands of rows in one invocation; see workers/reconcile-shipments.js's
 * DEFAULT_ORDER_LIMIT for the current default and rationale).
 */
export async function listActiveReconciliationCandidates(env, limit) {
  const { results } = await env.DB.prepare(
    `SELECT id, public_order_number, customer_email, customer_name, printify_order_id, fulfillment_status
     FROM orders
     WHERE printify_order_id IS NOT NULL AND fulfillment_status NOT IN ('delivered', 'printify_canceled')
     ORDER BY created_at ASC
     LIMIT ?`,
  ).bind(limit).all();
  return results;
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

// ─────────────────────────────────────────────────────────────────────────
// Marketing subscribers (migrations/0005) — see that file for the full
// rationale. Only called from stripe-webhook.js (upsertSubscriber, and only
// when that order's marketing_opt_in is true) and functions/api/
// unsubscribe.js (unsubscribeByToken). Nothing here sends email — this is
// storage only; see scripts/send-release-email.mjs for the actual send.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Records that `email` consented to release-announcement email, or renews
 * an existing (previously-unsubscribed) row's consent. Idempotent and safe
 * to call on every order that has marketing_opt_in = true, including
 * repeat orders from the same address.
 *
 * Deliberately does NOT touch unsubscribe_token on conflict — the token in
 * a previously-sent email must keep working for the lifetime of the row,
 * not just until the next order.
 *
 * @returns {Promise<string>} the row's unsubscribe_token (freshly generated
 *   for a new subscriber, or the existing one for a renewed subscription)
 */
export async function upsertSubscriber(env, { email, orderId }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const now = new Date().toISOString();
  const newToken = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO subscribers (email, subscribed, unsubscribe_token, source_order_id, created_at, updated_at)
     VALUES (?, 1, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET subscribed = 1, updated_at = excluded.updated_at`,
  ).bind(normalizedEmail, newToken, orderId ?? null, now, now).run();

  const row = await env.DB.prepare(
    `SELECT unsubscribe_token FROM subscribers WHERE email = ?`,
  ).bind(normalizedEmail).first();
  return row.unsubscribe_token;
}

/**
 * Unsubscribes exactly the (email, token) pair the caller presents — never
 * "the email regardless of token," which would let anyone unsubscribe a
 * stranger's address by guessing it. Returns a status the caller can turn
 * into a human message without leaking whether an email exists at all for
 * a wrong/tampered token.
 *
 * @returns {Promise<'unsubscribed' | 'already_unsubscribed' | 'not_found'>}
 */
export async function unsubscribeByToken(env, { email, token }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !token) return 'not_found';

  const result = await env.DB.prepare(
    `UPDATE subscribers SET subscribed = 0, updated_at = ? WHERE email = ? AND unsubscribe_token = ? AND subscribed = 1`,
  ).bind(new Date().toISOString(), normalizedEmail, token).run();
  if (result.meta.changes === 1) return 'unsubscribed';

  const row = await env.DB.prepare(
    `SELECT subscribed FROM subscribers WHERE email = ? AND unsubscribe_token = ?`,
  ).bind(normalizedEmail, token).first();
  if (!row) return 'not_found';
  return 'already_unsubscribed';
}

/**
 * Every currently-subscribed email + its unsubscribe token, for
 * scripts/send-release-email.mjs to mail out. Never used from a browser-
 * facing route — this is local-script-only, same as the reconciliation
 * scripts' D1 access.
 */
export async function getSubscribedEmails(env) {
  const result = await env.DB.prepare(
    `SELECT email, unsubscribe_token FROM subscribers WHERE subscribed = 1 ORDER BY created_at ASC`,
  ).bind().all();
  return result.results ?? [];
}

// ─────────────────────────────────────────────────────────────────────────
// Product reviews (migrations/0001 — reviews, review_tokens). Review tokens
// are mailed to a customer only after their order is confirmed delivered
// (see workers/send-review-requests.js); submitting one creates a 'pending'
// review that only shows up publicly once moderated to 'approved' (see
// functions/api/moderate-review.js). Token hashing/signing lives in
// functions/_lib/reviews.js — this file only ever sees/stores the hash.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Creates one review token for a single order item and returns its id —
 * callers combine this with functions/_lib/reviews.js's generateReviewToken/
 * hashToken themselves (this function never generates or hashes; it just
 * persists the hash it's given) so the raw token only ever exists in memory
 * long enough to go into an email link, never round-tripping through a
 * second function call.
 */
export async function insertReviewToken(env, { tokenHash, orderId, orderItemId, expiresAt }) {
  await env.DB.prepare(
    `INSERT INTO review_tokens (token_hash, order_id, order_item_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).bind(tokenHash, orderId, orderItemId ?? null, expiresAt, new Date().toISOString()).run();
}

/**
 * Atomically claims a review token: only succeeds if the hash exists, isn't
 * expired, and hasn't been used yet — the UPDATE's WHERE clause is the whole
 * safety mechanism (mirrors sendOrderEmailOnce's INSERT-OR-IGNORE claim,
 * just as an UPDATE instead since the row already exists). Returns the
 * token's (order_id, order_item_id) on success, or null if the token is
 * invalid/expired/already used — callers must not distinguish those cases
 * in what they show the submitter (same reasoning as unsubscribeByToken).
 */
export async function claimReviewToken(env, tokenHash) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE review_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
  ).bind(now, tokenHash, now).run();
  if (result.meta.changes !== 1) return null;

  return env.DB.prepare(
    `SELECT order_id, order_item_id FROM review_tokens WHERE token_hash = ?`,
  ).bind(tokenHash).first();
}

export async function insertReview(env, { id, orderId, orderItemId, productSlug, rating, title, body, displayName }) {
  await env.DB.prepare(
    `INSERT INTO reviews (id, order_id, order_item_id, product_slug, rating, title, body, display_name, verified_purchase, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?)`,
  ).bind(id, orderId, orderItemId ?? null, productSlug, rating, title ?? null, body, displayName, new Date().toISOString()).run();
}

export async function findReviewById(env, reviewId) {
  return env.DB.prepare(`SELECT * FROM reviews WHERE id = ?`).bind(reviewId).first();
}

/**
 * Moves a review from 'pending' to 'approved' or 'rejected' — the WHERE
 * status = 'pending' guard means a moderation link clicked twice (or an
 * approve and a reject both clicked) only ever applies the first click;
 * the second is a safe no-op the caller reports back as "already handled."
 * Returns true if this call is the one that actually changed it.
 */
export async function setReviewStatus(env, reviewId, status) {
  const result = await env.DB.prepare(
    `UPDATE reviews SET status = ?, approved_at = ? WHERE id = ? AND status = 'pending'`,
  ).bind(status, status === 'approved' ? new Date().toISOString() : null, reviewId).run();
  return result.meta.changes === 1;
}

/** Approved reviews for one product, newest first — the only reviews ever shown publicly. */
export async function listApprovedReviews(env, productSlug) {
  const { results } = await env.DB.prepare(
    `SELECT rating, title, body, display_name, created_at FROM reviews WHERE product_slug = ? AND status = 'approved' ORDER BY created_at DESC`,
  ).bind(productSlug).all();
  return results;
}

/**
 * Delivered orders due for a review-request email: every shipment on the
 * order is delivered, the most recent delivery happened at or before
 * `deliveredBeforeIso` (i.e. at least the configured wait has elapsed — see
 * REVIEW_REQUEST_DELAY_DAYS in workers/send-review-requests.js), and no
 * 'review_request' row exists yet for this order (checked against the same
 * email_events table every other order email uses, so this can run
 * repeatedly with no risk of a duplicate send — the actual claim still
 * happens via sendOrderEmailOnce's INSERT OR IGNORE at send time; this
 * query is just the candidate list, same division of labor as
 * listActiveReconciliationCandidates above).
 */
export async function listOrdersNeedingReviewRequest(env, { deliveredBeforeIso, limit }) {
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.public_order_number, o.customer_email, o.customer_name
     FROM orders o
     WHERE o.fulfillment_status = 'delivered'
       AND o.customer_email IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM email_events e WHERE e.order_id = o.id AND e.email_type = 'review_request')
       AND EXISTS (
         SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.status = 'delivered'
         GROUP BY s.order_id HAVING MAX(s.updated_at) <= ?
       )
     ORDER BY o.created_at ASC
     LIMIT ?`,
  ).bind(deliveredBeforeIso, limit).all();
  return results;
}
