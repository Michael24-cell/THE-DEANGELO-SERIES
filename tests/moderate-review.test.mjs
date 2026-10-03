// Persistent regression tests for functions/api/moderate-review.js.
// Run: node tests/moderate-review.test.mjs (or `npm test`)

import crypto from 'node:crypto';
import { onRequest } from '../functions/api/moderate-review.js';
import { signModerationAction } from '../functions/_lib/reviews.js';
import { createFakeD1 } from './_fake-d1.mjs';

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const SECRET = 'test_moderation_secret';

function makeEnv(db, extra) {
  return { DB: db, REVIEW_MODERATION_SECRET: SECRET, ...extra };
}

function seedReview(db, overrides = {}) {
  const review = {
    id: 'review_' + Math.random().toString(36).slice(2),
    order_id: 'order_x', order_item_id: 'item_x', product_slug: 'tee',
    rating: 5, title: 'Great', body: 'Loved it.', display_name: 'A Buyer',
    verified_purchase: 1, status: 'pending', created_at: new Date().toISOString(), approved_at: null,
    ...overrides,
  };
  db._tables.reviews.push(review);
  return review;
}

async function get(env, { review, action, sig }) {
  const url = `https://thedeangeloseries.com/api/moderate-review?review=${encodeURIComponent(review)}&action=${encodeURIComponent(action)}&sig=${encodeURIComponent(sig)}`;
  const request = { method: 'GET', url };
  return onRequest({ request, env });
}

async function run() {
  console.log('--- Valid signature approves a pending review ---');
  {
    const db = createFakeD1();
    const review = seedReview(db);
    const env = makeEnv(db);
    const sig = await signModerationAction(review.id, 'approve', SECRET);

    const res = await get(env, { review: review.id, action: 'approve', sig });
    ok('HTTP 200', res.status === 200);
    ok('Review status is now approved', review.status === 'approved', review.status);
    ok('approved_at stamped', typeof review.approved_at === 'string');
  }

  console.log('\n--- Valid signature rejects a pending review ---');
  {
    const db = createFakeD1();
    const review = seedReview(db);
    const env = makeEnv(db);
    const sig = await signModerationAction(review.id, 'reject', SECRET);

    const res = await get(env, { review: review.id, action: 'reject', sig });
    ok('HTTP 200', res.status === 200);
    ok('Review status is now rejected', review.status === 'rejected');
    ok('approved_at stays null for a rejection', review.approved_at === null);
  }

  console.log('\n--- Invalid signature is rejected, review untouched ---');
  {
    const db = createFakeD1();
    const review = seedReview(db);
    const env = makeEnv(db);

    const res = await get(env, { review: review.id, action: 'approve', sig: 'deadbeef'.repeat(8) });
    ok('HTTP 400', res.status === 400);
    ok('Review still pending', review.status === 'pending');
  }

  console.log('\n--- Signature for a DIFFERENT action is rejected (approve sig cannot reject) ---');
  {
    const db = createFakeD1();
    const review = seedReview(db);
    const env = makeEnv(db);
    const approveSig = await signModerationAction(review.id, 'approve', SECRET);

    const res = await get(env, { review: review.id, action: 'reject', sig: approveSig });
    ok('HTTP 400', res.status === 400);
    ok('Review still pending', review.status === 'pending');
  }

  console.log('\n--- Already-moderated review: second click reports current state, does not flip it back ---');
  {
    const db = createFakeD1();
    const review = seedReview(db);
    const env = makeEnv(db);
    const approveSig = await signModerationAction(review.id, 'approve', SECRET);
    const rejectSig = await signModerationAction(review.id, 'reject', SECRET);

    const first = await get(env, { review: review.id, action: 'approve', sig: approveSig });
    ok('First click (approve) succeeds', first.status === 200);
    ok('Review approved', review.status === 'approved');

    const second = await get(env, { review: review.id, action: 'reject', sig: rejectSig });
    const text = await second.text();
    ok('Second click (reject, via a forwarded/reused email) does not error', second.status === 200);
    ok('Review stays approved — a stale link cannot flip an already-moderated review', review.status === 'approved');
    ok('Response tells the truth about current state', text.includes('already approved'), text);
  }

  console.log('\n--- Unknown review id ---');
  {
    const db = createFakeD1();
    const env = makeEnv(db);
    const sig = await signModerationAction('does-not-exist', 'approve', SECRET);
    const res = await get(env, { review: 'does-not-exist', action: 'approve', sig });
    ok('HTTP 404', res.status === 404);
  }

  console.log('\n--- Missing REVIEW_MODERATION_SECRET fails closed ---');
  {
    const db = createFakeD1();
    const review = seedReview(db);
    const env = makeEnv(db, { REVIEW_MODERATION_SECRET: undefined });
    const res = await get(env, { review: review.id, action: 'approve', sig: 'whatever' });
    ok('HTTP 503', res.status === 503);
    ok('Review untouched', review.status === 'pending');
  }

  console.log('\n--- Invalid action value rejected before touching the database ---');
  {
    const db = createFakeD1();
    const review = seedReview(db);
    const env = makeEnv(db);
    const res = await get(env, { review: review.id, action: 'delete', sig: 'whatever' });
    ok('HTTP 400', res.status === 400);
    ok('Review untouched', review.status === 'pending');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
