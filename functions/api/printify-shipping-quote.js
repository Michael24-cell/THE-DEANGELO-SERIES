// Cloudflare Pages Function — Printify shipping quote
// Route: POST /api/printify-shipping-quote
//
// NOT wired into checkout.html yet — this is a standalone capability. The
// live checkout flow is unchanged by this endpoint's existence; it only
// takes effect once a future frontend change calls it and passes the chosen
// option's `id` to /api/create-checkout-session as `shippingOptionId`.
//
// Required env vars:
//   PRINTIFY_API_TOKEN   — never sent to the browser, never logged
//   PRINTIFY_SHOP_ID
//
// The browser may only send { items: [{slug, size, color, quantity}], address }.
// Every item is resolved against the trusted CATALOG server-side — nothing
// about price or Printify IDs is ever taken from the request. If any item in
// the cart lacks a confirmed Printify product/variant mapping (true for
// every product as of this pass — see functions/_lib/catalog.js), this
// endpoint returns a clear 409 rather than fabricating a shipping rate.

import { validateCartItems, CatalogValidationError, hasCompletePrintifyMapping } from '../_lib/catalog.js';
import { getShippingRates, PrintifyConfigError, PrintifyApiError } from '../_lib/printify.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  let items, address;
  try {
    items = validateCartItems(body.items);
    address = validateAddress(body.address);
  } catch (err) {
    if (err instanceof CatalogValidationError) return json({ error: err.message }, 400);
    throw err;
  }

  if (!hasCompletePrintifyMapping(items)) {
    return json(
      { error: 'Shipping quotes are not available yet — product setup on Printify is not complete.' },
      409,
    );
  }

  try {
    const quote = await getShippingRates(env, { items, address });
    return json({ options: quote.options }, 200);
  } catch (err) {
    if (err instanceof PrintifyConfigError) {
      console.error('[printify-shipping-quote] Config error:', err.message);
      return json({ error: 'Shipping is not configured yet.' }, 503);
    }
    if (err instanceof PrintifyApiError) {
      console.error('[printify-shipping-quote] Printify API error:', err.status, err.message);
      return json({ error: 'Could not get a shipping quote right now. Please try again.' }, 502);
    }
    throw err;
  }
}

function validateAddress(raw) {
  const country = String(raw?.country || '').trim().toUpperCase();
  if (!country || country.length !== 2) {
    throw new CatalogValidationError('A valid destination country is required.');
  }
  return {
    country,
    region: String(raw?.region || raw?.state || '').trim(),
    city: String(raw?.city || '').trim(),
    zip: String(raw?.zip || raw?.postal_code || '').trim(),
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
