// Cloudflare Pages Function — Route: GET /collection
//
// The collection grid is built in the browser from product-data.js, so its
// raw HTML had no product links for crawlers to follow. This fills #grid
// server-side with the exact markup the browser renders, and adds an
// ItemList JSON-LD of every product on the page.

import '../product-data.js';

const D = globalThis.DEANGELO_DATA;
const SITE = 'https://thedeangeloseries.com';

export function itemListSchema() {
  const seen = new Set();
  const items = D.PLATES.filter((p) => !p.soon && !seen.has(p.slug) && seen.add(p.slug));
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'The Collection — The DeAngelo Series',
    itemListElement: items.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE}/product?p=${p.slug}`,
      name: D.pageTitle(D.PRODS[p.slug] || { title: p.title, garment: p.garment }).split(' | ')[0],
    })),
  };
}

export async function onRequestGet(context) {
  const response = await context.next();
  if (!(response.headers.get('content-type') || '').includes('text/html')) return response;

  const schema = `<script type="application/ld+json">${JSON.stringify(itemListSchema())}</script>`;
  return new HTMLRewriter()
    .on('#grid', { element: (el) => el.setInnerContent(D.collectionGridHTML(), { html: true }) })
    .on('head', { element: (el) => el.append(schema, { html: true }) })
    .transform(response);
}
