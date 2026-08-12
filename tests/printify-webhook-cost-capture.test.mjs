// Persistent regression tests for functions/api/printify-webhook.js's
// Printify fulfillment-cost capture (refreshPrintifyCosts) — real costs
// only, fetched via a follow-up GET on the order, refreshed on both
// order:sent-to-production and order:updated. Never estimates.
//
// Run: node tests/printify-webhook-cost-capture.test.mjs (or `npm test`)

import crypto from 'node:crypto';
import { onRequest } from '../functions/api/printify-webhook.js';
import { createFakeD1 } from './_fake-d1.mjs';

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const SECRET = 'whsec_test_printify_fake';

function signBody(bodyStr, secret) {
  return crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');
}

function makeEnv(db, extra) {
  return {
    DB: db, PRINTIFY_WEBHOOK_SECRET: SECRET,
    RESEND_API_KEY: 'x', FROM_EMAIL: 'orders@thedeangeloseries.com', SUPPORT_EMAIL: 'support@thedeangeloseries.com',
    PRINTIFY_API_TOKEN: 'fake-printify-token', PRINTIFY_SHOP_ID: '26931439',
    ...extra,
  };
}

function seedOrder(db, overrides = {}) {
  const now = new Date().toISOString();
  const order = {
    id: 'order_' + Math.random().toString(36).slice(2),
    public_order_number: 'DS-TEST0001',
    stripe_checkout_session_id: 'cs_test_x', stripe_payment_intent_id: 'pi_test_x',
    customer_email: 'buyer@example.com', customer_name: 'Test Buyer',
    shipping_name: 'Test Buyer', shipping_address_line1: '1 St', shipping_address_line2: null,
    shipping_city: 'City', shipping_state: 'CA', shipping_postal_code: '95014', shipping_country: 'US',
    currency: 'usd', subtotal_amount: 6400, shipping_amount: 519, tax_amount: 0, total_amount: 6919,
    payment_status: 'paid', fulfillment_status: 'submitted_to_printify',
    created_at: now, updated_at: now,
    printify_order_id: 'pf_order_1',
    production_status: null, carrier: null, tracking_number: null, tracking_url: null, fulfillment_error: null,
    stripe_balance_transaction_id: null, stripe_fee_amount: 219, stripe_net_amount: 6700, paid_at: now,
    printify_product_cost: null, printify_shipping_cost: null, printify_tax_amount: null, printify_total_cost: null,
    estimated_margin_amount: null, financials_updated_at: null,
    ...overrides,
  };
  db._tables.orders.push(order);
  return order;
}

// printifyOrderMode: 'produced' (final costs) | 'pending' (still on-hold) | 'canceled' (real zero costs)
function stubFetch({ printifyOrderMode = 'produced', calls } = {}) {
  global.fetch = async (url) => {
    const u = String(url);
    calls?.push(u);
    if (u.includes('resend.com')) return { ok: true, json: async () => ({ id: 'r_' + Math.random().toString(36).slice(2) }) };
    if (u.includes('/orders/')) {
      if (printifyOrderMode === 'pending') {
        return { ok: true, json: async () => ({ id: 'pf_order_1', status: 'on-hold', line_items: [{ cost: 0, shipping_cost: 0 }], total_tax: 0 }) };
      }
      if (printifyOrderMode === 'canceled') {
        return { ok: true, json: async () => ({ id: 'pf_order_1', status: 'canceled', line_items: [{ cost: 0, shipping_cost: 0 }], total_tax: 0 }) };
      }
      return {
        ok: true, json: async () => ({
          id: 'pf_order_1', status: 'in-production',
          line_items: [{ cost: 2100, shipping_cost: 450 }, { cost: 900, shipping_cost: 0 }],
          total_tax: 25,
        }),
      };
    }
    throw new Error('Unexpected fetch: ' + u);
  };
}

function sentToProductionEvent({ id, resourceId }) {
  return { id, type: 'order:sent-to-production', created_at: new Date().toISOString(), resource: { id: resourceId, type: 'order', data: { shop_id: 815256 } } };
}
function orderUpdatedEvent({ id, resourceId, status }) {
  return { id, type: 'order:updated', created_at: new Date().toISOString(), resource: { id: resourceId, type: 'order', data: { shop_id: 815256, status } } };
}

async function post(env, bodyObj) {
  const bodyStr = JSON.stringify(bodyObj);
  const sig = signBody(bodyStr, env.PRINTIFY_WEBHOOK_SECRET);
  const request = { method: 'POST', headers: { get: (k) => (k.toLowerCase() === 'x-pfy-signature' ? sig : null) }, text: async () => bodyStr };
  const res = await onRequest({ request, env });
  const body = await res.json();
  return { res, body };
}

async function run() {
  console.log('--- order:sent-to-production: real Printify costs captured, margin computed ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    stubFetch({ printifyOrderMode: 'produced' });
    await post(env, sentToProductionEvent({ id: 'evt_stp_cost', resourceId: order.printify_order_id }));
    ok('printify_product_cost = sum of line_items[].cost (2100+900)', order.printify_product_cost === 3000, order.printify_product_cost);
    ok('printify_shipping_cost = sum of line_items[].shipping_cost (450+0)', order.printify_shipping_cost === 450, order.printify_shipping_cost);
    ok('printify_tax_amount = order.total_tax', order.printify_tax_amount === 25, order.printify_tax_amount);
    ok('printify_total_cost = product+shipping+tax', order.printify_total_cost === 3475, order.printify_total_cost);
    ok('financials_updated_at stamped', typeof order.financials_updated_at === 'string');
    // subtotal 6400 + shipping 519 - stripe_fee 219 (seeded) - product 3000 - shipping 450 - tax 25 = 3225
    ok('estimated_margin_amount computed now that all 6 inputs are known', order.estimated_margin_amount === 3225, order.estimated_margin_amount);
  }

  console.log('\n--- order:sent-to-production while Printify is still calculating costs: fields stay null ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    stubFetch({ printifyOrderMode: 'pending' });
    await post(env, sentToProductionEvent({ id: 'evt_stp_pending', resourceId: order.printify_order_id }));
    ok('printify_product_cost stays null (not 0 — genuinely unknown)', order.printify_product_cost === null);
    ok('printify_total_cost stays null', order.printify_total_cost === null);
    ok('estimated_margin_amount stays null', order.estimated_margin_amount === null);
  }

  console.log('\n--- order:updated (in-production) also triggers a cost refresh ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    stubFetch({ printifyOrderMode: 'produced' });
    await post(env, orderUpdatedEvent({ id: 'evt_upd_cost', resourceId: order.printify_order_id, status: 'in-production' }));
    ok('printify_total_cost captured via order:updated too', order.printify_total_cost === 3475, order.printify_total_cost);
  }

  console.log('\n--- Genuine cancellation: real zero costs ARE stored (0 is a real, final value here, not "unknown") ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    stubFetch({ printifyOrderMode: 'canceled' });
    await post(env, orderUpdatedEvent({ id: 'evt_upd_canceled_cost', resourceId: order.printify_order_id, status: 'canceled' }));
    ok('printify_product_cost = 0 (real, not null — order genuinely cost nothing)', order.printify_product_cost === 0, order.printify_product_cost);
    ok('printify_total_cost = 0', order.printify_total_cost === 0, order.printify_total_cost);
  }

  console.log('\n--- Printify fetch failure during cost refresh does not fail the webhook ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('resend.com')) return { ok: true, json: async () => ({ id: 'r_x' }) };
      if (u.includes('/orders/')) return { ok: false, status: 500, json: async () => ({ message: 'Printify is down' }) };
      throw new Error('Unexpected fetch: ' + u);
    };
    const { res } = await post(env, sentToProductionEvent({ id: 'evt_stp_fetchfail', resourceId: order.printify_order_id }));
    ok('Webhook still returns 200 despite cost-refresh failure', res.status === 200);
    ok('fulfillment_status still updated to in_production (cost refresh is best-effort/separate)', order.fulfillment_status === 'in_production');
    ok('printify_product_cost stays null after a failed fetch', order.printify_product_cost === null);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
