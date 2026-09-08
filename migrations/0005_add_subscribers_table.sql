-- Migration number: 0005 	 2026-09-08T00:00:00.000Z
--
-- Additive only — no existing table/column is altered or dropped.
--
-- Second half of the marketing-consent work started in migration 0004
-- (orders.marketing_opt_in). That column records consent per ORDER, which
-- is right for "what did this checkout say," but not enough on its own to
-- actually send anything: an email can appear on multiple orders with
-- different opt-in states, and there was no way to honor an unsubscribe
-- request without editing every one of that email's order rows.
--
-- `subscribers` is the single source of truth for "should we ever email
-- this address a release announcement" — one row per email, with a real
-- unsubscribe path:
--   email              — primary key, lowercased before insert (app-level,
--                         not enforced here — see upsertSubscriber())
--   subscribed         — 1 = ok to send, 0 = unsubscribed. Never deleted on
--                         unsubscribe, so a later re-checkout can't silently
--                         resurrect a subscription the token was already
--                         used to cancel without a fresh opt-in overwriting
--                         it (see upsertSubscriber()'s ON CONFLICT below).
--   unsubscribe_token  — opaque random token, stable for the row's lifetime
--                         (an upsert on an existing email never changes it).
--                         The unsubscribe link mailed to the customer embeds
--                         this, not the row's identity alone, so the link
--                         can't be guessed or reused for a different email.
--   source_order_id    — which order first created the row, for support/
--                         debugging only; never used for access control.
--
-- Populated by orders-db.js's upsertSubscriber(), called from
-- stripe-webhook.js only when that order's marketing_opt_in is true —
-- unchecking the box on a later order does NOT touch this table (silence
-- is not withdrawal of consent); only a real unsubscribe-link click does.

CREATE TABLE subscribers (
  email              TEXT PRIMARY KEY,
  subscribed         INTEGER NOT NULL DEFAULT 1,
  unsubscribe_token  TEXT NOT NULL UNIQUE,
  source_order_id    TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX idx_subscribers_subscribed ON subscribers (subscribed);
