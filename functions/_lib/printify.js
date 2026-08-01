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
