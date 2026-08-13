// Functional tests for workers/reconcile-shipments.js's runReconciliation()
// — exercised directly (not via Cloudflare's scheduled-event plumbing) using
// the same in-memory fake D1 (tests/_fake-d1.mjs) the webhook tests use, and
// a stubbed global.fetch for both Printify GET calls and Resend sends.
//
// Also proves cross-path idempotency directly against the real webhook
// handler (functions/api/printify-webhook.js's onRequest) — webhook-first
// and cron-first, in both directions, sharing the same fake D1 instance.
//
// Run: node tests/reconcile-shipments-worker.test.mjs (or `npm test`)

import crypto from 'node:crypto';
import { runReconciliation } from '../workers/reconcile-shipments.js';
import { onRequest } from '../functions/api/printify-webhook.js';
import { createFakeD1 } from './_fake-d1.mjs';

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const WEBHOOK_SECRET = 'whsec_test_printify_fake';
function signBody(bodyStr, secret) {
  return crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');
}

function makeEnv(db, extra) {
  return {
    DB: db,
    PRINTIFY_API_TOKEN: 'fake-printify-token', PRINTIFY_SHOP_ID: '26931439',
    PRINTIFY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RESEND_API_KEY: 'x', FROM_EMAIL: 'orders@thedeangeloseries.com', SUPPORT_EMAIL: 'support@thedeangeloseries.com',
    ...extra,
  };
}

function seedOrder(db, overrides = {}) {
  const now = new Date().toISOString();
  const order = {
    id: 'order_' + Math.random().toString(36).slice(2),
    public_order_number: 'DS-WORKER01',
    stripe_checkout_session_id: 'cs_test_x', stripe_payment_intent_id: 'pi_test_x',
    customer_email: 'buyer@example.com', customer_name: 'Test Buyer',
    shipping_name: 'Test Buyer', shipping_address_line1: '1 St', shipping_address_line2: null,
    shipping_city: 'City', shipping_state: 'CA', shipping_postal_code: '95014', shipping_country: 'US',
    currency: 'usd', subtotal_amount: 6400, shipping_amount: 519, tax_amount: 0, total_amount: 6919,
    payment_status: 'paid', fulfillment_status: 'in_production',
    created_at: now, updated_at: now,
    printify_order_id: 'pf_' + Math.random().toString(36).slice(2),
    production_status: null, carrier: null, tracking_number: null, tracking_url: null, fulfillment_error: null,
    stripe_balance_transaction_id: null, stripe_fee_amount: null, stripe_net_amount: null, paid_at: now,
    printify_product_cost: null, printify_shipping_cost: null, printify_tax_amount: null, printify_total_cost: null,
    estimated_margin_amount: null, financials_updated_at: null,
    ...overrides,
  };
  db._tables.orders.push(order);
  return order;
}

// Maps printify_order_id -> the printifyOrder object getPrintifyOrder should
// "return" for it; anything not in the map is an unexpected fetch and throws.
function stubFetch(printifyOrdersById, { failFor = new Set() } = {}) {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('resend.com')) {
      return { ok: true, json: async () => ({ id: 'r_' + Math.random().toString(36).slice(2) }) };
    }
    const m = u.match(/\/orders\/([^./]+)\.json$/);
    if (m) {
      const id = m[1];
      if (failFor.has(id)) return { ok: false, status: 500, json: async () => ({ message: 'Printify is down' }) };
      const order = printifyOrdersById[id];
      if (!order) throw new Error('Test stub: no printifyOrder configured for ' + id);
      return { ok: true, json: async () => order };
    }
    throw new Error('Unexpected fetch in worker test: ' + u);
  };
}

async function postWebhook(env, bodyObj) {
  const bodyStr = JSON.stringify(bodyObj);
  const sig = signBody(bodyStr, env.PRINTIFY_WEBHOOK_SECRET);
  const request = { method: 'POST', headers: { get: (k) => (k.toLowerCase() === 'x-pfy-signature' ? sig : null) }, text: async () => bodyStr };
  return onRequest({ request, env });
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

async function run() {
  console.log('--- Scheduled invocation with no active orders: clean no-op summary ---');
  {
    const db = createFakeD1();
    const env = makeEnv(db);
    stubFetch({});
    const summary = await runReconciliation(env);
    ok('checked = 0', summary.checked === 0);
    ok('no failures', summary.fetchFailures === 0);
    ok('durationMs recorded', typeof summary.durationMs === 'number' && summary.durationMs >= 0);
  }

  console.log('\n--- One active order, no tracking yet: no shipment, no email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    stubFetch({ [order.printify_order_id]: { status: 'in-production', shipments: [] } });
    const summary = await runReconciliation(env);
    ok('checked = 1', summary.checked === 1);
    ok('no shipments found', summary.shipmentsFound === 0);
    ok('no shipped emails', summary.shippedEmailsSent === 0);
    ok('D1 order untouched', db._tables.orders[0].fulfillment_status === 'in_production');
  }

  console.log('\n--- New shipment found: shipment row + one shipped email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    stubFetch({ [order.printify_order_id]: { status: 'in-production', shipments: [{ carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA' }] } });
    const summary = await runReconciliation(env);
    ok('shipmentsFound = 1', summary.shipmentsFound === 1);
    ok('shippedEmailsSent = 1', summary.shippedEmailsSent === 1);
    ok('one shipment row in D1', db._tables.shipments.filter((s) => s.order_id === order.id).length === 1);
    ok('order fulfillment_status = shipped', db._tables.orders[0].fulfillment_status === 'shipped');
    ok('status_events row recorded', db._tables.status_events.some((e) => e.order_id === order.id && e.event_type === 'reconcile:shipments'));
  }

  console.log('\n--- Duplicate polling (same tracking, unchanged): no duplicate row, no duplicate email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    stubFetch({ [order.printify_order_id]: { status: 'in-production', shipments: [{ carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA' }] } });
    await runReconciliation(env);
    const summary2 = await runReconciliation(env);
    ok('second poll: shipmentsFound still counts the (unchanged) shipment', summary2.shipmentsFound === 1);
    ok('second poll: shippedEmailsSent = 0 (already claimed)', summary2.shippedEmailsSent === 0);
    ok('second poll: shippedEmailsSkipped = 1', summary2.shippedEmailsSkipped === 1);
    ok('still exactly one shipment row', db._tables.shipments.filter((s) => s.order_id === order.id).length === 1);
    ok('still exactly one shipped email', db._tables.email_events.filter((e) => e.order_id === order.id && e.email_type.startsWith('shipped_')).length === 1);
  }

  console.log('\n--- Two shipments on one order: two rows, two separate emails ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    stubFetch({
      [order.printify_order_id]: {
        status: 'in-production',
        shipments: [
          { carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA' },
          { carrier: 'ups', number: 'TRACK-BBB', url: 'https://track/BBB' },
        ],
      },
    });
    const summary = await runReconciliation(env);
    ok('shipmentsFound = 2', summary.shipmentsFound === 2);
    ok('shippedEmailsSent = 2', summary.shippedEmailsSent === 2);
    ok('two shipment rows', db._tables.shipments.filter((s) => s.order_id === order.id).length === 2);
  }

  console.log('\n--- Delivery reconciliation: all shipments delivered => order delivered + one delivered email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    stubFetch({
      [order.printify_order_id]: {
        status: 'fulfilled',
        shipments: [{ carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA', delivered_at: '2026-08-13T00:00:00Z' }],
      },
    });
    const summary = await runReconciliation(env);
    ok('delivered = 1', summary.delivered === 1);
    ok('deliveredEmailsSent = 1', summary.deliveredEmailsSent === 1);
    ok('order fulfillment_status = delivered', db._tables.orders[0].fulfillment_status === 'delivered');
    ok('exactly one delivered email', db._tables.email_events.filter((e) => e.order_id === order.id && e.email_type === 'delivered').length === 1);

    // Re-poll: must not re-mark or re-email.
    const summary2 = await runReconciliation(env);
    ok('re-poll: checked = 0 (order is now terminal, excluded by the candidate query)', summary2.checked === 0);
  }

  console.log('\n--- Cancellation reconciliation: D1 state updated + one support alert ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    stubFetch({ [order.printify_order_id]: { status: 'canceled', shipments: [] } });
    const summary = await runReconciliation(env);
    ok('cancellationsReconciled = 1', summary.cancellationsReconciled === 1);
    ok('alertsSent = 1', summary.alertsSent === 1);
    ok('order fulfillment_status = printify_canceled', db._tables.orders[0].fulfillment_status === 'printify_canceled');
    ok('fulfillment_error stored', typeof db._tables.orders[0].fulfillment_error === 'string' && db._tables.orders[0].fulfillment_error.length > 0);
    ok('exactly one cancellation alert', db._tables.email_events.filter((e) => e.order_id === order.id && e.email_type === 'printify_canceled_alert').length === 1);

    // Re-poll: order is now terminal — excluded entirely.
    const summary2 = await runReconciliation(env);
    ok('re-poll: checked = 0 (terminal, excluded)', summary2.checked === 0);
  }

  console.log('\n--- Printify API failure on one order while another succeeds: isolated, both processed independently ---');
  {
    const db = createFakeD1();
    const failingOrder = seedOrder(db, { public_order_number: 'DS-FAIL01' });
    const okOrder = seedOrder(db, { public_order_number: 'DS-OK01' });
    const env = makeEnv(db);
    stubFetch(
      { [okOrder.printify_order_id]: { status: 'in-production', shipments: [{ carrier: 'usps', number: 'TRACK-OK', url: 'https://track/OK' }] } },
      { failFor: new Set([failingOrder.printify_order_id]) },
    );
    const summary = await runReconciliation(env);
    ok('checked = 2', summary.checked === 2);
    ok('fetchFailures = 1', summary.fetchFailures === 1);
    ok('shipmentsFound = 1 (the succeeding order still processed)', summary.shipmentsFound === 1);
    const failingRow = db._tables.orders.find((o) => o.id === failingOrder.id);
    ok('failing order left completely untouched', failingRow.fulfillment_status === 'in_production' && failingRow.fulfillment_error === null);
    const okRow = db._tables.orders.find((o) => o.id === okOrder.id);
    ok('succeeding order was updated', okRow.fulfillment_status === 'shipped');
  }

  console.log('\n--- Webhook-first, cron-second: no duplicate shipped email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    await postWebhook(env, shipmentCreatedEvent({ id: 'evt_webhook_first', resourceId: order.printify_order_id, trackingNumber: 'TRACK-AAA' }));
    ok('webhook: one shipped email', db._tables.email_events.filter((e) => e.order_id === order.id && e.email_type.startsWith('shipped_')).length === 1);

    stubFetch({ [order.printify_order_id]: { status: 'in-production', shipments: [{ carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA' }] } });
    const summary = await runReconciliation(env);
    ok('cron: shippedEmailsSent = 0 (webhook already claimed it)', summary.shippedEmailsSent === 0);
    ok('cron: shippedEmailsSkipped = 1', summary.shippedEmailsSkipped === 1);
    ok('still exactly one shipped email total', db._tables.email_events.filter((e) => e.order_id === order.id && e.email_type.startsWith('shipped_')).length === 1);
  }

  console.log('\n--- Cron-first, webhook-second: no duplicate shipped email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    stubFetch({ [order.printify_order_id]: { status: 'in-production', shipments: [{ carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA' }] } });
    const summary = await runReconciliation(env);
    ok('cron: shippedEmailsSent = 1', summary.shippedEmailsSent === 1);

    await postWebhook(env, shipmentCreatedEvent({ id: 'evt_webhook_second', resourceId: order.printify_order_id, trackingNumber: 'TRACK-AAA' }));
    ok('still exactly one shipped email total after the webhook fires', db._tables.email_events.filter((e) => e.order_id === order.id && e.email_type.startsWith('shipped_')).length === 1);
  }

  console.log('\n--- Bounded order processing: RECONCILE_ORDER_LIMIT is respected ---');
  {
    const db = createFakeD1();
    const orders = [seedOrder(db), seedOrder(db), seedOrder(db)];
    const env = makeEnv(db, { RECONCILE_ORDER_LIMIT: '2' });
    const stubMap = {};
    for (const o of orders) stubMap[o.printify_order_id] = { status: 'in-production', shipments: [] };
    stubFetch(stubMap);
    const summary = await runReconciliation(env);
    ok('checked respects the configured limit (2 of 3 candidates)', summary.checked === 2, summary.checked);
  }

  console.log('\n--- Fatal error (missing D1 binding) is thrown, not swallowed ---');
  {
    let threw = false;
    try {
      await runReconciliation({});
    } catch {
      threw = true;
    }
    ok('runReconciliation rejects when env.DB is missing', threw);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
