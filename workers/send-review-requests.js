// Standalone Cloudflare Worker — scheduled (Cron Trigger) review-request
// email sender. Finds orders that are fully delivered and past the
// configured wait, mints one one-time review token per item purchased
// (functions/_lib/reviews.js + orders-db.js's insertReviewToken), and
// emails the customer a review link per item (reviewRequestTemplate).
//
// Deploy target: a SEPARATE Worker from the Pages project, same reasoning
// as workers/reconcile-shipments.js (see wrangler.review-requests.toml at
// the repo root) — scheduled() only, no fetch() handler, never HTTP
// reachable, and an accidental `wrangler deploy` here can never touch the
// Pages project.
//
// Never touches Printify or Stripe — this worker only ever reads orders/
// order_items/shipments/email_events and writes review_tokens + email_events
// (via sendOrderEmailOnce). The actual review submission/moderation flow
// lives entirely in functions/api/submit-review.js and
// functions/api/moderate-review.js, both Pages Functions, not this worker.

import { reviewRequestTemplate } from '../functions/_lib/email-templates.js';
import { generateReviewToken, hashToken } from '../functions/_lib/reviews.js';
import {
  listOrdersNeedingReviewRequest, getOrderItems, insertReviewToken, sendOrderEmailOnce,
} from '../functions/_lib/orders-db.js';

const DEFAULT_DELAY_DAYS = 10;
const DEFAULT_ORDER_LIMIT = 200; // same reasoning as reconcile-shipments.js's DEFAULT_ORDER_LIMIT — generous headroom over current volume, not a soft guess.
const TOKEN_LIFETIME_DAYS = 60;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReviewRequests(env));
  },
};

/**
 * The actual run — exported separately from the `scheduled` handler so
 * tests can invoke it directly, same pattern as reconcile-shipments.js's
 * runReconciliation.
 */
export async function runReviewRequests(env) {
  const summary = { checked: 0, emailsSent: 0, emailsSkipped: 0, failures: 0 };

  if (!env.DB) {
    console.error(JSON.stringify({ worker: 'send-review-requests', level: 'fatal', error: 'Missing D1 binding: DB' }));
    throw new Error('[send-review-requests] Missing D1 binding: DB');
  }

  const delayDays = Number(env.REVIEW_REQUEST_DELAY_DAYS) > 0 ? Number(env.REVIEW_REQUEST_DELAY_DAYS) : DEFAULT_DELAY_DAYS;
  const limit = Number(env.REVIEW_REQUEST_ORDER_LIMIT) > 0 ? Number(env.REVIEW_REQUEST_ORDER_LIMIT) : DEFAULT_ORDER_LIMIT;
  const deliveredBeforeIso = new Date(Date.now() - delayDays * 24 * 60 * 60 * 1000).toISOString();

  let candidates;
  try {
    candidates = await listOrdersNeedingReviewRequest(env, { deliveredBeforeIso, limit });
  } catch (err) {
    console.error(JSON.stringify({ worker: 'send-review-requests', level: 'fatal', error: 'Candidate query failed', message: err?.message }));
    throw err;
  }

  for (const order of candidates) {
    summary.checked++;
    try {
      const sent = await sendReviewRequestForOrder(env, order);
      if (sent) summary.emailsSent++; else summary.emailsSkipped++;
    } catch (err) {
      // Per-order isolation — one order's failure (a template bug, a D1
      // write error) must never abort the rest of the run.
      summary.failures++;
      console.error(JSON.stringify({ worker: 'send-review-requests', level: 'error', orderId: order.id, orderNumber: order.public_order_number, error: err?.message }));
    }
  }

  console.log(JSON.stringify({ worker: 'send-review-requests', level: 'info', ...summary }));
  return summary;
}

async function sendReviewRequestForOrder(env, order) {
  const items = await getOrderItems(env, order.id);
  if (items.length === 0) return false;

  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const base = (env.SITE_URL || 'https://thedeangeloseries.com').replace(/\/$/, '');

  const emailItems = [];
  for (const item of items) {
    const rawToken = generateReviewToken();
    const tokenHash = await hashToken(rawToken);
    await insertReviewToken(env, { tokenHash, orderId: order.id, orderItemId: item.id, expiresAt });
    emailItems.push({
      name: item.product_name,
      reviewUrl: `${base}/leave-review.html?token=${rawToken}`,
    });
  }

  const result = await sendOrderEmailOnce(env, {
    orderId: order.id,
    emailType: 'review_request',
    to: order.customer_email,
    buildTemplate: () => reviewRequestTemplate({
      orderNumber: order.public_order_number,
      customerName: order.customer_name || undefined,
      items: emailItems,
    }),
  });

  if (!result.sent && result.reason !== 'duplicate') {
    console.error(JSON.stringify({ worker: 'send-review-requests', level: 'error', orderId: order.id, orderNumber: order.public_order_number, error: `Review request email failed: ${result.reason}` }));
  }
  return result.sent === true;
}
