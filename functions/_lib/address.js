// Shared server-side shipping-address validation.
//
// Used by both functions/api/printify-shipping-quote.js (to get a real
// Printify rate for the customer's actual destination) and
// functions/api/create-checkout-session.js (to re-validate and re-quote
// that same destination before attaching a shipping charge to the Stripe
// Session). The browser is never trusted for anything price-related here —
// this only validates shape/format so a real Printify quote can be
// requested; it never derives or accepts a price.
//
// US-only for launch, per the site owner's explicit instruction. Extending
// to other countries later means loosening ALLOWED_COUNTRIES and the ZIP
// format check below — nothing else in the shipping pipeline assumes US
// specifically (functions/_lib/printify.js already forwards whatever
// country/region/city/zip it's given).

export class AddressValidationError extends Error {}

const ALLOWED_COUNTRIES = ['US'];
const US_ZIP_RE = /^\d{5}(-\d{4})?$/;

// ---------------------------------------------------------------------------
// US state/territory normalization — standard USPS 2-letter codes. Maps
// full names (any casing/whitespace) to their code; codes map to themselves.
// This exists because checkout.html's address form and Stripe's own hosted
// address form don't necessarily produce the same string for the same real
// state ("California" vs "CA") — functions/api/stripe-webhook.js's
// detectAddressMismatch() must normalize both sides through this same table
// before comparing, or a real, correctly-shipped order gets incorrectly
// flagged and held for manual review. See tryNormalizeUSState/normalizeUSState.
// ---------------------------------------------------------------------------
export const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  AS: 'American Samoa', GU: 'Guam', MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico', VI: 'U.S. Virgin Islands',
};

// Reverse lookup: normalized (uppercased, whitespace-collapsed) full name -> code.
const NAME_TO_CODE = new Map(
  Object.entries(US_STATES).map(([code, name]) => [normalizeKey(name), code]),
);
const VALID_CODES = new Set(Object.keys(US_STATES));

function normalizeKey(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Normalizes "CA", "ca", " California ", "california" etc. to "CA". Never
 * throws — returns null if the input doesn't match a known US state/
 * territory code or full name, so callers can decide how to handle that
 * (reject during real validation, or fall back safely during best-effort
 * reconciliation, e.g. a non-US address slipping through).
 * @param {unknown} raw
 * @returns {string|null}
 */
export function tryNormalizeUSState(raw) {
  const key = normalizeKey(raw);
  if (!key) return null;
  if (VALID_CODES.has(key)) return key;
  return NAME_TO_CODE.get(key) ?? null;
}

/**
 * Strict version — throws AddressValidationError on anything that isn't a
 * recognized US state/territory. Used during real address validation, where
 * silently accepting an unrecognized state would mean quoting/charging
 * shipping for a destination we can't actually confirm.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeUSState(raw) {
  const code = tryNormalizeUSState(raw);
  if (!code) {
    throw new AddressValidationError('Please choose a valid US state.');
  }
  return code;
}

/**
 * @param {unknown} raw - raw `body.shippingAddress` / `body.address` from a request
 * @returns {{firstName:string,lastName:string,address1:string,address2:string,city:string,region:string,zip:string,country:string}}
 */
export function validateAddress(raw) {
  const firstName = String(raw?.firstName || '').trim();
  const lastName = String(raw?.lastName || '').trim();
  const address1 = String(raw?.address1 || '').trim();
  const address2 = String(raw?.address2 || '').trim();
  const city = String(raw?.city || '').trim();
  const regionRaw = String(raw?.region || raw?.state || '').trim();
  const zip = String(raw?.zip || raw?.postal_code || '').trim();
  const country = String(raw?.country || '').trim().toUpperCase();

  if (!firstName) throw new AddressValidationError('First name is required.');
  if (!lastName) throw new AddressValidationError('Last name is required.');
  if (!address1) throw new AddressValidationError('Street address is required.');
  if (!city) throw new AddressValidationError('City is required.');
  if (!regionRaw) throw new AddressValidationError('State is required.');
  if (!zip) throw new AddressValidationError('ZIP code is required.');
  if (!country || country.length !== 2) {
    throw new AddressValidationError('A valid destination country is required.');
  }
  if (!ALLOWED_COUNTRIES.includes(country)) {
    throw new AddressValidationError('Shipping is only available to the United States right now.');
  }
  if (country === 'US' && !US_ZIP_RE.test(zip)) {
    throw new AddressValidationError('Please enter a valid US ZIP code.');
  }

  // Normalized to a 2-letter code — this is what gets sent to Printify,
  // stored in Stripe Session metadata, and later compared against what
  // Stripe's own hosted page collected. Never silently accepted if
  // unrecognized (unlike detectAddressMismatch()'s best-effort comparison
  // in stripe-webhook.js, this is real validation — an unrecognized state
  // means we genuinely don't know the destination).
  const region = country === 'US' ? normalizeUSState(regionRaw) : regionRaw;

  return { firstName, lastName, address1, address2, city, region, zip, country };
}
