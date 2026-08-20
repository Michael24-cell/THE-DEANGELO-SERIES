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
  tee: 'Series 01 — Venezia. Three wearable pieces from a single artwork. The artwork becomes the garment.',
  hoodie: 'Series 01 — Venezia. Three wearable pieces from a single artwork. The artwork becomes the garment.',
  crew: 'Series 01 — Venezia. Three wearable pieces from a single artwork. The artwork becomes the garment.',
  'arhus-old-town-tee': 'Series 01 — Arhus, The Old Town. A standalone artwork, distinct from the Venezia pieces. The artwork becomes the garment.',
  'wind-sea-tee': 'Series 01 — Wind & Sea. A standalone artwork, distinct from the Venezia pieces. The artwork becomes the garment.',
  'waves-of-life-tee': 'Series 01 — Waves of Life. A standalone artwork, distinct from the Venezia pieces. The artwork becomes the garment.',
  'villa-d-este-tee': 'Series 01 — Villa d\'Este. A standalone artwork, distinct from the Venezia pieces. The artwork becomes the garment.',
  'the-wedge-tee': 'Series 01 — The Wedge. A standalone artwork, distinct from the Venezia pieces. The artwork becomes the garment.',
  'leaning-tower-of-pisa-tee': 'Series 01 — Leaning Tower of Pisa. A standalone artwork, distinct from the Venezia pieces. The artwork becomes the garment.',
  'piazza-san-marco-tee': 'Series 01 — Piazza San Marco. A standalone artwork, distinct from the Venezia pieces. The artwork becomes the garment.',
  'palatine-hill-tee': 'Series 01 — Palatine Hill. A standalone artwork, distinct from the Venezia pieces. The artwork becomes the garment.',
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
    .transform(response);
}
