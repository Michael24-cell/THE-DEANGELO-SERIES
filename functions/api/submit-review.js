// Cloudflare Pages Function — submit a product review
// Route: POST /api/submit-review
//
// Called from leave-review.html, which reads `token` out of the URL
// (the one-click link from reviewRequestTemplate) and posts it here along
// with the form fields. The token is the ONLY thing that authorizes a
// review — there is no account/login system on this site — so this
// endpoint's entire trust model rests on claimReviewToken()'s atomic,
// one-time claim (functions/_lib/orders-db.js). A review is always
// attributed to the real order_item the token was minted for; nothing
// about which product or order this is for is ever taken from the request
// body.
//
// Required env vars: DB (D1 binding). RESEND_API_KEY/FROM_EMAIL/
// SUPPORT_EMAIL/REVIEW_MODERATION_SECRET for the moderation alert — best
// effort: if any of those are missing, the review still saves (as
// 'pending'), it just sits un-alerted until someone notices it in D1.
// A missing REVIEW_MODERATION_SECRET specifically means no valid
// Approve/Reject links could be signed at all, so that alert is skipped
// entirely rather than sent with broken links.

import { claimReviewToken, findOrderItemById, findOrderById, insertReview, sendOrderEmailOnce } from '../_lib/orders-db.js';
import { hashToken, signModerationAction } from '../_lib/reviews.js';
import { reviewModerationAlertTemplate } from '../_lib/email-templates.js';
import { CATALOG } from '../_lib/catalog.js';

const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 4000;
const MAX_NAME_LENGTH = 100;

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }
  if (!env.DB) {
    console.error('[submit-review] Missing D1 binding: DB');
    return json({ error: 'Server misconfiguration — contact site owner' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const rating = Number(body.rating);
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE_LENGTH) : '';
  const reviewBody = typeof body.body === 'string' ? body.body.trim().slice(0, MAX_BODY_LENGTH) : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, MAX_NAME_LENGTH) : '';

  if (!token) return json({ error: 'Missing review token.' }, 400);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: 'Rating must be a whole number from 1 to 5.' }, 400);
  if (!reviewBody) return json({ error: 'Please write a short review.' }, 400);
  if (!displayName) return json({ error: 'Please enter a name to display with your review.' }, 400);

  const tokenHash = await hashToken(token);
  const claim = await claimReviewToken(env, tokenHash);
  if (!claim) {
    return json({ error: 'This review link is invalid, expired, or has already been used.' }, 400);
  }

  const orderItem = claim.order_item_id ? await findOrderItemById(env, claim.order_item_id) : null;
  const order = await findOrderById(env, claim.order_id);
  const productSlug = orderItem?.product_slug;
  if (!productSlug || !order) {
    console.error(`[submit-review] Claimed token but could not resolve order/item (order_id=${claim.order_id}, order_item_id=${claim.order_item_id})`);
    return json({ error: 'Something went wrong on our end. Please email support@thedeangeloseries.com.' }, 500);
  }

  const reviewId = crypto.randomUUID();
  await insertReview(env, {
    id: reviewId,
    orderId: claim.order_id,
    orderItemId: claim.order_item_id,
    productSlug,
    rating,
    title: title || null,
    body: reviewBody,
    displayName,
  });

  await sendModerationAlert(env, {
    reviewId,
    orderId: claim.order_id,
    orderNumber: order.public_order_number,
    productName: orderItem.product_name || CATALOG[productSlug]?.name || productSlug,
    rating,
    title,
    body: reviewBody,
    displayName,
  });

  return json({ ok: true });
}

async function sendModerationAlert(env, { reviewId, orderId, orderNumber, productName, rating, title, body, displayName }) {
  if (!env.SUPPORT_EMAIL) {
    console.log(`[submit-review] SUPPORT_EMAIL not set — skipping moderation alert for review ${reviewId}.`);
    return;
  }
  if (!env.REVIEW_MODERATION_SECRET) {
    console.error(`[submit-review] REVIEW_MODERATION_SECRET not set — cannot sign moderation links, skipping alert for review ${reviewId}.`);
    return;
  }

  const base = (env.SITE_URL || 'https://thedeangeloseries.com').replace(/\/$/, '');
  const approveSig = await signModerationAction(reviewId, 'approve', env.REVIEW_MODERATION_SECRET);
  const rejectSig = await signModerationAction(reviewId, 'reject', env.REVIEW_MODERATION_SECRET);

  const result = await sendOrderEmailOnce(env, {
    // email_events.order_id has a FOREIGN KEY to orders(id), so this must be
    // the real order — the per-review uniqueness instead comes from folding
    // reviewId into emailType, since one order can carry multiple reviews
    // (one per item) and each needs its own claim under the table's
    // UNIQUE(order_id, email_type) constraint.
    orderId,
    emailType: `review_moderation_alert:${reviewId}`,
    to: env.SUPPORT_EMAIL,
    buildTemplate: () => reviewModerationAlertTemplate({
      orderNumber,
      productName,
      rating,
      title: title || undefined,
      body,
      displayName,
      approveUrl: `${base}/api/moderate-review?review=${encodeURIComponent(reviewId)}&action=approve&sig=${approveSig}`,
      rejectUrl: `${base}/api/moderate-review?review=${encodeURIComponent(reviewId)}&action=reject&sig=${rejectSig}`,
    }),
  });
  if (!result.sent && result.reason !== 'duplicate') {
    console.error(`[submit-review] Moderation alert not sent for review ${reviewId}: ${result.reason}`);
  }
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
