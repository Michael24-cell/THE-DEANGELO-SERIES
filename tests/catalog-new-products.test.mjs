// Proves Wind & Sea — Tee and Waves of Life — Tee are fully and correctly
// wired into the trusted catalog (functions/_lib/catalog.js): every enabled
// size has a real Printify variant ID and SKU, invalid size/color is
// rejected, and existing products were left unchanged by the addition.
//
// Run: node tests/catalog-new-products.test.mjs (or `npm test`)

import { CATALOG, validateCartItems, hasCompletePrintifyMapping, CatalogValidationError } from '../functions/_lib/catalog.js';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const NEW_PRODUCTS = [
  { slug: 'wind-sea-tee', color: 'Black' },
  { slug: 'waves-of-life-tee', color: 'White' },
];

console.log('--- New products: every enabled size has a valid Printify variant ID + SKU ---');
for (const { slug, color } of NEW_PRODUCTS) {
  const entry = CATALOG[slug];
  ok(`${slug}: exists in catalog`, !!entry);
  ok(`${slug}: has a printify mapping (not null)`, !!entry?.printify);
  for (const size of entry?.sizes || []) {
    const variantId = entry.printify?.variantIdBySize?.[size];
    const sku = entry.printify?.skuBySize?.[size];
    ok(`${slug} ${size}: has a numeric Printify variant ID`, typeof variantId === 'number' && variantId > 0, variantId);
    ok(`${slug} ${size}: has a non-empty SKU`, typeof sku === 'string' && sku.length > 0, sku);
  }
}

console.log('\n--- New products: validateCartItems resolves the correct trusted variant/SKU ---');
for (const { slug, color } of NEW_PRODUCTS) {
  const entry = CATALOG[slug];
  for (const size of entry.sizes) {
    const [item] = validateCartItems([{ slug, size, color, quantity: 1 }]);
    ok(`${slug} ${size}: resolved variantId matches catalog`, item.printify.variantId === entry.printify.variantIdBySize[size]);
    ok(`${slug} ${size}: resolved SKU matches catalog`, item.printify.sku === entry.printify.skuBySize[size]);
    ok(`${slug} ${size}: resolved productId matches catalog`, item.printify.productId === entry.printify.productId);
  }
  ok(`${slug}: hasCompletePrintifyMapping is true for a full cart`, hasCompletePrintifyMapping(
    entry.sizes.map((size) => validateCartItems([{ slug, size, color, quantity: 1 }])[0])
  ));
}

console.log('\n--- New products: invalid size/color still fails correctly ---');
for (const { slug } of NEW_PRODUCTS) {
  let threw = false;
  try { validateCartItems([{ slug, size: 'XXXL', color: 'Black', quantity: 1 }]); }
  catch (e) { threw = e instanceof CatalogValidationError; }
  ok(`${slug}: invalid size rejected`, threw);

  threw = false;
  try { validateCartItems([{ slug, size: 'M', color: 'Neon Green', quantity: 1 }]); }
  catch (e) { threw = e instanceof CatalogValidationError; }
  ok(`${slug}: invalid color rejected`, threw);
}

console.log('\n--- New products: distinct products, not accidentally aliased to each other or Arhus ---');
{
  const windSea = CATALOG['wind-sea-tee'];
  const wavesOfLife = CATALOG['waves-of-life-tee'];
  const arhus = CATALOG['arhus-old-town-tee'];
  ok('Wind & Sea and Waves of Life have different Printify product IDs', windSea.printify.productId !== wavesOfLife.printify.productId);
  ok('Wind & Sea has a different Printify product ID than Arhus', windSea.printify.productId !== arhus.printify.productId);
  ok('Waves of Life has a different Printify product ID than Arhus', wavesOfLife.printify.productId !== arhus.printify.productId);
}

console.log('\n--- Regression: existing products unchanged by this addition ---');
{
  ok('Venezia Tee (tee) remains unmapped (printify: null)', CATALOG.tee.printify === null);
  ok('Arhus Old Town Tee still maps to its known Printify product ID', CATALOG['arhus-old-town-tee'].printify.productId === '6a3cab048606da46840fa2e7');
  ok('Hoodie still maps to its known Printify product ID', CATALOG.hoodie.printify.productId === '6a220095de5d2b9583031b16');
  ok('Crew still maps to its known Printify product ID', CATALOG.crew.printify.productId === '6a3372e03f9ce13ae30dad09');
  ok('Venezia Tee base price unchanged ($64.00)', CATALOG.tee.basePrice === 6400);
  ok('Hoodie base price unchanged ($84.00)', CATALOG.hoodie.basePrice === 8400);
  ok('Crew base price unchanged ($84.00)', CATALOG.crew.basePrice === 8400);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
