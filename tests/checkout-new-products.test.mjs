// Proves Wind & Sea — Tee and Waves of Life — Tee, now that they have real
// Printify mappings in functions/_lib/catalog.js, successfully flow all the
// way through the live checkout pipeline: the Printify shipping quote is
// reached (unlike an unmapped product — see checkout-unmapped-product.test.mjs)
// and a Stripe Checkout Session is created using the trusted variant ID/SKU
// from the catalog, never anything the browser could supply.
//
// Run: node tests/checkout-new-products.test.mjs (or `npm test`)

import { onRequest } from '../functions/api/create-checkout-session.js';
import { CATALOG } from '../functions/_lib/catalog.js';

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

const NEW_PRODUCTS = [
  { slug: 'wind-sea-tee', size: 'M', color: 'Black' },
  { slug: 'waves-of-life-tee', size: 'M', color: 'White' },
];

async function run() {
  for (const { slug, size, color } of NEW_PRODUCTS) {
    console.log(`\n--- ${slug}: reaches Printify shipping quote + creates a Stripe session with the trusted variant ---`);

    let stripeCalled = false;
    let printifyShippingCalled = false;
    let printifyRequestBody = null;
    let stripeRequestBody = null;

    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('orders/shipping.json')) {
        printifyShippingCalled = true;
        printifyRequestBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ standard: 500, economy: 300 }) };
      }
      if (u.includes('api.stripe.com')) {
        stripeCalled = true;
        stripeRequestBody = opts.body;
        return { ok: true, json: async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.com/cs_test_123' }) };
      }
      throw new Error('Unexpected fetch in checkout-new-products test: ' + u);
    };

    const body = {
      items: [{ slug, size, color, quantity: 1 }],
      email: 'buyer@example.com',
      shippingOptionId: 'standard',
      shippingAddress: VALID_ADDRESS,
    };
    const res = await onRequest({ request: makeRequest(body), env: makeEnv() });
    const responseBody = await res.json();

    ok('Printify shipping quote was reached (product is mapped)', printifyShippingCalled === true);

    const entry = CATALOG[slug];
    const expectedVariantId = entry.printify.variantIdBySize[size];
    ok(
      'Printify shipping request used the CATALOG-trusted variant ID (not something browser-supplied)',
      printifyRequestBody?.line_items?.some((li) => li.variant_id === expectedVariantId),
      printifyRequestBody
    );
    ok(
      'Printify shipping request used the correct product ID',
      printifyRequestBody?.line_items?.some((li) => li.product_id === entry.printify.productId),
      printifyRequestBody
    );

    ok('HTTP 200 (Stripe Checkout Session created)', res.status === 200, res.status);
    ok('Stripe API was called', stripeCalled === true);
    ok('response has a session id + url', !!responseBody.id && !!responseBody.url, responseBody);
    ok(
      'Stripe line item price came from CATALOG, not the request body (unit_amount = basePrice for a non-upcharge size)',
      typeof stripeRequestBody === 'string' && stripeRequestBody.includes(`unit_amount%5D=${entry.basePrice}`),
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
