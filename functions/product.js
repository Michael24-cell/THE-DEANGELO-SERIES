// Cloudflare Pages Function — Route: GET /product
//
// product.html is one static file that renders per-product content in the
// browser, keyed off ?p=. Crawlers and link-preview scrapers that don't run
// JS would otherwise see Venezia for every product, so this rewrites the
// static HTML server-side with the same data the browser uses
// (product-data.js), plus per-product meta tags and JSON-LD. The client
// script still runs and sets the same values, so the two can't disagree.
//
// Unknown slugs get a real 404; "coming soon" previews are served but
// marked noindex (no confirmed price or details yet).

import '../product-data.js';
import { CATALOG, printifyMappingForColor, resolveProductImage } from './_lib/catalog.js';
import { listApprovedReviews } from './_lib/orders-db.js';

const D = globalThis.DEANGELO_DATA;
const SITE = 'https://thedeangeloseries.com';

// Meta-description copy (marketing, not trusted pricing data).
const DESCRIPTIONS = {
  tee: 'Series 01 — Venezia Tee. An original watercolor translated onto a heavyweight cotton t-shirt.',
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
  'new-york-crew': 'Series 01 — New York Crewneck. The Chrysler Building and Empire State Building, painted by Tony DeAngelo in New York, 2019, on heavyweight fleece.',
};

const RETURN_POLICY = {
  '@type': 'MerchantReturnPolicy',
  applicableCountry: 'US',
  returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
};

export const canonicalFor = (key) => `${SITE}/product?p=${key}`;
const abs = (path) => `${SITE}/${path.split('/').map(encodeURIComponent).join('/')}`;
const stripTags = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function metaDescription(key) {
  const entry = CATALOG[key];
  const base = DESCRIPTIONS[key] || `Artwear from The DeAngelo Series. ${entry.name}.`;
  const price = ` From $${entry.basePrice / 100}.`;
  return (base + price).length <= 160 ? base + price : base.replace(/^Series 01 — /, '') + price;
}

const priceFor = (entry, size) =>
  ((entry.upchargeSizes || []).includes(size) ? entry.upchargePrice : entry.basePrice) / 100;

/** ProductGroup JSON-LD: one Product + Offer per color/size, with real Printify SKUs. */
export function productGroupSchema(key, reviews = []) {
  const entry = CATALOG[key];
  const prod = D.PRODS[key];
  const src = D.SOURCE[key];
  const name = D.pageTitle(prod).split(' | ')[0];
  const url = canonicalFor(key);
  const colors = entry.colors?.length ? entry.colors : [undefined];

  const variants = [];
  for (const color of colors) {
    const mapping = printifyMappingForColor(entry, color);
    for (const size of entry.sizes) {
      const inStock = Boolean(mapping?.variantIdBySize?.[size]);
      variants.push({
        '@type': 'Product',
        sku: mapping?.skuBySize?.[size] || `${key}-${color || 'default'}-${size}`.toLowerCase(),
        name: `${name} — ${color ? color + ', ' : ''}${size}`,
        image: resolveProductImage(entry, color),
        size,
        ...(color && { color }),
        offers: {
          '@type': 'Offer',
          url,
          priceCurrency: (entry.currency || 'usd').toUpperCase(),
          price: priceFor(entry, size).toFixed(2),
          availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          itemCondition: 'https://schema.org/NewCondition',
          hasMerchantReturnPolicy: RETURN_POLICY,
        },
      });
    }
  }

  const images = [entry.image, abs(prod.model), abs(prod.flat)];
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name,
    description: src?.bodyHtml ? stripTags(src.bodyHtml) : DESCRIPTIONS[key],
    url,
    productGroupID: key,
    brand: { '@type': 'Brand', name: 'The DeAngelo Series' },
    image: [...new Set(images)],
    material: D.DETAILS[key]?.material,
    variesBy: entry.colors?.length > 1
      ? ['https://schema.org/size', 'https://schema.org/color']
      : ['https://schema.org/size'],
    hasVariant: variants,
  };
  if (reviews.length) {
    const avg = reviews.reduce((a, r) => a + r.rating, 0) / reviews.length;
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: avg.toFixed(1),
      reviewCount: reviews.length,
      bestRating: 5,
      worstRating: 1,
    };
    schema.review = reviews.slice(0, 5).map((r) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: r.display_name },
      reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 },
      ...(r.title && { name: r.title }),
      reviewBody: r.body,
      datePublished: String(r.created_at).slice(0, 10),
    }));
  }
  return schema;
}

export function breadcrumbSchema(key) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'The Collection', item: `${SITE}/collection` },
      { '@type': 'ListItem', position: 3, name: D.pageTitle(D.PRODS[key]).split(' | ')[0], item: canonicalFor(key) },
    ],
  };
}

// JSON.stringify doesn't escape "</script>"; review text is user-supplied.
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

function starGlyphs(rating) {
  let html = '';
  for (let i = 1; i <= 5; i++) html += `<span${i > Math.round(rating) ? ' class="dim"' : ''}>&#9733;</span>`;
  return html;
}

// ── HTMLRewriter element handlers ──────────────────────────────────────────
const text = (value) => ({ element: (el) => el.setInnerContent(value) });
const html = (value) => ({ element: (el) => el.setInnerContent(value, { html: true }) });
const attrs = (map) => ({
  element: (el) => { for (const [k, v] of Object.entries(map)) if (v != null) el.setAttribute(k, String(v)); },
});
const shown = (visible) => ({
  element: (el) => (visible ? el.removeAttribute('style') : el.setAttribute('style', 'display:none')),
});
const thumbStyle = (src) => `background-image:url('${src}');background-size:cover;background-position:center;`;

function headRewriter(rw, { title, description, canonical, image, extraHead }) {
  return rw
    .on('title', text(title))
    .on('meta[name="description"]', attrs({ content: description }))
    .on('link[rel="canonical"]', attrs({ href: canonical }))
    .on('meta[property="og:title"]', attrs({ content: title }))
    .on('meta[property="og:description"]', attrs({ content: description }))
    .on('meta[property="og:image"]', attrs({ content: image }))
    .on('meta[property="og:url"]', attrs({ content: canonical }))
    .on('meta[name="twitter:title"]', attrs({ content: title }))
    .on('meta[name="twitter:description"]', attrs({ content: description }))
    .on('meta[name="twitter:image"]', attrs({ content: image }))
    .on('head', { element: (el) => el.append(extraHead, { html: true }) });
}

async function notFound(context, url) {
  const page = await context.env.ASSETS.fetch(new URL('/404', url));
  return new Response(page.body, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function approvedReviews(env, key) {
  if (!env.DB) return [];
  try {
    return await listApprovedReviews(env, key);
  } catch (err) {
    console.error('[product] review lookup failed:', err.message);
    return [];
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const key = url.searchParams.get('p') || 'tee';
  const own = (obj) => (Object.hasOwn(obj, key) ? obj[key] : undefined);
  const prod = own(D.PRODS);
  const entry = own(CATALOG);
  const preview = own(D.PREVIEWS);

  if (!preview && !(prod && entry)) return notFound(context, url);

  const response = await context.next();
  if (!(response.headers.get('content-type') || '').includes('text/html')) return response;

  if (preview) {
    const title = `${preview.title}${preview.sub ? ' ' + preview.sub : ''} — Coming Soon | The DeAngelo Series`;
    return headRewriter(new HTMLRewriter(), {
      title,
      description: `${preview.title} — in development at The DeAngelo Series. Artwork, pricing, and details to be announced.`,
      canonical: canonicalFor(key),
      image: abs(preview.img),
      extraHead: '<meta name="robots" content="noindex">',
    })
      .on('#productTitle', html(preview.sub ? `${escapeHtml(preview.title)}<br><em>${escapeHtml(preview.sub)}</em>` : escapeHtml(preview.title)))
      .transform(response);
  }

  const reviews = await approvedReviews(context.env, key);
  const src = D.SOURCE[key] || D.VENEZIA_SOURCE;
  const details = D.DETAILS[key] || D.DETAILS.tee;
  const chartId = D.SIZE_CHART_ID[key];
  const multiColor = prod.colors && prod.colors.length > 1;
  const third = D.thirdImageFor(prod, multiColor ? prod.colors[0].name : prod.frontColor, key);
  const label = `${prod.title} ${prod.garment}`;
  const cta = {
    'data-price': prod.priceNum,
    'data-name': label,
    'data-img': prod.model,
    'data-plate': `Piece ${prod.plate}`,
    'data-slug': key,
    'data-color': multiColor ? prod.colors[0].name : null,
  };

  const extraHead = jsonLd(productGroupSchema(key, reviews)) + jsonLd(breadcrumbSchema(key));
  let rw = headRewriter(new HTMLRewriter(), {
    title: D.pageTitle(prod),
    description: metaDescription(key),
    canonical: canonicalFor(key),
    image: entry.image,
    extraHead,
  })
    .on('#crumbPlate', text(`Piece ${prod.plate}`))
    .on('#eyebrowPlate', text(`${prod.artwork} · Piece ${prod.plate}`))
    .on('#productTitle', html(`${escapeHtml(prod.title)}<br><em>${escapeHtml(prod.garment)}</em>`))
    .on('#productPrice', text(`${prod.price} USD`))
    .on('#ctaBtn', { element: (el) => { attrs(cta).element(el); el.setInnerContent(`Add to Collection — ${prod.price}`); } })
    .on('#buyNowBtn', attrs(cta))
    .on('#frameModel', attrs({ src: prod.model, alt: `${label} — Model` }))
    .on('#frameFlat', attrs({ src: prod.flat, alt: `${label} — Flat` }))
    .on('#thumbModel', attrs({ style: thumbStyle(prod.model) }))
    .on('#thumbFlat', attrs({ style: thumbStyle(prod.flat) }))
    .on('#counter', text(third ? '01 / 03' : '01 / 02'))
    .on('#sizes', {
      element: (el) => {
        el.setAttribute('data-base', String(prod.priceNum));
        el.setAttribute('data-2xl', String(prod.priceNum2xl));
        el.setAttribute('style', `grid-template-columns:repeat(${prod.sizes.length},1fr)`);
        el.setInnerContent(prod.sizes.map((s, i) => `<button class="size${i === 1 ? ' is-active' : ''}">${s}</button>`).join(''), { html: true });
      },
    })
    .on('#sgTee', shown(chartId === 'sgTee'))
    .on('#sgCrew', shown(chartId === 'sgCrew'))
    .on('#editionDesc', text(D.EDITION_DESC[key] || D.EDITION_DESC.tee))
    .on('#detailMaterial', text(details.material))
    .on('#detailFit', text(details.fit))
    .on('#detailPrint', text(details.print))
    .on('#sourceArtImg', attrs({ src: src.artImg, alt: src.artAlt }))
    .on('#sourceCaptionMedium', text(src.captionMedium))
    .on('#sourceCaptionYear', text(src.captionYear))
    .on('#sourceEyebrow', text(src.eyebrow))
    .on('#sourceTitle', html(src.titleHtml))
    .on('#sourceMedium', { element: (el) => { el.setInnerContent(src.medium); shown(Boolean(src.medium)).element(el); } })
    .on('#sourcePull', text(src.pull))
    .on('#sourceBody', { element: (el) => { el.setInnerContent(src.bodyHtml, { html: true }); shown(Boolean(src.bodyHtml)).element(el); } })
    .on('#sourceSign', {
      element: (el) => {
        if (!src.signName) return el.setAttribute('style', 'display:none');
        el.setInnerContent(src.signatureImg
          ? `<img class="sign-img" src="${src.signatureImg}" alt="${escapeHtml(src.signName)} signature" loading="lazy" decoding="async">`
          : `<span>By</span><span class="name">${escapeHtml(src.signName)}</span>`, { html: true });
      },
    })
    .on('#provArtworkValue', html(src.provArtworkValueHtml))
    .on('#provArtworkAside', text(src.provArtworkAside))
    .on('#provPrintedAside', text(src.provPrintedAside))
    .on('#alsoGrid', html(D.alsoGridHTML(key)));

  rw = third
    ? rw.on('#frameFront', attrs({ src: third.src, alt: `${label} — ${third.label}` }))
      .on('#thumbFront', attrs({ style: thumbStyle(third.src) }))
      .on('#thumbFront .thumb-label', text(third.label))
    : rw.on('#frameFrontWrap', attrs({ style: 'display:none' }))
      .on('#thumbFront', attrs({ style: 'display:none' }));

  if (reviews.length) {
    const avg = reviews.reduce((a, r) => a + r.rating, 0) / reviews.length;
    rw = rw
      .on('#reviewsCount', {
        element: (el) => {
          el.setInnerContent(`Reviews (${reviews.length})`);
          el.setAttribute('aria-label', `${reviews.length} ${reviews.length === 1 ? 'review' : 'reviews'}, average ${avg.toFixed(1)} of 5 stars`);
        },
      })
      .on('#reviewsEmpty', attrs({ style: 'display:none' }))
      .on('#reviewsList', {
        element: (el) => {
          el.removeAttribute('style');
          el.setInnerContent(reviews.map((r) => '<article class="review-card">' +
            `<div class="stars" aria-hidden="true">${starGlyphs(r.rating)}</div>` +
            (r.title ? `<p class="review-title">${escapeHtml(r.title)}</p>` : '') +
            `<p class="review-body">${escapeHtml(r.body)}</p>` +
            `<p class="review-meta">${escapeHtml(r.display_name)}</p>` +
          '</article>').join(''), { html: true });
        },
      });
  }

  return rw.transform(response);
}
