// Standalone Cloudflare Worker — scheduled (Cron Trigger) shipment/delivery/
// cancellation reconciliation FALLBACK. The live webhook
// (functions/api/printify-webhook.js) is the fast path; this Worker exists
// only because a real Printify webhook delivery has already been observed
// to silently never arrive for a genuine cancellation (see earlier session
// notes) — this is the safety net for that gap, not a replacement for the
// webhook.
//
// STRICT READ-ONLY AGAINST PRINTIFY. This file must never import or call
// createPrintifyOrder, sendPrintifyOrderToProduction, the /cancel.json
// endpoint, or any POST/PUT/PATCH/DELETE Printify method — only
// getPrintifyOrder() (a GET). See the "Printify safety boundary" import
// list below and tests/reconcile-shipments-worker-safety.test.mjs, which
// statically asserts this file never contains a forbidden identifier or
// HTTP method string.
//
// Cross-path idempotency: reuses the EXACT SAME D1 primitives
// (functions/_lib/orders-db.js), the exact same shipment-key convention and
// shipment extraction (functions/_lib/printify.js), and the exact same pure
// decision logic (functions/_lib/shipment-reconciliation.js) that both
// functions/api/printify-webhook.js and scripts/reconcile-printify-orders.mjs
// already use — so whichever path (webhook or this Worker) discovers a
// shipment/delivery/cancellation FIRST wins the email claim (email_events'
// UNIQUE(order_id, email_type) constraint), and the other is always a safe,
// logged no-op. See tests/reconcile-shipments-worker.test.mjs for direct
// proof of both directions.
//
// Deploy target: a SEPARATE Worker from the Pages project (see
// wrangler.reconcile.toml at the repo root) — this file is not part of the
// Pages Functions build and is never reachable over HTTP; it only exposes
// scheduled(), no fetch() handler at all.

import { getPrintifyOrder, PrintifyConfigError, PrintifyApiError } from '../functions/_lib/printify.js';
import { planShipmentReconciliation } from '../functions/_lib/shipment-reconciliation.js';
import { shippedTemplate, deliveredTemplate, printifyFailureAlertTemplate } from '../functions/_lib/email-templates.js';
import {
  listActiveReconciliationCandidates, listShipmentsForOrder, hasEmailEvent,
  insertShipment, updateOrder, sendOrderEmailOnce, recordStatusEvent,
} from '../functions/_lib/orders-db.js';

// Current store size is a handful of orders — this is generous headroom
// (60x current volume) while still bounding a single 15-minute-cadence
// invocation's Printify API + D1 load as a hard ceiling, not a soft guess.
// Raise this (or make it env-driven — RECONCILE_ORDER_LIMIT is already read
// below if set) once real order volume approaches it.
const DEFAULT_ORDER_LIMIT = 200;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReconciliation(env));
  },
};

/**
 * The actual reconciliation run — exported separately from the `scheduled`
 * handler so tests can invoke it directly without going through Cloudflare's
 * scheduled-event plumbing. Returns the structured run summary it also logs.
 */
export async function runReconciliation(env) {
  const startedAt = Date.now();
  const summary = {
    checked: 0,
    shipmentsFound: 0,
    shippedEmailsSent: 0,
    shippedEmailsSkipped: 0,
    delivered: 0,
    deliveredEmailsSent: 0,
    deliveredEmailsSkipped: 0,
    cancellationsReconciled: 0,
    alertsSent: 0,
    alertsSkipped: 0,
    fetchFailures: 0,
    durationMs: 0,
  };

  if (!env.DB) {
    // Fatal — nothing can run without D1. Logged with structured context
    // and rethrown so Cloudflare marks the invocation failed (requirement:
    // fatal run-level errors must not be silently swallowed).
    console.error(JSON.stringify({ worker: 'reconcile-shipments', level: 'fatal', error: 'Missing D1 binding: DB' }));
    throw new Error('[reconcile-shipments] Missing D1 binding: DB');
  }

  let candidates;
  try {
    const limit = Number(env.RECONCILE_ORDER_LIMIT) > 0 ? Number(env.RECONCILE_ORDER_LIMIT) : DEFAULT_ORDER_LIMIT;
    candidates = await listActiveReconciliationCandidates(env, limit);
  } catch (err) {
    console.error(JSON.stringify({ worker: 'reconcile-shipments', level: 'fatal', error: 'Candidate query failed', message: err?.message }));
    throw err;
  }

  for (const order of candidates) {
    summary.checked++;
    try {
      await reconcileOneOrder(env, order, summary);
    } catch (err) {
      // Per-order isolation — one order's unexpected failure (a D1 write
      // error, a template-building bug, etc.) must never abort the rest of
      // the run. This is distinct from a Printify fetch failure (handled
      // inside reconcileOneOrder itself, without throwing) — this catch is
      // the last-resort backstop for anything else.
      summary.fetchFailures++; // counted the same as a fetch failure: this order was left unresolved this run
      console.error(JSON.stringify({
        worker: 'reconcile-shipments', level: 'error', orderNumber: order.public_order_number,
        error: 'Unexpected error reconciling order — left untouched, continuing', message: err?.message,
      }));
    }
  }

  summary.durationMs = Date.now() - startedAt;
  // Structured, single-line, PII-free summary — no customer email/name,
  // no raw Printify/webhook payloads, no tokens or secrets, ever.
  console.log(JSON.stringify({ worker: 'reconcile-shipments', level: 'info', summary }));
  return summary;
}

async function reconcileOneOrder(env, order, summary) {
  let printifyOrder;
  try {
    printifyOrder = await getPrintifyOrder(env, order.printify_order_id);
  } catch (err) {
    const reason = (err instanceof PrintifyConfigError || err instanceof PrintifyApiError) ? err.message : String(err);
    summary.fetchFailures++;
    console.error(JSON.stringify({
      worker: 'reconcile-shipments', level: 'warn', orderNumber: order.public_order_number,
      error: 'Printify fetch failed — order left untouched', reason,
    }));
    return; // order preserved exactly as-is; never a partial/destructive write
  }

  const existingShipments = await listShipmentsForOrder(env, order.id);

  const plan = await planShipmentReconciliation({
    order: { fulfillment_status: order.fulfillment_status },
    printifyOrder,
    existingShipments,
    hasEmail: (emailType) => hasEmailEvent(env, order.id, emailType),
  });

  if (plan.cancellation) {
    await applyCancellation(env, order, plan, summary);
    return; // never process shipments for a canceled order — matches the webhook path
  }

  if (plan.shipments.length === 0) {
    return; // no tracking yet — nothing to do
  }

  let lastShipment = null;
  for (const s of plan.shipments) {
    summary.shipmentsFound++;
    await insertShipment(env, {
      orderId: order.id, printifyShipmentId: s.key, carrier: s.carrier,
      trackingNumber: s.trackingNumber, trackingUrl: s.trackingUrl, status: s.status,
    });
    lastShipment = s;

    if (s.sendShippedEmail && order.customer_email) {
      const result = await sendOrderEmailOnce(env, {
        orderId: order.id, emailType: `shipped_${s.key}`, to: order.customer_email,
        buildTemplate: () => shippedTemplate({
          orderNumber: order.public_order_number,
          customerName: order.customer_name || undefined,
          carrier: s.carrier || 'Carrier not provided',
          trackingNumber: s.trackingNumber || 'Not provided',
          trackingUrl: s.trackingUrl || 'https://thedeangeloseries.com/contact.html',
        }),
      });
      if (result.sent) summary.shippedEmailsSent++;
      else summary.shippedEmailsSkipped++;
    } else {
      summary.shippedEmailsSkipped++;
    }
  }

  if (plan.newFulfillmentStatus && lastShipment) {
    await updateOrder(env, order.id, {
      fulfillment_status: plan.newFulfillmentStatus,
      carrier: lastShipment.carrier,
      tracking_number: lastShipment.trackingNumber,
      tracking_url: lastShipment.trackingUrl,
    });
  }
  await recordStatusEvent(env, {
    orderId: order.id, source: 'printify', externalEventId: null, eventType: 'reconcile:shipments',
    safeSummary: { printifyOrderId: order.printify_order_id, orderNumber: order.public_order_number, shipmentCount: plan.shipments.length },
  });

  if (plan.markDelivered) {
    summary.delivered++;
    if (plan.sendDeliveredEmail && order.customer_email) {
      const result = await sendOrderEmailOnce(env, {
        orderId: order.id, emailType: 'delivered', to: order.customer_email,
        buildTemplate: () => deliveredTemplate({ orderNumber: order.public_order_number, customerName: order.customer_name || undefined }),
      });
      if (result.sent) summary.deliveredEmailsSent++;
      else summary.deliveredEmailsSkipped++;
    } else {
      summary.deliveredEmailsSkipped++;
    }
  }
}

async function applyCancellation(env, order, plan, summary) {
  summary.cancellationsReconciled++;
  await updateOrder(env, order.id, { fulfillment_status: 'printify_canceled', fulfillment_error: plan.cancellation.reason });
  await recordStatusEvent(env, {
    orderId: order.id, source: 'printify', externalEventId: null, eventType: 'reconcile:canceled',
    safeSummary: { printifyOrderId: order.printify_order_id, orderNumber: order.public_order_number },
  });

  if (!plan.cancellation.sendAlert) {
    summary.alertsSkipped++;
    return;
  }
  if (!env.SUPPORT_EMAIL) {
    summary.alertsSkipped++;
    console.error(JSON.stringify({ worker: 'reconcile-shipments', level: 'error', orderNumber: order.public_order_number, error: 'SUPPORT_EMAIL not configured — cancellation alert not sent' }));
    return;
  }
  const result = await sendOrderEmailOnce(env, {
    orderId: order.id, emailType: 'printify_canceled_alert', to: env.SUPPORT_EMAIL,
    buildTemplate: () => printifyFailureAlertTemplate({
      orderNumber: order.public_order_number, orderId: order.id,
      reason: `Printify canceled this order. ${plan.cancellation.reason}`,
    }),
  });
  if (result.sent) summary.alertsSent++;
  else summary.alertsSkipped++;
}
