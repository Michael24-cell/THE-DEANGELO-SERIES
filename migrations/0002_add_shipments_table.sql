-- Migration number: 0002 	 2026-07-25T08:34:12.017Z
--
-- Additive only — no existing table is altered or dropped. Adds per-shipment
-- tracking so a split order (multiple packages) can be represented correctly
-- instead of overwriting orders.tracking_number with whichever shipment
-- event arrived last.
--
-- orders.carrier / orders.tracking_number / orders.tracking_url are left in
-- place unchanged (still updated with the most recent shipment, for
-- anything that only reads the single-shipment summary) — shipments is the
-- source of truth for "has everything actually been delivered."

CREATE TABLE shipments (
  id                    TEXT PRIMARY KEY,
  order_id              TEXT NOT NULL,
  printify_shipment_id  TEXT,
  carrier               TEXT,
  tracking_number       TEXT,
  tracking_url          TEXT,
  status                TEXT NOT NULL DEFAULT 'shipped', -- 'shipped' | 'delivered'
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders (id),
  UNIQUE (order_id, printify_shipment_id)
);

CREATE INDEX idx_shipments_order_id ON shipments (order_id);
