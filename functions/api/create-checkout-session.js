// Cloudflare Pages Function — creates a Stripe Checkout Session
// Route: POST /api/create-checkout-session
//
// Zero npm dependencies — calls the Stripe REST API directly via fetch(),
// matching the existing dependency-free style of stripe-webhook.js.
//
// Required secrets (Cloudflare Pages Dashboard > Settings > Environment Variables):
//   STRIPE_SECRET_KEY   — sk_test_... (test mode only — this endpoint refuses sk_live_)
//   SITE_URL            — e.g. https://thedeangeloseries.com (success/cancel redirect base)
//
// Optional:
//   STRIPE_TAX_ENABLED  — set to "true" once Stripe Tax is registered/configured in the
//                         Dashboard (Settings > Tax). Defaults to disabled.
//
// The browser may only send { slug, size, color, quantity } per line item, plus
// an optional email and an optional shippingOptionId. Price is never trusted
// from the client — name, unit amount, currency, and tax code always come
// from the shared CATALOG (functions/_lib/catalog.js), which mirrors the
// prices shown on product.html. `color` is accepted but only to record which
// of a product's ALREADY-DEFINED colors was picked; it can never introduce a
// color (or price) that CATALOG doesn't already know about.
//
// Shipping: if the browser sends `shippingOptionId`, it is NOT trusted as a
// price — the amount is independently re-resolved server-side via
// resolveShippingOption() before being handed to Stripe. See
// functions/_lib/printify.js for how quotes are produced in the first place.
// Today no product has a confirmed Printify mapping, so any shippingOptionId
// will fail to resolve and the request is rejected with a clear error — it
// never falls through to a guessed or free shipping amount. Omitting
// shippingOptionId (the only path checkout.html currently exercises) is
// unaffected and behaves exactly as before: no shipping_options, "Shipping
// calculated at checkout."

import { validateCartItems, CatalogValidationError } from '../_lib/catalog.js';
import { getShippingRates } from '../_lib/printify.js';

const ALLOWED_SHIP_COUNTRIES = ['US', 'CA', 'GB', 'IT', 'FR', 'JP'];

class ValidationError extends Error {}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }

  // ── Config guard — never proceed without a secret key, never proceed in live mode ──
  if (!env.STRIPE_SECRET_KEY) {
    console.error('[create-checkout-session] Missing env var: STRIPE_SECRET_KEY');
    return json({ error: 'Server misconfiguration — contact site owner' }, 500);
  }
  if (!env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    // Hard guard: this pass is test-mode only. Refuse to run against a live key
    // even if one is accidentally configured.
    console.error('[create-checkout-session] STRIPE_SECRET_KEY is not a test-mode key');
    return json({ error: 'Checkout is running in test mode only right now.' }, 500);
  }

  const siteUrl = (env.SITE_URL || 'https://thedeangeloseries.com').replace(/\/+$/, '');

  // ── Parse + validate body ──────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  let lineItems, email;
  try {
    lineItems = validateCartItems(body.items);
    email = validateEmail(body.email);
  } catch (err) {
    if (err instanceof ValidationError || err instanceof CatalogValidationError) {
      return json({ error: err.message }, 400);
    }
    throw err;
  }

  // ── Optional shipping — never trust a browser-submitted amount ─────────────────
  // checkout.html does not send shippingOptionId today, so this block is inert
  // in the current live flow. If a future frontend change starts sending one,
  // the amount is independently re-resolved here, not taken from the request.
  let shippingOption = null;
  if (body.shippingOptionId) {
    try {
      shippingOption = await resolveShippingOption(env, body.shippingOptionId, lineItems, body.shippingAddress);
    } catch (err) {
      if (err instanceof ValidationError) return json({ error: err.message }, 400);
      throw err;
    }
  }

  // ── Build the Stripe Checkout Session payload ──────────────────────────────────
  const taxEnabled = env.STRIPE_TAX_ENABLED === 'true';

  const payload = {
    mode: 'payment',
    success_url: `${siteUrl}/checkout-success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/checkout-cancel.html`,
    line_items: lineItems.map((li) => ({
      quantity: li.quantity,
      price_data: {
        currency: li.currency,
        unit_amount: li.unitAmount,
        product_data: {
          name: li.name,
          images: [li.image],
          tax_code: li.taxCode,
          metadata: { slug: li.slug, size: li.size, color: li.color },
        },
      },
    })),
    shipping_address_collection: { allowed_countries: ALLOWED_SHIP_COUNTRIES },
    metadata: {
      order_source: 'thedeangeloseries.com',
      item_count: String(lineItems.length),
    },
  };

  if (shippingOption) {
    // Server-resolved amount only — see resolveShippingOption() below.
    payload.shipping_options = [{
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: shippingOption.amountCents, currency: shippingOption.currency },
        display_name: shippingOption.label,
      },
    }];
  }
  // If shippingOption is still null: no shipping_options are sent. Do NOT add a
  // $0 entry here — that would render as "Free shipping," which is not true.
  // "Shipping calculated at checkout" (checkout.html's current copy) stays
  // accurate until real Printify rates exist.

  if (email) payload.customer_email = email;
  if (taxEnabled) payload.automatic_tax = { enabled: true };

  // ── Create the session via Stripe's REST API ───────────────────────────────────
  let stripeRes;
  try {
    stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2024-06-20',
      },
      body: toFormBody(payload),
    });
  } catch (err) {
    console.error('[create-checkout-session] Network error calling Stripe:', err.message);
    return json({ error: 'Could not reach Stripe. Please try again.' }, 502);
  }

  const data = await stripeRes.json();

  if (!stripeRes.ok) {
    // Forward Stripe's message (never the secret key) so the browser can show
    // something useful; log the full error server-side for debugging.
    console.error('[create-checkout-session] Stripe API error:', JSON.stringify(data.error || data));
    return json({ error: data.error?.message || 'Stripe could not create a checkout session.' }, 502);
  }

  return json({ id: data.id, url: data.url }, 200);
}

// ---------------------------------------------------------------------------
// Re-resolves a shipping quote server-side. `shippingOptionId` and
// `shippingAddress` come from the browser but are used only to ask Printify
// the same question again — never to accept a price directly from the
// client. Throws ValidationError (400) if the option can't be independently
// confirmed, e.g. because the cart's Printify mapping isn't complete yet.
// ---------------------------------------------------------------------------
async function resolveShippingOption(env, shippingOptionId, lineItems, shippingAddress) {
  let quote;
  try {
    quote = await getShippingRates(env, { items: lineItems, address: shippingAddress || {} });
  } catch (err) {
    console.error('[create-checkout-session] Shipping quote failed:', err.message);
    throw new ValidationError('Shipping is not available for this order yet.');
  }
  const match = (quote.options || []).find((o) => o.id === shippingOptionId);
  if (!match) throw new ValidationError('That shipping option is no longer available. Please try again.');
  return match;
}

function validateEmail(value) {
  if (value === undefined || value === null || value === '') return null;
  const email = String(value).trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('That email address doesn\'t look right.');
  }
  return email;
}

// ---------------------------------------------------------------------------
// Stripe's REST API takes application/x-www-form-urlencoded bodies with
// bracket-notation keys for nested objects/arrays (the same format its own
// client libraries produce). This flattens a plain JS object into that shape.
// ---------------------------------------------------------------------------
function toFormBody(obj) {
  const params = new URLSearchParams();
  appendFormParam(params, null, obj);
  return params.toString();
}

function appendFormParam(params, key, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => appendFormParam(params, key ? `${key}[${i}]` : String(i), v));
  } else if (typeof value === 'object') {
    Object.entries(value).forEach(([k, v]) => appendFormParam(params, key ? `${key}[${k}]` : k, v));
  } else {
    params.append(key, String(value));
  }
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
