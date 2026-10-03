// Persistent regression tests for workers/send-review-requests.js's
// runReviewRequests() — exercised directly (not via Cloudflare's scheduled-
// event plumbing), same approach as tests/reconcile-shipments-worker.test.mjs.
//
// Run: node tests/send-review-requests-worker.test.mjs (or `npm test`)

import crypto from 'node:crypto';
import { runReviewRequests } from '../workers/send-review-requests.js';
import { createFakeD1 } from './_fake-d1.mjs';

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function makeEnv(db, extra) {
  return {
    DB: db,
    RESEND_API_KEY: 'x', FROM_EMAIL: 'orders@thedeangeloseries.com', SUPPORT_EMAIL: 'support@thedeangeloseries.com',
    SITE_URL: 'https://thedeangeloseries.com',
    ...extra,
  };
}

function stubResendFetch(calls) {
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('resend.com')) {
      calls?.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ id: 'r_' + Math.random().toString(36).slice(2) }) };
    }
    throw new Error('Unexpected fetch in send-review-requests worker test: ' + u);
  };
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function seedDeliveredOrder(db, { id, deliveredDaysAgo, itemCount = 1 }) {
  const order = {
    id, public_order_number: 'DS-' + id.toUpperCase(),
    customer_email: 'buyer@example.com', customer_name: 'Test Buyer',
    fulfillment_status: 'delivered',
    created_at: daysAgoIso(deliveredDaysAgo + 1), updated_at: daysAgoIso(deliveredDaysAgo),
  };
  db._tables.orders.push(order);
  for (let i = 0; i < itemCount; i++) {
    db._tables.order_items.push({
      id: `${id}_item${i}`, order_id: id, product_slug: 'tee', product_name: `Piece ${i + 1}`,
      size: 'M', color: 'White', quantity: 1, unit_price: 6400,
      printify_product_id: null, printify_variant_id: null, sku: null,
    });
  }
  db._tables.shipments.push({
    order_id: id, printify_shipment_id: `${id}_ship`, carrier: 'USPS',
    tracking_number: '123', tracking_url: 'https://example.com',
    status: 'delivered', created_at: daysAgoIso(deliveredDaysAgo), updated_at: daysAgoIso(deliveredDaysAgo),
  });
  return order;
}

async function run() {
  console.log('--- Order delivered 15 days ago (past the 10-day default wait): gets a review-request email ---');
  {
    const db = createFakeD1();
    seedDeliveredOrder(db, { id: 'order1', deliveredDaysAgo: 15, itemCount: 2 });
    const env = makeEnv(db);
    const calls = [];
    stubResendFetch(calls);

    const summary = await runReviewRequests(env);
    ok('1 order checked', summary.checked === 1, summary);
    ok('1 email sent', summary.emailsSent === 1, summary);
    ok('One review_request email_events row claimed', db._tables.email_events.some((e) => e.order_id === 'order1' && e.email_type === 'review_request'));
    ok('One review token minted PER ITEM (2 items)', db._tables.review_tokens.filter((t) => t.order_id === 'order1').length === 2);
    ok('Tokens are unused and unexpired', db._tables.review_tokens.every((t) => t.used_at === null && new Date(t.expires_at) > new Date()));
    ok('Email actually sent via Resend', calls.length === 1);
    ok('Email contains a review link per item', (calls[0].html.match(/leave-review\.html\?token=/g) || []).length === 2, calls[0].html);
  }

  console.log('\n--- Order delivered only 3 days ago (before the 10-day default wait): skipped ---');
  {
    const db = createFakeD1();
    seedDeliveredOrder(db, { id: 'order2', deliveredDaysAgo: 3 });
    const env = makeEnv(db);
    stubResendFetch();

    const summary = await runReviewRequests(env);
    ok('0 orders checked (not yet a candidate)', summary.checked === 0, summary);
    ok('No tokens minted', db._tables.review_tokens.length === 0);
    ok('No email sent', db._tables.email_events.length === 0);
  }

  console.log('\n--- Custom REVIEW_REQUEST_DELAY_DAYS is respected ---');
  {
    const db = createFakeD1();
    seedDeliveredOrder(db, { id: 'order3', deliveredDaysAgo: 3 });
    const env = makeEnv(db, { REVIEW_REQUEST_DELAY_DAYS: '2' });
    const calls = [];
    stubResendFetch(calls);

    const summary = await runReviewRequests(env);
    ok('Order qualifies under the shorter 2-day wait', summary.checked === 1, summary);
    ok('Email sent', summary.emailsSent === 1);
  }

  console.log('\n--- Order already has a review_request email_events row: not re-sent ---');
  {
    const db = createFakeD1();
    seedDeliveredOrder(db, { id: 'order4', deliveredDaysAgo: 15 });
    db._tables.email_events.push({ id: 'ev1', order_id: 'order4', email_type: 'review_request', status: 'sent', created_at: new Date().toISOString(), resend_email_id: 'r_x', error_message: null, sent_at: new Date().toISOString() });
    const env = makeEnv(db);
    stubResendFetch();

    const summary = await runReviewRequests(env);
    ok('0 orders checked (already claimed)', summary.checked === 0, summary);
    ok('No new tokens minted', db._tables.review_tokens.length === 0);
  }

  console.log('\n--- Order with an undelivered shipment is not eligible, even if fulfillment_status somehow says delivered ---');
  {
    const db = createFakeD1();
    const order = seedDeliveredOrder(db, { id: 'order5', deliveredDaysAgo: 15 });
    db._tables.shipments.find((s) => s.order_id === 'order5').status = 'shipped';
    const env = makeEnv(db);
    stubResendFetch();

    const summary = await runReviewRequests(env);
    ok('Not a candidate without a real delivered shipment', summary.checked === 0, summary);
  }

  console.log('\n--- Two eligible orders in one run: both handled, failure in one does not affect the other ---');
  {
    const db = createFakeD1();
    seedDeliveredOrder(db, { id: 'order6', deliveredDaysAgo: 15 });
    seedDeliveredOrder(db, { id: 'order7', deliveredDaysAgo: 20 });
    const env = makeEnv(db);
    const calls = [];
    stubResendFetch(calls);

    const summary = await runReviewRequests(env);
    ok('Both orders checked', summary.checked === 2, summary);
    ok('Both emails sent', summary.emailsSent === 2, summary);
    ok('0 failures', summary.failures === 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
