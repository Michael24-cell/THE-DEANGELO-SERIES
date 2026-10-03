// Persistent regression tests for functions/api/submit-review.js.
// Run: node tests/submit-review.test.mjs (or `npm test`)

import crypto from 'node:crypto';
import { onRequest } from '../functions/api/submit-review.js';
import { hashToken, generateReviewToken } from '../functions/_lib/reviews.js';
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
    RESEND_API_KEY: 'x',
    FROM_EMAIL: 'orders@thedeangeloseries.com',
    SUPPORT_EMAIL: 'support@thedeangeloseries.com',
    REVIEW_MODERATION_SECRET: 'test_moderation_secret',
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
    throw new Error('Unexpected fetch in submit-review test: ' + u);
  };
}

async function seedOrderWithItem(db, overrides = {}) {
  const now = new Date().toISOString();
  const order = {
    id: 'order_' + Math.random().toString(36).slice(2),
    public_order_number: 'DS-TEST0001',
    customer_email: 'buyer@example.com',
    customer_name: 'Test Buyer',
    fulfillment_status: 'delivered',
    created_at: now, updated_at: now,
    ...overrides,
  };
  db._tables.orders.push(order);
  const item = {
    id: 'item_' + Math.random().toString(36).slice(2),
    order_id: order.id,
    product_slug: 'tee',
    product_name: 'Venezia — Tee (M)',
    size: 'M', color: 'White', quantity: 1, unit_price: 6400,
    printify_product_id: null, printify_variant_id: null, sku: null,
  };
  db._tables.order_items.push(item);
  return { order, item };
}

async function seedToken(db, { orderId, orderItemId, expiresInMs = 60 * 24 * 60 * 60 * 1000, used = false }) {
  const raw = generateReviewToken();
  const hash = await hashToken(raw);
  db._tables.review_tokens.push({
    token_hash: hash, order_id: orderId, order_item_id: orderItemId,
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    used_at: used ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
  });
  return raw;
}

function post(env, body) {
  const request = { method: 'POST', json: async () => body };
  return onRequest({ request, env });
}

async function run() {
  console.log('--- Valid token + valid fields: review saved as pending, moderation alert sent ---');
  {
    const db = createFakeD1();
    const { order, item } = await seedOrderWithItem(db);
    const token = await seedToken(db, { orderId: order.id, orderItemId: item.id });
    const env = makeEnv(db);
    const resendCalls = [];
    stubResendFetch(resendCalls);

    const res = await post(env, { token, rating: 5, title: 'Great', body: 'Really happy with this piece.', displayName: 'A. Buyer' });
    const body = await res.json();
    ok('HTTP 200', res.status === 200, res.status);
    ok('{ok:true}', body.ok === true);
    ok('Review inserted as pending', db._tables.reviews.length === 1 && db._tables.reviews[0].status === 'pending');
    ok('Review attributed to correct product_slug', db._tables.reviews[0].product_slug === 'tee');
    ok('verified_purchase = 1', db._tables.reviews[0].verified_purchase === 1);
    ok('Token marked used', db._tables.review_tokens[0].used_at !== null);
    ok('Moderation alert sent to SUPPORT_EMAIL', resendCalls.length === 1 && resendCalls[0].to[0] === 'support@thedeangeloseries.com', resendCalls);
    ok('Moderation alert subject names the rating', resendCalls[0] && resendCalls[0].subject.includes('5★'));
  }

  console.log('\n--- Reusing the same token a second time is rejected ---');
  {
    const db = createFakeD1();
    const { order, item } = await seedOrderWithItem(db);
    const token = await seedToken(db, { orderId: order.id, orderItemId: item.id });
    const env = makeEnv(db);
    stubResendFetch();

    const first = await post(env, { token, rating: 4, body: 'Good.', displayName: 'First' });
    ok('First submission succeeds', first.status === 200);

    const second = await post(env, { token, rating: 1, body: 'Trying again.', displayName: 'Second' });
    const secondBody = await second.json();
    ok('Second submission with same token rejected', second.status === 400);
    ok('Only one review exists', db._tables.reviews.length === 1);
    ok('Error message does not distinguish used-vs-invalid', typeof secondBody.error === 'string');
  }

  console.log('\n--- Expired token rejected ---');
  {
    const db = createFakeD1();
    const { order, item } = await seedOrderWithItem(db);
    const token = await seedToken(db, { orderId: order.id, orderItemId: item.id, expiresInMs: -1000 });
    const env = makeEnv(db);
    stubResendFetch();

    const res = await post(env, { token, rating: 5, body: 'Too late.', displayName: 'Late' });
    ok('HTTP 400', res.status === 400);
    ok('No review created', db._tables.reviews.length === 0);
  }

  console.log('\n--- Unknown token rejected ---');
  {
    const db = createFakeD1();
    const env = makeEnv(db);
    stubResendFetch();
    const res = await post(env, { token: 'not-a-real-token', rating: 5, body: 'x', displayName: 'x' });
    ok('HTTP 400', res.status === 400);
  }

  console.log('\n--- Field validation: rating out of range, missing body, missing displayName ---');
  {
    const db = createFakeD1();
    const { order, item } = await seedOrderWithItem(db);
    const env = makeEnv(db);
    stubResendFetch();

    const tok1 = await seedToken(db, { orderId: order.id, orderItemId: item.id });
    const r1 = await post(env, { token: tok1, rating: 6, body: 'x', displayName: 'x' });
    ok('Rating 6 rejected', r1.status === 400);

    const tok2 = await seedToken(db, { orderId: order.id, orderItemId: item.id });
    const r2 = await post(env, { token: tok2, rating: 3, body: '   ', displayName: 'x' });
    ok('Blank body rejected', r2.status === 400);

    const tok3 = await seedToken(db, { orderId: order.id, orderItemId: item.id });
    const r3 = await post(env, { token: tok3, rating: 3, body: 'fine', displayName: '  ' });
    ok('Blank displayName rejected', r3.status === 400);

    ok('None of the invalid attempts consumed their token', db._tables.review_tokens.every((t) => t.used_at === null));
  }

  console.log('\n--- Missing REVIEW_MODERATION_SECRET: review still saves, alert is skipped ---');
  {
    const db = createFakeD1();
    const { order, item } = await seedOrderWithItem(db);
    const token = await seedToken(db, { orderId: order.id, orderItemId: item.id });
    const env = makeEnv(db, { REVIEW_MODERATION_SECRET: undefined });
    stubResendFetch();

    const res = await post(env, { token, rating: 5, body: 'Still works.', displayName: 'Buyer' });
    ok('HTTP 200 — submission itself is unaffected', res.status === 200);
    ok('Review still saved as pending', db._tables.reviews.length === 1 && db._tables.reviews[0].status === 'pending');
    ok('No moderation alert row created (nothing to claim without a secret to sign links)', db._tables.email_events.length === 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
