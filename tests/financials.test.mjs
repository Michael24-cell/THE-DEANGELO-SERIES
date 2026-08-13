// Unit tests for the pure margin formula in functions/_lib/financials.js.
// Run: node tests/financials.test.mjs (or `npm test`)

import { computeEstimatedMargin } from '../functions/_lib/financials.js';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

const FULL = {
  subtotal_amount: 6400, shipping_amount: 519, tax_amount: 542, // tax_amount present but must be ignored
  stripe_fee_amount: 219, printify_product_cost: 2100, printify_shipping_cost: 450, printify_tax_amount: 25,
};

function run() {
  console.log('--- All six required inputs known: margin computed, tax_amount ignored ---');
  {
    const margin = computeEstimatedMargin(FULL);
    // 6400 + 519 - 219 - 2100 - 450 - 25 = 4125
    ok('margin = subtotal + shipping - fee - product - shipping_cost - printify_tax', margin === 4125, margin);
  }

  console.log('\n--- tax_amount (sales tax collected) never affects the result ---');
  {
    const a = computeEstimatedMargin({ ...FULL, tax_amount: 0 });
    const b = computeEstimatedMargin({ ...FULL, tax_amount: 99999 });
    ok('changing tax_amount does not change margin', a === b && a === 4125, { a, b });
  }

  console.log('\n--- Missing any single required input yields null, not a partial number ---');
  const requiredKeys = ['subtotal_amount', 'shipping_amount', 'stripe_fee_amount', 'printify_product_cost', 'printify_shipping_cost', 'printify_tax_amount'];
  for (const key of requiredKeys) {
    const partial = { ...FULL, [key]: null };
    ok(`null ${key} => margin is null`, computeEstimatedMargin(partial) === null);
  }

  console.log('\n--- All required inputs missing (fresh order) => null ---');
  {
    ok('empty order => null', computeEstimatedMargin({}) === null);
  }

  console.log('\n--- Zero is a valid known value, not treated as missing ---');
  {
    const zeroFee = computeEstimatedMargin({ ...FULL, stripe_fee_amount: 0 });
    ok('stripe_fee_amount: 0 is used as a real zero, not null', zeroFee === 4344, zeroFee);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
