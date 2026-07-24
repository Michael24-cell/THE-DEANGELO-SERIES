-- Migration number: 0001 	 2026-07-24T22:04:17.731Z
--
-- Initial commerce schema for The DeAngelo Series.
-- Operational order tracking only — this migration does not activate live
-- checkout, create Printify orders, or send email. It just gives those
-- future integrations somewhere safe to write to.
--
-- Monetary amounts are stored as integer cents (never floating-point
-- dollars). Timestamps are stored as TEXT ISO-8601 strings (SQLite/D1 have
-- no native DATETIME type). Do NOT store card numbers, CVC values, full
-- Stripe secret data, API keys, or raw webhook payloads beyond what's
-- needed operationally — see safe_summary_json on status_events.

-- ── orders ──────────────────────────────────────────────────────────────────
CREATE TABLE orders (
  id                          TEXT PRIMARY KEY,
  public_order_number         TEXT NOT NULL UNIQUE,
  stripe_checkout_session_id  TEXT UNIQUE,
  stripe_payment_intent_id    TEXT,
  printify_order_id           TEXT UNIQUE,
  customer_email              TEXT NOT NULL,
  customer_name               TEXT,
  shipping_name               TEXT,
  shipping_address_line1      TEXT,
  shipping_address_line2      TEXT,
  shipping_city               TEXT,
  shipping_state               TEXT,
  shipping_postal_code        TEXT,
  shipping_country            TEXT,
  currency                    TEXT NOT NULL DEFAULT 'usd',
  subtotal_amount             INTEGER NOT NULL,
  shipping_amount             INTEGER NOT NULL DEFAULT 0,
  tax_amount                  INTEGER NOT NULL DEFAULT 0,
  total_amount                INTEGER NOT NULL,
  payment_status              TEXT NOT NULL,
  fulfillment_status          TEXT NOT NULL DEFAULT 'unfulfilled',
  production_status           TEXT,
  carrier                     TEXT,
  tracking_number             TEXT,
  tracking_url                TEXT,
  fulfillment_error           TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL
);

CREATE INDEX idx_orders_customer_email    ON orders (customer_email);
CREATE INDEX idx_orders_created_at        ON orders (created_at);
CREATE INDEX idx_orders_fulfillment_status ON orders (fulfillment_status);

-- ── order_items ─────────────────────────────────────────────────────────────
CREATE TABLE order_items (
  id                    TEXT PRIMARY KEY,
  order_id              TEXT NOT NULL,
  product_slug          TEXT NOT NULL,
  product_name          TEXT NOT NULL,
  size                  TEXT,
  color                 TEXT,
  quantity              INTEGER NOT NULL,
  unit_price            INTEGER NOT NULL,
  printify_product_id   TEXT,
  printify_variant_id   TEXT,
  sku                   TEXT,
  FOREIGN KEY (order_id) REFERENCES orders (id)
);

CREATE INDEX idx_order_items_order_id ON order_items (order_id);

-- ── processed_webhooks ───────────────────────────────────────────────────────
-- Idempotency ledger for inbound webhooks (Stripe, Printify, ...). Durable
-- replacement for the Cache-API best-effort dedup used before this migration.
CREATE TABLE processed_webhooks (
  source            TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type        TEXT,
  processed_at      TEXT NOT NULL,
  PRIMARY KEY (source, external_event_id)
);

-- ── status_events ────────────────────────────────────────────────────────────
-- Append-only audit trail of what happened to an order and why. Store only
-- what's operationally useful — never raw webhook bodies with full customer/
-- payment payloads.
CREATE TABLE status_events (
  id                TEXT PRIMARY KEY,
  order_id          TEXT,
  source            TEXT NOT NULL,
  external_event_id TEXT,
  event_type        TEXT NOT NULL,
  safe_summary_json TEXT,
  created_at        TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders (id)
);

CREATE INDEX idx_status_events_order_id ON status_events (order_id);

-- ── email_events ─────────────────────────────────────────────────────────────
-- One row per (order, email type) — the unique constraint is what prevents a
-- retried webhook delivery from sending "order confirmed" twice.
CREATE TABLE email_events (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL,
  email_type      TEXT NOT NULL,
  resend_email_id TEXT,
  status          TEXT NOT NULL,
  error_message   TEXT,
  sent_at         TEXT,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders (id),
  UNIQUE (order_id, email_type)
);

CREATE INDEX idx_email_events_order_id ON email_events (order_id);

-- ── reviews ──────────────────────────────────────────────────────────────────
CREATE TABLE reviews (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT,
  order_item_id      TEXT,
  product_slug       TEXT NOT NULL,
  rating             INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title              TEXT,
  body               TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  verified_purchase  INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'pending',
  created_at         TEXT NOT NULL,
  approved_at        TEXT,
  FOREIGN KEY (order_id) REFERENCES orders (id),
  FOREIGN KEY (order_item_id) REFERENCES order_items (id)
);

CREATE INDEX idx_reviews_product_slug_status ON reviews (product_slug, status);

-- ── review_tokens ────────────────────────────────────────────────────────────
-- One-time tokens mailed to customers so only verified, delivered orders can
-- submit a review. Store a hash of the token, never the token itself.
CREATE TABLE review_tokens (
  token_hash    TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL,
  order_item_id TEXT,
  expires_at    TEXT NOT NULL,
  used_at       TEXT,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders (id),
  FOREIGN KEY (order_item_id) REFERENCES order_items (id)
);
