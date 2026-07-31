#!/usr/bin/env node
// Reconciliation script — finds paid orders that never got a Printify order
// created (e.g. because PRINTIFY_API_TOKEN or the product/variant mapping
// wasn't configured yet at the time), and retries creation now.
//
// PROTECTED / LOCAL ONLY. This is a plain Node script, not an HTTP endpoint —
// nothing in functions/ exposes this capability to the internet. It must be
// run manually by someone with:
//   - `wrangler` authenticated against this Cloudflare account (see
//     `npx wrangler whoami`) — used to query/update D1 via the CLI, the same
//     mechanism already used for migrations in this repo.
//   - PRINTIFY_API_TOKEN (and PRINTIFY_SHOP_ID, PRINTIFY_SHIPPING_METHOD_ID)
//     in the environment.
//
// Safety:
//   - Reuses functions/_lib/printify.js's createPrintifyOrder() unchanged —
//     identical behavior to the live webhook: send_shipping_notification is
//     always false, and send-to-production is NEVER called from here or
//     from createPrintifyOrder(). Production approval stays a manual,
//     separate action regardless of PRINTIFY_AUTO_SEND_TO_PRODUCTION.
//   - Cannot create a duplicate Printify order for the same D1 order:
//       1. The selection query only returns orders where
//          printify_order_id IS NULL.
//       2. Immediately before calling Printify for a given order, the
//          script re-reads that single row fresh — if another process (or a
//          concurrent run of this same script) already filled in
//          printify_order_id in the meantime, this order is skipped.
//       3. On success, printify_order_id is written back to D1 before
//          moving to the next order — so a second run (even a
//          re-invocation moments later) will never see this order again.
//   - Every item must have a CONFIRMED Printify product/variant mapping in
//     functions/_lib/catalog.js — orders with any unmapped item are skipped
//     and reported, never partially submitted.
//   - Defaults to --dry-run (prints what it WOULD do). Pass --apply to
//     actually call Printify and write to D1.
//
// Usage:
//   PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... node scripts/reconcile-printify-orders.mjs
//   PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... node scripts/reconcile-printify-orders.mjs --apply

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPrintifyOrder, PrintifyConfigError, PrintifyApiError } from '../functions/_lib/printify.js';
import { CATALOG } from '../functions/_lib/catalog.js';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const D1_DATABASE = 'deangelo-series-orders';
const APPLY = process.argv.includes('--apply');
const LOCAL = process.argv.includes('--local'); // testing only — points at the local D1 SQLite state, never production

function d1Query(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', D1_DATABASE, LOCAL ? '--local' : '--remote', '--json', '--command', sql],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  // wrangler returns an array of result sets; we only ever run one statement.
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

async function main() {
  console.log(`[reconcile] Mode: ${APPLY ? 'APPLY (will call Printify and write to D1)' : 'DRY RUN (no changes — pass --apply to execute)'} — ${LOCAL ? 'LOCAL D1 (testing)' : 'REMOTE D1 (production)'}`);

  if (!process.env.PRINTIFY_API_TOKEN) {
    console.error('[reconcile] PRINTIFY_API_TOKEN is not set in the environment. Aborting.');
    process.exit(1);
  }
  if (!process.env.PRINTIFY_SHOP_ID) {
    console.error('[reconcile] PRINTIFY_SHOP_ID is not set in the environment. Aborting.');
    process.exit(1);
  }

  const env = {
    PRINTIFY_API_TOKEN: process.env.PRINTIFY_API_TOKEN,
    PRINTIFY_SHOP_ID: process.env.PRINTIFY_SHOP_ID,
    PRINTIFY_SHIPPING_METHOD_ID: process.env.PRINTIFY_SHIPPING_METHOD_ID,
    // Deliberately NOT reading PRINTIFY_AUTO_SEND_TO_PRODUCTION here — this
    // script never calls sendPrintifyOrderToProduction regardless.
  };

  const candidates = d1Query(
    `SELECT id, public_order_number, customer_email, customer_name,
            shipping_name, shipping_address_line1, shipping_address_line2,
            shipping_city, shipping_state, shipping_postal_code, shipping_country,
            payment_status, printify_order_id
     FROM orders
     WHERE payment_status = 'paid' AND printify_order_id IS NULL
     ORDER BY created_at ASC`,
  );

  console.log(`[reconcile] Found ${candidates.length} paid order(s) without a Printify order.`);
  if (candidates.length === 0) return;

  let succeeded = 0, skipped = 0, failed = 0;

  for (const order of candidates) {
    console.log(`\n[reconcile] --- ${order.public_order_number} (${order.id}) ---`);

    // Re-check fresh, immediately before acting — closes the race window
    // against a concurrent run or a webhook that just now created it.
    const [fresh] = d1Query(`SELECT printify_order_id FROM orders WHERE id = ${sqlString(order.id)}`);
    if (fresh?.printify_order_id) {
      console.log(`[reconcile] Skipping — printify_order_id was set since the initial query (${fresh.printify_order_id}).`);
      skipped++;
      continue;
    }

    const itemRows = d1Query(`SELECT * FROM order_items WHERE order_id = ${sqlString(order.id)}`);
    if (itemRows.length === 0) {
      console.log('[reconcile] Skipping — order has no order_items rows (data problem, investigate manually).');
      skipped++;
      continue;
    }

    // Re-resolve against the CURRENT catalog.js, not the (possibly stale,
    // null-at-the-time) printify IDs captured on the order_items rows —
    // catalog.js is the one place mappings get filled in going forward.
    const items = itemRows.map((row) => {
      const entry = CATALOG[row.product_slug];
      const variantId = entry?.printify?.variantIdBySize?.[row.size] ?? null;
      return {
        slug: row.product_slug,
        size: row.size,
        quantity: row.quantity,
        printify: { productId: entry?.printify?.productId ?? null, variantId },
      };
    });

    const unmapped = items.filter((it) => !it.printify.productId || !it.printify.variantId);
    if (unmapped.length > 0) {
      console.log(`[reconcile] Skipping — missing Printify mapping for: ${unmapped.map((it) => `${it.slug} (${it.size})`).join(', ')}. Fill in functions/_lib/catalog.js and re-run.`);
      skipped++;
      continue;
    }

    const shipping = {
      firstName: (order.shipping_name || '').split(' ')[0] || '',
      lastName: (order.shipping_name || '').split(' ').slice(1).join(' ') || '',
      country: order.shipping_country,
      region: order.shipping_state,
      address1: order.shipping_address_line1,
      address2: order.shipping_address_line2,
      city: order.shipping_city,
      zip: order.shipping_postal_code,
    };

    if (!APPLY) {
      console.log(`[reconcile] Would create Printify order for ${order.public_order_number} with ${items.length} item(s), external_id=${order.public_order_number}.`);
      succeeded++;
      continue;
    }

    try {
      const result = await createPrintifyOrder(env, {
        orderNumber: order.public_order_number,
        items,
        shipping,
        email: order.customer_email,
      });
      d1Execute(
        `UPDATE orders SET printify_order_id = ${sqlString(result.printifyOrderId)}, fulfillment_status = 'submitted_to_printify', fulfillment_error = NULL, updated_at = ${sqlString(new Date().toISOString())} WHERE id = ${sqlString(order.id)}`,
      );
      console.log(`[reconcile] Created Printify order ${result.printifyOrderId} for ${order.public_order_number}. Production NOT triggered — approve manually in Printify.`);
      succeeded++;
    } catch (err) {
      const reason = (err instanceof PrintifyConfigError || err instanceof PrintifyApiError) ? err.message : String(err);
      console.error(`[reconcile] Failed for ${order.public_order_number}: ${reason}`);
      d1Execute(
        `UPDATE orders SET fulfillment_error = ${sqlString(reason)}, updated_at = ${sqlString(new Date().toISOString())} WHERE id = ${sqlString(order.id)}`,
      );
      failed++;
    }
  }

  console.log(`\n[reconcile] Done. ${succeeded} ${APPLY ? 'created' : 'would create'}, ${skipped} skipped, ${failed} failed.`);
  if (!APPLY) console.log('[reconcile] This was a dry run — re-run with --apply to actually call Printify.');
}

main().catch((err) => {
  console.error('[reconcile] Fatal error:', err);
  process.exit(1);
});
