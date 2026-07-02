# The DeAngelo Series — Launch Checklist

## Backend & API (scaffold in place — wire before launch)

- [ ] **Stripe Checkout session creation** — Server endpoint `POST /api/checkout` creates a Stripe Checkout Session with line items from cart. Redirect customer to `session.url`.
- [ ] **Stripe success/cancel URLs** — Configure in Stripe Dashboard: success → `https://thedeangeloseries.com/checkout-success.html`, cancel → `https://thedeangeloseries.com/checkout-cancel.html`
- [ ] **Stripe webhook** — Endpoint `POST /api/stripe-webhook` verifies signature and handles `checkout.session.completed`. Triggers Printify order creation and sends order confirmation email.
- [ ] **Printify order creation** — On `checkout.session.completed`: call Printify `POST /v1/shops/{shop_id}/orders.json` with line items, variant IDs, shipping address. Store Printify order ID against Stripe session ID.
- [ ] **Printify tracking** — Poll or webhook Printify order status. On shipment, send tracking email to customer.
- [ ] **Order confirmed email** — Send via Resend on `checkout.session.completed`. Include order number, items, shipping address, estimated dispatch window (5–7 business days).
- [ ] **Order shipped email** — Send via Resend when Printify order status = `shipped`. Include carrier and tracking link.
- [ ] **Contact form** — Wire `POST /api/contact` in contact.html. Validate fields server-side, send email via Resend to `SUPPORT_EMAIL`. Rate-limit submissions.

### Environment variables required
```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PRINTIFY_API_TOKEN=
PRINTIFY_SHOP_ID=
RESEND_API_KEY=
FROM_EMAIL=orders@thedeangeloseries.com
SUPPORT_EMAIL=support@thedeangeloseries.com
NEXT_PUBLIC_SITE_URL=https://thedeangeloseries.com
```

### Printify pre-launch
- [ ] **Confirm product IDs and variant IDs** — Do not hardcode until verified in Printify dashboard (Tee / Hoodie / Crewneck)
- [ ] **Confirm shipping profile** — Verify carrier, rates, and international availability match shipping-policy.html
- [ ] **Test order flow in sandbox** — Place a test order end-to-end before going live

---

## Payment & Checkout

- [ ] **Stripe account setup** — Create/verify Stripe account at stripe.com
- [ ] **Stripe Tax** — Enable Stripe Tax for automatic US sales tax calculation
- [ ] **Stripe Checkout integration** — Replace scaffolded checkout.html with real Stripe Checkout session redirect
- [ ] **Full checkout QA** — Test end-to-end purchase flow with real card in test mode, then live mode

## Domain & DNS

- [ ] **Purchase domain** — thedeangeloseries.com (or preferred)
- [ ] **Connect domain to Vercel** — Add custom domain in Vercel project settings
- [ ] **SSL certificate** — Auto-provisioned by Vercel on domain connect

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
- [ ] **Confirm processing time** — Verify 5–7 business day production estimate with Printify
- [ ] **International shipping** — Confirm which countries are supported and at what cost
- [ ] **Express shipping pricing** — Set actual cost in Stripe Checkout shipping options

## Product & Pricing

- [ ] **Confirm final prices** — Tee $72 / Hoodie $88 / Crewneck $82 (verify margins after fulfillment cost)
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
- [ ] **Test contact page** — contact.html form intercepts submit correctly pre-launch; email link works
- [ ] **OG image preview** — Test with opengraph.xyz or Twitter Card Validator
- [ ] **Favicon** — Confirm visible in browser tab and on mobile home screen

## Known Dev Notes

- Tweaks panel and all React CDN references removed from collection.html — no console 404s on production.
- Canonical URLs and OG image URLs use `https://thedeangeloseries.com` as placeholder — update to final domain.
- Checkout is currently scaffolded (no real payment processing). Do not promote checkout until Stripe is live.
- checkout-success.html and checkout-cancel.html are Stripe redirect destinations — noindex, not linked from nav.
- Contact form in contact.html intercepts submit and shows direct email until `/api/contact` backend is wired.
