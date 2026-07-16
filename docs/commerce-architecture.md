# The DeAngelo Series — Commerce Architecture

## Current state

The storefront is a static Cloudflare Pages site. Commerce is deliberately pre-launch.

- The cart is managed in `site-ui.js` and persisted in browser `localStorage` under `deangelo_cart`.
- Cart items currently preserve piece label, product name, selected size, unit price, image, presentation kind, and quantity.
- Cart items do **not** currently preserve a stable product slug, color/variant identifier, Printify product ID, or Printify variant ID.
- There are no customer-facing color options in the current product UI.
- Browser cart data is not available to Cloudflare Pages Functions until a future checkout request explicitly sends and validates it.
- `checkout.html` is a visual pre-launch scaffold. Its button does not submit an order, collect card data, or navigate to a success page.
- `functions/api/stripe-webhook.js` verifies Stripe webhook signatures and handles `checkout.session.completed` by logging selected session fields only.
- No Printify API request is implemented.
- No Resend integration is implemented.
- No Cloudflare D1 binding, orders table, or reviews table exists.
- `wrangler.toml` defines the Pages project and compatibility settings only; it has no D1 binding.

## Intended flow

Customer cart
→ validated server-side cart and shipping address/quote
→ Stripe Checkout Session
→ Stripe `checkout.session.completed` webhook
→ order saved in Cloudflare D1
→ Printify order created
→ order-confirmed email sent with Resend
→ Printify production status webhook or polling
→ production email
→ Printify shipment webhook or polling
→ shipped/tracking email
→ Printify delivered status
→ delivered email
→ optional verified review request

Payment confirmation must be the authority for fulfillment. Never create a Printify order from browser state alone.

## Future Cloudflare bindings and secrets

Set secrets in Cloudflare Pages settings; never commit values.

```text
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PRINTIFY_API_TOKEN=
PRINTIFY_SHOP_ID=
PRINTIFY_AUTO_SEND_TO_PRODUCTION=false
RESEND_API_KEY=
FROM_EMAIL=
SUPPORT_EMAIL=support@thedeangeloseries.com
SITE_URL=https://thedeangeloseries.com
```

Required D1 binding:

```text
DB
```

## Required data work before checkout

1. Define an authoritative server-side product catalog keyed by stable product slug and size/variant.
2. Map each sellable variant to verified Printify product and variant IDs.
3. Send only product slug, size, color/variant, and quantity from the browser; calculate authoritative prices server-side.
4. Create a Stripe Checkout Session in a new `POST /api/checkout` Pages Function.
5. Store an idempotent order record in D1 when Stripe confirms payment.
6. Create the Printify order only after payment confirmation and only once.
7. Add status handling and transactional email templates for confirmed, production, shipped, and delivered states.

## Future reviews

The product page currently displays an honest empty Reviews section. A real system requires:

- a Cloudflare D1 `reviews` table;
- a verified order/review token tied to a delivered order;
- a `pending` moderation status by default;
- public rendering of approved reviews only;
- a verified-purchase label derived from order data, never user input.

Public review submission must remain disabled until those controls exist.
