// Persistent regression tests for functions/api/product-reviews.js.
// Run: node tests/product-reviews.test.mjs (or `npm test`)

import { onRequest } from '../functions/api/product-reviews.js';
import { createFakeD1 } from './_fake-d1.mjs';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function seedReview(db, overrides = {}) {
  db._tables.reviews.push({
    id: 'review_' + Math.random().toString(36).slice(2),
    order_id: 'order_x', order_item_id: 'item_x', product_slug: 'tee',
    rating: 5, title: null, body: 'Great piece.', display_name: 'Buyer',
    verified_purchase: 1, status: 'approved', created_at: new Date().toISOString(), approved_at: new Date().toISOString(),
    ...overrides,
  });
}

function get(env, slug) {
  const url = `https://thedeangeloseries.com/api/product-reviews${slug !== undefined ? `?slug=${encodeURIComponent(slug)}` : ''}`;
  return onRequest({ request: { method: 'GET', url }, env });
}

async function run() {
  console.log('--- No reviews for a valid product: empty, not an error ---');
  {
    const db = createFakeD1();
    const env = { DB: db };
    const res = await get(env, 'tee');
    const body = await res.json();
    ok('HTTP 200', res.status === 200);
    ok('count = 0', body.count === 0);
    ok('averageRating = null', body.averageRating === null);
    ok('reviews = []', Array.isArray(body.reviews) && body.reviews.length === 0);
  }

  console.log('\n--- Only approved reviews for the requested slug are returned ---');
  {
    const db = createFakeD1();
    seedReview(db, { product_slug: 'tee', rating: 5, status: 'approved', display_name: 'Approved Tee Review' });
    seedReview(db, { product_slug: 'tee', rating: 3, status: 'pending', display_name: 'Pending Tee Review' });
    seedReview(db, { product_slug: 'tee', rating: 1, status: 'rejected', display_name: 'Rejected Tee Review' });
    seedReview(db, { product_slug: 'crew', rating: 4, status: 'approved', display_name: 'Approved Crew Review' });
    const env = { DB: db };

    const res = await get(env, 'tee');
    const body = await res.json();
    ok('count = 1 (only the approved tee review)', body.count === 1, body);
    ok('averageRating = 5', body.averageRating === 5);
    ok('Returned review is the approved one', body.reviews[0].displayName === 'Approved Tee Review');
    ok('No order_id/order_item_id/verified_purchase/status leaked', !('order_id' in body.reviews[0]) && !('status' in body.reviews[0]));
  }

  console.log('\n--- Average rating computed correctly across multiple approved reviews ---');
  {
    const db = createFakeD1();
    seedReview(db, { product_slug: 'crew', rating: 5, status: 'approved' });
    seedReview(db, { product_slug: 'crew', rating: 3, status: 'approved' });
    seedReview(db, { product_slug: 'crew', rating: 4, status: 'approved' });
    const env = { DB: db };

    const res = await get(env, 'crew');
    const body = await res.json();
    ok('count = 3', body.count === 3);
    ok('averageRating = 4 ((5+3+4)/3)', body.averageRating === 4, body.averageRating);
  }

  console.log('\n--- Unknown product slug rejected ---');
  {
    const db = createFakeD1();
    const env = { DB: db };
    const res = await get(env, 'not-a-real-product');
    ok('HTTP 400', res.status === 400);
  }

  console.log('\n--- Missing slug rejected ---');
  {
    const db = createFakeD1();
    const env = { DB: db };
    const res = await get(env, undefined);
    ok('HTTP 400', res.status === 400);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
