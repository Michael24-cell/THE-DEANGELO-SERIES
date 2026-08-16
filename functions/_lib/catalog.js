// Single source of truth for trusted product data — price, tax code, and the
// Printify product/variant mapping. Imported by every Function that needs to
// know what a product actually costs or how it maps to Printify; the browser
// is never trusted for any of this.
//
// Audited against product.html / collection.html / index.html on 2026-07-25 —
// all three prices agree everywhere on the site (no conflicting values found):
//   Venezia Tee       $64.00 base / $68.00 at 2XL
//   Venezia Hoodie     $84.00 base / $88.00 at 2XL
//   Venezia Crewneck   $84.00 base / $88.00 at 2XL, 3XL
//
// Printify mapping confirmed live via GET /v1/shops/26931439/products.json on
// 2026-07-31 and re-confirmed 2026-08-03 after the Printify product rename:
//   crew   -> "Venezia Crewneck"                       (unchanged)
//   hoodie -> "Three-Panel Fleece Hoodie"               (unchanged)
//   arhus-old-town-tee -> "Arhus, The Old Town - Tee"   (renamed in Printify
//     from "Anhor The Old Town Tee" — same product ID 6a3cab048606da46840fa2e7,
//     same print provider (74), same 5 enabled Black variant IDs/SKUs. This
//     is a DISTINCT product from Venezia Tee — it must never fulfill `tee`.)
// "Harbor The Old Town T-Shirt" also exists in the shop but has no site
// product/slug and is intentionally not mapped.
//
// `tee` (Venezia Tee) has NO confirmed Printify product as of this pass.
// It was incorrectly mapped to the Arhus Printify product in an earlier
// version of this file — that mapping has been removed. Until a real
// "Venezia Tee" product is created in Printify and its IDs are confirmed
// here, `tee` cannot be fulfilled and printify-shipping-quote /
// create-checkout-session will correctly refuse to quote/ship it (see
// hasCompletePrintifyMapping below). Do not reuse Arhus's or any other
// product's fulfillment mapping for `tee`.
//
// Only the Printify variants the owner confirmed as final are mapped below.
// The Three-Panel Fleece Hoodie also has enabled XS and 3XL variants in
// Printify that are NOT included here, because the site's own sizes/pricing
// (product.html, collection.html, index.html) only ever offered S-2XL for
// the hoodie and no upcharge price exists for a 3XL/XS tier — adding them
// would mean inventing a retail price, which is not this pass's job. Flag
// for the owner: if XS/3XL hoodie should be sellable, decide pricing first,
// then extend `sizes` and the price fields below together.

export const CATALOG = {
  tee: {
    name: 'Venezia — Tee',
    image: 'https://thedeangeloseries.com/Venezia-tee-m.png',
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    colors: ['White'], // Unconfirmed — no Printify product exists yet to verify against.
    basePrice: 6400,      // $64.00, in cents
    upchargePrice: 6800,  // $68.00, in cents
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000', // Stripe Tax: t-shirts / apparel (clothing)
    printify: null, // TODO: no confirmed Venezia Tee product in Printify — see module note above.
  },
  'arhus-old-town-tee': {
    name: 'Arhus, The Old Town — Tee',
    image: 'https://thedeangeloseries.com/Arhus%2C%20The%20Old%20Town.png',
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    colors: ['Black'],
    basePrice: 6400,      // $64.00, in cents — owner-confirmed to match Venezia Tee's price point.
    upchargePrice: 6800,  // $68.00, in cents
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000',
    printify: {
      productId: '6a3cab048606da46840fa2e7', // Arhus, The Old Town - Tee (Printify)
      printProviderId: 74,
      variantIdBySize: {
        S: 118085, M: 118086, L: 118087, XL: 118101, '2XL': 118088,
      },
      skuBySize: {
        S: '20895555733597642048',
        M: '39235731445219782269',
        L: '18678384786444998988',
        XL: '12952437285169431874',
        '2XL': '28928495237465759666',
      },
    },
  },
  'wind-sea-tee': {
    name: 'Wind & Sea — Tee',
    image: 'https://thedeangeloseries.com/wind%20%26%20sea%20tee%20model.png',
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    colors: ['Black'],
    basePrice: 6400,      // $64.00, in cents — same price point as the other tees.
    upchargePrice: 6800,  // $68.00, in cents
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000',
    // Printify mapping confirmed live via GET /v1/shops/26931439/products/6a7f8354a978846d7c006ce4.json
    // on 2026-08-14 — "Wind & Sea - Tee", blueprint 1723 / print provider 74 (same combo as Arhus),
    // 5 enabled variants, all color Black.
    printify: {
      productId: '6a7f8354a978846d7c006ce4',
      printProviderId: 74,
      variantIdBySize: {
        S: 118085, M: 118086, L: 118087, XL: 118101, '2XL': 118088,
      },
      skuBySize: {
        S: '20895972675934738799',
        M: '25208313305980061996',
        L: '21576473407719983403',
        XL: '48674827964003061184',
        '2XL': '10585811960067414411',
      },
    },
  },
  'waves-of-life-tee': {
    name: 'Waves of Life — Tee',
    image: 'https://thedeangeloseries.com/waves%20of%20life%20tee%20model.png',
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    colors: ['White'],
    basePrice: 6400,      // $64.00, in cents — same price point as the other tees.
    upchargePrice: 6800,  // $68.00, in cents
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000',
    // Printify mapping confirmed live via GET /v1/shops/26931439/products/6a7f88d72355b5d08f0a9e38.json
    // on 2026-08-14 — "Waves of Life - Tee", blueprint 1723 / print provider 74 (same combo as Arhus/
    // Wind & Sea), 5 enabled variants, all color White.
    printify: {
      productId: '6a7f88d72355b5d08f0a9e38',
      printProviderId: 74,
      variantIdBySize: {
        S: 118089, M: 118090, L: 118091, XL: 118107, '2XL': 118092,
      },
      skuBySize: {
        S: '23603245496908456030',
        M: '41975995912485104856',
        L: '15084851229969697539',
        XL: '16455006015073468463',
        '2XL': '33276854566387499697',
      },
    },
  },
  hoodie: {
    name: 'Venezia — Hoodie',
    image: 'https://thedeangeloseries.com/Venezia-Hoodie-m.png',
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    colors: ['White'],
    basePrice: 8400,
    upchargePrice: 8800,
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000',
    printify: {
      productId: '6a220095de5d2b9583031b16', // Three-Panel Fleece Hoodie
      printProviderId: 99,
      variantIdBySize: {
        S: 68051, M: 68052, L: 68053, XL: 68054, '2XL': 68055,
      },
      skuBySize: {
        S: '24650836604369219693',
        M: '11466811190940805896',
        L: '33043393534951849610',
        XL: '19825577858137957313',
        '2XL': '31314893818378716050',
      },
    },
  },
  crew: {
    name: 'Venezia — Crewneck',
    image: 'https://thedeangeloseries.com/Venezia-crew-m.png',
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    colors: ['White'],
    basePrice: 8400,
    upchargePrice: 8800,
    upchargeSizes: ['2XL', '3XL'],
    stripeTaxCode: 'txcd_30011000',
    printify: {
      productId: '6a3372e03f9ce13ae30dad09', // Venezia Crewneck
      printProviderId: 99,
      variantIdBySize: {
        S: 96919, M: 96920, L: 96921, XL: 96922, '2XL': 96923, '3XL': 102376,
      },
      skuBySize: {
        S: '56375788856496942500',
        M: '14371375033157219416',
        L: '17361719666430497266',
        XL: '30828551016315872979',
        '2XL': '30529974360931354039',
        '3XL': '21518862049329321690',
      },
    },
  },
};

export const MAX_LINE_ITEMS = 20;
export const MAX_QUANTITY = 10;

export class CatalogValidationError extends Error {}

/**
 * Validates a raw browser-submitted cart against CATALOG and returns a
 * trusted, server-priced line-item array. Throws CatalogValidationError on
 * any mismatch — never falls back to a browser-supplied value for anything
 * price-related.
 *
 * @param {unknown} items - raw `body.items` from a request
 * @returns {Array<{slug:string,size:string,color:string,quantity:number,unitAmount:number,currency:string,taxCode:string,name:string,image:string,printify:object}>}
 */
export function validateCartItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new CatalogValidationError('Your cart is empty.');
  }
  if (items.length > MAX_LINE_ITEMS) {
    throw new CatalogValidationError('Too many items in cart.');
  }

  return items.map((raw) => {
    const slug = String(raw?.slug || '');
    const size = String(raw?.size || '');

    const entry = CATALOG[slug];
    if (!entry) throw new CatalogValidationError(`Unknown product: "${slug}"`);

    // Color is optional from the browser — most pieces have exactly one
    // color today. If omitted, default to the product's sole catalog color.
    const color = String(raw?.color || entry.colors[0] || '');
    const quantity = Math.trunc(Number(raw?.quantity));

    if (!entry.sizes.includes(size)) {
      throw new CatalogValidationError(`"${size}" is not an available size for this piece.`);
    }
    if (!entry.colors.includes(color)) {
      throw new CatalogValidationError(`"${color}" is not an available color for this piece.`);
    }
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new CatalogValidationError(`Invalid quantity for "${slug}".`);
    }

    const unitAmount = entry.upchargeSizes.includes(size) ? entry.upchargePrice : entry.basePrice;

    return {
      slug,
      size,
      color,
      quantity,
      unitAmount,
      currency: entry.currency,
      taxCode: entry.stripeTaxCode,
      name: `${entry.name} (${size})`,
      image: entry.image,
      printify: {
        productId: entry.printify?.productId ?? null,
        printProviderId: entry.printify?.printProviderId ?? null,
        variantId: entry.printify?.variantIdBySize?.[size] ?? null,
        sku: entry.printify?.skuBySize?.[size] ?? null,
      },
    };
  });
}

/**
 * True only when every given cart item has a confirmed Printify product AND
 * variant ID. Used to refuse shipping quotes / order creation cleanly
 * instead of pretending Printify integration is complete.
 */
export function hasCompletePrintifyMapping(items) {
  return items.every((it) => it.printify?.productId && it.printify?.variantId);
}
