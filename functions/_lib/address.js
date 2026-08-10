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
  const region = String(raw?.region || raw?.state || '').trim();
  const zip = String(raw?.zip || raw?.postal_code || '').trim();
  const country = String(raw?.country || '').trim().toUpperCase();

  if (!firstName) throw new AddressValidationError('First name is required.');
  if (!lastName) throw new AddressValidationError('Last name is required.');
  if (!address1) throw new AddressValidationError('Street address is required.');
  if (!city) throw new AddressValidationError('City is required.');
  if (!region) throw new AddressValidationError('State is required.');
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

  return { firstName, lastName, address1, address2, city, region, zip, country };
}
