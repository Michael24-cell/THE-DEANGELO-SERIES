// Cloudflare Pages Function — one-click review moderation
// Route: GET /api/moderate-review?review=...&action=approve|reject&sig=...
//
// The Approve/Reject links in reviewModerationAlertTemplate (sent to
// SUPPORT_EMAIL by functions/api/submit-review.js) point here. No login —
// the HMAC signature over (reviewId, action) is what authorizes the
// change (functions/_lib/reviews.js's signModerationAction), so this can't
// be driven by guessing a review id. A review only ever leaves 'pending'
// once (setReviewStatus's WHERE status = 'pending' guard), so clicking
// Approve, then Reject (or either twice — a forwarded/reused email, a link
// preview bot) can't flip a decision after the fact.
//
// Required env var: REVIEW_MODERATION_SECRET. FAIL-CLOSED: if it's not
// set, every request is rejected with 503 — same policy as
// printify-webhook.js's PRINTIFY_WEBHOOK_SECRET.

import { findReviewById, setReviewStatus } from '../_lib/orders-db.js';
import { verifyModerationAction } from '../_lib/reviews.js';

const VALID_ACTIONS = new Set(['approve', 'reject']);

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  }
  if (!env.DB) {
    console.error('[moderate-review] Missing D1 binding: DB');
    return page('Something went wrong on our end.', 500);
  }
  if (!env.REVIEW_MODERATION_SECRET) {
    console.error('[moderate-review] REVIEW_MODERATION_SECRET not configured — refusing all requests (fail closed)');
    return page('Moderation links are not configured yet.', 503);
  }

  const url = new URL(request.url);
  const reviewId = url.searchParams.get('review') || '';
  const action = url.searchParams.get('action') || '';
  const sig = url.searchParams.get('sig') || '';

  if (!reviewId || !VALID_ACTIONS.has(action)) {
    return page('This moderation link is malformed.', 400);
  }

  const valid = await verifyModerationAction(reviewId, action, sig, env.REVIEW_MODERATION_SECRET);
  if (!valid) {
    return page('This moderation link is invalid.', 400);
  }

  const review = await findReviewById(env, reviewId);
  if (!review) {
    return page('That review no longer exists.', 404);
  }

  const status = action === 'approve' ? 'approved' : 'rejected';
  const changed = await setReviewStatus(env, reviewId, status);

  if (!changed) {
    // Either someone already clicked a link for this review, or it was
    // never 'pending' to begin with — either way, tell the truth about its
    // CURRENT state rather than claiming this click did something.
    const current = await findReviewById(env, reviewId);
    return page(`This review was already ${escapeHtml(current?.status || 'handled')} — no change made.`, 200);
  }

  return page(`Review ${status}. "${escapeHtml(review.display_name)}"'s review of this piece is ${status === 'approved' ? 'now live on the site' : 'hidden and will not be shown'}.`, 200);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(message, status) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review moderation — The DeAngelo Series</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0A0A0A;color:#F5F5F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px}
  .card{max-width:440px;text-align:center}
  .brand{font-size:11px;letter-spacing:.3em;text-transform:uppercase;opacity:.55;margin-bottom:24px}
  p{font-size:1rem;line-height:1.6;font-weight:300}
</style>
</head>
<body>
  <div class="card">
    <p class="brand">The DeAngelo Series</p>
    <p>${message}</p>
  </div>
</body>
</html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
