// Shared server-side Stripe API helpers.
// Lives under functions/_lib/ — Cloudflare Pages excludes any `_`-prefixed
// path from routing, so this file is never itself reachable as an endpoint.
// Imported by functions/api/stripe-webhook.js and scripts/reconcile-financials.mjs.
//
// Required env var: STRIPE_SECRET_KEY — never sent to the browser, never logged.
//
// Zero npm dependencies — same raw-fetch approach as functions/_lib/printify.js.

const API_BASE = 'https://api.stripe.com/v1';
const STRIPE_VERSION = '2024-06-20';

export class StripeApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function stripeRequest(env, path, params) {
  if (!env.STRIPE_SECRET_KEY) {
    throw new StripeApiError('Stripe is not configured (missing secret key).', 0);
  }

  const url = `${API_BASE}${path}${params ? '?' + params.toString() : ''}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Stripe-Version': STRIPE_VERSION,
      },
    });
  } catch (err) {
    console.error('[stripe] Network error:', err.message);
    throw new StripeApiError('Could not reach Stripe.', 0);
  }

  let data = {};
  try { data = await res.json(); } catch { /* some responses may have no body */ }

  if (!res.ok) {
    // Log Stripe's diagnostic message, never the Authorization header/key.
    console.error('[stripe] API error:', res.status, data?.error?.message || JSON.stringify(data).slice(0, 300));
    throw new StripeApiError(data?.error?.message || `Stripe API error (${res.status})`, res.status);
  }

  return data;
}

/**
 * Re-fetches a Checkout Session with line items (and their products, for the
 * slug/size/color metadata) expanded. checkout.session.completed's own
 * payload doesn't include line_items by default.
 */
export async function fetchExpandedCheckoutSession(env, sessionId) {
  const params = new URLSearchParams();
  params.append('expand[]', 'line_items');
  params.append('expand[]', 'line_items.data.price.product');
  return stripeRequest(env, `/checkout/sessions/${sessionId}`, params);
}

/**
 * Resolves the ACTUAL Stripe fee/net for a paid order by walking
 * PaymentIntent -> latest Charge -> BalanceTransaction — the only place
 * these real figures live (they are not on the Checkout Session object at
 * all). Never estimates or hardcodes a fee.
 *
 * Returns { known: false } — never a guessed number — if the PaymentIntent
 * can't be fetched, or if the charge hasn't settled/attached a balance
 * transaction yet (this can happen briefly even for card payments, and for
 * longer for payment methods with delayed settlement). Callers must leave
 * the financial fields null in that case and rely on later reconciliation
 * (see scripts/reconcile-financials.mjs) rather than fail or fabricate.
 */
export async function fetchStripeFeeAndNet(env, { paymentIntentId }) {
  if (!paymentIntentId) return { known: false };

  const params = new URLSearchParams();
  params.append('expand[]', 'latest_charge.balance_transaction');

  let paymentIntent;
  try {
    paymentIntent = await stripeRequest(env, `/payment_intents/${paymentIntentId}`, params);
  } catch (err) {
    console.error('[stripe] Could not fetch PaymentIntent for fee/net capture:', err.message);
    return { known: false };
  }

  const balanceTransaction = paymentIntent?.latest_charge?.balance_transaction;
  if (!balanceTransaction || typeof balanceTransaction !== 'object') {
    return { known: false };
  }

  return {
    known: true,
    balanceTransactionId: balanceTransaction.id,
    feeAmount: balanceTransaction.fee,
    netAmount: balanceTransaction.net,
  };
}
