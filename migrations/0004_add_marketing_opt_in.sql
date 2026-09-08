-- Migration number: 0004 	 2026-09-08T00:00:00.000Z
--
-- Additive only — no existing column is altered or dropped. Adds a real,
-- per-order record of whether the customer actually consented to
-- "new release" marketing email, captured at the moment of checkout
-- (checkout.html's "Note me when new pieces are released" checkbox).
--
-- Before this: that checkbox existed in the UI but its state was never
-- read by any JS, never sent to the server, and never stored anywhere —
-- there was no way to know who had actually agreed to it. This column is
-- the source of truth going forward. NULL means "order predates this
-- migration / consent unknown" — never treat NULL as consent.
--
-- This migration only adds the storage. It does not add any code path
-- that sends marketing email — that's separate, future work (a way to
-- query opted-in customers, an unsubscribe mechanism, and the actual send
-- pipeline all still need to be built before any "new release" email is
-- sent to anyone).

ALTER TABLE orders ADD COLUMN marketing_opt_in INTEGER;
