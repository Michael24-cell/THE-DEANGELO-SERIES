#!/usr/bin/env node
// Reconciliation script — two independent passes over Printify-backed orders:
//
//   1. reconcileMissingPrintifyOrders — finds paid orders that never got a
//      Printify order created (e.g. because PRINTIFY_API_TOKEN or the
//      product/variant mapping wasn't configured yet at the time), and
//      retries creation now.
//
//   2. reconcileShipmentsAndStatus — the PRODUCTION-SAFETY FALLBACK for
//      shipped/delivered tracking emails and cancellation detection, so the
//      site does not depend exclusively on Printify's webhook actually
//      being delivered (a real gap already observed once — a genuine
//      cancellation never reached the webhook endpoint). Polls the live
//      Printify order for every non-final order with a printify_order_id,
//      and reconciles shipments/delivery/cancellation using the EXACT same
//      D1 shipment records, the exact same shipment-key convention
//      (functions/_lib/printify.js's deriveShipmentKey), and the exact same
//      email_events UNIQUE(order_id, email_type) idempotency table as the
//      live webhook path (functions/api/printify-webhook.js) — so whichever
//      path (webhook or this script) discovers a shipment/cancellation
//      FIRST wins the email claim, and the other is always a safe no-op.
//      See functions/_lib/shipment-reconciliation.js for the pure decision
//      logic shared by both this script and its tests.
//
// PROTECTED / LOCAL ONLY. This is a plain Node script, not an HTTP endpoint —
// nothing in functions/ exposes this capability to the internet. It must be
// run manually by someone with:
//   - `wrangler` authenticated against this Cloudflare account — used to
//     query/update D1 via the CLI, same mechanism as migrations in this repo.
//   - PRINTIFY_API_TOKEN (and PRINTIFY_SHOP_ID, PRINTIFY_SHIPPING_METHOD_ID)
//     in the environment.
//   - RESEND_API_KEY, FROM_EMAIL, SUPPORT_EMAIL — only needed for pass 2's
//     shipped/delivered/cancellation-alert emails.
//
// Safety (pass 2, this is the read-only-against-Printify pass):
//   - Only ever calls GET on Printify (getPrintifyOrder). Never creates,
//     modifies, or cancels a Printify order. Never calls
//     sendPrintifyOrderToProduction (not even imported by this pass).
//   - A GET failure for one order is logged and that single order is left
//     completely untouched (no partial/destructive write) — the script
//     moves on to the next candidate.
//   - Every D1 write and every email send in this pass is idempotent via
//     the same real UNIQUE constraints the live webhook relies on
//     (shipments(order_id, printify_shipment_id), email_events(order_id,
//     email_type)) — safe to run on a schedule, repeatedly, with overlap.
//   - Defaults to --dry-run for both passes (prints what it WOULD do).
//     Pass --apply to actually call Printify (pass 1 only)/write to D1/send
//     email.
//
// Usage:
//   PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... RESEND_API_KEY=... FROM_EMAIL=... SUPPORT_EMAIL=... node scripts/reconcile-printify-orders.mjs
//   ...same... node scripts/reconcile-printify-orders.mjs --apply

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { createPrintifyOrder, getPrintifyOrder, PrintifyConfigError, PrintifyApiError } from '../functions/_lib/printify.js';
import { CATALOG } from '../functions/_lib/catalog.js';
import { planShipmentReconciliation } from '../functions/_lib/shipment-reconciliation.js';
import { shippedTemplate, deliveredTemplate, printifyFailureAlertTemplate } from '../functions/_lib/email-templates.js';
import { sendEmail } from '../functions/_lib/resend.js';

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const D1_DATABASE = 'deangelo-series-orders';
const APPLY = process.argv.includes('--apply');
const LOCAL = process.argv.includes('--local'); // testing only — points at the local D1 SQLite state, never production

// `local` is an explicit param (not read from module-level LOCAL) so
// reconcileShipmentsAndStatus can be imported and exercised by tests against
// local D1 regardless of how the test file itself was invoked.
function d1Query(sql, local = LOCAL) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', D1_DATABASE, local ? '--local' : '--remote', '--json', '--command', sql],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  return parsed[0]?.results ?? [];
}

// Like d1Query, but returns { changes, ... } instead of `results` — needed
// for INSERT OR IGNORE claim checks (email_events), where "did MY call win
// the claim" is exactly `meta.changes === 1`, the same signal
// sendOrderEmailOnce() in functions/_lib/orders-db.js relies on.
function d1ExecuteWithMeta(sql, local = LOCAL) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', D1_DATABASE, local ? '--local' : '--remote', '--json', '--command', sql],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  return parsed[0]?.meta ?? {};
}

function d1Execute(sql, local = LOCAL) {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', D1_DATABASE, local ? '--local' : '--remote', '--command', sql],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
}

function sqlString(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Pass 1 — create Printify orders that never got created (unchanged from
// before this feature; see module header).
// ---------------------------------------------------------------------------
export async function reconcileMissingPrintifyOrders(env, { local = LOCAL } = {}) {
  const candidates = d1Query(
    `SELECT id, public_order_number, customer_email, customer_name,
            shipping_name, shipping_address_line1, shipping_address_line2,
            shipping_city, shipping_state, shipping_postal_code, shipping_country,
            payment_status, printify_order_id
     FROM orders
     WHERE payment_status = 'paid' AND printify_order_id IS NULL
     ORDER BY created_at ASC`,
    local,
  );

  console.log(`[reconcile] Found ${candidates.length} paid order(s) without a Printify order.`);

  let succeeded = 0, skipped = 0, failed = 0;

  for (const order of candidates) {
    console.log(`\n[reconcile] --- ${order.public_order_number} (${order.id}) ---`);

    const [fresh] = d1Query(`SELECT printify_order_id FROM orders WHERE id = ${sqlString(order.id)}`, local);
    if (fresh?.printify_order_id) {
      console.log(`[reconcile] Skipping — printify_order_id was set since the initial query (${fresh.printify_order_id}).`);
      skipped++;
      continue;
    }

    const itemRows = d1Query(`SELECT * FROM order_items WHERE order_id = ${sqlString(order.id)}`, local);
    if (itemRows.length === 0) {
      console.log('[reconcile] Skipping — order has no order_items rows (data problem, investigate manually).');
      skipped++;
      continue;
    }

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
        local,
      );
      console.log(`[reconcile] Created Printify order ${result.printifyOrderId} for ${order.public_order_number}. Production NOT triggered — approve manually in Printify.`);
      succeeded++;
    } catch (err) {
      const reason = (err instanceof PrintifyConfigError || err instanceof PrintifyApiError) ? err.message : String(err);
      console.error(`[reconcile] Failed for ${order.public_order_number}: ${reason}`);
      d1Execute(
        `UPDATE orders SET fulfillment_error = ${sqlString(reason)}, updated_at = ${sqlString(new Date().toISOString())} WHERE id = ${sqlString(order.id)}`,
        local,
      );
      failed++;
    }
  }

  console.log(`[reconcile] Pass 1 done. ${succeeded} ${APPLY ? 'created' : 'would create'}, ${skipped} skipped, ${failed} failed.`);
  return { succeeded, skipped, failed };
}

// ---------------------------------------------------------------------------
// Pass 2 — shipment/delivery/cancellation reconciliation fallback. Read-only
// against Printify; the only writes are to D1 (shipments/orders/status_events/
// email_events) and outbound email via Resend, exactly mirroring what
// functions/api/printify-webhook.js does for a live event.
// ---------------------------------------------------------------------------
export async function reconcileShipmentsAndStatus(env, { local = LOCAL, apply = APPLY } = {}) {
  // printify_order_id IS NOT NULL: an order with no Printify order yet has
  // nothing to poll — pass 1's job, not this one's. Excluding
  // 'delivered'/'printify_canceled' (both terminal) keeps this from doing
  // pointless repeat work on orders that can't change further.
  const candidates = d1Query(
    `SELECT id, public_order_number, customer_email, customer_name, printify_order_id, fulfillment_status
     FROM orders
     WHERE printify_order_id IS NOT NULL AND fulfillment_status NOT IN ('delivered', 'printify_canceled')
     ORDER BY created_at ASC`,
    local,
  );

  console.log(`[reconcile-shipments] Found ${candidates.length} non-final order(s) with a Printify order to check.`);

  const counts = { checked: 0, shipmentsFound: 0, shippedEmailsSent: 0, delivered: 0, deliveredEmailsSent: 0, canceled: 0, alertsSent: 0, fetchFailed: 0 };

  for (const order of candidates) {
    counts.checked++;
    console.log(`\n[reconcile-shipments] --- ${order.public_order_number} (${order.printify_order_id}) ---`);

    let printifyOrder;
    try {
      printifyOrder = await getPrintifyOrder(env, order.printify_order_id);
    } catch (err) {
      // Order preserved untouched — no partial write, just report and move on.
      const reason = (err instanceof PrintifyConfigError || err instanceof PrintifyApiError) ? err.message : String(err);
      console.error(`[reconcile-shipments] Could not fetch Printify order — leaving ${order.public_order_number} untouched: ${reason}`);
      counts.fetchFailed++;
      continue;
    }

    const existingShipments = d1Query(
      `SELECT printify_shipment_id, status FROM shipments WHERE order_id = ${sqlString(order.id)}`,
      local,
    );
    const hasEmail = (emailType) => {
      const rows = d1Query(
        `SELECT id FROM email_events WHERE order_id = ${sqlString(order.id)} AND email_type = ${sqlString(emailType)}`,
        local,
      );
      return rows.length > 0;
    };

    const plan = planShipmentReconciliation({ order, printifyOrder, existingShipments, hasEmail });

    if (plan.cancellation) {
      counts.canceled++;
      console.log(`[reconcile-shipments] Printify reports this order canceled. Reason: ${plan.cancellation.reason}`);
      if (!apply) {
        console.log('[reconcile-shipments] (dry run) would set fulfillment_status=printify_canceled' + (plan.cancellation.sendAlert ? ' and send one support alert' : ' (support alert already sent)'));
        continue;
      }
      const now = new Date().toISOString();
      d1Execute(
        `UPDATE orders SET fulfillment_status = 'printify_canceled', fulfillment_error = ${sqlString(plan.cancellation.reason)}, updated_at = ${sqlString(now)} WHERE id = ${sqlString(order.id)}`,
        local,
      );
      recordStatusEvent(local, { orderId: order.id, eventType: 'reconcile:canceled', safeSummary: { printifyOrderId: order.printify_order_id, orderNumber: order.public_order_number } });

      if (plan.cancellation.sendAlert && env.SUPPORT_EMAIL) {
        const claimed = d1ExecuteWithMeta(
          `INSERT OR IGNORE INTO email_events (id, order_id, email_type, status, created_at) VALUES (${sqlString(crypto.randomUUID())}, ${sqlString(order.id)}, 'printify_canceled_alert', 'pending', ${sqlString(now)})`,
          local,
        );
        if (claimed.changes === 1) {
          const template = printifyFailureAlertTemplate({
            orderNumber: order.public_order_number, orderId: order.id,
            reason: `Printify canceled this order. ${plan.cancellation.reason}`,
          });
          const result = await sendEmail({ env, to: env.SUPPORT_EMAIL, subject: template.subject, html: template.html, text: template.text });
          updateEmailStatus(local, order.id, 'printify_canceled_alert', result);
          if (result.ok) { console.log('[reconcile-shipments] Support alert sent.'); counts.alertsSent++; }
          else console.error('[reconcile-shipments] Support alert claimed but send failed:', result.error);
        } else {
          console.log('[reconcile-shipments] Support alert already claimed by another path — not sending again.');
        }
      } else if (!env.SUPPORT_EMAIL) {
        console.error('[reconcile-shipments] SUPPORT_EMAIL not configured — could not send cancellation alert.');
      }
      continue;
    }

    if (plan.shipments.length === 0) {
      console.log('[reconcile-shipments] No tracking yet.');
      continue;
    }

    if (!apply) {
      for (const s of plan.shipments) {
        console.log(`[reconcile-shipments] (dry run) shipment key=${s.key} status=${s.status} ${s.isNewRow ? '(new)' : '(existing, ' + (s.statusChanged ? 'status change' : 'no change') + ')'} — ${s.sendShippedEmail ? 'would send shipped email' : 'shipped email already sent'}`);
      }
      if (plan.markDelivered) console.log('[reconcile-shipments] (dry run) would mark order delivered' + (plan.sendDeliveredEmail ? ' and send one delivered email' : ' (delivered email already sent)'));
      continue;
    }

    const now = new Date().toISOString();
    let lastShipment = null;
    for (const s of plan.shipments) {
      counts.shipmentsFound++;
      upsertShipment(local, order.id, s);
      lastShipment = s;

      if (s.sendShippedEmail) {
        const claimed = d1ExecuteWithMeta(
          `INSERT OR IGNORE INTO email_events (id, order_id, email_type, status, created_at) VALUES (${sqlString(crypto.randomUUID())}, ${sqlString(order.id)}, ${sqlString('shipped_' + s.key)}, 'pending', ${sqlString(now)})`,
          local,
        );
        if (claimed.changes === 1) {
          const template = shippedTemplate({
            orderNumber: order.public_order_number,
            customerName: order.customer_name || undefined,
            carrier: s.carrier || 'Carrier not provided',
            trackingNumber: s.trackingNumber || 'Not provided',
            trackingUrl: s.trackingUrl || 'https://thedeangeloseries.com/contact.html',
          });
          if (order.customer_email) {
            const result = await sendEmail({ env, to: order.customer_email, subject: template.subject, html: template.html, text: template.text });
            updateEmailStatus(local, order.id, 'shipped_' + s.key, result);
            if (result.ok) { console.log(`[reconcile-shipments] Shipped email sent for shipment ${s.key}.`); counts.shippedEmailsSent++; }
            else console.error(`[reconcile-shipments] Shipped email claimed but send failed for ${s.key}:`, result.error);
          }
        } else {
          console.log(`[reconcile-shipments] Shipped email for ${s.key} already claimed by another path — not sending again.`);
        }
      } else {
        console.log(`[reconcile-shipments] Shipped email for ${s.key} already sent — skipping (idempotent).`);
      }
    }

    if (plan.newFulfillmentStatus && lastShipment) {
      d1Execute(
        `UPDATE orders SET fulfillment_status = ${sqlString(plan.newFulfillmentStatus)}, carrier = ${sqlString(lastShipment.carrier)}, tracking_number = ${sqlString(lastShipment.trackingNumber)}, tracking_url = ${sqlString(lastShipment.trackingUrl)}, updated_at = ${sqlString(now)} WHERE id = ${sqlString(order.id)}`,
        local,
      );
    }
    recordStatusEvent(local, { orderId: order.id, eventType: 'reconcile:shipments', safeSummary: { printifyOrderId: order.printify_order_id, orderNumber: order.public_order_number, shipmentCount: plan.shipments.length } });

    if (plan.markDelivered) {
      counts.delivered++;
      if (plan.sendDeliveredEmail) {
        const claimed = d1ExecuteWithMeta(
          `INSERT OR IGNORE INTO email_events (id, order_id, email_type, status, created_at) VALUES (${sqlString(crypto.randomUUID())}, ${sqlString(order.id)}, 'delivered', 'pending', ${sqlString(now)})`,
          local,
        );
        if (claimed.changes === 1 && order.customer_email) {
          const template = deliveredTemplate({ orderNumber: order.public_order_number, customerName: order.customer_name || undefined });
          const result = await sendEmail({ env, to: order.customer_email, subject: template.subject, html: template.html, text: template.text });
          updateEmailStatus(local, order.id, 'delivered', result);
          if (result.ok) { console.log('[reconcile-shipments] Delivered email sent.'); counts.deliveredEmailsSent++; }
          else console.error('[reconcile-shipments] Delivered email claimed but send failed:', result.error);
        } else if (claimed.changes !== 1) {
          console.log('[reconcile-shipments] Delivered email already claimed by another path — not sending again.');
        }
      }
    }
  }

  console.log(`\n[reconcile-shipments] Pass 2 done. checked=${counts.checked} shipmentsFound=${counts.shipmentsFound} shippedEmailsSent=${counts.shippedEmailsSent} delivered=${counts.delivered} deliveredEmailsSent=${counts.deliveredEmailsSent} canceled=${counts.canceled} alertsSent=${counts.alertsSent} fetchFailed=${counts.fetchFailed}`);
  return counts;
}

function upsertShipment(local, orderId, s) {
  const now = new Date().toISOString();
  const [existing] = d1Query(
    `SELECT id FROM shipments WHERE order_id = ${sqlString(orderId)} AND printify_shipment_id = ${sqlString(s.key)}`,
    local,
  );
  if (existing) {
    d1Execute(
      `UPDATE shipments SET carrier = ${sqlString(s.carrier)}, tracking_number = ${sqlString(s.trackingNumber)}, tracking_url = ${sqlString(s.trackingUrl)}, status = ${sqlString(s.status)}, updated_at = ${sqlString(now)} WHERE id = ${sqlString(existing.id)}`,
      local,
    );
    return;
  }
  d1Execute(
    `INSERT INTO shipments (id, order_id, printify_shipment_id, carrier, tracking_number, tracking_url, status, created_at, updated_at)
     VALUES (${sqlString(crypto.randomUUID())}, ${sqlString(orderId)}, ${sqlString(s.key)}, ${sqlString(s.carrier)}, ${sqlString(s.trackingNumber)}, ${sqlString(s.trackingUrl)}, ${sqlString(s.status)}, ${sqlString(now)}, ${sqlString(now)})`,
    local,
  );
}

function recordStatusEvent(local, { orderId, eventType, safeSummary }) {
  d1Execute(
    `INSERT INTO status_events (id, order_id, source, external_event_id, event_type, safe_summary_json, created_at)
     VALUES (${sqlString(crypto.randomUUID())}, ${sqlString(orderId)}, 'printify', NULL, ${sqlString(eventType)}, ${sqlString(JSON.stringify(safeSummary))}, ${sqlString(new Date().toISOString())})`,
    local,
  );
}

function updateEmailStatus(local, orderId, emailType, result) {
  d1Execute(
    `UPDATE email_events SET status = ${sqlString(result.ok ? 'sent' : 'failed')}, resend_email_id = ${sqlString(result.ok ? result.id : null)}, error_message = ${sqlString(result.ok ? null : result.error)}, sent_at = ${result.ok ? sqlString(new Date().toISOString()) : 'NULL'} WHERE order_id = ${sqlString(orderId)} AND email_type = ${sqlString(emailType)}`,
    local,
  );
}

async function main() {
  console.log(`[reconcile] Mode: ${APPLY ? 'APPLY (will call Printify/Resend and write to D1)' : 'DRY RUN (no changes — pass --apply to execute)'} — ${LOCAL ? 'LOCAL D1 (testing)' : 'REMOTE D1 (production)'}`);

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
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    FROM_EMAIL: process.env.FROM_EMAIL,
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
    REPLY_TO_EMAIL: process.env.REPLY_TO_EMAIL,
    // Deliberately NOT reading PRINTIFY_AUTO_SEND_TO_PRODUCTION — neither
    // pass ever calls sendPrintifyOrderToProduction, regardless.
  };

  console.log('\n=== Pass 1: missing Printify orders ===');
  await reconcileMissingPrintifyOrders(env);

  console.log('\n=== Pass 2: shipment/delivery/cancellation reconciliation ===');
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
    console.warn('[reconcile] RESEND_API_KEY/FROM_EMAIL not set — pass 2 will still detect shipments/cancellations but any email send will fail cleanly (logged, not thrown).');
  }
  await reconcileShipmentsAndStatus(env);

  if (!APPLY) console.log('\n[reconcile] This was a dry run — re-run with --apply to actually write.');
}

// Only run when invoked directly (`node scripts/reconcile-printify-orders.mjs`),
// not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[reconcile] Fatal error:', err);
    process.exit(1);
  });
}
