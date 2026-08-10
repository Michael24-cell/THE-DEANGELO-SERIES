// Cloudflare Pages Function — Printify shipping quote
// Route: POST /api/printify-shipping-quote
//
// Called by checkout.html live, as the customer's shipping address fields
// are filled in — see the "Shipping" step there. The chosen option's `id`
// is then sent to /api/create-checkout-session as `shippingOptionId`,
// alongside the same address, which independently re-quotes and verifies it.
//
// Required env vars:
//   PRINTIFY_API_TOKEN   — never sent to the browser, never logged
//   PRINTIFY_SHOP_ID
//
// The browser may only send { items: [{slug, size, color, quantity}], address }.
// `address` is the customer's actual, full shipping destination (see
// functions/_lib/address.js) — collected by checkout.html BEFORE a Stripe
// Checkout Session is created, so the rate quoted here matches the
// destination create-checkout-session.js will independently re-quote and
// charge for. Every item is resolved against the trusted CATALOG
// server-side — nothing about price or Printify IDs is ever taken from the
// request. If any item in the cart lacks a confirmed Printify product/
// variant mapping (true for every product as of this pass — see
// functions/_lib/catalog.js), this endpoint returns a clear 409 rather
// than fabricating a shipping rate.

import { validateCartItems, CatalogValidationError, hasCompletePrintifyMapping } from '../_lib/catalog.js';
import { validateAddress, AddressValidationError } from '../_lib/address.js';
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
    if (err instanceof CatalogValidationError || err instanceof AddressValidationError) {
      return json({ error: err.message }, 400);
    }
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

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
