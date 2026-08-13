// Pure planning logic for the shipment/cancellation reconciliation fallback —
// shared by scripts/reconcile-printify-orders.mjs (a plain Node script, D1
// access via `wrangler d1 execute`) and workers/reconcile-shipments.js (a
// Cloudflare Worker, D1 access via the real `env.DB` binding). No fetch, no
// env, no direct D1 access of its own — takes already-fetched state and
// returns a plan describing exactly what should happen. This is what
// functions/api/printify-webhook.js's inline branching does for the live
// webhook path; kept here as a separate function so all THREE call sites
// share one decision logic instead of three copies. Async only because its
// `hasEmail` callback might be (workers/reconcile-shipments.js's D1-binding
// reads are); otherwise fully pure. Thoroughly unit-testable — see
// tests/shipment-reconciliation.test.mjs.

import { deriveShipmentKey, extractOrderShipments } from './printify.js';

/**
 * @param {object} args
 * @param {{fulfillment_status: string}} args.order - the D1 order row (only
 *   fulfillment_status is read)
 * @param {object} args.printifyOrder - raw GET /orders/{id}.json response
 * @param {Array<{printify_shipment_id: string, status: string}>} args.existingShipments -
 *   D1 shipments rows already recorded for this order
 * @param {(emailType: string) => boolean|Promise<boolean>} args.hasEmail -
 *   returns true if email_events already has a row for (order, emailType) —
 *   i.e. it would be a duplicate to send again, from EITHER path (webhook or
 *   reconciliation), since both write to the same table under the same
 *   UNIQUE constraint. May be sync (scripts/reconcile-printify-orders.mjs's
 *   CLI-backed D1 reads) or async (workers/reconcile-shipments.js's D1
 *   binding reads) — every call is awaited internally, so a plain boolean
 *   return works identically to a Promise<boolean> one.
 *
 * @returns {Promise<{
 *   cancellation: {reason: string, sendAlert: boolean} | null,
 *   shipments: Array<{key: string, carrier: string|null, trackingNumber: string|null,
 *     trackingUrl: string|null, status: 'shipped'|'delivered', isNewRow: boolean,
 *     statusChanged: boolean, sendShippedEmail: boolean}>,
 *   newFulfillmentStatus: 'shipped' | 'delivered' | null,
 *   markDelivered: boolean,
 *   sendDeliveredEmail: boolean,
 * }>}
 */
export async function planShipmentReconciliation({ order, printifyOrder, existingShipments, hasEmail }) {
  const plan = {
    cancellation: null,
    shipments: [],
    newFulfillmentStatus: null,
    markDelivered: false,
    sendDeliveredEmail: false,
  };

  // ── Cancellation takes priority and stops here — never process shipments
  // for an order Printify reports as canceled, same as markCanceled() in
  // printify-webhook.js never touching shipped/delivered claims. ─────────
  if (printifyOrder?.status === 'canceled') {
    if (order.fulfillment_status !== 'printify_canceled') {
      plan.cancellation = {
        reason: extractCancelReasonFromOrder(printifyOrder),
        sendAlert: !(await hasEmail('printify_canceled_alert')),
      };
    }
    return plan;
  }

  // ── Shipments ────────────────────────────────────────────────────────
  const liveShipments = extractOrderShipments(printifyOrder);
  const existingByKey = new Map((existingShipments || []).map((s) => [s.printify_shipment_id, s]));

  for (const s of liveShipments) {
    const key = deriveShipmentKey({
      carrier: s.carrier,
      trackingNumber: s.trackingNumber,
      discriminator: `${s.deliveredAt || 'undelivered'}:${s.index}`,
    });
    const status = s.deliveredAt ? 'delivered' : 'shipped';
    const existing = existingByKey.get(key);

    plan.shipments.push({
      key,
      carrier: s.carrier,
      trackingNumber: s.trackingNumber,
      trackingUrl: s.trackingUrl,
      status,
      isNewRow: !existing,
      statusChanged: existing ? existing.status !== status : true,
      // Sent regardless of current status (shipped OR delivered) — a
      // shipment discovered for the first time already fully delivered
      // still deserves its tracking email; see the module note in
      // scripts/reconcile-printify-orders.mjs.
      sendShippedEmail: !(await hasEmail(`shipped_${key}`)),
    });
  }

  if (plan.shipments.length > 0 && order.fulfillment_status !== 'delivered') {
    plan.newFulfillmentStatus = 'shipped';
  }

  // ── Delivery — only once EVERY known shipment (already-recorded rows
  // union this poll's findings) is delivered. Mirrors allShipmentsDelivered()
  // in functions/_lib/orders-db.js exactly, just computed from the merged
  // view instead of a fresh D1 SELECT (the caller hasn't written this poll's
  // shipments yet at plan time). ─────────────────────────────────────────
  const mergedStatusByKey = new Map();
  for (const es of existingShipments || []) mergedStatusByKey.set(es.printify_shipment_id, es.status);
  for (const ps of plan.shipments) mergedStatusByKey.set(ps.key, ps.status); // this poll wins on conflict
  const mergedStatuses = [...mergedStatusByKey.values()];
  const allDelivered = mergedStatuses.length > 0 && mergedStatuses.every((st) => st === 'delivered');

  if (allDelivered && order.fulfillment_status !== 'delivered') {
    plan.markDelivered = true;
    plan.newFulfillmentStatus = 'delivered';
    plan.sendDeliveredEmail = !(await hasEmail('delivered'));
  }

  return plan;
}

// Printify's GET order response documents no cancellation-reason field
// anywhere (confirmed against the API reference) — same situation as the
// order:updated webhook payload. Checked defensively in case Printify ever
// adds one, for consistency with extractCancelReason() in printify-webhook.js,
// but in practice this always falls through to the constant message today.
function extractCancelReasonFromOrder(printifyOrder) {
  return printifyOrder?.reason || printifyOrder?.message || printifyOrder?.status_note
    || 'Printify reports this order as canceled; no reason field was present in the order response.';
}
