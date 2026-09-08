// Cloudflare Pages Function — Route: GET /product
//
// product.html is a single static file that renders per-product content
// (title, images, price) entirely client-side via JS, keyed off ?p=. That
// left every product's *server-delivered* HTML — title, meta description,
// canonical, OG/Twitter tags — identical for all six products (all read
// "Venezia Tee"), which collapses their canonicals together in Google's
// eyes and breaks social-share previews. See thedeangeloseries.com-audit/
// FULL-AUDIT-REPORT.md, finding #1.
//
// This intercepts the static response and rewrites just those tags to be
// correct per product before the HTML reaches the browser/crawler. The
// client-side JS is untouched and still does its own DOM updates for the
// in-page experience.

import { CATALOG } from './_lib/catalog.js';

// Marketing copy, not trusted pricing/fulfillment data — kept here rather
// than in catalog.js, and intentionally mirrors the EDITION_DESC map in
// product.html's own client-side JS (the ?p= product-switch script).
const DESCRIPTIONS = {
  tee: 'Series 01 — Venezia Tee. An original watercolor translated onto a heavyweight cotton t-shirt.',
  hoodie: 'Series 01 — Venezia Hoodie. An original watercolor translated onto a heavyweight fleece hoodie.',
  crew: 'Series 01 — Venezia Crewneck. An original watercolor translated onto a heavyweight fleece crewneck.',
  'arhus-old-town-tee': 'Series 01 — Århus, The Old Town Tee. A 1980 vintage Kodak slide from Århus, Denmark, printed on a heavyweight cotton shirt.',
  'wind-sea-tee': 'Series 01 — Wind & Sea Tee. "Valley Vista to the Ocean," painted by Tony DeAngelo in New York, 1999, printed on a heavyweight cotton shirt.',
  'waves-of-life-tee': 'Series 01 — Waves of Life Tee. "Crashing waves of life," painted by Tony DeAngelo in New York, 1990, printed on a heavyweight cotton shirt.',
  'villa-d-este-tee': 'Series 01 — Villa d\'Este Tee. A 1980 vintage Kodak slide of Tivoli, Italy, printed on a heavyweight cotton shirt.',
  'the-wedge-tee': 'Series 01 — The Wedge Tee. "By Water or By Air," painted by Tony DeAngelo in New York, 1990, printed on a heavyweight cotton shirt.',
  'leaning-tower-of-pisa-tee': 'Series 01 — Leaning Tower of Pisa Tee. A 1980 vintage Kodak slide of Pisa, Italy, printed on a heavyweight cotton shirt.',
  'piazza-san-marco-tee': 'Series 01 — Piazza San Marco Tee. A 1980 vintage Kodak slide of Venice, Italy, printed on a heavyweight cotton shirt.',
  'palatine-hill-tee': 'Series 01 — Palatine Hill Tee. A 1980 vintage Kodak slide of Rome, Italy, printed on a heavyweight cotton shirt.',
  'ostia-antica-tee': 'Series 01 — Ostia Antica Tee. A 1980 vintage Kodak slide of Ostia Antica, Italy, printed on a heavyweight cotton shirt.',
  'waves-of-life-crew': 'Series 01 — Waves of Life Crewneck. "Crashing waves of life," painted by Tony DeAngelo in New York, 1990, printed on a heavyweight fleece crewneck.',
  'villa-d-este-crew': 'Series 01 — Villa d\'Este Crewneck. A 1980 vintage Kodak slide of Tivoli, Italy, printed on a heavyweight fleece crewneck.',
  'palatine-hill-crew': 'Series 01 — Palatine Hill Crewneck. A 1980 vintage Kodak slide of Rome, Italy, printed on a heavyweight fleece crewneck.',
  'wind-sea-crew': 'Series 01 — Wind & Sea Crewneck. "Valley Vista to the Ocean," painted by Tony DeAngelo in New York, 1999, printed on a heavyweight fleece crewneck.',
  'arhus-old-town-crew': 'Series 01 — Århus, The Old Town Crewneck. A 1980 vintage Kodak slide from Århus, Denmark, printed on a heavyweight fleece crewneck.',
  'new-york-crew': 'Series 01 — New York Crewneck. The Chrysler Building and Empire State Building, painted by Tony DeAngelo in New York, 2019, printed on a heavyweight fleece crewneck.',
};

class SetAttribute {
  constructor(attr, value) {
    this.attr = attr;
    this.value = value;
  }
  element(element) {
    element.setAttribute(this.attr, this.value);
  }
}

class SetText {
  constructor(value) {
    this.value = value;
  }
  element(element) {
    element.setInnerContent(this.value);
  }
}

class AppendHtml {
  constructor(html) {
    this.html = html;
  }
  element(element) {
    element.append(this.html, { html: true });
  }
}

// Product schema — gives Google an explicit, structured signal that this
// is a shirt/apparel product sold by "The DeAngelo Series", independent
// of body copy. availability reflects hasCompletePrintifyMapping's own
// logic (functions/_lib/catalog.js): no confirmed Printify mapping means
// it can't actually be fulfilled right now.
function productSchema(product, description, canonicalUrl) {
  const lowPrice = product.basePrice / 100;
  const highPrice = (product.upchargePrice || product.basePrice) / 100;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name.replace(' — ', ' '),
    image: product.image,
    description,
    brand: { '@type': 'Brand', name: 'The DeAngelo Series' },
    url: canonicalUrl,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: (product.currency || 'usd').toUpperCase(),
      lowPrice,
      highPrice,
      offerCount: product.sizes.length,
      availability: product.printify ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

export async function onRequestGet(context) {
  const response = await context.next();

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const key = new URL(context.request.url).searchParams.get('p');
  const product = key && CATALOG[key];
  // Unknown slug, or a "coming soon" preview piece with no catalog entry
  // yet (no confirmed price/fulfillment) — leave the static defaults
  // rather than inventing metadata for a product that isn't real yet.
  if (!product) return response;

  // Matches the exact string product.html's own client JS sets via
  // `document.title = p.title + ' ' + p.garment + ' — The DeAngelo Series'`.
  const title = `${product.name.replace(' — ', ' ')} — The DeAngelo Series`;
  const description = DESCRIPTIONS[key] || `Artwear from The DeAngelo Series. ${product.name}.`;
  const canonicalUrl = `https://thedeangeloseries.com/product?p=${key}`;

  return new HTMLRewriter()
    .on('title', new SetText(title))
    .on('meta[name="description"]', new SetAttribute('content', description))
    .on('link[rel="canonical"]', new SetAttribute('href', canonicalUrl))
    .on('meta[property="og:title"]', new SetAttribute('content', title))
    .on('meta[property="og:description"]', new SetAttribute('content', description))
    .on('meta[property="og:image"]', new SetAttribute('content', product.image))
    .on('meta[property="og:url"]', new SetAttribute('content', canonicalUrl))
    .on('meta[name="twitter:title"]', new SetAttribute('content', title))
    .on('meta[name="twitter:description"]', new SetAttribute('content', description))
    .on('meta[name="twitter:image"]', new SetAttribute('content', product.image))
    .on('head', new AppendHtml(productSchema(product, description, canonicalUrl)))
    .transform(response);
}
