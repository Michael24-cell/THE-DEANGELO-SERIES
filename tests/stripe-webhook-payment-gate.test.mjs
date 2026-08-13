// Persistent regression tests for functions/api/stripe-webhook.js's payment
// gate (Printify order creation must never happen before payment_status is
// confirmed "paid") and financial-ledger capture (real Stripe fee/net,
// never estimated; margin stays null until every input is known).
//
// Run: node tests/stripe-webhook-payment-gate.test.mjs (or `npm test`)

import crypto from 'node:crypto';
import { onRequest } from '../functions/api/stripe-webhook.js';
import { updateOrderFinancials } from '../functions/_lib/orders-db.js';
import { createFakeD1 } from './_fake-d1.mjs';

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const WEBHOOK_SECRET = 'whsec_test_fake';
const STRIPE_SECRET = 'sk_test_SUPER_SECRET_VALUE_DO_NOT_LOG_12345';
const RESEND_SECRET = 'resend_SUPER_SECRET_VALUE_DO_NOT_LOG_67890';

async function signStripeBody(bodyStr, secret) {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.webcrypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${bodyStr}`));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

function makeSession({ id, paymentStatus = 'paid', paymentIntentId }) {
  const pi = paymentIntentId || 'pi_' + id;
  return {
    id, currency: 'usd', payment_intent: pi, payment_status: paymentStatus,
    amount_subtotal: 6400, amount_total: 6919,
    shipping_cost: { amount_total: 519 },
    total_details: { amount_tax: 0 },
    metadata: {
      shipping_option_id: 'standard',
      shipping_quote_country: 'US', shipping_quote_region: 'CA', shipping_quote_zip: '95014',
    },
    customer_details: { email: 'buyer@example.com', name: 'Test Buyer' },
    shipping_details: {
      name: 'Test Buyer',
      address: { line1: '1 St', city: 'City', state: 'CA', postal_code: '95014', country: 'US' },
    },
    line_items: {
      data: [{ quantity: 1, price: { unit_amount: 6400, product: { name: 'Arhus Tee', metadata: { slug: 'arhus-old-town-tee', size: 'M', color: 'Black' } } } }],
    },
  };
}

function makeEnv(db, extra) {
  return {
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_SECRET_KEY: STRIPE_SECRET, DB: db,
    RESEND_API_KEY: RESEND_SECRET, FROM_EMAIL: 'orders@thedeangeloseries.com', SUPPORT_EMAIL: 'support@thedeangeloseries.com',
    PRINTIFY_API_TOKEN: 'fake-printify-token', PRINTIFY_SHOP_ID: '26931439', PRINTIFY_SHIPPING_METHOD_ID: '1',
    ...extra,
  };
}

// balanceTransactionMode: 'known' | 'unavailable' | 'missing-charge'
function stubFetch({ session, balanceTransactionMode = 'known', calls }) {
  global.fetch = async (url, opts) => {
    const u = String(url);
    calls?.push(u);
    if (u.includes('checkout/sessions/')) return { ok: true, json: async () => session };
    if (u.includes('payment_intents/')) {
      if (balanceTransactionMode === 'missing-charge') {
        return { ok: true, json: async () => ({ id: session.payment_intent, latest_charge: null }) };
      }
      if (balanceTransactionMode === 'unavailable') {
        // latest_charge present but not expanded to an object yet (still a string id).
        return { ok: true, json: async () => ({ id: session.payment_intent, latest_charge: 'ch_' + session.id }) };
      }
      return {
        ok: true, json: async () => ({
          id: session.payment_intent,
          latest_charge: { id: 'ch_' + session.id, balance_transaction: { id: 'txn_' + session.id, fee: 219, net: 6700 } },
        }),
      };
    }
    if (u.includes('resend.com')) return { ok: true, json: async () => ({ id: 'r_' + Math.random().toString(36).slice(2) }) };
    if (u.endsWith('/orders.json') && opts.method === 'POST') return { ok: true, json: async () => ({ id: 'pf_' + Math.random().toString(36).slice(2) }) };
    throw new Error('Unexpected fetch: ' + u);
  };
}

async function post(env, session, eventId) {
  const bodyStr = JSON.stringify({ id: eventId, type: 'checkout.session.completed', data: { object: { id: session.id, created: Math.floor(Date.now() / 1000) } } });
  const sig = await signStripeBody(bodyStr, WEBHOOK_SECRET);
  const request = { method: 'POST', headers: { get: (k) => (k.toLowerCase() === 'stripe-signature' ? sig : null) }, text: async () => bodyStr };
  const res = await onRequest({ request, env });
  const body = await res.json();
  return { res, body };
}

async function run() {
  console.log('--- Paid Stripe Session: Printify order IS created, fee/net captured, paid_at stamped ---');
  {
    const db = createFakeD1();
    const env = makeEnv(db);
    const session = makeSession({ id: 'cs_paid_1', paymentStatus: 'paid' });
    stubFetch({ session, balanceTransactionMode: 'known' });
    const { res, body } = await post(env, session, 'evt_paid_1');
    ok('HTTP 200', res.status === 200);
    ok('not flagged awaitingPayment', body.awaitingPayment !== true);
    const order = db._tables.orders[0];
    ok('order persisted', !!order);
    ok('printify_order_id set (order was created)', !!order.printify_order_id);
    ok('fulfillment_status = submitted_to_printify', order.fulfillment_status === 'submitted_to_printify');
    ok('paid_at stamped', typeof order.paid_at === 'string' && order.paid_at.length > 0);
    ok('stripe_balance_transaction_id captured', order.stripe_balance_transaction_id === 'txn_cs_paid_1');
    ok('stripe_fee_amount captured (real value, not estimated)', order.stripe_fee_amount === 219);
    ok('stripe_net_amount captured', order.stripe_net_amount === 6700);
    ok('order_confirmed email sent', db._tables.email_events.some((e) => e.email_type === 'order_confirmed'));
    ok('estimated_margin_amount still null (Printify costs unknown)', order.estimated_margin_amount === null, order.estimated_margin_amount);
    ok('financials_updated_at stamped even though margin is null', typeof order.financials_updated_at === 'string');
  }

  console.log('\n--- Unpaid Stripe Session: Printify order is NOT created, no confirmation email ---');
  {
    const db = createFakeD1();
    const env = makeEnv(db);
    const session = makeSession({ id: 'cs_unpaid_1', paymentStatus: 'unpaid' });
    const calls = [];
    stubFetch({ session, calls });
    const { res, body } = await post(env, session, 'evt_unpaid_1');
    ok('HTTP 200 (recorded, not an error)', res.status === 200);
    ok('flagged awaitingPayment', body.awaitingPayment === true);
    const order = db._tables.orders[0];
    ok('order persisted (durable record even though unpaid)', !!order);
    ok('payment_status stored as-is ("unpaid")', order.payment_status === 'unpaid');
    ok('printify_order_id NOT set', order.printify_order_id === null);
    ok('fulfillment_status unchanged from default', order.fulfillment_status === 'unfulfilled');
    ok('paid_at NOT stamped', order.paid_at === null);
    ok('no order_confirmed email sent', !db._tables.email_events.some((e) => e.email_type === 'order_confirmed'));
    ok('no email of any kind sent', db._tables.email_events.length === 0);
    ok('status_events records "fulfillment_awaiting_payment"', db._tables.status_events.some((e) => {
      try { return JSON.parse(e.safe_summary_json).note === 'fulfillment_awaiting_payment'; } catch { return false; }
    }));
    ok('Printify orders.json was never called', !calls.some((u) => u.endsWith('/orders.json')));
    ok('Stripe payment_intents was never called (fee lookup skipped for unpaid order)', !calls.some((u) => u.includes('payment_intents/')));
  }

  console.log('\n--- Duplicate Stripe webhook delivery (same event id): processed exactly once ---');
  {
    const db = createFakeD1();
    const env = makeEnv(db);
    const session = makeSession({ id: 'cs_dup_1', paymentStatus: 'paid' });
    stubFetch({ session, balanceTransactionMode: 'known' });
    const first = await post(env, session, 'evt_dup_1');
    const second = await post(env, session, 'evt_dup_1');
    ok('First delivery processed', first.body.duplicate !== true);
    ok('Second delivery flagged duplicate', second.body.duplicate === true);
    ok('Exactly one order row', db._tables.orders.length === 1);
    ok('Exactly one order_confirmed email', db._tables.email_events.filter((e) => e.email_type === 'order_confirmed').length === 1);
    ok('Exactly one Printify order (printify_order_id set once, not overwritten to a new value)', db._tables.orders[0].printify_order_id != null);
  }

  console.log('\n--- Stripe fee/net temporarily unavailable: order still fulfilled, fields stay null ---');
  {
    const db = createFakeD1();
    const env = makeEnv(db);
    const session = makeSession({ id: 'cs_feepending_1', paymentStatus: 'paid' });
    stubFetch({ session, balanceTransactionMode: 'unavailable' });
    const { res } = await post(env, session, 'evt_feepending_1');
    ok('HTTP 200', res.status === 200);
    const order = db._tables.orders[0];
    ok('Printify order still created despite missing fee data', !!order.printify_order_id);
    ok('fulfillment_status = submitted_to_printify (not blocked by missing fee)', order.fulfillment_status === 'submitted_to_printify');
    ok('stripe_balance_transaction_id left null', order.stripe_balance_transaction_id === null);
    ok('stripe_fee_amount left null (never estimated/guessed)', order.stripe_fee_amount === null);
    ok('stripe_net_amount left null', order.stripe_net_amount === null);
    ok('estimated_margin_amount left null', order.estimated_margin_amount === null);
  }

  console.log('\n--- Margin becomes non-null only once every required value is known (Printify costs arrive later) ---');
  {
    const db = createFakeD1();
    const env = makeEnv(db);
    const session = makeSession({ id: 'cs_margin_1', paymentStatus: 'paid' });
    stubFetch({ session, balanceTransactionMode: 'known' });
    await post(env, session, 'evt_margin_1');
    const order = db._tables.orders[0];
    ok('Margin null right after Stripe-only data is known', order.estimated_margin_amount === null);

    // Simulate Printify's cost-refresh path (printify-webhook.js) supplying
    // the remaining three values later, via the exact same shared helper.
    const margin = await updateOrderFinancials(env, order.id, {
      printify_product_cost: 2100, printify_shipping_cost: 450, printify_tax_amount: 0,
    });
    const updated = db._tables.orders.find((o) => o.id === order.id);
    // subtotal 6400 + shipping 519 - fee 219 - product 2100 - shipping 450 - tax 0 = 4150
    ok('Margin computed correctly once all six inputs are known', margin === 4150, margin);
    ok('Margin persisted to the order row', updated.estimated_margin_amount === 4150, updated.estimated_margin_amount);
  }

  console.log('\n--- No secret value is ever logged across a full run ---');
  {
    const db = createFakeD1();
    const env = makeEnv(db);
    const session = makeSession({ id: 'cs_secretcheck_1', paymentStatus: 'paid' });
    stubFetch({ session, balanceTransactionMode: 'known' });

    const captured = [];
    const originalLog = console.log, originalWarn = console.warn, originalError = console.error;
    console.log = (...args) => { captured.push(args.join(' ')); };
    console.warn = (...args) => { captured.push(args.join(' ')); };
    console.error = (...args) => { captured.push(args.join(' ')); };
    try {
      await post(env, session, 'evt_secretcheck_1');
    } finally {
      console.log = originalLog; console.warn = originalWarn; console.error = originalError;
    }
    const joined = captured.join('\n');
    ok('STRIPE_SECRET_KEY never appears in logs', !joined.includes(STRIPE_SECRET));
    ok('RESEND_API_KEY never appears in logs', !joined.includes(RESEND_SECRET));
  }

  console.log('\n--- Structural: sendPrintifyOrderToProduction is never called from live fulfillment code ---');
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const filesToCheck = [
      'functions/api/stripe-webhook.js',
      'functions/api/printify-webhook.js',
      'functions/api/create-checkout-session.js',
    ];
    for (const rel of filesToCheck) {
      const contents = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      // Matches an actual invocation (`sendPrintifyOrderToProduction(...)` not
      // preceded by "// "), not a doc-comment merely mentioning the name.
      const callSites = contents
        .split('\n')
        .filter((line) => line.includes('sendPrintifyOrderToProduction(') && !line.trim().startsWith('//'));
      ok(`${rel} does not call sendPrintifyOrderToProduction(`, callSites.length === 0, callSites);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
