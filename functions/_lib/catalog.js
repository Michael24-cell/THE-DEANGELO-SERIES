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
    // Multi-color product — imagesByColor overrides `image` above once a
    // color is known (see resolveProductImage / validateCartItems below).
    imagesByColor: {
      White: 'https://thedeangeloseries.com/waves%20of%20life%20tee%20model.png',
      Black: 'https://thedeangeloseries.com/waves%20of%20life%20black%20tee%20model.png',
    },
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    // White confirmed live 2026-08-14; Black added to the same Printify
    // product and confirmed live 2026-08-20 (GET /v1/shops/26931439/
    // products/6a7f88d72355b5d08f0a9e38.json — blueprint 1723 / print
    // provider 74, same combo as Arhus/Wind & Sea, 5 enabled variants per
    // color). Retail price is the same across colors even though Printify's
    // own per-color cost differs (White $45.25/$48.87 vs Black $38.99) —
    // that's their cost, not our price.
    colors: ['White', 'Black'],
    basePrice: 6400,      // $64.00, in cents — same price point as the other tees.
    upchargePrice: 6800,  // $68.00, in cents
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000',
    // Multi-color products nest their Printify mapping by color instead of
    // the flat {productId, printProviderId, variantIdBySize, skuBySize}
    // shape single-color products use — see printifyMappingForColor below,
    // which is the only place that should ever read this field directly.
    printify: {
      White: {
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
      Black: {
        productId: '6a7f88d72355b5d08f0a9e38',
        printProviderId: 74,
        variantIdBySize: {
          S: 118085, M: 118086, L: 118087, XL: 118101, '2XL': 118088,
        },
        skuBySize: {
          S: '19821456836916548590',
          M: '23315823194948060038',
          L: '28866163467856211923',
          XL: '52974902146094064874',
          '2XL': '33711648017503044966',
        },
      },
    },
  },
  'villa-d-este-tee': {
    name: 'Villa d\'Este — Tee',
    image: 'https://thedeangeloseries.com/villa-d-este%20model.png',
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    colors: ['Black'],
    basePrice: 6400,      // $64.00, in cents — same price point as the other tees.
    upchargePrice: 6800,  // $68.00, in cents
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000',
    // Printify mapping confirmed live via GET /v1/shops/26931439/products/6a84ed5884a138c30d0b62d9.json
    // on 2026-08-19 — "Villa d'Este - Tee", blueprint 1723 / print provider 74 (same combo as Arhus/
    // Wind & Sea/Waves of Life), 5 enabled variants, all color Black.
    printify: {
      productId: '6a84ed5884a138c30d0b62d9',
      printProviderId: 74,
      variantIdBySize: {
        S: 118085, M: 118086, L: 118087, XL: 118101, '2XL': 118088,
      },
      skuBySize: {
        S: '70289775690599812972',
        M: '15936825846157070580',
        L: '46005705100070495334',
        XL: '28508995031255357778',
        '2XL': '30608025617507758941',
      },
    },
  },
  'the-wedge-tee': {
    name: 'The Wedge — Tee',
    image: 'https://thedeangeloseries.com/the%20wedge%20tee%20model.png',
    // Only White has been photographed — Cream/Oatmeal reuse the White
    // shots until real photography exists for them (owner-confirmed
    // 2026-08-20: ship the color options now rather than wait).
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    colors: ['White', 'Cream', 'Oatmeal'],
    basePrice: 6400,      // $64.00, in cents — same price point as the other tees.
    upchargePrice: 6800,  // $68.00, in cents
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000',
    // Printify mapping confirmed live via GET /v1/shops/26931439/products/6a84edc80a842ed2ac036bb4.json
    // on 2026-08-20 — "The Wedge - Tee", blueprint 1723 / print provider 74 (same combo as the other
    // standalone tees), 15 enabled variants across White/Cream/Oatmeal.
    printify: {
      White: {
        productId: '6a84edc80a842ed2ac036bb4',
        printProviderId: 74,
        variantIdBySize: {
          S: 118089, M: 118090, L: 118091, XL: 118107, '2XL': 118092,
        },
        skuBySize: {
          S: '28862787019529189822',
          M: '12505029720861974964',
          L: '16788989969971939608',
          XL: '12844102174900449847',
          '2XL': '37336938863912718746',
        },
      },
      Cream: {
        productId: '6a84edc80a842ed2ac036bb4',
        printProviderId: 74,
        variantIdBySize: {
          S: 118073, M: 118074, L: 118075, XL: 118102, '2XL': 118076,
        },
        skuBySize: {
          S: '15239488764793931958',
          M: '14645138535348381854',
          L: '23471051185727195177',
          XL: '16761904448755901740',
          '2XL': '48525324841094607766',
        },
      },
      Oatmeal: {
        productId: '6a84edc80a842ed2ac036bb4',
        printProviderId: 74,
        variantIdBySize: {
          S: 118093, M: 118094, L: 118095, XL: 118104, '2XL': 118096,
        },
        skuBySize: {
          S: '21212870796519566042',
          M: '52833008129709611525',
          L: '20774673857276961695',
          XL: '33002605360509794675',
          '2XL': '11231503631478486755',
        },
      },
    },
  },
  'leaning-tower-of-pisa-tee': {
    name: 'Leaning Tower of Pisa — Tee',
    image: 'https://thedeangeloseries.com/leaningtowerofpisa%20tee%20model.png',
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    colors: ['White'],
    basePrice: 6400,      // $64.00, in cents — same price point as the other tees.
    upchargePrice: 6800,  // $68.00, in cents
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000',
    // Printify mapping confirmed live via GET /v1/shops/26931439/products/6a84f0832ec1f62af907f477.json
    // on 2026-08-20 — "Leaning Tower of Pisa - Tee", blueprint 1723 / print provider 74 (same combo as
    // the other standalone tees), 5 enabled variants, all color White.
    printify: {
      productId: '6a84f0832ec1f62af907f477',
      printProviderId: 74,
      variantIdBySize: {
        S: 118089, M: 118090, L: 118091, XL: 118107, '2XL': 118092,
      },
      skuBySize: {
        S: '96938111770832728623',
        M: '16445589811388208089',
        L: '33381954687747664874',
        XL: '67728606598756711522',
        '2XL': '14920260224841091260',
      },
    },
  },
  'piazza-san-marco-tee': {
    name: 'Piazza San Marco — Tee',
    image: 'https://thedeangeloseries.com/piazza%20san%20marco%20tee%20model.png',
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    colors: ['White'],
    basePrice: 6400,      // $64.00, in cents — same price point as the other tees.
    upchargePrice: 6800,  // $68.00, in cents
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000',
    // Printify mapping confirmed live via GET /v1/shops/26931439/products/6a84eed38d4f77c3ad0ef7ba.json
    // on 2026-08-20 — "Piazza San Marco - Tee", blueprint 1723 / print provider 74 (same combo as the
    // other standalone tees), 5 enabled variants, all color White.
    printify: {
      productId: '6a84eed38d4f77c3ad0ef7ba',
      printProviderId: 74,
      variantIdBySize: {
        S: 118089, M: 118090, L: 118091, XL: 118107, '2XL': 118092,
      },
      skuBySize: {
        S: '68992081454908110121',
        M: '20508543726030943148',
        L: '17842860172418347845',
        XL: '21502439819348045236',
        '2XL': '81966954140395495218',
      },
    },
  },
  'palatine-hill-tee': {
    name: 'Palatine Hill — Tee',
    image: 'https://thedeangeloseries.com/palatine%20hill%20tee%20model.png',
    // Only White has been photographed — Cream/Oatmeal reuse the White
    // shots until real photography exists for them (owner-confirmed
    // 2026-08-20: ship the color options now rather than wait).
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    colors: ['White', 'Cream', 'Oatmeal'],
    basePrice: 6400,      // $64.00, in cents — same price point as the other tees.
    upchargePrice: 6800,  // $68.00, in cents
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000',
    // Printify mapping confirmed live via GET /v1/shops/26931439/products/6a84ebad37f7a6e6be0a3bea.json
    // on 2026-08-20 — "Palatine Hill - Tee", blueprint 1723 / print provider 74 (same combo as the
    // other standalone tees), 15 enabled variants across White/Cream/Oatmeal.
    printify: {
      White: {
        productId: '6a84ebad37f7a6e6be0a3bea',
        printProviderId: 74,
        variantIdBySize: {
          S: 118089, M: 118090, L: 118091, XL: 118107, '2XL': 118092,
        },
        skuBySize: {
          S: '49166606672086455834',
          M: '52243808950929545046',
          L: '23560874620854043348',
          XL: '14791496092507724798',
          '2XL': '60022683906889134729',
        },
      },
      Cream: {
        productId: '6a84ebad37f7a6e6be0a3bea',
        printProviderId: 74,
        variantIdBySize: {
          S: 118073, M: 118074, L: 118075, XL: 118102, '2XL': 118076,
        },
        skuBySize: {
          S: '29180879776838017304',
          M: '11061512022182086736',
          L: '24830213220491960379',
          XL: '12240763506582701511',
          '2XL': '10549320780882568811',
        },
      },
      Oatmeal: {
        productId: '6a84ebad37f7a6e6be0a3bea',
        printProviderId: 74,
        variantIdBySize: {
          S: 118093, M: 118094, L: 118095, XL: 118104, '2XL': 118096,
        },
        skuBySize: {
          S: '32337420082912964972',
          M: '98865350102826132750',
          L: '19817816389124008058',
          XL: '12588524884107444918',
          '2XL': '55855557068785116130',
        },
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
    // The Printify product this used to map to ("Three-Panel Fleece
    // Hoodie", 6a220095de5d2b9583031b16) was deleted from Printify —
    // confirmed 404 via GET /v1/shops/26931439/products/
    // 6a220095de5d2b9583031b16.json on 2026-08-20. hasCompletePrintifyMapping
    // now correctly refuses to quote/ship this product (matches `tee`'s
    // existing unmapped state below) until it's relinked to a real
    // Printify product and re-confirmed. Do not restore the old IDs
    // below without re-verifying them live — they may no longer exist.
    // Last known mapping, for reference only:
    //   printProviderId: 99, variantIdBySize: { S:68051, M:68052, L:68053, XL:68054, '2XL':68055 }
    printify: null,
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
 * Returns the {productId, printProviderId, variantIdBySize, skuBySize}
 * Printify mapping for a given catalog entry + color. Single-color products
 * keep the flat shape (entry.printify itself); multi-color products nest
 * that same shape per color (entry.printify[color]) — this is the one place
 * that distinction should be handled, so callers never need to know which
 * shape a given product uses.
 */
export function printifyMappingForColor(entry, color) {
  if (!entry?.printify) return undefined;
  return entry.colors.length > 1 ? entry.printify[color] : entry.printify;
}

/**
 * Returns the product image to show for a given catalog entry + color —
 * imagesByColor[color] for multi-color products, falling back to the
 * product's single `image` for everything else.
 */
export function resolveProductImage(entry, color) {
  return entry?.imagesByColor?.[color] ?? entry?.image;
}

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
    const printifyMap = printifyMappingForColor(entry, color);

    return {
      slug,
      size,
      color,
      quantity,
      unitAmount,
      currency: entry.currency,
      taxCode: entry.stripeTaxCode,
      name: `${entry.name} (${size})`,
      image: resolveProductImage(entry, color),
      printify: {
        productId: printifyMap?.productId ?? null,
        printProviderId: printifyMap?.printProviderId ?? null,
        variantId: printifyMap?.variantIdBySize?.[size] ?? null,
        sku: printifyMap?.skuBySize?.[size] ?? null,
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
