// Minimal in-memory D1 mock covering exactly the query shapes used by
// functions/_lib/orders-db.js — enough for functional testing without a
// real Cloudflare Workers runtime. Used by every tests/*.test.mjs file.
export function createFakeD1() {
  const tables = {
    orders: [],
    order_items: [],
    processed_webhooks: [],
    status_events: [],
    email_events: [],
    shipments: [],
  };

  function prepare(sql) {
    return {
      bind(...args) {
        return {
          async run() {
            if (sql.startsWith('INSERT OR IGNORE INTO processed_webhooks')) {
              const [source, external_event_id, event_type, processed_at] = args;
              const exists = tables.processed_webhooks.some((r) => r.source === source && r.external_event_id === external_event_id);
              if (exists) return { meta: { changes: 0 } };
              tables.processed_webhooks.push({ source, external_event_id, event_type, processed_at });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('INSERT OR IGNORE INTO email_events')) {
              const [id, order_id, email_type, status, created_at] = args;
              const exists = tables.email_events.some((r) => r.order_id === order_id && r.email_type === email_type);
              if (exists) return { meta: { changes: 0 } };
              tables.email_events.push({ id, order_id, email_type, status, created_at, resend_email_id: null, error_message: null, sent_at: null });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('UPDATE email_events')) {
              const [status, resend_email_id, error_message, sent_at, order_id, email_type] = args;
              const row = tables.email_events.find((r) => r.order_id === order_id && r.email_type === email_type);
              if (row) Object.assign(row, { status, resend_email_id, error_message, sent_at });
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.startsWith('INSERT INTO orders')) {
              const cols = ['id','public_order_number','stripe_checkout_session_id','stripe_payment_intent_id','customer_email','customer_name','shipping_name','shipping_address_line1','shipping_address_line2','shipping_city','shipping_state','shipping_postal_code','shipping_country','currency','subtotal_amount','shipping_amount','tax_amount','total_amount','payment_status','fulfillment_status','created_at','updated_at'];
              const row = Object.fromEntries(cols.map((c, i) => [c, args[i]]));
              row.printify_order_id = null; row.production_status = null; row.carrier = null; row.tracking_number = null; row.tracking_url = null; row.fulfillment_error = null;
              // migrations/0003_add_financial_ledger_fields.sql — all nullable, unset at insert.
              row.stripe_balance_transaction_id = null; row.stripe_fee_amount = null; row.stripe_net_amount = null; row.paid_at = null;
              row.printify_product_cost = null; row.printify_shipping_cost = null; row.printify_tax_amount = null; row.printify_total_cost = null;
              row.estimated_margin_amount = null; row.financials_updated_at = null;
              tables.orders.push(row);
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('INSERT INTO order_items')) {
              const cols = ['id','order_id','product_slug','product_name','size','color','quantity','unit_price','printify_product_id','printify_variant_id','sku'];
              tables.order_items.push(Object.fromEntries(cols.map((c, i) => [c, args[i]])));
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('INSERT INTO status_events')) {
              const cols = ['id','order_id','source','external_event_id','event_type','safe_summary_json','created_at'];
              tables.status_events.push(Object.fromEntries(cols.map((c, i) => [c, args[i]])));
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('UPDATE orders SET')) {
              const orderId = args[args.length - 1];
              const updatedAt = args[args.length - 2];
              const setPart = sql.match(/SET (.+) WHERE/)[1];
              const cols = setPart.split(',').map((s) => s.trim().split('=')[0].trim()).filter((c) => c !== 'updated_at');
              const row = tables.orders.find((r) => r.id === orderId);
              if (row) { cols.forEach((c, i) => { row[c] = args[i]; }); row.updated_at = updatedAt; }
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.startsWith('UPDATE shipments SET')) {
              const [carrier, tracking_number, tracking_url, status, updated_at, id] = args;
              const row = tables.shipments.find((r) => r.id === id);
              if (row) Object.assign(row, { carrier, tracking_number, tracking_url, status, updated_at });
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.startsWith('INSERT INTO shipments')) {
              const cols = ['id','order_id','printify_shipment_id','carrier','tracking_number','tracking_url','status','created_at','updated_at'];
              tables.shipments.push(Object.fromEntries(cols.map((c, i) => [c, args[i]])));
              return { meta: { changes: 1 } };
            }
            throw new Error('Unrecognized run() SQL: ' + sql.slice(0, 80));
          },
          async first() {
            if (sql.includes('FROM orders WHERE stripe_checkout_session_id')) {
              return tables.orders.find((r) => r.stripe_checkout_session_id === args[0]) || null;
            }
            if (sql.includes('FROM orders WHERE printify_order_id')) {
              return tables.orders.find((r) => r.printify_order_id === args[0]) || null;
            }
            if (sql.includes('FROM orders WHERE id')) {
              return tables.orders.find((r) => r.id === args[0]) || null;
            }
            if (sql.includes('FROM shipments WHERE order_id') && sql.includes('printify_shipment_id')) {
              const [order_id, printify_shipment_id] = args;
              return tables.shipments.find((r) => r.order_id === order_id && r.printify_shipment_id === printify_shipment_id) || null;
            }
            throw new Error('Unrecognized first() SQL: ' + sql.slice(0, 80));
          },
          async all() {
            if (sql.includes('FROM order_items WHERE order_id')) {
              return { results: tables.order_items.filter((r) => r.order_id === args[0]) };
            }
            if (sql.includes('FROM shipments WHERE order_id')) {
              return { results: tables.shipments.filter((r) => r.order_id === args[0]) };
            }
            throw new Error('Unrecognized all() SQL: ' + sql.slice(0, 80));
          },
        };
      },
    };
  }

  async function batch(stmts) {
    const results = [];
    for (const s of stmts) results.push(await s.run());
    return results;
  }

  return { prepare, batch, _tables: tables };
}
