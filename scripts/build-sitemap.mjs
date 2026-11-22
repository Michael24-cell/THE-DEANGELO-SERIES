// Regenerates sitemap.xml from product-data.js + catalog.js, so every
// sellable product is listed at its final canonical URL (the old hand-kept
// file had silently dropped six). tests/seo.test.mjs fails if the committed
// sitemap.xml drifts from this output.
// Usage: node scripts/build-sitemap.mjs

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../product-data.js';
import { CATALOG } from '../functions/_lib/catalog.js';

const D = globalThis.DEANGELO_DATA;
const SITE = 'https://thedeangeloseries.com';

const STATIC_PAGES = [
  '/', '/collection', '/art', '/artist', '/statement', '/contact', '/archive',
  '/shipping-policy', '/refund-policy', '/privacy-policy', '/terms',
];

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const abs = (path) => `${SITE}/${path.split('/').map(encodeURIComponent).join('/')}`;

export function buildSitemap() {
  const urls = STATIC_PAGES.map((p) => `  <url><loc>${SITE}${p}</loc></url>`);
  for (const [key, prod] of Object.entries(D.PRODS)) {
    if (!Object.hasOwn(CATALOG, key) || prod.unavailable) continue;
    const images = [prod.model, prod.flat]
      .map((img) => `    <image:image><image:loc>${xml(abs(img))}</image:loc></image:image>`)
      .join('\n');
    urls.push(`  <url>\n    <loc>${xml(`${SITE}/product?p=${key}`)}</loc>\n${images}\n  </url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>
`;
}

export const SITEMAP_PATH = fileURLToPath(new URL('../sitemap.xml', import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(SITEMAP_PATH, buildSitemap());
  console.log('wrote', SITEMAP_PATH);
}
