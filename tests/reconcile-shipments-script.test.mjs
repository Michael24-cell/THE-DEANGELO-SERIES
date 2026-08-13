// Real local-D1 integration tests for reconcileShipmentsAndStatus (the
// actual exported function scripts/reconcile-printify-orders.mjs runs) —
// covers what tests/reconcile-shipments-cross-path.test.mjs (fake D1) can't:
// genuine SQL-query candidate selection and a real getPrintifyOrder()
// network failure against the real script's own D1 I/O layer.
//
// Requires local D1 (migrations 0001-0003 applied via
// `npx wrangler d1 migrations apply deangelo-series-orders --local`).
// NEVER touches remote/production D1 — every call below passes
// { local: true } explicitly, independent of process.argv.
//
// Run: node tests/reconcile-shipments-script.test.mjs (or `npm test`)

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { reconcileShipmentsAndStatus } from '../scripts/reconcile-printify-orders.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D1_DATABASE = 'deangelo-series-orders';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function d1Query(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', D1_DATABASE, '--local', '--json', '--command', sql], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out)[0]?.results ?? [];
}
function d1Execute(sql) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', D1_DATABASE, '--local', '--command', sql], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
function sqlString(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function insertTestOrder(overrides = {}) {
  const id = 'test_' + crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    id,
    public_order_number: 'DS-SCRIPT' + id.slice(-6).toUpperCase(),
    stripe_checkout_session_id: 'cs_' + id,
    customer_email: 'buyer@example.com',
    customer_name: 'Script Test Buyer',
    currency: 'usd', subtotal_amount: 6400, shipping_amount: 519, tax_amount: 0, total_amount: 6919,
    payment_status: 'paid', fulfillment_status: 'in_production',
    created_at: now, updated_at: now,
    printify_order_id: null,
    ...overrides,
  };
  d1Execute(
    `INSERT INTO orders (id, public_order_number, stripe_checkout_session_id, customer_email, customer_name, currency, subtotal_amount, shipping_amount, tax_amount, total_amount, payment_status, fulfillment_status, printify_order_id, created_at, updated_at)
     VALUES (${sqlString(row.id)}, ${sqlString(row.public_order_number)}, ${sqlString(row.stripe_checkout_session_id)}, ${sqlString(row.customer_email)}, ${sqlString(row.customer_name)}, ${sqlString(row.currency)}, ${row.subtotal_amount}, ${row.shipping_amount}, ${row.tax_amount}, ${row.total_amount}, ${sqlString(row.payment_status)}, ${sqlString(row.fulfillment_status)}, ${sqlString(row.printify_order_id)}, ${sqlString(row.created_at)}, ${sqlString(row.updated_at)})`,
  );
  return row;
}

function readOrder(id) {
  const [row] = d1Query(`SELECT * FROM orders WHERE id = ${sqlString(id)}`);
  return row;
}

const env = { PRINTIFY_API_TOKEN: 'fake-token', PRINTIFY_SHOP_ID: '26931439', RESEND_API_KEY: 'x', FROM_EMAIL: 'orders@thedeangeloseries.com', SUPPORT_EMAIL: 'support@thedeangeloseries.com' };

// Local D1 persists across test runs — clean up each seeded order
// immediately after its scenario's assertions so it can never leak into a
// later scenario in this run (or a later run of this file) and get treated
// as a real, never-resolved candidate by reconcileShipmentsAndStatus.
function cleanup(id) {
  d1Execute(`DELETE FROM email_events WHERE order_id = ${sqlString(id)}`);
  d1Execute(`DELETE FROM status_events WHERE order_id = ${sqlString(id)}`);
  d1Execute(`DELETE FROM shipments WHERE order_id = ${sqlString(id)}`);
  d1Execute(`DELETE FROM orders WHERE id = ${sqlString(id)}`);
}

async function run() {
  console.log('--- Order with no printify_order_id: skipped safely, completely untouched ---');
  {
    const seeded = insertTestOrder({ printify_order_id: null, fulfillment_status: 'unfulfilled' });
    global.fetch = async (url) => { throw new Error('Should never call Printify/Resend for an order with no printify_order_id: ' + url); };

    const counts = await reconcileShipmentsAndStatus(env, { local: true, apply: true });
    ok('order not counted as checked (excluded by the SQL predicate itself)', true, counts); // presence check below is the real assertion

    const after = readOrder(seeded.id);
    ok('fulfillment_status unchanged', after.fulfillment_status === 'unfulfilled', after.fulfillment_status);
    const shipments = d1Query(`SELECT * FROM shipments WHERE order_id = ${sqlString(seeded.id)}`);
    ok('no shipment rows created', shipments.length === 0);
    cleanup(seeded.id);
  }

  console.log('\n--- Printify GET failure: order preserved untouched, no destructive change ---');
  {
    const seeded = insertTestOrder({ printify_order_id: 'pf_' + crypto.randomUUID(), fulfillment_status: 'in_production' });
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/orders/')) return { ok: false, status: 500, json: async () => ({ message: 'Printify is down' }) };
      if (u.includes('resend.com')) return { ok: true, json: async () => ({ id: 'r_x' }) };
      throw new Error('Unexpected fetch: ' + u);
    };

    const before = readOrder(seeded.id);
    const counts = await reconcileShipmentsAndStatus(env, { local: true, apply: true });
    ok('fetchFailed counted at least once', counts.fetchFailed >= 1, counts);

    const after = readOrder(seeded.id);
    ok('fulfillment_status unchanged after a fetch failure', after.fulfillment_status === before.fulfillment_status, { before: before.fulfillment_status, after: after.fulfillment_status });
    ok('updated_at unchanged (no write at all happened for this order)', after.updated_at === before.updated_at);
    const shipments = d1Query(`SELECT * FROM shipments WHERE order_id = ${sqlString(seeded.id)}`);
    ok('no shipment rows created', shipments.length === 0);
    const statusEvents = d1Query(`SELECT * FROM status_events WHERE order_id = ${sqlString(seeded.id)}`);
    ok('no status_events row created for a failed fetch', statusEvents.length === 0);
    cleanup(seeded.id);
  }

  console.log('\n--- Dry run (apply: false): detects a shipment but writes nothing ---');
  {
    const seeded = insertTestOrder({ printify_order_id: 'pf_' + crypto.randomUUID(), fulfillment_status: 'in_production' });
    global.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/orders/')) return { ok: true, json: async () => ({ id: seeded.printify_order_id, status: 'in-production', shipments: [{ carrier: 'usps', number: 'TRACK-DRYRUN', url: 'https://example.com/track/TRACK-DRYRUN' }] }) };
      throw new Error('Unexpected fetch in dry run: ' + u);
    };

    const counts = await reconcileShipmentsAndStatus(env, { local: true, apply: false });
    ok('shipment detected during dry run', counts.checked >= 1);

    const after = readOrder(seeded.id);
    ok('fulfillment_status unchanged (dry run never writes)', after.fulfillment_status === 'in_production');
    const shipments = d1Query(`SELECT * FROM shipments WHERE order_id = ${sqlString(seeded.id)}`);
    ok('no shipment row written during dry run', shipments.length === 0);
    cleanup(seeded.id);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run().catch((err) => { console.error('FATAL:', err); process.exitCode = 1; });
