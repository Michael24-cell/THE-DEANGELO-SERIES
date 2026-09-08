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
//   crew   -> "Venezia Crewneck"                       (superseded 2026-09-08,
//     see `crew` below — owner switched to a different crew blank)
//   hoodie -> "Three-Panel Fleece Hoodie"               (unchanged)
//   arhus-old-town-tee -> "Arhus, The Old Town - Tee"   (renamed in Printify
//     from "Anhor The Old Town Tee" — same product ID 6a3cab048606da46840fa2e7,
//     same print provider (74), same 5 enabled Black variant IDs/SKUs. This
//     is a DISTINCT product from Venezia Tee — it must never fulfill `tee`.)
// "Harbor The Old Town T-Shirt" also exists in the shop but has no site
// product/slug and is intentionally not mapped.
//
// `tee` (Venezia Tee) was incorrectly mapped to the Arhus Printify product
// in an earlier version of this file, then went unmapped entirely once that
// was caught — it briefly could not be fulfilled at all (hoodie is
// currently in that same unmapped state; see below). A real "Venezia Tee"
// product now exists in Printify (White + Black) — confirmed live via
// GET /v1/shops/26931439/products/6a9e5512d4f10211ae0c5568.json on
// 2026-09-08, blueprint 1723 / print provider 99 — a different provider
// from the standalone artwork tees' 74, and (as of the same day) from
// `crew`'s new blank on provider 217 too. Do not reuse Arhus's or any
// other product's fulfillment mapping for `tee` going forward.
//
// Only the Printify variants the owner confirmed as final are mapped below.
// The Three-Panel Fleece Hoodie also has enabled XS and 3XL variants in
// Printify that are NOT included here, because the site's own sizes/pricing
// (product.html, collection.html, index.html) only ever offered S-2XL for
// the hoodie and no upcharge price exists for a 3XL/XS tier — adding them
// would mean inventing a retail price, which is not this pass's job. Flag
// for the owner: if XS/3XL hoodie should be sellable, decide pricing first,
// then extend `sizes` and the price fields below together.
//
// 2026-09-08: owner added four more crewnecks in Printify, all on the same
// blank as the new `crew` (blueprint 6992 / print provider 217, confirmed
// live per-product below). `waves-of-life-crew`, `villa-d-este-crew`, and
// `palatine-hill-crew` are mapped using the $84/$88 crew price point (no
// separate pricing decision communicated, so it follows the one established
// crew price like every new tee has followed the established tee price).
// `wind-sea-crew` is NOT mapped — its Printify product only has Black/Army
// enabled, but the one photo provided isn't labeled by color and has no
// model shot; flagged for the owner rather than guessed at.

export const CATALOG = {
  tee: {
    name: 'Venezia — Tee',
    image: 'https://thedeangeloseries.com/venezia%20tee%20white%20model.png',
    // Multi-color product — imagesByColor overrides `image` above once a
    // color is known (see resolveProductImage / validateCartItems below).
    imagesByColor: {
      White: 'https://thedeangeloseries.com/venezia%20tee%20white%20model.png',
      Black: 'https://thedeangeloseries.com/venezia%20tee%20black%20model.png',
    },
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    colors: ['White', 'Black'],
    basePrice: 6400,      // $64.00, in cents
    upchargePrice: 6800,  // $68.00, in cents
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000', // Stripe Tax: t-shirts / apparel (clothing)
    // Printify mapping confirmed live via GET /v1/shops/26931439/products/
    // 6a9e5512d4f10211ae0c5568.json on 2026-09-08 — "Venezia - Tee",
    // blueprint 1723 / print provider 99, 10 enabled variants across
    // White/Black.
    printify: {
      White: {
        productId: '6a9e5512d4f10211ae0c5568',
        printProviderId: 99,
        variantIdBySize: {
          S: 118089, M: 118090, L: 118091, XL: 118107, '2XL': 118092,
        },
        skuBySize: {
          S: '71663963689614523189',
          M: '48331297202852878124',
          L: '24605492024500342873',
          XL: '29434223566593684662',
          '2XL': '25891756247833900082',
        },
      },
      Black: {
        productId: '6a9e5512d4f10211ae0c5568',
        printProviderId: 99,
        variantIdBySize: {
          S: 118085, M: 118086, L: 118087, XL: 118101, '2XL': 118088,
        },
        skuBySize: {
          S: '77682723245001045554',
          M: '33054355010774183968',
          L: '11321249902396843074',
          XL: '13216717713662294153',
          '2XL': '19650998568129984277',
        },
      },
    },
  },
  'arhus-old-town-tee': {
    name: 'Århus, The Old Town — Tee',
    image: 'https://thedeangeloseries.com/the%20old%20town%20model.png',
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
  'ostia-antica-tee': {
    name: 'Ostia Antica — Tee',
    image: 'https://thedeangeloseries.com/ostia%20antica%20tee%20model.png',
    // Only White has been photographed — Cream reuses the White shots
    // until real photography exists for it, same pattern as The Wedge/
    // Palatine Hill.
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL'],
    colors: ['White', 'Cream'],
    basePrice: 6400,      // $64.00, in cents — same price point as the other tees.
    upchargePrice: 6800,  // $68.00, in cents
    upchargeSizes: ['2XL'],
    stripeTaxCode: 'txcd_30011000',
    // Printify mapping confirmed live via GET /v1/shops/26931439/products/6a872f9bd45e50fc2506b101.json
    // on 2026-09-06 — "Ostia Antica - Tee", blueprint 1723 / print provider 74 (same combo as the
    // other standalone tees), 10 enabled variants across White/Cream.
    printify: {
      White: {
        productId: '6a872f9bd45e50fc2506b101',
        printProviderId: 74,
        variantIdBySize: {
          S: 118089, M: 118090, L: 118091, XL: 118107, '2XL': 118092,
        },
        skuBySize: {
          S: '27625534152527550068',
          M: '16257516992909733032',
          L: '14001630753020042294',
          XL: '18863662322991678382',
          '2XL': '18973477193390954442',
        },
      },
      Cream: {
        productId: '6a872f9bd45e50fc2506b101',
        printProviderId: 74,
        variantIdBySize: {
          S: 118073, M: 118074, L: 118075, XL: 118102, '2XL': 118076,
        },
        skuBySize: {
          S: '14166584459876716556',
          M: '22260161100351253938',
          L: '25375397969174636881',
          XL: '10146664744610624373',
          '2XL': '22160285195618227382',
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
    image: 'https://thedeangeloseries.com/venezia%20crew%20model%20front.png',
    // Multi-color product — imagesByColor overrides `image` above once a
    // color is known (see resolveProductImage / validateCartItems below).
    imagesByColor: {
      White: 'https://thedeangeloseries.com/venezia%20crew%20model%20front.png',
      Black: 'https://thedeangeloseries.com/venezia%20black%20crew%20model.png',
    },
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    // Owner switched to a different crew blank in Printify — a new "Venezia
    // - Crew" product (6a9fe5355f7ad524a40565b1, blueprint 6992, print
    // provider 217), confirmed live via GET /v1/shops/26931439/products/
    // 6a9fe5355f7ad524a40565b1.json on 2026-09-08. This replaces the old
    // "Venezia Crewneck" product (6a3372e03f9ce13ae30dad09, blueprint 1296,
    // provider 99) below for fulfillment going forward; the old product is
    // still live in Printify but should no longer be used for new orders.
    // Black photography arrived 2026-09-08 too, so Black is now sellable
    // alongside White.
    colors: ['White', 'Black'],
    basePrice: 8400,
    upchargePrice: 8800,
    upchargeSizes: ['2XL', '3XL'],
    stripeTaxCode: 'txcd_30011000',
    printify: {
      White: {
        productId: '6a9fe5355f7ad524a40565b1', // Venezia - Crew (new blank)
        printProviderId: 217,
        variantIdBySize: {
          S: 302521, M: 302513, L: 302520, XL: 302515, '2XL': 302523, '3XL': 302524,
        },
        skuBySize: {
          S: '91012257067515697560',
          M: '25757851784377805035',
          L: '32726095027082297765',
          XL: '32107334401092782977',
          '2XL': '13170274534679742688',
          '3XL': '29660179369702066481',
        },
      },
      Black: {
        productId: '6a9fe5355f7ad524a40565b1',
        printProviderId: 217,
        variantIdBySize: {
          S: 302545, M: 302531, L: 302589, XL: 302574, '2XL': 302567, '3XL': 302591,
        },
        skuBySize: {
          S: '30182333857985978858',
          M: '88905436260879305175',
          L: '17141653211059328898',
          XL: '32631943490500188808',
          '2XL': '28218533546371128973',
          '3XL': '46653753990831510091',
        },
      },
    },
  },
  // The following three crewnecks share their artwork with an existing tee
  // but are new, separate Printify products on the same blank as `crew`
  // (blueprint 6992 / print provider 217) — confirmed live via GET
  // /v1/shops/26931439/products/<id>.json on 2026-09-08.
  'waves-of-life-crew': {
    name: 'Waves of Life — Crewneck',
    image: 'https://thedeangeloseries.com/waves%20of%20life%20white%20crew%20model.png',
    imagesByColor: {
      White: 'https://thedeangeloseries.com/waves%20of%20life%20white%20crew%20model.png',
      Black: 'https://thedeangeloseries.com/waves%20of%20life%20black%20crew%20model.png',
    },
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    colors: ['White', 'Black'],
    basePrice: 8400,
    upchargePrice: 8800,
    upchargeSizes: ['2XL', '3XL'],
    stripeTaxCode: 'txcd_30011000',
    printify: {
      White: {
        productId: '6a9fe605bc34f118ec0c0dcf', // Waves of Life - Crew
        printProviderId: 217,
        variantIdBySize: {
          S: 302521, M: 302513, L: 302520, XL: 302515, '2XL': 302523, '3XL': 302524,
        },
        skuBySize: {
          S: '29119757201151975291',
          M: '57692161196383247295',
          L: '15464678002865028802',
          XL: '44180192412178348671',
          '2XL': '29242422410352700449',
          '3XL': '22687787694258549930',
        },
      },
      Black: {
        productId: '6a9fe605bc34f118ec0c0dcf',
        printProviderId: 217,
        variantIdBySize: {
          S: 302545, M: 302531, L: 302589, XL: 302574, '2XL': 302567, '3XL': 302591,
        },
        skuBySize: {
          S: '22736343838288129172',
          M: '37699821672057282530',
          L: '21024423051152749955',
          XL: '28862464186417954905',
          '2XL': '26396439374364675711',
          '3XL': '32017588879662978040',
        },
      },
    },
  },
  'villa-d-este-crew': {
    name: 'Villa d\'Este — Crewneck',
    image: 'https://thedeangeloseries.com/villa%20de%20este%20crew%20model.png',
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    colors: ['Black'],
    basePrice: 8400,
    upchargePrice: 8800,
    upchargeSizes: ['2XL', '3XL'],
    stripeTaxCode: 'txcd_30011000',
    printify: {
      productId: '6a9fe9c8d56a26f23102ba12', // Villa d'Este - Crew
      printProviderId: 217,
      variantIdBySize: {
        S: 302545, M: 302531, L: 302589, XL: 302574, '2XL': 302567, '3XL': 302591,
      },
      skuBySize: {
        S: '40394226663133073671',
        M: '69383662554205481552',
        L: '25964686052420482088',
        XL: '15422456814516688819',
        '2XL': '10048003294752558143',
        '3XL': '72477095391136231976',
      },
    },
  },
  'palatine-hill-crew': {
    name: 'Palatine Hill — Crewneck',
    image: 'https://thedeangeloseries.com/palatine%20hill%20crew%20bone%20model.png',
    imagesByColor: {
      Bone: 'https://thedeangeloseries.com/palatine%20hill%20crew%20bone%20model.png',
      White: 'https://thedeangeloseries.com/palatine%20hill%20crew%20white%20model.png',
    },
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    colors: ['Bone', 'White'],
    basePrice: 8400,
    upchargePrice: 8800,
    upchargeSizes: ['2XL', '3XL'],
    stripeTaxCode: 'txcd_30011000',
    printify: {
      Bone: {
        productId: '6a9febc85f7ad524a4056bf1', // Palatine Hill - Crew
        printProviderId: 217,
        variantIdBySize: {
          S: 302562, M: 302556, L: 302606, XL: 302616, '2XL': 302595, '3XL': 302611,
        },
        skuBySize: {
          S: '10780123537964188804',
          M: '12603913763236409896',
          L: '18297422357316383269',
          XL: '29710740351753515270',
          '2XL': '68135581867638654352',
          '3XL': '49870724194002749117',
        },
      },
      White: {
        productId: '6a9febc85f7ad524a4056bf1',
        printProviderId: 217,
        variantIdBySize: {
          S: 302521, M: 302513, L: 302520, XL: 302515, '2XL': 302523, '3XL': 302524,
        },
        skuBySize: {
          S: '10457376986952169679',
          M: '90789715234040162726',
          L: '32029417296947443872',
          XL: '13680404561100117113',
          '2XL': '16077978525983830138',
          '3XL': '33239454707610930947',
        },
      },
    },
  },
  'wind-sea-crew': {
    name: 'Wind & Sea — Crewneck',
    image: 'https://thedeangeloseries.com/wind%20%26%20sea%20crew.png',
    currency: 'usd',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
    colors: ['Black'],
    basePrice: 8400,
    upchargePrice: 8800,
    upchargeSizes: ['2XL', '3XL'],
    stripeTaxCode: 'txcd_30011000',
    // Owner confirmed 2026-09-08: this is Black (not the also-enabled Army
    // variant). Printify product "Wind & Sea - Crew" (6a9feaf3bc34f118ec0c1230),
    // blueprint 6992 / print provider 217, same blank as the other new
    // crewnecks.
    printify: {
      productId: '6a9feaf3bc34f118ec0c1230',
      printProviderId: 217,
      variantIdBySize: {
        S: 302545, M: 302531, L: 302589, XL: 302574, '2XL': 302567, '3XL': 302591,
      },
      skuBySize: {
        S: '21488046551503248285',
        M: '16622908470564321674',
        L: '16437059867879109785',
        XL: '19658214598169757021',
        '2XL': '11451182233302643537',
        '3XL': '19051048998019634788',
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
