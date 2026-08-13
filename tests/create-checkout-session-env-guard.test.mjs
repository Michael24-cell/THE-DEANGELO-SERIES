// Tests for checkStripeEnvironmentGuard() in functions/api/create-checkout-session.js
// — the environment-aware replacement for the old unconditional
// "reject anything but sk_test_" guard. APP_ENV (an explicit, separately
// configured signal — see wrangler.toml's [env.production.vars] /
// [env.preview.vars]) is the only source of truth for what's allowed; the
// Stripe key's own prefix is only cross-checked against it, never used to
// infer environment.
//
// Run: node tests/create-checkout-session-env-guard.test.mjs (or `npm test`)

import { checkStripeEnvironmentGuard } from '../functions/api/create-checkout-session.js';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function run() {
  console.log('--- Preview + sk_test_ => allowed ---');
  {
    const result = checkStripeEnvironmentGuard({ APP_ENV: 'preview', STRIPE_SECRET_KEY: 'sk_test_abc123' });
    ok('ok: true', result.ok === true, result);
  }

  console.log('\n--- Preview + sk_live_ => rejected ---');
  {
    const result = checkStripeEnvironmentGuard({ APP_ENV: 'preview', STRIPE_SECRET_KEY: 'sk_live_abc123' });
    ok('ok: false', result.ok === false, result);
    ok('log message does not contain the key value', !result.logMessage.includes('sk_live_abc123'));
  }

  console.log('\n--- Production + sk_live_ => allowed ---');
  {
    const result = checkStripeEnvironmentGuard({ APP_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_xyz789' });
    ok('ok: true', result.ok === true, result);
  }

  console.log('\n--- Production + sk_test_ => rejected ---');
  {
    const result = checkStripeEnvironmentGuard({ APP_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_xyz789' });
    ok('ok: false', result.ok === false, result);
    ok('log message does not contain the key value', !result.logMessage.includes('sk_test_xyz789'));
  }

  console.log('\n--- Missing APP_ENV => rejected (fail closed) ---');
  {
    const result = checkStripeEnvironmentGuard({ STRIPE_SECRET_KEY: 'sk_live_xyz789' });
    ok('ok: false', result.ok === false, result);
  }

  console.log('\n--- Ambiguous/unrecognized APP_ENV => rejected (fail closed) ---');
  {
    const result = checkStripeEnvironmentGuard({ APP_ENV: 'staging', STRIPE_SECRET_KEY: 'sk_test_abc123' });
    ok('ok: false for unrecognized APP_ENV value', result.ok === false, result);
  }
  {
    const result = checkStripeEnvironmentGuard({ APP_ENV: '', STRIPE_SECRET_KEY: 'sk_test_abc123' });
    ok('ok: false for empty-string APP_ENV', result.ok === false, result);
  }
  {
    // Case sensitivity is deliberate — an accidental "Production" must not
    // silently pass as "production".
    const result = checkStripeEnvironmentGuard({ APP_ENV: 'Production', STRIPE_SECRET_KEY: 'sk_live_xyz789' });
    ok('ok: false for wrong-case APP_ENV', result.ok === false, result);
  }

  console.log('\n--- Missing STRIPE_SECRET_KEY entirely => rejected even with valid APP_ENV ---');
  {
    const result = checkStripeEnvironmentGuard({ APP_ENV: 'production' });
    ok('ok: false', result.ok === false, result);
  }

  console.log('\n--- Malformed key (no recognized prefix) => rejected regardless of environment ---');
  {
    const result = checkStripeEnvironmentGuard({ APP_ENV: 'preview', STRIPE_SECRET_KEY: 'not-a-real-key' });
    ok('ok: false', result.ok === false, result);
  }
  {
    const result = checkStripeEnvironmentGuard({ APP_ENV: 'production', STRIPE_SECRET_KEY: 'not-a-real-key' });
    ok('ok: false', result.ok === false, result);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
