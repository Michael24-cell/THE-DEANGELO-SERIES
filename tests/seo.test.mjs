// Regression tests for the server-rendered SEO layer: functions/product.js,
// functions/collection.js, functions/sitemap.xml.js and product-data.js.
// Run: node tests/seo.test.mjs (or `npm test`)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG } from '../functions/_lib/catalog.js';
import { productGroupSchema, breadcrumbSchema, metaDescription, canonicalFor, onRequestGet as productGet } from '../functions/product.js';
import { buildSitemap, SITEMAP_PATH } from '../scripts/build-sitemap.mjs';
import { itemListSchema } from '../functions/collection.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = globalThis.DEANGELO_DATA;
const KEYS = Object.keys(CATALOG);

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

async function run() {
  console.log('--- Every catalog product has display data, and vice versa ---');
  ok('every CATALOG key is in PRODS', KEYS.every((k) => D.PRODS[k]), KEYS.filter((k) => !D.PRODS[k]));
  ok('every PRODS key is in CATALOG', Object.keys(D.PRODS).every((k) => CATALOG[k]), Object.keys(D.PRODS).filter((k) => !CATALOG[k]));
  ok('every product has a source story', KEYS.every((k) => D.SOURCE[k]));

  console.log('--- Every image product-data.js references exists on disk ---');
  const src = fs.readFileSync(path.join(ROOT, 'product-data.js'), 'utf8');
  const imgs = [...new Set(src.match(/img\/[a-z0-9-]+\.(webp|png)/g))];
  const missing = imgs.filter((p) => !fs.existsSync(path.join(ROOT, p)));
  ok(`all ${imgs.length} referenced images exist`, missing.length === 0, missing);

  console.log('--- Titles and meta descriptions fit in search results ---');
  const longTitles = KEYS.map((k) => D.pageTitle(D.PRODS[k])).filter((t) => t.length > 60);
  ok('every product title <= 60 chars', longTitles.length === 0, longTitles);
  const longDescs = KEYS.map(metaDescription).filter((d) => d.length > 160);
  ok('every meta description <= 160 chars', longDescs.length === 0, longDescs);
  ok('meta description includes the price', metaDescription('crew').includes('$84'));

  console.log('--- Sitemap lists every product at its canonical URL ---');
  const sitemap = buildSitemap();
  ok('every product URL present', KEYS.every((k) => sitemap.includes(`<loc>${canonicalFor(k)}</loc>`)), KEYS.filter((k) => !sitemap.includes(canonicalFor(k))));
  ok('no .html URLs', !/\.html/.test(sitemap));
  ok('no preview (noindex) pages listed', Object.keys(D.PREVIEWS).every((k) => !sitemap.includes(`p=${k}<`)));
  ok('product images included', sitemap.includes('<image:loc>https://thedeangeloseries.com/img/'));
  ok('committed sitemap.xml is up to date (run: node scripts/build-sitemap.mjs)', fs.readFileSync(SITEMAP_PATH, 'utf8') === sitemap);

  console.log('--- ProductGroup schema: real prices per size, one variant per color x size ---');
  for (const key of ['tee', 'new-york-crew', 'palatine-hill-crew']) {
    const entry = CATALOG[key];
    const s = productGroupSchema(key);
    ok(`${key}: @type ProductGroup`, s['@type'] === 'ProductGroup');
    ok(`${key}: ${entry.sizes.length * entry.colors.length} variants`, s.hasVariant.length === entry.sizes.length * entry.colors.length, s.hasVariant.length);
    const xl = s.hasVariant.find((v) => v.size === 'XL').offers.price;
    const xxl = s.hasVariant.find((v) => v.size === '2XL').offers.price;
    ok(`${key}: XL priced at base`, xl === (entry.basePrice / 100).toFixed(2), xl);
    ok(`${key}: 2XL priced at upcharge`, xxl === (entry.upchargePrice / 100).toFixed(2), xxl);
    ok(`${key}: every offer has the no-returns policy`, s.hasVariant.every((v) => v.offers.hasMerchantReturnPolicy.returnPolicyCategory.endsWith('MerchantReturnNotPermitted')));
    ok(`${key}: no rating without reviews`, !('aggregateRating' in s));
  }
  ok('variant SKUs are unique', new Set(productGroupSchema('tee').hasVariant.map((v) => v.sku)).size === productGroupSchema('tee').hasVariant.length);

  const withReviews = productGroupSchema('tee', [
    { rating: 5, title: 'Great', body: 'Love it', display_name: 'A.', created_at: '2026-11-01T00:00:00Z' },
    { rating: 4, title: null, body: 'Good', display_name: 'B.', created_at: '2026-11-02T00:00:00Z' },
  ]);
  ok('aggregateRating averages real reviews', withReviews.aggregateRating?.ratingValue === '4.5' && withReviews.aggregateRating.reviewCount === 2, withReviews.aggregateRating);
  ok('breadcrumb ends at the product', breadcrumbSchema('tee').itemListElement[2].item === canonicalFor('tee'));

  console.log('--- Collection grid and ItemList link every product ---');
  const grid = D.collectionGridHTML();
  ok('grid links every product', KEYS.every((k) => grid.includes(`href="product?p=${k}"`)), KEYS.filter((k) => !grid.includes(`p=${k}"`)));
  ok('grid has no .html links', !/\.html/.test(grid));
  const list = itemListSchema().itemListElement;
  ok('ItemList has one entry per product', list.length === KEYS.length, list.length);

  console.log('--- Unknown slugs 404 instead of showing Venezia ---');
  for (const slug of ['does-not-exist', '__proto__', 'constructor']) {
    let nextCalled = false;
    const res = await productGet({
      request: { url: `https://thedeangeloseries.com/product?p=${slug}` },
      env: { ASSETS: { fetch: async () => new Response('<h1>Not found</h1>') } },
      next: async () => { nextCalled = true; return new Response(''); },
    });
    ok(`?p=${slug} -> 404`, res.status === 404 && !nextCalled, res.status);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run().catch((err) => { console.error(err); process.exit(1); });
