#!/usr/bin/env node
// Financial-ledger reconciliation script — fills in Stripe fee/net and
// Printify fulfillment-cost data for orders that never got it from a live
// webhook (e.g. the balance transaction wasn't attached yet, or a Printify
// cost-refresh call failed transiently). Recomputes estimated_margin_amount
// wherever new data lands, using the exact same formula as the live path
// (functions/_lib/financials.js — imported, not duplicated).
//
// PROTECTED / LOCAL ONLY. Plain Node script, not an HTTP endpoint — nothing
// in functions/ exposes this capability to the internet. Run manually by
// someone with:
//   - `wrangler` authenticated against this Cloudflare account — used to
//     query/update D1 via the CLI, same mechanism as scripts/reconcile-printify-orders.mjs
//   - STRIPE_SECRET_KEY in the environment (for balance-transaction lookups)
//   - PRINTIFY_API_TOKEN and PRINTIFY_SHOP_ID (for order-cost lookups)
//
// Safety:
//   - Read-only against Stripe and Printify — this script only ever GETs.
//   - Never creates, updates, or cancels a Printify order.
//   - Never calls sendPrintifyOrderToProduction (not even imported).
//   - Never touches Stripe Checkout Sessions or PaymentIntents beyond a GET.
//   - Never logs STRIPE_SECRET_KEY, PRINTIFY_API_TOKEN, or any Authorization
//     header value — only order numbers, amounts, and IDs that are already
//     safe to print (order numbers, balance transaction IDs, Printify order
//     IDs — none of these are secrets).
//   - Defaults to --dry-run (prints what it WOULD update). Pass --apply to
//     actually call Stripe/Printify and write to D1.
//   - Idempotent: only selects orders with a genuinely missing field: it can
//     be run repeatedly / on a schedule with no risk of double-charging or
//     duplicate writes — every write is a plain UPDATE of nullable columns.
//
// Usage:
//   STRIPE_SECRET_KEY=... PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... node scripts/reconcile-financials.mjs
//   STRIPE_SECRET_KEY=... PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... node scripts/reconcile-financials.mjs --apply

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchStripeFeeAndNet } from '../functions/_lib/stripe.js';
import { getPrintifyOrder, extractPrintifyCosts } from '../functions/_lib/printify.js';
import { computeEstimatedMargin } from '../functions/_lib/financials.js';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const D1_DATABASE = 'deangelo-series-orders';
const APPLY = process.argv.includes('--apply');
const LOCAL = process.argv.includes('--local'); // testing only — points at local D1 SQLite state, never production

function d1Query(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', D1_DATABASE, LOCAL ? '--local' : '--remote', '--json', '--command', sql],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

function d1Execute(sql) {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', D1_DATABASE, LOCAL ? '--local' : '--remote', '--command', sql],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

function sqlString(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function sqlNumberOrNull(v) {
  return v === null || v === undefined ? 'NULL' : String(Number(v));
}

// Recomputes and writes estimated_margin_amount from the order's current
// full row (freshly re-read), then stamps financials_updated_at. Mirrors
// updateOrderFinancials() in functions/_lib/orders-db.js exactly, just via
// raw SQL instead of the D1 binding (this script runs outside the Workers
// runtime, so env.DB.prepare() isn't available here).
function recomputeAndWriteMargin(order) {
  const margin = computeEstimatedMargin(order);
  const now = new Date().toISOString();
  d1Execute(
    `UPDATE orders SET estimated_margin_amount = ${sqlNumberOrNull(margin)}, financials_updated_at = ${sqlString(now)}, updated_at = ${sqlString(now)} WHERE id = ${sqlString(order.id)}`,
  );
  return margin;
}

async function reconcileStripeFees(env) {
  console.log('\n=== Stripe fee/net reconciliation ===');
  const candidates = d1Query(
    `SELECT id, public_order_number, stripe_payment_intent_id, subtotal_amount, shipping_amount,
            stripe_fee_amount, printify_product_cost, printify_shipping_cost, printify_tax_amount
     FROM orders
     WHERE payment_status = 'paid' AND stripe_payment_intent_id IS NOT NULL AND stripe_balance_transaction_id IS NULL
     ORDER BY created_at ASC`,
  );
  console.log(`Found ${candidates.length} paid order(s) missing Stripe fee/net data.`);

  let updated = 0, stillPending = 0, failed = 0;
  for (const order of candidates) {
    console.log(`--- ${order.public_order_number} ---`);
    let feeInfo;
    try {
      feeInfo = await fetchStripeFeeAndNet(env, { paymentIntentId: order.stripe_payment_intent_id });
    } catch (err) {
      console.error(`  Failed to fetch: ${err.message}`);
      failed++;
      continue;
    }
    if (!feeInfo.known) {
      console.log('  Balance transaction not yet available — leaving null, will retry next run.');
      stillPending++;
      continue;
    }
    console.log(`  fee=${feeInfo.feeAmount} net=${feeInfo.netAmount} balance_transaction=${feeInfo.balanceTransactionId}`);
    if (!APPLY) { updated++; continue; }

    d1Execute(
      `UPDATE orders SET stripe_balance_transaction_id = ${sqlString(feeInfo.balanceTransactionId)}, stripe_fee_amount = ${sqlNumberOrNull(feeInfo.feeAmount)}, stripe_net_amount = ${sqlNumberOrNull(feeInfo.netAmount)}, updated_at = ${sqlString(new Date().toISOString())} WHERE id = ${sqlString(order.id)}`,
    );
    const margin = recomputeAndWriteMargin({
      ...order,
      stripe_fee_amount: feeInfo.feeAmount,
    });
    console.log(`  Updated. estimated_margin_amount = ${margin ?? 'null (still missing Printify costs)'}`);
    updated++;
  }
  console.log(`Stripe fees: ${updated} ${APPLY ? 'updated' : 'would update'}, ${stillPending} still pending, ${failed} failed.`);
  return { updated, stillPending, failed };
}

async function reconcilePrintifyCosts(env) {
  console.log('\n=== Printify cost reconciliation ===');
  const candidates = d1Query(
    `SELECT id, public_order_number, printify_order_id, subtotal_amount, shipping_amount,
            stripe_fee_amount, printify_product_cost, printify_shipping_cost, printify_tax_amount
     FROM orders
     WHERE printify_order_id IS NOT NULL AND printify_total_cost IS NULL
     ORDER BY created_at ASC`,
  );
  console.log(`Found ${candidates.length} order(s) with a Printify order missing cost data.`);

  let updated = 0, stillPending = 0, failed = 0;
  for (const order of candidates) {
    console.log(`--- ${order.public_order_number} (Printify ${order.printify_order_id}) ---`);
    let printifyOrder;
    try {
      printifyOrder = await getPrintifyOrder(env, order.printify_order_id);
    } catch (err) {
      console.error(`  Failed to fetch Printify order: ${err.message}`);
      failed++;
      continue;
    }
    const costs = extractPrintifyCosts(printifyOrder);
    if (!costs.known) {
      console.log(`  Costs not yet available (order status: ${printifyOrder?.status}) — leaving null, will retry next run.`);
      stillPending++;
      continue;
    }
    console.log(`  product=${costs.productCost} shipping=${costs.shippingCost} tax=${costs.taxAmount} total=${costs.totalCost}`);
    if (!APPLY) { updated++; continue; }

    d1Execute(
      `UPDATE orders SET printify_product_cost = ${sqlNumberOrNull(costs.productCost)}, printify_shipping_cost = ${sqlNumberOrNull(costs.shippingCost)}, printify_tax_amount = ${sqlNumberOrNull(costs.taxAmount)}, printify_total_cost = ${sqlNumberOrNull(costs.totalCost)}, updated_at = ${sqlString(new Date().toISOString())} WHERE id = ${sqlString(order.id)}`,
    );
    const margin = recomputeAndWriteMargin({
      ...order,
      printify_product_cost: costs.productCost,
      printify_shipping_cost: costs.shippingCost,
      printify_tax_amount: costs.taxAmount,
    });
    console.log(`  Updated. estimated_margin_amount = ${margin ?? 'null (still missing Stripe fee)'}`);
    updated++;
  }
  console.log(`Printify costs: ${updated} ${APPLY ? 'updated' : 'would update'}, ${stillPending} still pending, ${failed} failed.`);
  return { updated, stillPending, failed };
}

async function main() {
  console.log(`[reconcile-financials] Mode: ${APPLY ? 'APPLY (will call Stripe/Printify and write to D1)' : 'DRY RUN (no changes — pass --apply to execute)'} — ${LOCAL ? 'LOCAL D1 (testing)' : 'REMOTE D1 (production)'}`);

  const env = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    PRINTIFY_API_TOKEN: process.env.PRINTIFY_API_TOKEN,
    PRINTIFY_SHOP_ID: process.env.PRINTIFY_SHOP_ID,
    // Deliberately not reading PRINTIFY_AUTO_SEND_TO_PRODUCTION — this
    // script never sends anything to production, regardless.
  };
  if (!env.STRIPE_SECRET_KEY) console.warn('[reconcile-financials] STRIPE_SECRET_KEY not set — Stripe fee/net reconciliation will fail for every candidate.');
  if (!env.PRINTIFY_API_TOKEN || !env.PRINTIFY_SHOP_ID) console.warn('[reconcile-financials] PRINTIFY_API_TOKEN/PRINTIFY_SHOP_ID not set — Printify cost reconciliation will fail for every candidate.');

  const stripeResult = await reconcileStripeFees(env);
  const printifyResult = await reconcilePrintifyCosts(env);

  console.log('\n[reconcile-financials] Done.');
  console.log(`  Stripe:   ${stripeResult.updated} updated, ${stripeResult.stillPending} pending, ${stripeResult.failed} failed`);
  console.log(`  Printify: ${printifyResult.updated} updated, ${printifyResult.stillPending} pending, ${printifyResult.failed} failed`);
  if (!APPLY) console.log('[reconcile-financials] This was a dry run — re-run with --apply to actually write to D1.');
}

main().catch((err) => {
  console.error('[reconcile-financials] Fatal error:', err.message);
  process.exit(1);
});
