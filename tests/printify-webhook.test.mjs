// Persistent regression tests for functions/api/printify-webhook.js.
//
// Exercises the endpoint exactly as Printify would call it: signed POST
// bodies matching the *documented* payload shapes (developers.printify.com —
// Events > Order events), run through the real onRequest() handler against
// an in-memory D1 mock (tests/_fake-d1.mjs) and a stubbed Resend fetch.
//
// Run: node tests/printify-webhook.test.mjs  (or `npm test`, via tests/run-all.mjs)

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
    DB: db,
    PRINTIFY_WEBHOOK_SECRET: SECRET,
    RESEND_API_KEY: 'x',
    FROM_EMAIL: 'orders@thedeangeloseries.com',
    SUPPORT_EMAIL: 'support@thedeangeloseries.com',
    ...extra,
  };
}

function seedOrder(db, overrides = {}) {
  const now = new Date().toISOString();
  const order = {
    id: 'order_' + Math.random().toString(36).slice(2),
    public_order_number: 'DS-TEST0001',
    stripe_checkout_session_id: 'cs_test_x',
    stripe_payment_intent_id: 'pi_test_x',
    customer_email: 'buyer@example.com',
    customer_name: 'Test Buyer',
    shipping_name: 'Test Buyer',
    shipping_address_line1: '1 St', shipping_address_line2: null,
    shipping_city: 'City', shipping_state: 'CA', shipping_postal_code: '95014', shipping_country: 'US',
    currency: 'usd', subtotal_amount: 6400, shipping_amount: 519, tax_amount: 0, total_amount: 6919,
    payment_status: 'paid', fulfillment_status: 'submitted_to_printify',
    created_at: now, updated_at: now,
    printify_order_id: 'pf_order_1',
    production_status: null, carrier: null, tracking_number: null, tracking_url: null, fulfillment_error: null,
    ...overrides,
  };
  db._tables.orders.push(order);
  return order;
}

function stubResendFetch() {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('resend.com')) {
      return { ok: true, json: async () => ({ id: 'r_' + Math.random().toString(36).slice(2) }) };
    }
    throw new Error('Unexpected fetch in printify-webhook test: ' + u);
  };
}

// Payload shapes copied verbatim from developers.printify.com's documented
// "Resource data examples" — not guessed. See functions/api/printify-webhook.js
// header comment for the source.
function orderUpdatedEvent({ id, resourceId, status, extra }) {
  return { id, type: 'order:updated', created_at: new Date().toISOString(), resource: { id: resourceId, type: 'order', data: { shop_id: 815256, status, ...extra } } };
}
function sentToProductionEvent({ id, resourceId }) {
  return { id, type: 'order:sent-to-production', created_at: new Date().toISOString(), resource: { id: resourceId, type: 'order', data: { shop_id: 815256 } } };
}
function shipmentCreatedEvent({ id, resourceId, trackingNumber, skus }) {
  return {
    id, type: 'order:shipment:created', created_at: new Date().toISOString(),
    resource: { id: resourceId, type: 'order', data: {
      shop_id: 815256, shipped_at: new Date().toISOString(),
      carrier: { code: 'USPS', tracking_number: trackingNumber, tracking_url: `https://example.com/track/${trackingNumber}` },
      skus: skus || ['6202'],
    } },
  };
}
function shipmentDeliveredEvent({ id, resourceId, trackingNumber, skus }) {
  return {
    id, type: 'order:shipment:delivered', created_at: new Date().toISOString(),
    resource: { id: resourceId, type: 'order', data: {
      shop_id: 815256, delivered_at: new Date().toISOString(),
      carrier: { code: 'USPS', tracking_number: trackingNumber, tracking_url: `https://example.com/track/${trackingNumber}` },
      skus: skus || ['6202'],
    } },
  };
}

async function post(env, bodyObj, { signatureOverride, omitSignature = false } = {}) {
  const bodyStr = JSON.stringify(bodyObj);
  const sig = signatureOverride !== undefined ? signatureOverride : signBody(bodyStr, env.PRINTIFY_WEBHOOK_SECRET || SECRET);
  const request = {
    method: 'POST',
    headers: { get: (k) => (k.toLowerCase() === 'x-pfy-signature' && !omitSignature ? sig : null) },
    text: async () => bodyStr,
  };
  const res = await onRequest({ request, env });
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  return { res, body };
}

async function run() {
  stubResendFetch();

  console.log('--- Missing PRINTIFY_WEBHOOK_SECRET => 503, fails closed before parsing ---');
  {
    const db = createFakeD1();
    const env = makeEnv(db, { PRINTIFY_WEBHOOK_SECRET: undefined });
    const { res } = await post(env, sentToProductionEvent({ id: 'evt_1', resourceId: 'pf_order_1' }));
    ok('HTTP 503', res.status === 503, res.status);
  }

  console.log('\n--- Invalid signature => rejected, nothing processed ---');
  {
    const db = createFakeD1();
    seedOrder(db);
    const env = makeEnv(db);
    const { res } = await post(env, sentToProductionEvent({ id: 'evt_2', resourceId: 'pf_order_1' }), { signatureOverride: 'deadbeef'.repeat(8) });
    ok('HTTP 400', res.status === 400);
    ok('Event was NOT claimed', db._tables.processed_webhooks.length === 0);
  }

  console.log('\n--- Valid signature => accepted ---');
  {
    const db = createFakeD1();
    seedOrder(db);
    const env = makeEnv(db);
    const { res, body } = await post(env, sentToProductionEvent({ id: 'evt_3', resourceId: 'pf_order_1' }));
    ok('HTTP 200', res.status === 200, res.status);
    ok('received:true', body?.received === true);
  }

  console.log('\n--- Duplicate event delivery => no duplicate processing ---');
  {
    const db = createFakeD1();
    seedOrder(db);
    const env = makeEnv(db);
    const event = sentToProductionEvent({ id: 'evt_dup', resourceId: 'pf_order_1' });
    const first = await post(env, event);
    const second = await post(env, event);
    ok('First delivery processed (200, not duplicate)', first.res.status === 200 && first.body.duplicate !== true);
    ok('Second delivery flagged duplicate', second.body.duplicate === true);
    ok('Only one status_events row', db._tables.status_events.filter((e) => e.external_event_id === 'evt_dup').length === 1);
    ok('Only one in_production email', db._tables.email_events.filter((e) => e.email_type === 'in_production').length === 1);
  }

  console.log('\n--- order:sent-to-production marks in_production + sends email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    await post(env, sentToProductionEvent({ id: 'evt_stp', resourceId: order.printify_order_id }));
    ok('fulfillment_status = in_production', order.fulfillment_status === 'in_production', order.fulfillment_status);
    ok('production_status = in_production', order.production_status === 'in_production');
    ok('in_production email claimed', db._tables.email_events.some((e) => e.email_type === 'in_production'));
  }

  console.log('\n--- order:updated status=in-production marks in_production ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    await post(env, orderUpdatedEvent({ id: 'evt_upd_prod', resourceId: order.printify_order_id, status: 'in-production' }));
    ok('fulfillment_status = in_production', order.fulfillment_status === 'in_production');
    ok('in_production email claimed', db._tables.email_events.some((e) => e.email_type === 'in_production'));
  }

  console.log('\n--- Duplicate production signals (sent-to-production + order:updated) => exactly one production email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    await post(env, sentToProductionEvent({ id: 'evt_prod_a', resourceId: order.printify_order_id }));
    await post(env, orderUpdatedEvent({ id: 'evt_prod_b', resourceId: order.printify_order_id, status: 'in-production' }));
    const emails = db._tables.email_events.filter((e) => e.email_type === 'in_production');
    ok('Exactly one in_production email despite two distinct signal events', emails.length === 1, emails.length);
  }

  console.log('\n--- Genuine cancellation: order:updated status=canceled ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    const { res } = await post(env, orderUpdatedEvent({ id: 'evt_cancel', resourceId: order.printify_order_id, status: 'canceled', extra: { reason: 'Print provider out of stock' } }));
    ok('HTTP 200', res.status === 200);
    ok('fulfillment_status = printify_canceled', order.fulfillment_status === 'printify_canceled', order.fulfillment_status);
    ok('fulfillment_error captured from payload', order.fulfillment_error === 'Print provider out of stock', order.fulfillment_error);
    const alert = db._tables.email_events.find((e) => e.email_type === 'printify_canceled_alert');
    ok('Support alert claimed exactly once', !!alert);
    ok('No shipped email was sent', !db._tables.email_events.some((e) => e.email_type.startsWith('shipped_')));
    ok('No delivered email was sent', !db._tables.email_events.some((e) => e.email_type === 'delivered'));
  }

  console.log('\n--- Cancellation reason falls back to a clear default when payload has no reason field ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    await post(env, orderUpdatedEvent({ id: 'evt_cancel_noreason', resourceId: order.printify_order_id, status: 'canceled' }));
    ok('fulfillment_error has a non-empty fallback message', typeof order.fulfillment_error === 'string' && order.fulfillment_error.length > 0, order.fulfillment_error);
  }

  console.log('\n--- Duplicate cancellation delivery => alert sent exactly once ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    const event = orderUpdatedEvent({ id: 'evt_cancel_dup', resourceId: order.printify_order_id, status: 'canceled' });
    await post(env, event);
    await post(env, event);
    ok('Exactly one cancellation alert', db._tables.email_events.filter((e) => e.email_type === 'printify_canceled_alert').length === 1);
  }

  console.log('\n--- First shipment created: shipment row + one shipped email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    await post(env, shipmentCreatedEvent({ id: 'evt_ship_1', resourceId: order.printify_order_id, trackingNumber: 'TRACK-AAA', skus: ['SKU-1'] }));
    ok('One shipment row', db._tables.shipments.length === 1);
    ok('Shipment carries tracking number as its key', db._tables.shipments[0].printify_shipment_id === 'TRACK-AAA');
    ok('order.fulfillment_status = shipped', order.fulfillment_status === 'shipped');
    const shippedEmails = db._tables.email_events.filter((e) => e.email_type.startsWith('shipped_'));
    ok('Exactly one shipped email, keyed to this tracking number', shippedEmails.length === 1 && shippedEmails[0].email_type === 'shipped_TRACK-AAA', shippedEmails);
  }

  console.log('\n--- Second, distinct shipment created on the same order: second row + second, separate email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    await post(env, shipmentCreatedEvent({ id: 'evt_ship_a', resourceId: order.printify_order_id, trackingNumber: 'TRACK-AAA', skus: ['SKU-1'] }));
    await post(env, shipmentCreatedEvent({ id: 'evt_ship_b', resourceId: order.printify_order_id, trackingNumber: 'TRACK-BBB', skus: ['SKU-2'] }));
    ok('Two distinct shipment rows', db._tables.shipments.length === 2, db._tables.shipments.length);
    const shippedEmails = db._tables.email_events.filter((e) => e.email_type.startsWith('shipped_'));
    ok('Two separate shipped emails (this is the split-shipment bug fix)', shippedEmails.length === 2, shippedEmails);
    ok('Keyed by distinct tracking numbers', shippedEmails.some((e) => e.email_type === 'shipped_TRACK-AAA') && shippedEmails.some((e) => e.email_type === 'shipped_TRACK-BBB'));
  }

  console.log('\n--- Duplicate delivery of the first shipment-created event => no second email ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    const event = shipmentCreatedEvent({ id: 'evt_ship_dup', resourceId: order.printify_order_id, trackingNumber: 'TRACK-AAA' });
    await post(env, event);
    await post(env, event);
    ok('Still exactly one shipment row (upserted, not duplicated)', db._tables.shipments.length === 1);
    ok('Still exactly one shipped email', db._tables.email_events.filter((e) => e.email_type.startsWith('shipped_')).length === 1);
  }

  console.log('\n--- Shipment event with no tracking number falls back to a deterministic, non-colliding key ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    const event = { id: 'evt_ship_notrack', type: 'order:shipment:created', created_at: new Date().toISOString(), resource: { id: order.printify_order_id, type: 'order', data: { shop_id: 815256, shipped_at: '2026-08-11T00:00:00Z', carrier: { code: 'USPS' }, skus: ['SKU-9'] } } };
    await post(env, event);
    const row = db._tables.shipments[0];
    ok('Shipment stored with a non-null, non-empty fallback key', typeof row.printify_shipment_id === 'string' && row.printify_shipment_id.length > 0, row.printify_shipment_id);
    ok('Fallback key is not the collision-prone flat constant this replaces', row.printify_shipment_id !== 'shipped', row.printify_shipment_id);
  }

  console.log('\n--- One of two shipments delivered: order not yet marked delivered ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    await post(env, shipmentCreatedEvent({ id: 'evt_ship_a2', resourceId: order.printify_order_id, trackingNumber: 'TRACK-AAA' }));
    await post(env, shipmentCreatedEvent({ id: 'evt_ship_b2', resourceId: order.printify_order_id, trackingNumber: 'TRACK-BBB' }));
    await post(env, shipmentDeliveredEvent({ id: 'evt_del_a', resourceId: order.printify_order_id, trackingNumber: 'TRACK-AAA' }));
    ok('order.fulfillment_status is still "shipped", not "delivered"', order.fulfillment_status === 'shipped', order.fulfillment_status);
    ok('No delivered email sent yet', !db._tables.email_events.some((e) => e.email_type === 'delivered'));
  }

  console.log('\n--- Both shipments delivered: order delivered + exactly one delivered email (order-level) ---');
  {
    const db = createFakeD1();
    const order = seedOrder(db);
    const env = makeEnv(db);
    await post(env, shipmentCreatedEvent({ id: 'evt_ship_a3', resourceId: order.printify_order_id, trackingNumber: 'TRACK-AAA' }));
    await post(env, shipmentCreatedEvent({ id: 'evt_ship_b3', resourceId: order.printify_order_id, trackingNumber: 'TRACK-BBB' }));
    await post(env, shipmentDeliveredEvent({ id: 'evt_del_a3', resourceId: order.printify_order_id, trackingNumber: 'TRACK-AAA' }));
    await post(env, shipmentDeliveredEvent({ id: 'evt_del_b3', resourceId: order.printify_order_id, trackingNumber: 'TRACK-BBB' }));
    ok('order.fulfillment_status = delivered', order.fulfillment_status === 'delivered', order.fulfillment_status);
    ok('Exactly one delivered email', db._tables.email_events.filter((e) => e.email_type === 'delivered').length === 1);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
