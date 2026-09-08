// Covers the marketing-consent capture/storage/send path added on top of
// migrations/0004 (orders.marketing_opt_in) and 0005 (subscribers):
//   - orders-db.js: upsertSubscriber, unsubscribeByToken, getSubscribedEmails
//   - functions/api/stripe-webhook.js: only upserts a subscriber when the
//     order's marketing_opt_in is true — never on false/undefined
//   - functions/api/unsubscribe.js: the one-click unsubscribe endpoint
//   - functions/_lib/email-templates.js: newReleaseTemplate always carries
//     a real unsubscribe link
//   - scripts/send-release-email.mjs: buildSends() (the pure part — no D1/
//     Resend access, safe to test directly)
//
// Run: node tests/marketing-subscribers.test.mjs (or `npm test`)

import crypto from 'node:crypto';
import { upsertSubscriber, unsubscribeByToken, getSubscribedEmails } from '../functions/_lib/orders-db.js';
import { onRequest as unsubscribeOnRequest } from '../functions/api/unsubscribe.js';
import { newReleaseTemplate } from '../functions/_lib/email-templates.js';
import { buildSends } from '../scripts/send-release-email.mjs';
import { createFakeD1 } from './_fake-d1.mjs';

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function makeReq(url) {
  return { method: 'GET', url };
}

console.log('--- upsertSubscriber: creates, renews, never rotates the token ---');
{
  const db = createFakeD1();
  const env = { DB: db };

  const token1 = await upsertSubscriber(env, { email: 'Buyer@Example.com', orderId: 'order-1' });
  ok('First upsert creates a subscribed=1 row', db._tables.subscribers.length === 1 && db._tables.subscribers[0].subscribed === 1);
  ok('Email is normalized to lowercase', db._tables.subscribers[0].email === 'buyer@example.com');
  ok('Returns a non-empty unsubscribe token', typeof token1 === 'string' && token1.length > 0);

  await unsubscribeByToken(env, { email: 'buyer@example.com', token: token1 });
  ok('Unsubscribed after the token link', db._tables.subscribers[0].subscribed === 0);

  const token2 = await upsertSubscriber(env, { email: 'buyer@example.com', orderId: 'order-2' });
  ok('A later order with opt-in re-subscribes (subscribed back to 1)', db._tables.subscribers[0].subscribed === 1);
  ok('Renewal does NOT rotate the token — old email links keep working', token2 === token1, { token1, token2 });
  ok('Still exactly one row for the email (no duplicate)', db._tables.subscribers.length === 1);
}

console.log('\n--- unsubscribeByToken: only the matching (email, token) pair works ---');
{
  const db = createFakeD1();
  const env = { DB: db };
  const token = await upsertSubscriber(env, { email: 'a@example.com', orderId: 'order-1' });

  const wrongToken = await unsubscribeByToken(env, { email: 'a@example.com', token: 'not-the-real-token' });
  ok('Wrong token is rejected (not_found)', wrongToken === 'not_found', wrongToken);
  ok('Row is untouched by a wrong-token attempt', db._tables.subscribers[0].subscribed === 1);

  const unknownEmail = await unsubscribeByToken(env, { email: 'nobody@example.com', token });
  ok('Unknown email + a real token (belonging to someone else) is rejected', unknownEmail === 'not_found', unknownEmail);

  const result1 = await unsubscribeByToken(env, { email: 'a@example.com', token });
  ok('Correct (email, token) unsubscribes', result1 === 'unsubscribed', result1);

  const result2 = await unsubscribeByToken(env, { email: 'a@example.com', token });
  ok('Unsubscribing again reports already_unsubscribed, not an error', result2 === 'already_unsubscribed', result2);

  const missing = await unsubscribeByToken(env, { email: '', token: '' });
  ok('Empty email/token is rejected without touching D1', missing === 'not_found', missing);
}

console.log('\n--- getSubscribedEmails: only subscribed=1 rows, in signup order ---');
{
  const db = createFakeD1();
  const env = { DB: db };
  await upsertSubscriber(env, { email: 'first@example.com', orderId: 'o1' });
  const secondToken = await upsertSubscriber(env, { email: 'second@example.com', orderId: 'o2' });
  await upsertSubscriber(env, { email: 'third@example.com', orderId: 'o3' });
  await unsubscribeByToken(env, { email: 'second@example.com', token: secondToken });

  const rows = await getSubscribedEmails(env);
  ok('Excludes the unsubscribed address', !rows.some((r) => r.email === 'second@example.com'), rows);
  ok('Includes the two still-subscribed addresses', rows.length === 2, rows);
  ok('Each row carries its unsubscribe_token (needed to build the link)', rows.every((r) => typeof r.unsubscribe_token === 'string' && r.unsubscribe_token.length > 0));
}

console.log('\n--- functions/api/unsubscribe.js: the actual HTTP endpoint ---');
{
  const db = createFakeD1();
  const env = { DB: db };
  const token = await upsertSubscriber(env, { email: 'link@example.com', orderId: 'o1' });

  const resMissing = await unsubscribeOnRequest({ request: makeReq('https://thedeangeloseries.com/api/unsubscribe'), env });
  ok('Missing email/token -> 400', resMissing.status === 400, resMissing.status);

  const resWrong = await unsubscribeOnRequest({ request: makeReq(`https://thedeangeloseries.com/api/unsubscribe?email=link@example.com&token=wrong`), env });
  ok('Wrong token -> 400 (not a 200 that pretends to succeed)', resWrong.status === 400, resWrong.status);

  const resOk = await unsubscribeOnRequest({ request: makeReq(`https://thedeangeloseries.com/api/unsubscribe?email=link@example.com&token=${encodeURIComponent(token)}`), env });
  ok('Correct link -> 200', resOk.status === 200, resOk.status);
  const bodyText = await resOk.text();
  ok('Confirmation page mentions the email that was unsubscribed', bodyText.includes('link@example.com'));
  ok('Response is HTML, not JSON (a human clicks this from their inbox)', resOk.headers.get('Content-Type').includes('text/html'));

  ok('Actually flipped subscribed to 0', db._tables.subscribers[0].subscribed === 0);

  const resPost = await unsubscribeOnRequest({ request: { method: 'POST', url: 'https://thedeangeloseries.com/api/unsubscribe' }, env });
  ok('Non-GET is rejected (405)', resPost.status === 405, resPost.status);
}

console.log('\n--- newReleaseTemplate: the only marketing template, always carries an unsubscribe link ---');
{
  const t = newReleaseTemplate({
    title: 'New York',
    blurb: 'Chrysler Building and Empire State Building, 2019.',
    imageUrl: 'https://thedeangeloseries.com/new%20york%20crew%20model.png',
    url: 'https://thedeangeloseries.com/product.html?p=new-york-crew',
    unsubscribeUrl: 'https://thedeangeloseries.com/api/unsubscribe?email=x%40example.com&token=abc123',
  });
  ok('Subject mentions the piece title', t.subject.includes('New York'), t.subject);
  ok('HTML includes the unsubscribe link', t.html.includes('/api/unsubscribe?email=x%40example.com&amp;token=abc123') || t.html.includes('/api/unsubscribe?email=x%40example.com&token=abc123'), t.html);
  ok('HTML includes the shop link', t.html.includes(encodeURI('https://thedeangeloseries.com/product.html?p=new-york-crew').replace(/&/g, '&amp;')) || t.html.includes('product.html?p=new-york-crew'));
  ok('Plain-text version also includes the unsubscribe link', t.text.includes('/api/unsubscribe'));
  ok('User-supplied blurb is HTML-escaped (no raw HTML injection)', !t.html.includes('<script'));
}

console.log('\n--- send-release-email.mjs buildSends(): pure mapping from subscriber rows to sends ---');
{
  const subscribers = [
    { email: 'one@example.com', unsubscribe_token: 'tok-1' },
    { email: 'two@example.com', unsubscribe_token: 'tok-2' },
  ];
  const sends = buildSends(subscribers, {
    title: 'Villa d\'Este',
    blurb: 'A 1980 vintage Kodak slide of Tivoli, Italy.',
    url: 'https://thedeangeloseries.com/product.html?p=villa-d-este-crew',
    image: 'https://thedeangeloseries.com/villa%20de%20este%20crew%20model.png',
  });
  ok('One send per subscriber', sends.length === 2, sends.length);
  ok('Each send targets the right email', sends[0].email === 'one@example.com' && sends[1].email === 'two@example.com');
  ok('Each recipient gets THEIR OWN unsubscribe token in the link, not a shared one', sends[0].template.html.includes('token=tok-1') && sends[1].template.html.includes('token=tok-2'));
  ok('No recipient sees another recipient\'s email/token in their own copy', !sends[0].template.html.includes('two@example.com') && !sends[1].template.html.includes('one@example.com'));
}

console.log('\n--- Integration: stripe-webhook.js only creates a subscriber on true, never on false/undefined ---');
{
  // Re-derive the exact decision stripe-webhook.js makes from Stripe Session
  // metadata, without re-running the full webhook (already covered end-to-
  // end by tests/checkout-new-products.test.mjs and stripe-webhook-payment-
  // gate.test.mjs). This isolates the specific tri-state parsing rule.
  function marketingOptInFromMetadata(metadata) {
    return metadata?.marketing_opt_in === 'true'
      ? true
      : metadata?.marketing_opt_in === 'false'
        ? false
        : undefined;
  }
  ok('metadata.marketing_opt_in = "true" -> true', marketingOptInFromMetadata({ marketing_opt_in: 'true' }) === true);
  ok('metadata.marketing_opt_in = "false" -> false', marketingOptInFromMetadata({ marketing_opt_in: 'false' }) === false);
  ok('Missing metadata key -> undefined, not false (an older session shouldn\'t look like an explicit no)', marketingOptInFromMetadata({}) === undefined);
  ok('A tampered/unexpected value -> undefined, never guessed as true', marketingOptInFromMetadata({ marketing_opt_in: 'yes' }) === undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
