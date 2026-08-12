-- Migration number: 0003 	 2026-08-12T20:34:27.000Z
--
-- Additive only — no existing column in `orders` is altered or dropped, and
-- no other table is touched. Adds financial-ledger fields so real Stripe
-- fee/net and real Printify fulfillment-cost data can be captured per order,
-- plus a derived margin figure. All new columns are nullable: none of this
-- data exists at the moment an order is first recorded (Stripe's balance
-- transaction and Printify's cost calculation both settle asynchronously,
-- sometimes well after the order row is created), so NULL is the correct
-- "not known yet" state rather than a fabricated 0.
--
-- Monetary values are integer cents, consistent with every other amount
-- column in this schema (see migrations/0001). sales tax collected
-- (orders.tax_amount, already existing) is deliberately excluded from the
-- margin calculation — see functions/_lib/financials.js.

-- ── Stripe ────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN stripe_balance_transaction_id TEXT;
ALTER TABLE orders ADD COLUMN stripe_fee_amount             INTEGER;
ALTER TABLE orders ADD COLUMN stripe_net_amount              INTEGER;
ALTER TABLE orders ADD COLUMN paid_at                        TEXT;

-- ── Printify ──────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN printify_product_cost   INTEGER;
ALTER TABLE orders ADD COLUMN printify_shipping_cost  INTEGER;
ALTER TABLE orders ADD COLUMN printify_tax_amount     INTEGER;
ALTER TABLE orders ADD COLUMN printify_total_cost     INTEGER;

-- ── Business ──────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN estimated_margin_amount INTEGER;
ALTER TABLE orders ADD COLUMN financials_updated_at   TEXT;
