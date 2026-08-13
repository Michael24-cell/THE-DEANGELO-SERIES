// Unit tests for the pure planner in functions/_lib/shipment-reconciliation.js
// — the decision logic shared by the reconciliation fallback
// (scripts/reconcile-printify-orders.mjs) and, indirectly (via the same
// deriveShipmentKey/extractOrderShipments), the live webhook path
// (functions/api/printify-webhook.js). No D1, no fetch — pure input/output.
//
// Run: node tests/shipment-reconciliation.test.mjs (or `npm test`)

import { planShipmentReconciliation } from '../functions/_lib/shipment-reconciliation.js';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function noEmailsSent() { return () => false; }

function run() {
  console.log('--- New tracking discovered: one shipment planned, shipped email planned ---');
  {
    const order = { fulfillment_status: 'in_production' };
    const printifyOrder = { status: 'in-production', shipments: [{ carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA' }] };
    const plan = planShipmentReconciliation({ order, printifyOrder, existingShipments: [], hasEmail: noEmailsSent() });
    ok('one shipment planned', plan.shipments.length === 1);
    ok('keyed by tracking number', plan.shipments[0].key === 'TRACK-AAA');
    ok('isNewRow true', plan.shipments[0].isNewRow === true);
    ok('sendShippedEmail true', plan.shipments[0].sendShippedEmail === true);
    ok('status = shipped (no delivered_at)', plan.shipments[0].status === 'shipped');
    ok('newFulfillmentStatus = shipped', plan.newFulfillmentStatus === 'shipped');
    ok('markDelivered false', plan.markDelivered === false);
  }

  console.log('\n--- Same tracking discovered again (already in D1, email already sent): no duplicate email ---');
  {
    const order = { fulfillment_status: 'shipped' };
    const printifyOrder = { status: 'in-production', shipments: [{ carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA' }] };
    const plan = planShipmentReconciliation({
      order, printifyOrder,
      existingShipments: [{ printify_shipment_id: 'TRACK-AAA', status: 'shipped' }],
      hasEmail: (t) => t === 'shipped_TRACK-AAA',
    });
    ok('shipment still reported (for upsert/no-op)', plan.shipments.length === 1);
    ok('isNewRow false (already in D1)', plan.shipments[0].isNewRow === false);
    ok('statusChanged false', plan.shipments[0].statusChanged === false);
    ok('sendShippedEmail false — already claimed', plan.shipments[0].sendShippedEmail === false);
  }

  console.log('\n--- Reconciliation discovers a shipment the WEBHOOK already emailed for: no duplicate (webhook-first) ---');
  {
    // Simulates: webhook already inserted the shipments row AND claimed the
    // email_events row for shipped_TRACK-AAA. Reconciliation polls later and
    // must not send a second email, even though from ITS perspective this
    // is "new" (isNewRow would be false since D1 already has it — the real
    // guard is hasEmail(), backed by the same email_events table both paths
    // write to).
    const order = { fulfillment_status: 'shipped' };
    const printifyOrder = { status: 'in-production', shipments: [{ carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA' }] };
    const plan = planShipmentReconciliation({
      order, printifyOrder,
      existingShipments: [{ printify_shipment_id: 'TRACK-AAA', status: 'shipped' }],
      hasEmail: (t) => t === 'shipped_TRACK-AAA', // webhook already claimed this
    });
    ok('sendShippedEmail false (webhook already sent it)', plan.shipments[0].sendShippedEmail === false);
  }

  console.log('\n--- Reconciliation discovers a shipment FIRST: plans exactly one email; a later webhook (simulated by hasEmail flipping true) must not resend ---');
  {
    const order = { fulfillment_status: 'in_production' };
    const printifyOrder = { status: 'in-production', shipments: [{ carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA' }] };
    const firstPoll = planShipmentReconciliation({ order, printifyOrder, existingShipments: [], hasEmail: noEmailsSent() });
    ok('reconciliation-first: plans exactly one shipped email', firstPoll.shipments[0].sendShippedEmail === true);

    // Now simulate the email_events row this claim would have created, and
    // ask again (standing in for "the webhook now delivers for the same
    // shipment") — must see it as already claimed.
    const secondLook = planShipmentReconciliation({
      order: { fulfillment_status: 'shipped' }, printifyOrder,
      existingShipments: [{ printify_shipment_id: 'TRACK-AAA', status: 'shipped' }],
      hasEmail: (t) => t === 'shipped_TRACK-AAA',
    });
    ok('subsequent webhook/poll: sendShippedEmail false', secondLook.shipments[0].sendShippedEmail === false);
  }

  console.log('\n--- Two distinct packages: two shipment rows planned, two separate shipped emails ---');
  {
    const order = { fulfillment_status: 'in_production' };
    const printifyOrder = {
      status: 'in-production',
      shipments: [
        { carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA' },
        { carrier: 'ups', number: 'TRACK-BBB', url: 'https://track/BBB' },
      ],
    };
    const plan = planShipmentReconciliation({ order, printifyOrder, existingShipments: [], hasEmail: noEmailsSent() });
    ok('two shipments planned', plan.shipments.length === 2);
    ok('distinct keys', plan.shipments[0].key !== plan.shipments[1].key);
    ok('both plan a shipped email', plan.shipments.every((s) => s.sendShippedEmail === true));
  }

  console.log('\n--- Duplicate polling of the same state: no duplicate anything ---');
  {
    const order = { fulfillment_status: 'shipped' };
    const printifyOrder = { status: 'in-production', shipments: [{ carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA' }] };
    const existingShipments = [{ printify_shipment_id: 'TRACK-AAA', status: 'shipped' }];
    const hasEmail = (t) => t === 'shipped_TRACK-AAA';
    const plan1 = planShipmentReconciliation({ order, printifyOrder, existingShipments, hasEmail });
    const plan2 = planShipmentReconciliation({ order, printifyOrder, existingShipments, hasEmail });
    ok('first poll: no email (already claimed)', plan1.shipments[0].sendShippedEmail === false);
    ok('second poll: still no email', plan2.shipments[0].sendShippedEmail === false);
    ok('neither poll wants a new row', plan1.shipments[0].isNewRow === false && plan2.shipments[0].isNewRow === false);
  }

  console.log('\n--- Canceled Printify order: cancellation planned, one support alert ---');
  {
    const order = { fulfillment_status: 'submitted_to_printify' };
    const printifyOrder = { status: 'canceled', shipments: [] };
    const plan = planShipmentReconciliation({ order, printifyOrder, existingShipments: [], hasEmail: noEmailsSent() });
    ok('cancellation planned', plan.cancellation !== null);
    ok('sendAlert true', plan.cancellation.sendAlert === true);
    ok('has a non-empty reason', typeof plan.cancellation.reason === 'string' && plan.cancellation.reason.length > 0);
    ok('no shipments processed for a canceled order', plan.shipments.length === 0);
  }

  console.log('\n--- Repeated canceled polling: no duplicate alert, and no-op once D1 already reflects it ---');
  {
    const printifyOrder = { status: 'canceled', shipments: [] };
    // First poll: D1 not yet updated, alert not yet sent.
    const firstPoll = planShipmentReconciliation({ order: { fulfillment_status: 'submitted_to_printify' }, printifyOrder, existingShipments: [], hasEmail: noEmailsSent() });
    ok('first poll plans the alert', firstPoll.cancellation?.sendAlert === true);

    // Second poll: alert already claimed, but D1 fulfillment_status not
    // updated yet (e.g. a concurrent/retried run) — must not re-plan an alert.
    const secondPoll = planShipmentReconciliation({ order: { fulfillment_status: 'submitted_to_printify' }, printifyOrder, existingShipments: [], hasEmail: (t) => t === 'printify_canceled_alert' });
    ok('second poll: cancellation still detected but sendAlert false', secondPoll.cancellation !== null && secondPoll.cancellation.sendAlert === false);

    // Third poll: D1 already reflects the cancellation — fully no-op.
    const thirdPoll = planShipmentReconciliation({ order: { fulfillment_status: 'printify_canceled' }, printifyOrder, existingShipments: [], hasEmail: (t) => t === 'printify_canceled_alert' });
    ok('third poll: no cancellation action at all once D1 already reflects it', thirdPoll.cancellation === null);
  }

  console.log('\n--- No tracking yet: no shipment planned, no email ---');
  {
    const order = { fulfillment_status: 'in_production' };
    const printifyOrder = { status: 'in-production', shipments: [] };
    const plan = planShipmentReconciliation({ order, printifyOrder, existingShipments: [], hasEmail: noEmailsSent() });
    ok('no shipments planned', plan.shipments.length === 0);
    ok('no fulfillment status change', plan.newFulfillmentStatus === null);
    ok('no cancellation', plan.cancellation === null);
  }

  console.log('\n--- One of two shipments delivered: order not marked delivered yet ---');
  {
    const order = { fulfillment_status: 'shipped' };
    const printifyOrder = {
      status: 'partially-fulfilled',
      shipments: [
        { carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA', delivered_at: '2026-08-13T00:00:00Z' },
        { carrier: 'ups', number: 'TRACK-BBB', url: 'https://track/BBB' },
      ],
    };
    const existingShipments = [
      { printify_shipment_id: 'TRACK-AAA', status: 'shipped' },
      { printify_shipment_id: 'TRACK-BBB', status: 'shipped' },
    ];
    const plan = planShipmentReconciliation({ order, printifyOrder, existingShipments, hasEmail: (t) => t.startsWith('shipped_') });
    ok('AAA status = delivered', plan.shipments.find((s) => s.key === 'TRACK-AAA').status === 'delivered');
    ok('BBB status = shipped', plan.shipments.find((s) => s.key === 'TRACK-BBB').status === 'shipped');
    ok('markDelivered false — not all shipments delivered yet', plan.markDelivered === false);
    ok('sendDeliveredEmail false', plan.sendDeliveredEmail === false);
  }

  console.log('\n--- Both shipments delivered: order marked delivered, exactly one delivered email planned ---');
  {
    const order = { fulfillment_status: 'shipped' };
    const printifyOrder = {
      status: 'fulfilled',
      shipments: [
        { carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA', delivered_at: '2026-08-13T00:00:00Z' },
        { carrier: 'ups', number: 'TRACK-BBB', url: 'https://track/BBB', delivered_at: '2026-08-13T01:00:00Z' },
      ],
    };
    const existingShipments = [
      { printify_shipment_id: 'TRACK-AAA', status: 'shipped' },
      { printify_shipment_id: 'TRACK-BBB', status: 'shipped' },
    ];
    const plan = planShipmentReconciliation({ order, printifyOrder, existingShipments, hasEmail: (t) => t.startsWith('shipped_') });
    ok('markDelivered true', plan.markDelivered === true);
    ok('newFulfillmentStatus = delivered', plan.newFulfillmentStatus === 'delivered');
    ok('sendDeliveredEmail true', plan.sendDeliveredEmail === true);
  }

  console.log('\n--- Order already delivered in D1: repeated polling never re-plans delivery or re-sends the email ---');
  {
    const order = { fulfillment_status: 'delivered' };
    const printifyOrder = {
      status: 'fulfilled',
      shipments: [{ carrier: 'usps', number: 'TRACK-AAA', url: 'https://track/AAA', delivered_at: '2026-08-13T00:00:00Z' }],
    };
    const plan = planShipmentReconciliation({
      order, printifyOrder,
      existingShipments: [{ printify_shipment_id: 'TRACK-AAA', status: 'delivered' }],
      hasEmail: (t) => t === 'shipped_TRACK-AAA' || t === 'delivered',
    });
    ok('markDelivered false (already delivered)', plan.markDelivered === false);
    ok('newFulfillmentStatus null (nothing left to change)', plan.newFulfillmentStatus === null);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
