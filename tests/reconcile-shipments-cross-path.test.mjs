// Cross-path convergence tests: proves the live webhook
// (functions/api/printify-webhook.js) and the reconciliation fallback's
// decision logic (functions/_lib/shipment-reconciliation.js) share the exact
// same D1 shipment records and the exact same email_events UNIQUE(order_id,
// email_type) idempotency table, whichever one discovers a shipment first.
//
// The "apply" side for reconciliation here uses the REAL D1 primitives from
// functions/_lib/orders-db.js (insertShipment, sendOrderEmailOnce) — the
// same functions the webhook path already uses — against the same in-memory
// fake D1 (tests/_fake-d1.mjs). scripts/reconcile-printify-orders.mjs's own
// "apply" step uses raw SQL via `wrangler d1 execute` instead (see
// tests/reconcile-shipments-script.test.mjs for a real-local-D1 test of that
// script directly) — mechanically identical (same table, same UNIQUE
// constraint), so proving the contract here via orders-db.js is a faithful
// test of the same guarantee.
//
// Run: node tests/reconcile-shipments-cross-path.test.mjs (or `npm test`)

import crypto from 'node:crypto';
import { onRequest } from '../functions/api/printify-webhook.js';
import { insertShipment, sendOrderEmailOnce } from '../functions/_lib/orders-db.js';
import { planShipmentReconciliation } from '../functions/_lib/shipment-reconciliation.js';
import { shippedTemplate } from '../functions/_lib/email-templates.js';
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
    payment_status: 'paid', fulfillment_status: 'in_production',
    created_at: now, updated_at: now,
    printify_order_id: 'pf_order_1',
    production_status: null, carrier: null, tracking_number: null, tracking_url: null, fulfillment_error: null,
    stripe_balance_transaction_id: null, stripe_fee_amount: null, stripe_net_amount: null, paid_at: now,
    printify_product_cost: null, printify_shipping_cost: null, printify_tax_amount: null, printify_total_cost: null,
    estimated_margin_amount: null, financials_updated_at: null,
    ...overrides,
  };
  db._tables.orders.push(order);
  return order;
}

function stubResendFetch() {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('resend.com')) return { ok: true, json: async () => ({ id: 'r_' + Math.random().toString(36).slice(2) }) };
    throw new Error('Unexpected fetch: ' + u);
  };
}

function shipmentCreatedEvent({ id, resourceId, trackingNumber }) {
  return {
    id, type: 'order:shipment:created', created_at: new Date().toISOString(),
    resource: { id: resourceId, type: 'order', data: {
      shop_id: 815256, shipped_at: new Date().toISOString(),
      carrier: { code: 'USPS', tracking_number: trackingNumber, tracking_url: `https://example.com/track/${trackingNumber}` },
      skus: ['SKU-1'],
    } },
  };
}

async function postWebhook(env, bodyObj) {
  const bodyStr = JSON.stringify(bodyObj);
  const sig = signBody(bodyStr, env.PRINTIFY_WEBHOOK_SECRET);
  const request = { method: 'POST', headers: { get: (k) => (k.toLowerCase() === 'x-pfy-signature' ? sig : null) }, text: async () => bodyStr };
  return onRequest({ request, env });
}

// Reconciliation's "apply" step, using the real shared D1 primitives — see
// module note above for why this is a faithful stand-in for the actual
// script's raw-SQL apply step.
async function applyReconciliationPlan(env, order, plan) {
  for (const s of plan.shipments) {
    await insertShipment(env, { orderId: order.id, printifyShipmentId: s.key, carrier: s.carrier, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl, status: s.status });
    if (s.sendShippedEmail) {
      await sendOrderEmailOnce(env, {
        orderId: order.id, emailType: `shipped_${s.key}`, to: order.customer_email,
        buildTemplate: () => shippedTemplate({ orderNumber: order.public_order_number, carrier: s.carrier, trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl }),
      });
    }
  }
}

function hasEmailFrom(db, orderId) {
  return (emailType) => db._tables.email_events.some((e) => e.order_id === orderId && e.email_type === emailType);
}
function existingShipmentsFrom(db, orderId) {
  return db._tables.shipments.filter((s) => s.order_id === orderId).map((s) => ({ printify_shipment_id: s.printify_shipment_id, status: s.status }));
}

async function run() {
  stubResendFetch();

  console.log('--- Webhook discovers shipment FIRST; reconciliation polls the same tracking later: no duplicate email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);

    await postWebhook(env, shipmentCreatedEvent({ id: 'evt_ship_webhook_first', resourceId: order.printify_order_id, trackingNumber: 'TRACK-AAA' }));
    ok('webhook: one shipment row', db._tables.shipments.filter((s) => s.order_id === order.id).length === 1);
    ok('webhook: one shipped email', db._tables.email_events.filter((e) => e.order_id === order.id && e.email_type.startsWith('shipped_')).length === 1);

    // Reconciliation polls Printify and sees the SAME shipment.
    const printifyOrder = { status: 'in-production', shipments: [{ carrier: 'USPS', number: 'TRACK-AAA', url: 'https://example.com/track/TRACK-AAA' }] };
    const plan = await planShipmentReconciliation({
      order: { fulfillment_status: order.fulfillment_status },
      printifyOrder,
      existingShipments: existingShipmentsFrom(db, order.id),
      hasEmail: hasEmailFrom(db, order.id),
    });
    ok('reconciliation plan: sendShippedEmail is false (webhook already claimed it)', plan.shipments[0].sendShippedEmail === false);

    await applyReconciliationPlan(env, order, plan);
    ok('still exactly one shipment row after reconciliation applies', db._tables.shipments.filter((s) => s.order_id === order.id).length === 1);
    ok('still exactly one shipped email after reconciliation applies', db._tables.email_events.filter((e) => e.order_id === order.id && e.email_type.startsWith('shipped_')).length === 1);
  }

  console.log('\n--- Reconciliation discovers shipment FIRST; webhook delivers for the same tracking later: no duplicate email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);

    const printifyOrder = { status: 'in-production', shipments: [{ carrier: 'USPS', number: 'TRACK-AAA', url: 'https://example.com/track/TRACK-AAA' }] };
    const plan = await planShipmentReconciliation({
      order: { fulfillment_status: order.fulfillment_status },
      printifyOrder,
      existingShipments: existingShipmentsFrom(db, order.id),
      hasEmail: hasEmailFrom(db, order.id),
    });
    ok('reconciliation plan: sendShippedEmail true (nothing claimed it yet)', plan.shipments[0].sendShippedEmail === true);
    await applyReconciliationPlan(env, order, plan);
    ok('reconciliation: one shipment row', db._tables.shipments.filter((s) => s.order_id === order.id).length === 1);
    ok('reconciliation: one shipped email', db._tables.email_events.filter((e) => e.order_id === order.id && e.email_type.startsWith('shipped_')).length === 1);

    // The real webhook now delivers for the same physical shipment.
    await postWebhook(env, shipmentCreatedEvent({ id: 'evt_ship_recon_first', resourceId: order.printify_order_id, trackingNumber: 'TRACK-AAA' }));
    ok('still exactly one shipment row after the webhook fires', db._tables.shipments.filter((s) => s.order_id === order.id).length === 1);
    ok('still exactly one shipped email after the webhook fires (no duplicate)', db._tables.email_events.filter((e) => e.order_id === order.id && e.email_type.startsWith('shipped_')).length === 1);
  }

  console.log('\n--- Two distinct packages, one discovered by each path: two shipment rows, two separate emails, no cross-contamination ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);

    // Webhook delivers for package A.
    await postWebhook(env, shipmentCreatedEvent({ id: 'evt_pkg_a', resourceId: order.printify_order_id, trackingNumber: 'TRACK-AAA' }));

    // Reconciliation polls and sees BOTH packages (A already known, B new).
    const printifyOrder = {
      status: 'in-production',
      shipments: [
        { carrier: 'USPS', number: 'TRACK-AAA', url: 'https://example.com/track/TRACK-AAA' },
        { carrier: 'UPS', number: 'TRACK-BBB', url: 'https://example.com/track/TRACK-BBB' },
      ],
    };
    const plan = await planShipmentReconciliation({
      order: { fulfillment_status: order.fulfillment_status },
      printifyOrder,
      existingShipments: existingShipmentsFrom(db, order.id),
      hasEmail: hasEmailFrom(db, order.id),
    });
    const planA = plan.shipments.find((s) => s.key === 'TRACK-AAA');
    const planB = plan.shipments.find((s) => s.key === 'TRACK-BBB');
    ok('package A: no email (webhook already sent it)', planA.sendShippedEmail === false);
    ok('package B: email planned (genuinely new)', planB.sendShippedEmail === true);

    await applyReconciliationPlan(env, order, plan);
    ok('two shipment rows total', db._tables.shipments.filter((s) => s.order_id === order.id).length === 2);
    ok('exactly two shipped emails total (one per package)', db._tables.email_events.filter((e) => e.order_id === order.id && e.email_type.startsWith('shipped_')).length === 2);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
