import { sanitizeAttribution, attributionFromStripeMetadata } from '../functions/_lib/attribution.js';

let passed = 0;
let failed = 0;
function ok(label, condition, actual) {
  if (condition) { passed++; console.log('  PASS:', label); }
  else { failed++; console.log('  FAIL:', label, actual); }
}

const clean = sanitizeAttribution({
  utm_source: 'facebook',
  utm_medium: 'social',
  utm_campaign: 'series_01_launch',
  utm_content: 'tony_post',
  utm_term: 'venezia',
  referrer_host: 'www.facebook.com',
  landing_path: '/product.html',
  fbclid: 'must-not-be-stored',
  unknown: 'ignored',
});

ok('keeps allowlisted campaign fields', clean.utm_source === 'facebook' && clean.utm_campaign === 'series_01_launch', clean);
ok('keeps a valid external referring hostname', clean.referrer_host === 'www.facebook.com', clean);
ok('keeps a root-relative landing path', clean.landing_path === '/product.html', clean);
ok('drops fbclid and unknown fields', !('fbclid' in clean) && !('unknown' in clean), clean);

const dirty = sanitizeAttribution({
  utm_source: ' face\u0000book ',
  referrer_host: 'https://facebook.com/path',
  landing_path: 'https://example.com/not-relative',
  utm_campaign: 'x'.repeat(150),
});
ok('strips control characters and surrounding space', dirty.utm_source === 'facebook', dirty);
ok('rejects full referrer URLs', !('referrer_host' in dirty), dirty);
ok('rejects absolute landing URLs', !('landing_path' in dirty), dirty);
ok('caps Stripe metadata values to the field limit', dirty.utm_campaign.length === 100, dirty.utm_campaign.length);

const fromStripe = attributionFromStripeMetadata({ utm_source: 'facebook', order_source: 'thedeangeloseries.com' });
ok('extracts attribution from Stripe without copying order metadata', fromStripe.utm_source === 'facebook' && !('order_source' in fromStripe), fromStripe);
ok('returns an empty object for invalid input', Object.keys(sanitizeAttribution(null)).length === 0, sanitizeAttribution(null));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
