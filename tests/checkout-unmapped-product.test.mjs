// Proves the live storefront cannot complete a purchase of a product with no
// confirmed Printify mapping (currently: Venezia Tee, `tee` in
// functions/_lib/catalog.js — `printify: null`). Shipping is mandatory
// (functions/api/create-checkout-session.js) and the shipping quote path
// (functions/_lib/printify.js's getShippingRates) refuses any cart containing
// an unmapped item — so the request fails before a Stripe Checkout Session
// is ever created. This test exercises the REAL onRequest() end-to-end with
// a stubbed fetch, and asserts Stripe's API was never called at all.
//
// Run: node tests/checkout-unmapped-product.test.mjs (or `npm test`)

import { onRequest } from '../functions/api/create-checkout-session.js';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function makeEnv(extra) {
  return {
    APP_ENV: 'preview',
    STRIPE_SECRET_KEY: 'sk_test_fake',
    SITE_URL: 'https://thedeangeloseries.com',
    PRINTIFY_API_TOKEN: 'fake-printify-token',
    PRINTIFY_SHOP_ID: '26931439',
    ...extra,
  };
}

const VALID_ADDRESS = {
  firstName: 'Test', lastName: 'Buyer', address1: '1 Main St', city: 'Anaheim',
  region: 'CA', zip: '92805', country: 'US',
};

function makeRequest(body) {
  return {
    method: 'POST',
    json: async () => body,
  };
}

async function run() {
  let stripeCalled = false;
  let printifyShippingCalled = false;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.stripe.com')) {
      stripeCalled = true;
      return { ok: true, json: async () => ({ id: 'cs_test_should_never_happen', url: 'https://checkout.stripe.com/should-never-happen' }) };
    }
    if (u.includes('orders/shipping.json')) {
      printifyShippingCalled = true;
      // Real getShippingRates() throws PrintifyConfigError BEFORE this fetch
      // ever fires (it checks item.printify.productId/variantId first) — if
      // this stub is ever hit for the unmapped-product case, that's itself a
      // regression, so it intentionally returns something that would look
      // like a valid quote if the guard were bypassed.
      return { ok: true, json: async () => ({ standard: 500 }) };
    }
    throw new Error('Unexpected fetch in unmapped-product test: ' + u);
  };

  console.log('--- Venezia Tee (unmapped): checkout session creation is refused ---');
  {
    const body = {
      items: [{ slug: 'tee', size: 'M', color: 'White', quantity: 1 }],
      email: 'buyer@example.com',
      shippingOptionId: 'standard',
      shippingAddress: VALID_ADDRESS,
    };
    const res = await onRequest({ request: makeRequest(body), env: makeEnv() });
    const responseBody = await res.json();
    ok('HTTP 400 (not 200 — no session created)', res.status === 400, res.status);
    ok('rejected before ever calling Printify shipping.json', printifyShippingCalled === false);
    ok('Stripe API was never called', stripeCalled === false);
    ok('response contains an error message, not a session id/url', !responseBody.id && !responseBody.url, responseBody);
  }

  console.log('\n--- Control: a fully-mapped product (Arhus Tee) with the SAME stub still requires a real Printify quote ---');
  {
    // Sanity check that the test harness itself isn't just rejecting
    // everything — a mapped product reaches the shipping-quote stub (proving
    // the unmapped-product case above was rejected for the right reason,
    // earlier in the pipeline, not by some unrelated failure).
    stripeCalled = false;
    printifyShippingCalled = false;
    const body = {
      items: [{ slug: 'arhus-old-town-tee', size: 'M', color: 'Black', quantity: 1 }],
      email: 'buyer@example.com',
      shippingOptionId: 'standard',
      shippingAddress: VALID_ADDRESS,
    };
    await onRequest({ request: makeRequest(body), env: makeEnv() });
    ok('mapped product DOES reach the Printify shipping-quote call', printifyShippingCalled === true);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
