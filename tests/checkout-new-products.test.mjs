// Proves Wind & Sea — Tee and Waves of Life — Tee, now that they have real
// Printify mappings in functions/_lib/catalog.js, successfully flow all the
// way through the live checkout pipeline: the Printify shipping quote is
// reached (unlike an unmapped product — see checkout-unmapped-product.test.mjs)
// and a Stripe Checkout Session is created using the trusted variant ID/SKU
// from the catalog, never anything the browser could supply.
//
// Run: node tests/checkout-new-products.test.mjs (or `npm test`)

import { onRequest } from '../functions/api/create-checkout-session.js';
import { CATALOG, printifyMappingForColor } from '../functions/_lib/catalog.js';

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
  { slug: 'waves-of-life-tee', size: 'M', color: 'Black' },
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
      marketingOptIn: true,
      shippingOptionId: 'standard',
      shippingAddress: VALID_ADDRESS,
      attribution: {
        utm_source: 'facebook',
        utm_medium: 'social',
        utm_campaign: 'series_01_launch',
        fbclid: 'must-not-reach-stripe',
      },
    };
    const res = await onRequest({ request: makeRequest(body), env: makeEnv() });
    const responseBody = await res.json();

    ok('Printify shipping quote was reached (product is mapped)', printifyShippingCalled === true);

    const entry = CATALOG[slug];
    const printifyMap = printifyMappingForColor(entry, color);
    const expectedVariantId = printifyMap.variantIdBySize[size];
    ok(
      'Printify shipping request used the CATALOG-trusted variant ID (not something browser-supplied)',
      printifyRequestBody?.line_items?.some((li) => li.variant_id === expectedVariantId),
      printifyRequestBody
    );
    ok(
      'Printify shipping request used the correct product ID',
      printifyRequestBody?.line_items?.some((li) => li.product_id === printifyMap.productId),
      printifyRequestBody
    );

    ok('HTTP 200 (Stripe Checkout Session created)', res.status === 200, res.status);
    ok('Stripe API was called', stripeCalled === true);
    ok('response has a session id + url', !!responseBody.id && !!responseBody.url, responseBody);
    ok(
      'Stripe line item price came from CATALOG, not the request body (unit_amount = basePrice for a non-upcharge size)',
      typeof stripeRequestBody === 'string' && stripeRequestBody.includes(`unit_amount%5D=${entry.basePrice}`),
    );
    ok(
      'allowlisted campaign attribution reaches Stripe Session metadata',
      stripeRequestBody.includes('metadata%5Butm_source%5D=facebook') &&
        stripeRequestBody.includes('metadata%5Butm_campaign%5D=series_01_launch'),
      stripeRequestBody,
    );
    ok('Facebook click IDs are not forwarded to Stripe', !stripeRequestBody.includes('fbclid'), stripeRequestBody);
    ok(
      'marketingOptIn:true reaches Stripe Session metadata as the literal string "true"',
      stripeRequestBody.includes('metadata%5Bmarketing_opt_in%5D=true'),
      stripeRequestBody,
    );
  }

  console.log('\n--- marketingOptIn defaults to false when omitted, and non-boolean values never pass through as true ---');
  {
    let stripeRequestBody = null;
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('orders/shipping.json')) return { ok: true, json: async () => ({ standard: 500 }) };
      if (u.includes('api.stripe.com')) {
        stripeRequestBody = opts.body;
        return { ok: true, json: async () => ({ id: 'cs_test_456', url: 'https://checkout.stripe.com/cs_test_456' }) };
      }
      throw new Error('Unexpected fetch: ' + u);
    };
    const body = {
      items: [{ slug: 'wind-sea-tee', size: 'M', color: 'Black', quantity: 1 }],
      email: 'buyer@example.com',
      marketingOptIn: 'true', // a string, not a boolean — must NOT be trusted
      shippingOptionId: 'standard',
      shippingAddress: VALID_ADDRESS,
    };
    await onRequest({ request: makeRequest(body), env: makeEnv() });
    ok(
      'A non-boolean marketingOptIn value is recorded as false, not guessed at',
      stripeRequestBody.includes('metadata%5Bmarketing_opt_in%5D=false'),
      stripeRequestBody,
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
