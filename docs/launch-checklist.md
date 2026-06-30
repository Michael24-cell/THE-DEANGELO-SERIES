# The DeAngelo Series — Launch Checklist

## Payment & Checkout
- [ ] **Stripe account setup** — Create/verify Stripe account at stripe.com
- [ ] **Stripe Tax** — Enable Stripe Tax for automatic US sales tax calculation
- [ ] **Stripe Checkout integration** — Replace scaffolded checkout with real Stripe Checkout session
- [ ] **Set env vars** — `STRIPE_SECRET_KEY=`, `STRIPE_WEBHOOK_SECRET=`, `NEXT_PUBLIC_SITE_URL=`, `SUPPORT_EMAIL=`
- [ ] **Webhook endpoint** — Configure Stripe webhook for order confirmation emails
- [ ] **Full checkout QA** — Test end-to-end purchase flow with real card in test mode, then live mode

## Domain & DNS
- [ ] **Purchase domain** — thedeangeloseries.com (or preferred)
- [ ] **Connect domain to Vercel** — Add custom domain in Vercel project settings
- [ ] **Update canonical URLs** — Replace `https://www.thedeangeloseries.com` placeholder in all HTML meta tags and sitemap.xml with final domain
- [ ] **SSL certificate** — Auto-provisioned by Vercel on domain connect

## Business Email
- [ ] **Set up support@thedeangeloseries.com** — Google Workspace, Zoho, or similar
- [ ] **Test contact flow** — Verify email is reachable before launch

## Legal Entity & Policies
- [ ] **Confirm legal entity name** — Replace `[LEGAL ENTITY — TBD]` in privacy-policy.html and terms.html
- [ ] **Confirm state of incorporation/operation** — Replace `[STATE — TBD]` in terms.html section 19
- [ ] **Confirm mailing address** — Replace `[MAILING ADDRESS — TBD]` in privacy-policy.html and terms.html
- [ ] **Final legal review** — Have an attorney review Terms, Privacy Policy, Refund Policy, and Shipping Policy before launch
- [ ] **Update "Last updated" dates** — Set to actual launch date on all policy pages

## Taxes & Seller's Permit
- [ ] **Seller's permit** — Obtain where required for your state
- [ ] **Sales tax nexus** — Confirm tax obligations in states where you have nexus
- [ ] **Stripe Tax configuration** — Map products to correct tax codes in Stripe dashboard

## Shipping & Fulfillment
- [ ] **Confirm fulfillment partner** — Finalize Printify or alternative POD/fulfillment setup
- [ ] **Connect fulfillment to orders** — Wire Stripe order webhooks to fulfillment API
- [ ] **Confirm processing time** — Verify 5–7 business day production estimate with fulfillment partner
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
- [ ] **Test all nav links** — No broken links or 404s
- [ ] **Test search** — Verify search results on all pages
- [ ] **Test vote section** — All three pages (index, product, art)
- [ ] **Test policy pages** — shipping-policy.html, refund-policy.html, privacy-policy.html, terms.html
- [ ] **OG image preview** — Test with opengraph.xyz or Twitter Card Validator
- [ ] **Favicon** — Confirm visible in browser tab and on mobile home screen

## Known Dev Notes
- `tweaks-panel.jsx` is referenced in product.html but the file does not exist — causes a silent console 404. Remove the React/tweaks script block before launch if the panel is not needed.
- Canonical URLs and OG image URLs use `https://www.thedeangeloseries.com` as placeholder — update to final domain.
- Checkout is currently scaffolded (no real payment processing). Do not promote checkout until Stripe is live.
