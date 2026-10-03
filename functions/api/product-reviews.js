// Cloudflare Pages Function — approved reviews for one product
// Route: GET /api/product-reviews?slug=...
//
// Called from product.html on load to populate the Reviews section. Only
// ever returns 'approved' reviews (listApprovedReviews in orders-db.js) —
// pending/rejected reviews are never reachable from this endpoint. Never
// exposes order_id, order_item_id, or any customer-identifying field
// beyond the display name the reviewer themselves chose to show.

import { listApprovedReviews } from '../_lib/orders-db.js';
import { CATALOG } from '../_lib/catalog.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
  }
  if (!env.DB) {
    console.error('[product-reviews] Missing D1 binding: DB');
    return json({ error: 'Server misconfiguration — contact site owner' }, 500);
  }

  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') || '';
  if (!slug || !CATALOG[slug]) {
    return json({ error: 'Unknown product.' }, 400);
  }

  const rows = await listApprovedReviews(env, slug);
  const count = rows.length;
  const averageRating = count > 0 ? rows.reduce((sum, r) => sum + r.rating, 0) / count : null;

  return json({
    count,
    averageRating,
    reviews: rows.map((r) => ({
      rating: r.rating,
      title: r.title,
      body: r.body,
      displayName: r.display_name,
      createdAt: r.created_at,
    })),
  });
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
