// Small, privacy-conscious campaign attribution shared by checkout creation
// and the Stripe webhook. Only these non-sensitive campaign fields are ever
// accepted from the browser or copied out of Stripe metadata.

const FIELD_LIMITS = {
  utm_source: 100,
  utm_medium: 100,
  utm_campaign: 100,
  utm_content: 100,
  utm_term: 100,
  referrer_host: 253,
  landing_path: 255,
};

export function sanitizeAttribution(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result = {};
  for (const [field, maxLength] of Object.entries(FIELD_LIMITS)) {
    const clean = cleanValue(value[field], maxLength);
    if (!clean) continue;

    if (field === 'referrer_host' && !isHostname(clean)) continue;
    if (field === 'landing_path' && !clean.startsWith('/')) continue;
    result[field] = clean;
  }
  return result;
}

export function attributionFromStripeMetadata(metadata) {
  return sanitizeAttribution(metadata || {});
}

function cleanValue(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

function isHostname(value) {
  return value.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
}
