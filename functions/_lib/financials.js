// Pure financial-calculation helpers — no D1, no fetch, no env. Shared by
// functions/_lib/orders-db.js (live webhooks) and scripts/reconcile-financials.mjs
// (a plain Node script, outside the Workers runtime) so the margin formula
// only lives in one place.
//
// All monetary values are integer cents throughout.

/**
 * estimated_margin_amount = subtotal_amount + shipping_amount
 *                           - stripe_fee_amount
 *                           - printify_product_cost - printify_shipping_cost - printify_tax_amount
 *
 * tax_amount (sales tax collected from the customer) is deliberately NOT
 * subtracted — it was never business revenue in the first place (it's a
 * pass-through liability owed to a tax authority), so it's tracked
 * separately and must not distort the margin figure.
 *
 * Returns null — never a partial/fabricated number — if any required cost
 * component isn't known yet. subtotal_amount/shipping_amount are NOT NULL
 * columns and always present once an order exists; the four cost fields are
 * genuinely nullable until Stripe/Printify report real figures.
 */
export function computeEstimatedMargin(order) {
  const { subtotal_amount, shipping_amount, stripe_fee_amount, printify_product_cost, printify_shipping_cost, printify_tax_amount } = order;

  if (
    subtotal_amount == null || shipping_amount == null ||
    stripe_fee_amount == null ||
    printify_product_cost == null || printify_shipping_cost == null || printify_tax_amount == null
  ) {
    return null;
  }

  return subtotal_amount + shipping_amount - stripe_fee_amount - printify_product_cost - printify_shipping_cost - printify_tax_amount;
}
