// Shared server-side Printify API client.
// Lives under functions/_lib/ — Cloudflare Pages excludes any `_`-prefixed
// path from routing, so this file is never itself reachable as an endpoint.
//
// Required env vars (Cloudflare Pages Dashboard > Settings > Environment Variables):
//   PRINTIFY_API_TOKEN   — never sent to the browser, never logged
//   PRINTIFY_SHOP_ID     — numeric shop ID
//
// As of this pass, PRINTIFY_API_TOKEN is NOT configured in the Cloudflare
// Pages project (confirmed via `wrangler pages secret list` — it is absent).
// Every function here will therefore fail with a clear "not configured"
// error until it's added. That is the correct, safe behavior — nothing here
// invents a token, a product ID, or a shipping rate.
//
// Safety invariants enforced throughout this file:
//   - send_shipping_notification is always false — Printify must never email
//     the customer directly; Resend (via functions/_lib/resend.js) owns all
//     customer-facing order email.
//   - createOrder() never sends the order to production. Printify registers
//     the order (returning a Printify order ID to store) but production only
//     starts when sendToProduction() below is explicitly called — and
//     nothing in this codebase calls it automatically. That is intentional:
//     "Printify approval manual" per the current safety requirements.

const API_BASE = 'https://api.printify.com/v1';

export class PrintifyConfigError extends Error {}
export class PrintifyApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function requireConfig(env) {
  if (!env.PRINTIFY_API_TOKEN) {
    throw new PrintifyConfigError('Printify is not configured (missing API token).');
  }
  if (!env.PRINTIFY_SHOP_ID) {
    throw new PrintifyConfigError('Printify is not configured (missing shop ID).');
  }
}

async function printifyRequest(env, method, path, body) {
  requireConfig(env);

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer ' + env.PRINTIFY_API_TOKEN,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error('[printify] Network error:', err.message);
    throw new PrintifyApiError('Could not reach Printify.', 0);
  }

  let data = {};
  try { data = await res.json(); } catch { /* some Printify endpoints return no body */ }

  if (!res.ok) {
    // Log Printify's diagnostic message, never the Authorization header/token.
    console.error('[printify] API error:', res.status, data?.message || JSON.stringify(data).slice(0, 300));
    throw new PrintifyApiError(data?.message || `Printify API error (${res.status})`, res.status);
  }

  return data;
}

/**
 * Requests shipping rates for a trusted cart against Printify's shipping
 * calculator. `items` must already be CATALOG-resolved (see
 * functions/_lib/catalog.js) — this function never accepts raw browser input.
 *
 * Returns { options: [{ id, label, amountCents, currency }] } — reshaped to
 * expose only what the browser needs, never Printify's raw response.
 *
 * Throws PrintifyConfigError / PrintifyApiError if the token is missing, or
 * if any item lacks a confirmed Printify product/variant mapping (which is
 * the case for every product today — see catalog.js).
 */
export async function getShippingRates(env, { items, address }) {
  requireConfig(env);

  const unmapped = items.filter((it) => !it.printify?.productId || !it.printify?.variantId);
  if (unmapped.length > 0) {
    throw new PrintifyConfigError(
      `Printify product/variant mapping is missing for: ${unmapped.map((it) => it.slug + ' (' + it.size + ')').join(', ')}.`,
    );
  }

  const payload = {
    line_items: items.map((it) => ({
      product_id: it.printify.productId,
      variant_id: it.printify.variantId,
      quantity: it.quantity,
    })),
    address_to: {
      country: address?.country || '',
      region: address?.region || address?.state || '',
      city: address?.city || '',
      zip: address?.zip || address?.postal_code || '',
    },
  };

  const data = await printifyRequest(env, 'POST', `/shops/${env.PRINTIFY_SHOP_ID}/orders/shipping.json`, payload);

  // Printify's shipping response shape is { standard: <cents>, express: <cents>,
  // priority: <cents>, economy: <cents>, ... } (cost per named method, not a
  // list). The site only ever offers Economy and Standard — Express, Priority,
  // and Printify Express are not options we support, so they are dropped here
  // rather than merely hidden by the frontend. If Printify doesn't return an
  // `economy` rate for this cart/print-provider combo, only `standard` (if
  // present) comes through — nothing is fabricated to fill the gap.
  const ALLOWED_METHOD_KEYS = ['economy', 'standard'];
  const options = Object.entries(data || {})
    .filter(([methodKey, cents]) => ALLOWED_METHOD_KEYS.includes(methodKey) && Number.isFinite(cents))
    .map(([methodKey, cents]) => ({
      id: methodKey,
      label: methodKey.charAt(0).toUpperCase() + methodKey.slice(1),
      amountCents: cents,
      currency: 'usd',
    }))
    .sort((a, b) => ALLOWED_METHOD_KEYS.indexOf(a.id) - ALLOWED_METHOD_KEYS.indexOf(b.id));

  return { options };
}

/**
 * Creates (registers) an order in Printify. Does NOT send it to production —
 * see the module-level note above. Returns Printify's order ID to store in
 * D1 (orders.printify_order_id).
 *
 * `items` must be CATALOG-resolved with a confirmed printify.productId /
 * printify.variantId for every line — throws PrintifyConfigError otherwise
 * rather than submitting a partial/garbled order.
 */
export async function createPrintifyOrder(env, { orderNumber, items, shipping, email }) {
  requireConfig(env);

  const unmapped = items.filter((it) => !it.printify?.productId || !it.printify?.variantId);
  if (unmapped.length > 0) {
    throw new PrintifyConfigError(
      `Cannot create Printify order — missing product/variant mapping for: ${unmapped.map((it) => it.slug + ' (' + it.size + ')').join(', ')}.`,
    );
  }

  const payload = {
    external_id: orderNumber,
    label: orderNumber,
    line_items: items.map((it) => ({
      product_id: it.printify.productId,
      variant_id: it.printify.variantId,
      quantity: it.quantity,
    })),
    shipping_method: env.PRINTIFY_SHIPPING_METHOD_ID ? Number(env.PRINTIFY_SHIPPING_METHOD_ID) : undefined,
    send_shipping_notification: false, // Resend owns all customer email — see module note above.
    address_to: {
      first_name: shipping?.firstName || '',
      last_name: shipping?.lastName || '',
      email: email || '',
      country: shipping?.country || '',
      region: shipping?.region || shipping?.state || '',
      address1: shipping?.address1 || '',
      address2: shipping?.address2 || '',
      city: shipping?.city || '',
      zip: shipping?.zip || shipping?.postal_code || '',
    },
  };

  const data = await printifyRequest(env, 'POST', `/shops/${env.PRINTIFY_SHOP_ID}/orders.json`, payload);
  return { printifyOrderId: data.id };
}

/**
 * Fetches the authoritative order record from Printify — the create-order
 * response only ever returns an id (see createPrintifyOrder above); actual
 * cost data lives here, via GET /v1/shops/{shop_id}/orders/{order_id}.json.
 */
export async function getPrintifyOrder(env, printifyOrderId) {
  return printifyRequest(env, 'GET', `/shops/${env.PRINTIFY_SHOP_ID}/orders/${printifyOrderId}.json`);
}

// Costs aren't final while Printify is still pricing the order. Treating a
// 0 in these fields as "known: true, cost is $0" while an order is still in
// one of these statuses would be wrong — it means "not calculated yet," not
// "free." (Confirmed against a real order: a genuinely canceled order also
// reports 0 for these fields — that 0 IS real/final, which is why 'canceled'
// is deliberately NOT in this set.)
const PENDING_COST_STATUSES = new Set(['on-hold', 'cost-calculation', 'payment-not-received']);

/**
 * Extracts real fulfillment-cost fields from a Printify order detail
 * response (from getPrintifyOrder above). Never estimates.
 *
 * Important field-mapping note, confirmed directly against Printify's docs:
 * the order-level `total_price`/`total_shipping` fields are documented as
 * "Retail price"/"Shipping price" — i.e. what the SALE was for, not what
 * Printify charges for fulfillment. They must never be used as our cost.
 * The real per-line-item cost fields are `cost` ("fulfillment cost") and
 * `shipping_cost` ("shipment cost"), summed across every line item.
 * `total_tax` is the only tax-cost field Printify exposes at all; used as-is
 * — there is no per-line-item tax breakdown documented.
 *
 * Returns { known: false } (never a fabricated number) while the order is
 * still in a pending-cost status — see PENDING_COST_STATUSES above.
 */
export function extractPrintifyCosts(order) {
  if (!order || PENDING_COST_STATUSES.has(order.status)) {
    return { known: false };
  }

  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const productCost = lineItems.reduce((sum, li) => sum + (Number(li.cost) || 0), 0);
  const shippingCost = lineItems.reduce((sum, li) => sum + (Number(li.shipping_cost) || 0), 0);
  const taxAmount = Number(order.total_tax) || 0;

  return {
    known: true,
    productCost,
    shippingCost,
    taxAmount,
    totalCost: productCost + shippingCost + taxAmount,
  };
}

// ---------------------------------------------------------------------------
// Shared shipment-key derivation — the ONE place this logic lives, imported
// by both functions/api/printify-webhook.js (the primary, event-driven path)
// and scripts/reconcile-printify-orders.mjs (the polling fallback), so both
// paths can never independently drift into computing a different key for
// the same physical shipment. Callers give it whatever identity fields their
// data source actually has:
//   - the order:shipment:created/delivered webhook payload has
//     carrier/tracking_number/tracking_url + skus[] + shipped_at/delivered_at
//   - GET /v1/shops/{shop_id}/orders/{order_id}.json's `shipments[]` array
//     (see extractOrderShipments below) has only carrier/number/url/delivered_at
// Neither shape includes a real shipment ID (confirmed against Printify's
// docs — see extractOrderShipments's own comment) — the tracking number is
// the only genuinely stable per-package identifier either shape provides.
// ---------------------------------------------------------------------------

/**
 * Primary key: the carrier tracking number — each physical package gets its
 * own, so two distinct shipments always differ here. Fallback (only when a
 * source genuinely omits tracking_number, which no observed/documented
 * payload has done): a deterministic key from carrier + caller-supplied
 * `discriminator` (whatever best-effort extra identity the caller's data
 * shape actually has — e.g. skus+timestamp for the webhook payload, or
 * delivered_at+array-index for the GET-order shipments array). This is not
 * collision-proof in theory, but it is never the only protection against a
 * duplicate email — the `shipments` table's UNIQUE(order_id,
 * printify_shipment_id) upsert and the `email_events` UNIQUE(order_id,
 * email_type) claim are what actually guarantee at-most-once, on both paths.
 */
export function deriveShipmentKey({ carrier, trackingNumber, discriminator }) {
  if (trackingNumber) return trackingNumber;
  return `no-tracking:${carrier || 'unknown-carrier'}:${discriminator || 'unknown'}`;
}

/**
 * Parses the `shipments` array off a GET order-detail response (see
 * getPrintifyOrder above) into normalized entries. Confirmed against
 * Printify's documented "Shipment properties" (developers.printify.com,
 * order.shipments[]): `carrier` (courier name), `number` (tracking number),
 * `url` (tracking link), `delivered_at` (ISO datetime — present once the
 * carrier has confirmed delivery, absent/null while merely shipped). There
 * is no shipment-id field and no "shipped_at" at this level (unlike the
 * webhook payload) — see deriveShipmentKey above for how identity is still
 * derived. Deliberately does NOT read printify_connect.url — that field
 * points to Printify's own hosted tracking page on a third-party domain,
 * not a carrier tracking link, and was explicitly excluded from this
 * feature's scope.
 */
export function extractOrderShipments(order) {
  const raw = Array.isArray(order?.shipments) ? order.shipments : [];
  return raw.map((s, index) => ({
    carrier: s?.carrier ?? null,
    trackingNumber: s?.number ?? null,
    trackingUrl: s?.url ?? null,
    deliveredAt: s?.delivered_at ?? null,
    index,
  }));
}

/**
 * Sends an already-created Printify order into production. NOT called from
 * anywhere in this codebase yet — "Printify approval manual" is a hard
 * safety requirement for this pass. Exists so a future, explicitly-reviewed
 * admin action (or a later PRINTIFY_AUTO_SEND_TO_PRODUCTION-gated pass) has
 * something to call.
 */
export async function sendPrintifyOrderToProduction(env, printifyOrderId) {
  requireConfig(env);
  if (env.PRINTIFY_AUTO_SEND_TO_PRODUCTION !== 'true') {
    throw new PrintifyConfigError('PRINTIFY_AUTO_SEND_TO_PRODUCTION is not enabled — refusing to send to production.');
  }
  return printifyRequest(env, 'POST', `/shops/${env.PRINTIFY_SHOP_ID}/orders/${printifyOrderId}/send_to_production.json`);
}
