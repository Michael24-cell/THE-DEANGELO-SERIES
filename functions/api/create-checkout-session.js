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
// an optional email, a required shippingOptionId, and a required
// shippingAddress (see functions/_lib/address.js). Price is never trusted
// from the client — name, unit amount, currency, and tax code always come
// from the shared CATALOG (functions/_lib/catalog.js), which mirrors the
// prices shown on product.html. `color` is accepted but only to record which
// of a product's ALREADY-DEFINED colors was picked; it can never introduce a
// color (or price) that CATALOG doesn't already know about.
//
// Shipping: `shippingOptionId` (e.g. "standard") and `shippingAddress` (the
// customer's actual destination — collected by checkout.html's own
// "Shipping" step, BEFORE this call) are both REQUIRED. Neither is trusted
// for price — the amount is independently re-resolved server-side via
// resolveShippingOption(), which re-validates the address (see
// functions/_lib/address.js) and re-queries Printify for a fresh quote
// against that exact destination, only accepting an amount that appears in
// that fresh response. See functions/_lib/printify.js — getShippingRates()
// only ever returns Economy or Standard (Express/Priority/Printify Express
// are filtered out at that shared source), so an arbitrary, stale, or
// premium shippingOptionId can never match and is rejected with 400 here.
//
// Address-mismatch note: Stripe's own hosted Checkout page also collects a
// shipping address (`shipping_address_collection` below) — Stripe gives us
// no API parameter to lock or force that collected address to match the one
// quoted here, so a customer could in principle type something different on
// Stripe's page. functions/api/stripe-webhook.js compares the two after
// payment (country/region/zip, stored in this Session's metadata as
// shipping_quote_*) and refuses to auto-fulfill on a mismatch rather than
// silently shipping at a possibly-wrong rate. See that file and the launch
// checklist for the full writeup of this limitation.

import { validateCartItems, CatalogValidationError } from '../_lib/catalog.js';
import { validateAddress, AddressValidationError } from '../_lib/address.js';
import { getShippingRates } from '../_lib/printify.js';

const ALLOWED_SHIP_COUNTRIES = ['US'];
const SHIPPING_LABELS = { standard: 'Standard shipping', economy: 'Economy shipping' };

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

  // ── Shipping — required, never trust a browser-submitted amount ────────────────
  // shippingOptionId and a full shippingAddress must both be present. The
  // address is re-validated (functions/_lib/address.js) and used to get a
  // fresh Printify quote — the amount is always re-derived here, never taken
  // from the request body.
  const shippingOptionId = String(body.shippingOptionId || '').trim();
  if (!shippingOptionId) {
    return json({ error: 'A shipping method is required.' }, 400);
  }

  let shippingAddress;
  try {
    shippingAddress = validateAddress(body.shippingAddress);
  } catch (err) {
    if (err instanceof AddressValidationError) return json({ error: err.message }, 400);
    throw err;
  }

  let shippingOption;
  try {
    shippingOption = await resolveShippingOption(env, shippingOptionId, lineItems, shippingAddress);
  } catch (err) {
    if (err instanceof ValidationError) return json({ error: err.message }, 400);
    throw err;
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
    // shipping_option_id is stored so the webhook/fulfillment step can confirm
    // Printify is fulfilling with the exact method Stripe actually charged
    // for. shipping_quote_* records the destination shipping was actually
    // quoted against, so the webhook can compare it to whatever address
    // Stripe's own hosted page collects and refuse to auto-fulfill on a
    // mismatch (see functions/api/stripe-webhook.js and the note above about
    // Stripe not supporting a locked/prefilled shipping address). Integer
    // cents throughout; never a float dollar amount.
    metadata: {
      order_source: 'thedeangeloseries.com',
      item_count: String(lineItems.length),
      shipping_option_id: shippingOption.id,
      shipping_quote_country: shippingAddress.country,
      shipping_quote_region: shippingAddress.region,
      shipping_quote_zip: shippingAddress.zip,
    },
    shipping_options: [{
      shipping_rate_data: {
        type: 'fixed_amount',
        // Server-resolved amount only — see resolveShippingOption() below.
        // shippingOption.amountCents already comes back as an integer (cents)
        // from Printify via getShippingRates(); never a browser-supplied value.
        fixed_amount: { amount: shippingOption.amountCents, currency: shippingOption.currency },
        display_name: SHIPPING_LABELS[shippingOption.id] || shippingOption.label,
      },
    }],
  };

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
