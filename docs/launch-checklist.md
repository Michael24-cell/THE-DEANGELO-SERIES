# The DeAngelo Series — Launch Checklist

## Backend & API (scaffold in place — wire before launch)

- [x] **Stripe Checkout session creation** — `functions/api/create-checkout-session.js` (Cloudflare Pages Function) at `POST /api/create-checkout-session`. Accepts only `{slug, size, quantity}` per line item plus an optional email; price/name/image always come from a server-side `CATALOG` — the browser's price is never trusted. Refuses to run unless `STRIPE_SECRET_KEY` starts with `sk_test_`. Redirects to `session.url`.
- [x] **Stripe success/cancel URLs** — Set in code to `https://thedeangeloseries.com/checkout-success.html?session_id={CHECKOUT_SESSION_ID}` and `https://thedeangeloseries.com/checkout-cancel.html` (via `SITE_URL`). No further Dashboard config needed for these.
- [x] **Stripe webhook endpoint created** — `functions/api/stripe-webhook.js` (Cloudflare Pages Function) deployed at `https://thedeangeloseries.com/api/stripe-webhook`. Verifies signature using Web Crypto API (raw HMAC-SHA256, no SDK), handles `checkout.session.completed`. Idempotency is now D1-backed (`processed_webhooks` table) instead of Cache-API-only. On a new event: re-fetches the session with line items expanded, records the order + order_items in D1, attempts Printify order creation, and sends the order-confirmed email only if that succeeds.
- [ ] **Register webhook in Stripe Dashboard** — Stripe Dashboard > Developers > Webhooks > Add endpoint. URL: `https://thedeangeloseries.com/api/stripe-webhook`. Event: `checkout.session.completed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. **If an endpoint/secret already exists from an earlier test, replace it with the new one and update the env var — do not reuse an old signing secret.**
- [ ] **Test webhook locally** — Install wrangler (`npm install -g wrangler`), run `wrangler pages dev . --compatibility-flag nodejs_compat`, then use Stripe CLI: `stripe listen --forward-to http://localhost:8788/api/stripe-webhook`.
- [ ] **Test webhook in test mode** — Trigger a test event from Stripe Dashboard > Webhooks > endpoint > Send test event. Confirm 200 response and correct logging in Cloudflare Pages Dashboard > Functions > Real-time Logs.
- [ ] **Enable Stripe Tax** — Set `STRIPE_TAX_ENABLED=true` only after registering/configuring Stripe Tax in Dashboard > Settings > Tax. Left off by default; `create-checkout-session.js` does not claim tax is being collected until this is done.
- [x] **Printify API client + order creation (code)** — `functions/_lib/printify.js` (`getShippingRates`, `createPrintifyOrder`, `sendPrintifyOrderToProduction`) and `functions/_lib/catalog.js` (trusted product/Printify-mapping data). Wired into `stripe-webhook.js`. `createPrintifyOrder` always sets `send_shipping_notification: false` (Resend owns customer email) and never calls send-to-production — that's a separate, unused-by-default function. **Not functionally usable yet: `PRINTIFY_API_TOKEN` is not configured in Cloudflare (confirmed via `wrangler pages secret list`), and no product in `catalog.js` has a real Printify product/variant ID.** Every attempt fails cleanly and is stored in `orders.fulfillment_error`.
- [x] **Printify shipping quote endpoint (code)** — `functions/api/printify-shipping-quote.js` at `POST /api/printify-shipping-quote`. **Not called by checkout.html** — the live checkout flow is unaffected by its existence. Returns 409 until Printify product mapping is complete (true for every product today).
- [x] **Printify webhook endpoint created** — `functions/api/printify-webhook.js` at `POST /api/printify-webhook`. Handles `order:sent-to-production`, `order:updated` (status `in-production` or `canceled`), `order:shipment:created`, `order:shipment:delivered` — event names and payload shapes confirmed directly against Printify's official docs (developers.printify.com > Events), not guessed. D1-backed idempotency, finds the order by `printify_order_id`, updates status/tracking, sends the matching email exactly once.
  - **Signature verification is REQUIRED and fails closed** — if `PRINTIFY_WEBHOOK_SECRET` is not set, the endpoint returns `503` on every request *before* the body is parsed. There is no "accept unverified" fallback.
  - **Shipment emails are per-package.** Printify's documented shipment payload has no shipment-ID field, so each shipment's carrier tracking number is used as its identity — the email claim key is `shipped_<trackingNumber>` (falling back to a deterministic carrier+SKUs+timestamp key on the rare payload with no tracking number). A second physical package on a split-shipment order now gets its own "shipped" email instead of silently being swallowed by the first package's claim.
  - **The delivered email stays order-level** — sent once, only after every known shipment on the order is `delivered` (`allShipmentsDelivered()`), never per-package.
  - **Cancellation reconciliation** — Printify has no dedicated cancellation webhook topic, but `order:updated`'s payload carries `data.status`, and `"canceled"` is a documented, real order-level status value. A `canceled` `order:updated` event sets `fulfillment_status = 'printify_canceled'`, records `fulfillment_error` from the payload (falling back to a clear default if Printify includes no reason), and sends a one-time internal alert to `SUPPORT_EMAIL` — never a customer-facing shipped/delivered email. This is a real, documented signal, not an invented event; no separate reconciliation-script cancellation path was needed.
  - Covered by persistent tests: `tests/printify-webhook.test.mjs` (run via `npm test`).
- [x] **Resend email helper** — `functions/_lib/resend.js`. Reads `RESEND_API_KEY`/`FROM_EMAIL` from `context.env`, uses `REPLY_TO_EMAIL` or `SUPPORT_EMAIL` as reply-to, never logs the key, never throws (always returns `{ok, ...}` so a failed send can't block or retry whatever triggered it). Supports an `Idempotency-Key` via `stableIdempotencyKey()` to collapse accidental duplicate sends.
- [x] **Order-status email templates, now wired** — `functions/_lib/email-templates.js`: `orderConfirmedTemplate` (stripe-webhook.js, gated on Printify order creation succeeding), `inProductionTemplate` / `shippedTemplate` / `deliveredTemplate` (printify-webhook.js). Exactly-once delivery per (order, email type) is enforced by the `email_events` table's unique constraint — see `functions/_lib/orders-db.js`.
- [x] **Contact form** — `functions/api/contact.js` at `POST /api/contact`, connected to contact.html. Validates all fields server-side, honeypot field for basic spam protection, per-IP rate limit (Cache API, 30s), sends the message to `SUPPORT_EMAIL` and then a short acknowledgment to the customer (only if the support copy sent successfully).

### Environment variables required
Set all of these in **Cloudflare Pages Dashboard > Settings > Environment Variables**.
Never commit values to git. See `.env.local.example` for reference.
```
STRIPE_SECRET_KEY=sk_test_...              # Stripe secret key — create-checkout-session.js refuses anything not sk_test_
STRIPE_WEBHOOK_SECRET=whsec_...            # From Stripe Dashboard > Webhooks > endpoint secret
STRIPE_PUBLISHABLE_KEY=pk_test_...         # Publishable key (browser-safe). Not read by any code yet — see .env.local.example
STRIPE_TAX_ENABLED=false                   # Set to "true" only once Stripe Tax is configured in the Dashboard
SITE_URL=https://thedeangeloseries.com     # Builds the checkout-success/checkout-cancel redirect URLs
PRINTIFY_API_TOKEN=                             # Printify account API token — NOT SET in Cloudflare as of 2026-07-25
PRINTIFY_SHOP_ID=                               # Printify shop ID (numeric) — IS set in Cloudflare
PRINTIFY_AUTO_SEND_TO_PRODUCTION=false          # Only gates sendPrintifyOrderToProduction(), which nothing calls automatically
PRINTIFY_SHIPPING_METHOD_ID=                    # Printify shipping profile ID — exact name, not PRINTIFY_SHIPPING_METHOD
PRINTIFY_WEBHOOK_SECRET=                        # /api/printify-webhook signature secret — no webhook registered yet, so unset
RESEND_API_KEY=                                 # Resend API key — read only by functions/_lib/resend.js, never logged
FROM_EMAIL=orders@thedeangeloseries.com          # Sender for all outgoing email
SUPPORT_EMAIL=support@thedeangeloseries.com       # Contact-form destination; default reply-to
REPLY_TO_EMAIL=                                 # Optional — overrides SUPPORT_EMAIL as reply-to
```

**Also found during this pass:** the Cloudflare Pages project has a secret named `STRIPE_PUBLISHABLE_SECRET`. No code reads that name — `create-checkout-session.js` doesn't read a publishable key at all (see `.env.local.example`), and if it ever does, it will read `STRIPE_PUBLISHABLE_KEY`. Left as-is; flagging rather than renaming, since a Cloudflare secret can't be renamed without being re-entered.

### Printify pre-launch
- [ ] **Confirm product IDs and variant IDs** — Do not hardcode until verified in Printify dashboard (Tee / Hoodie / Crewneck). Fill into `functions/_lib/catalog.js` (`printify.productId`, `printify.variantIdBySize`, `printify.sku`) — every Printify-facing Function reads from that one file, so nothing else needs to change once these are known.
- [ ] **Add `PRINTIFY_API_TOKEN` to Cloudflare** — currently absent; every Printify API call fails cleanly until this is set.
- [ ] **Confirm shipping profile** — Verify carrier, rates, and international availability match shipping-policy.html
- [ ] **Register `/api/printify-webhook` with Printify** — Printify Dashboard > Webhooks > Add endpoint. URL: `https://thedeangeloseries.com/api/printify-webhook`. Subscribe to `order:sent-to-production`, `order:updated`, `order:shipment:created`, `order:shipment:delivered`. Copy the signing secret into `PRINTIFY_WEBHOOK_SECRET`. (`PRINTIFY_WEBHOOK_SECRET` is confirmed absent from both Preview and Production as of this pass — until it's set, this endpoint 503s every request by design.)
- [ ] **Reconfirm the shipment-event payload against a real delivery** — field names (`carrier.code`/`carrier.tracking_number`/`carrier.tracking_url`, `skus`) now match Printify's documented payload exactly (confirmed directly against developers.printify.com, not guessed), but this still hasn't been checked against an actual live shipment webhook firing. Trigger a real test shipment once a webhook is registered and watch for the "Could not find carrier/tracking fields" warning in logs.
- [ ] **One already-observed real cancellation is not yet reconciled** — order `DS-GOOB2D2A` (Printify order `6a727ff46298fe830b05cd73`) flipped to `canceled` on Printify's side during earlier testing, before this webhook handling existed; D1 still shows its old `fulfillment_status`. The new `order:updated`/`canceled` handling only covers cancellations that happen *after* the webhook is registered — this one historic record needs a manual one-off D1 update (not built by this pass, since it wasn't asked for).
- [ ] **Test order flow in sandbox** — Place a test order end-to-end before going live

---

## Payment & Checkout

- [ ] **Stripe account setup** — Create/verify Stripe account at stripe.com
- [ ] **Stripe Tax** — Enable Stripe Tax for automatic US sales tax calculation, then set `STRIPE_TAX_ENABLED=true`
- [x] **Stripe Checkout integration** — checkout.html reads the real cart, calls `/api/create-checkout-session`, and redirects to Stripe's hosted Checkout page (test mode). No card fields exist on this page.
- [ ] **Shipping rates** — No `shipping_options` are set yet (Printify rates aren't confirmed) — Stripe collects the shipping *address* but does not currently charge for shipping. Add real rates before launch; do not add a $0 option (would render as "Free shipping").
- [ ] **Full checkout QA** — Test end-to-end purchase flow with a Stripe test card in test mode, then repeat in live mode before launch

## Domain & DNS

- [ ] **Purchase domain** — thedeangeloseries.com (or preferred)
- [ ] **Connect domain to Cloudflare Pages** — Add custom domain in Cloudflare Pages project settings
- [ ] **SSL certificate** — Auto-provisioned by Cloudflare on domain connect

## Business Email

- [ ] **Set up support@thedeangeloseries.com** — Google Workspace, Zoho, or similar
- [ ] **Test contact flow** — Verify email is reachable before launch

## Legal Entity & Policies

- [ ] **Confirm mailing address** — Replace `[MAILING ADDRESS — TBD]` in privacy-policy.html and terms.html
- [ ] **Confirm state of incorporation/operation** — Replace `[STATE — TBD]` in terms.html section 19
- [ ] **Final legal review** — Have an attorney review Terms, Privacy Policy, Refund Policy, and Shipping Policy before launch
- [ ] **Update "Last updated" dates** — Set to actual launch date on all policy pages

## Taxes & Seller's Permit

- [ ] **Seller's permit** — Obtain where required for your state
- [ ] **Sales tax nexus** — Confirm tax obligations in states where you have nexus
- [ ] **Stripe Tax configuration** — Map products to correct tax codes in Stripe dashboard

## Shipping & Fulfillment

- [ ] **Confirm fulfillment partner** — Finalize Printify setup (see Printify pre-launch above)
- [ ] **Connect fulfillment to orders** — Wire Stripe order webhooks to Printify API
- [ ] **Confirm production and delivery estimates** — Verify Printify production timing and carrier estimates before displaying them
- [ ] **International shipping** — Confirm which countries are supported and at what cost
- [ ] **Shipping rates and methods** — Configure verified Printify/Stripe Checkout shipping options; do not hardcode unconfirmed rates

## Product & Pricing

- [ ] **Confirm final prices** — Tee $64 ($68 in 2XL) / Hoodie $84 ($88 in 2XL) / Crewneck $84 ($88 in 2XL/3XL); verify margins after fulfillment cost
- [ ] **Confirm edition size** — Edition of 200 per piece
- [ ] **Inventory tracking** — Set up sold-out handling (hide add-to-cart or show waitlist when edition closes)
- [ ] **Size availability** — Confirm which sizes are available; update `is-disabled` in product.html

## Analytics & Tracking

- [ ] **Google Analytics or Plausible** — Add tracking before launch
- [ ] **Meta Pixel** — Add if running paid social ads
- [ ] **Update Privacy Policy** — Add analytics tool names once confirmed

## Pre-Launch QA

- [ ] **Test all pages on mobile** — iOS Safari, Android Chrome
- [ ] **Test cart flow** — Add to cart, view cart, proceed to checkout
- [ ] **Test all nav links** — No broken links or 404s (Archive → archive.html, Contact → contact.html now live)
- [ ] **Test search** — Verify search results on all pages
- [ ] **Test vote section** — All three pages (index, product, art)
- [ ] **Test policy pages** — shipping-policy.html, refund-policy.html, privacy-policy.html, terms.html
- [ ] **Test contact page** — submit a real message in production, confirm it arrives at `SUPPORT_EMAIL` and the customer receives an acknowledgment; email link works
- [ ] **OG image preview** — Test with opengraph.xyz or Twitter Card Validator
- [ ] **Favicon** — Confirm visible in browser tab and on mobile home screen

## Preview Test Results

- [x] **Controlled Preview checkout test (2026-08-05)** — Full flow exercised on `printify-test` Preview: Arhus, The Old Town — Tee (M / Black, qty 1) through Stripe test-mode Checkout, real webhook delivery, D1 persistence, Printify order creation, and a branded Resend confirmation email. Inspected without modifying data — findings:
  - Stripe: session `cs_test_a1XbB8Eym97nR6hd01DGjYx4y2AWyEW8JAyLRqQk7ycjyi34COGOoB2d2A`, payment `paid`, event `evt_1U0sRfFCbYKS1zC5MuFRcxcs` processed exactly once.
  - D1: order `6f705416-cc44-4141-8a34-737130790d3b` / `DS-GOOB2D2A`. Subtotal $64.00, shipping $0.00, tax $0.00, total $64.00. Correct product/variant/SKU (`6a3cab048606da46840fa2e7` / `118086` / M-Black).
  - Printify order `6a727ff46298fe830b05cd73` created once (no duplicates in the shop), correctly **not** sent to production.
  - Resend: `order_confirmed` sent exactly once, message ID `44063601-ea4c-4dde-b468-39ce4f9fe6f5`.
  - No duplicate webhook events, orders, Printify orders, or emails found on inspection.
  - **Open issues found, not yet resolved:**
    - No shipping was actually charged ($0 in D1) — checkout.html doesn't send `shippingOptionId` yet, so the $5.19 seen during the test was a display-only quote, not a real charge.
    - Printify order status has since changed to `canceled` with all cost fields zeroed, despite being observed as "On hold" with a $35.10 Printify cost during the test — cause not yet identified, needs investigation before launch.
    - The Printify order's `printify_connect.url` points to an unfamiliar domain (`trackorder.site`) — worth confirming this is expected Printify behavior before it's ever shown to a customer.
    - `migrations/0002_add_shipments_table.sql` is still not applied to remote D1 (`shipments` table doesn't exist there yet) — split-shipment tracking is non-functional until this is applied.
    - Success-redirect domain (Preview vs. production) not independently verified — needs confirmation of the actual browser address bar URL post-payment.

## Known Dev Notes

- Tweaks panel and all React CDN references removed from collection.html — no console 404s on production.
- Canonical URLs and OG image URLs use `https://thedeangeloseries.com` as placeholder — update to final domain.
- Checkout now creates real Stripe Checkout Sessions in **test mode only** (`create-checkout-session.js` hard-refuses any key that isn't `sk_test_...`). Do not switch to live keys until the full pre-launch checklist below is complete.
- checkout-success.html and checkout-cancel.html are Stripe redirect destinations — noindex, not linked from nav.
- Only Venezia tee/hoodie/crew are purchasable (defined in `functions/_lib/catalog.js`, mirroring the prices on product.html — moved out of `create-checkout-session.js` in this pass so every Printify-facing Function shares one source of truth). The 10 "In Development" pieces on collection.html have disabled Add-to-Collection buttons and cannot reach checkout.
- Contact form in contact.html posts to `/api/contact` and shows a real success/error notice based on the response.
- Cart data lives in browser `localStorage` (`deangelo_cart`) and is sent to `/api/create-checkout-session` only when the customer clicks "Continue to Payment" — the server re-derives price from `catalog.js` and ignores any price/name/image the browser sends.
- Cart items now carry a `slug` field so the server can validate them against `catalog.js`. Carts saved in a browser before this change won't have `slug` — checkout.html detects this and asks the customer to remove/re-add the item rather than guessing.
- Webhook idempotency (both Stripe and Printify) is now D1-backed via the `processed_webhooks` table (`INSERT OR IGNORE` on `(source, external_event_id)`) — durable, replaces the earlier Cache-API-only approach.
- Orders are now persisted to D1 (`orders`, `order_items`) by `stripe-webhook.js` on `checkout.session.completed`. Line items are read by re-fetching the Checkout Session from Stripe with `line_items` expanded (the webhook payload alone doesn't include them).
- Printify order creation is wired into `stripe-webhook.js` but cannot succeed yet — `PRINTIFY_API_TOKEN` isn't configured and no product has a real Printify variant ID in `catalog.js`. Orders sit at `fulfillment_status = 'awaiting_printify_setup'` until both are fixed. **There is no automatic backfill/retry** for orders stuck in that state — Stripe won't redeliver the webhook (this endpoint always returns 200), so once Printify is configured, orders already stuck there need a manual reconciliation step this pass does not build.
- The order-confirmed email is deliberately gated on Printify order creation succeeding — see the task's original safety requirement. In the current environment (no Printify token) this means **no order-confirmed emails send at all** until Printify is configured. This is intentional, not a bug.
- `shipping_options` are intentionally omitted from the Checkout Session by default (see Payment & Checkout above) — Stripe collects the shipping address but does not yet charge for shipping. `create-checkout-session.js` can accept an optional `shippingOptionId` that re-resolves a trusted amount via Printify, but checkout.html doesn't send one yet, so this is dormant.
- `automatic_tax` is gated behind `STRIPE_TAX_ENABLED` (default off) — no tax is collected until that's explicitly turned on after Stripe Tax is configured.
- Contact form rate limiting is per-IP via the Cache API (30s) — unrelated to webhook idempotency now that the latter is D1-backed; still fine for abuse deterrence at current scale.
- See `docs/commerce-architecture.md` for the intended Stripe → D1 → Printify → Resend flow and data gaps.
