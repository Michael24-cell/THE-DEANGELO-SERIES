#!/usr/bin/env node
// Registers this site's Printify webhook — Printify has no dashboard form
// for this; webhooks are managed entirely through their REST API (confirmed
// directly against developers.printify.com — Webhooks section, not
// guessed). See functions/_lib/printify.js's listPrintifyWebhooks /
// createPrintifyWebhook / updatePrintifyWebhook.
//
// PROTECTED / LOCAL ONLY. Plain Node script, not an HTTP endpoint. Run
// manually by someone with PRINTIFY_API_TOKEN, PRINTIFY_SHOP_ID, and
// PRINTIFY_WEBHOOK_SECRET.
//
// PRINTIFY_WEBHOOK_SECRET here is a secret WE choose (e.g.
// `openssl rand -hex 32`) — NOT one Printify issues. Confirmed directly
// against Printify's live API for this shop (sales_channel:
// "custom_integration") that no endpoint ever returns a webhook secret:
// creation (POST) returns only {id, topic, url, shop_id}; there is no GET
// for a single webhook (405, only PUT/DELETE supported); the shop detail
// endpoint carries no secret field either. So instead, the secret is
// embedded directly in the url WE register — Printify just echoes back
// whatever url we gave it on every delivery — and
// functions/api/printify-webhook.js checks that url's `key` query param
// against PRINTIFY_WEBHOOK_SECRET. See that file's header comment for the
// full rationale.
//
// Base URL defaults to production; pass --url=<...> to point at a
// different one (e.g. a preview deployment).
//
// What it does, per required topic (order:sent-to-production, order:updated,
// order:shipment:created, order:shipment:delivered):
//   - Lists ALL of Printify's existing webhooks for this shop (a topic can
//     have more than one entry — e.g. a stale one from earlier testing next
//     to the real one).
//   - An entry whose url already exactly matches ours (base + our key):
//     left alone.
//   - An entry at the SAME origin+path but a different or missing `key`
//     (e.g. an older registration made before this project used a
//     URL-embedded secret): its url is updated in place, same webhook id.
//   - An entry at a completely different URL (e.g. a stale preview/test
//     endpoint): left untouched and reported as a duplicate — this script
//     never deletes anything.
//   - No entry for this topic at all: creates one.
//
// Printify's API takes one topic per webhook object — there is no
// documented way to subscribe one webhook to multiple topics — so this
// makes up to 4 separate calls.
//
// Safety:
//   - Defaults to --dry-run (lists + prints what it WOULD do). Pass --apply
//     to actually call Printify's API.
//   - Never deletes anything (functions/_lib/printify.js's
//     deletePrintifyWebhook exists for manual cleanup of stale duplicates,
//     but this script doesn't call it — nothing here needs a fresh secret
//     minted by Printify anymore).
//   - Never logs PRINTIFY_API_TOKEN, PRINTIFY_WEBHOOK_SECRET, or any
//     Authorization header value.
//
// Usage:
//   PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... PRINTIFY_WEBHOOK_SECRET=... node scripts/register-printify-webhook.mjs
//   PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... PRINTIFY_WEBHOOK_SECRET=... node scripts/register-printify-webhook.mjs --apply
//   PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... PRINTIFY_WEBHOOK_SECRET=... node scripts/register-printify-webhook.mjs --url=https://printify-test.the-deangelo-series.pages.dev/api/printify-webhook --apply

import { listPrintifyWebhooks, createPrintifyWebhook, updatePrintifyWebhook } from '../functions/_lib/printify.js';

const APPLY = process.argv.includes('--apply');
const urlArg = process.argv.find((a) => a.startsWith('--url='));
const BASE_URL = urlArg ? urlArg.slice('--url='.length) : 'https://thedeangeloseries.com/api/printify-webhook';
const REQUIRED_TOPICS = [
  'order:sent-to-production',
  'order:updated',
  'order:shipment:created',
  'order:shipment:delivered',
];

function sameEndpoint(url) {
  try {
    const u = new URL(url);
    const b = new URL(BASE_URL);
    return u.origin === b.origin && u.pathname === b.pathname;
  } catch {
    return false;
  }
}

async function main() {
  const env = {
    PRINTIFY_API_TOKEN: process.env.PRINTIFY_API_TOKEN,
    PRINTIFY_SHOP_ID: process.env.PRINTIFY_SHOP_ID,
  };
  const secret = process.env.PRINTIFY_WEBHOOK_SECRET;
  if (!env.PRINTIFY_API_TOKEN || !env.PRINTIFY_SHOP_ID || !secret) {
    console.error('[register-printify-webhook] PRINTIFY_API_TOKEN, PRINTIFY_SHOP_ID, and PRINTIFY_WEBHOOK_SECRET must all be set in the environment.');
    process.exit(1);
  }
  const fullUrl = `${BASE_URL}?key=${encodeURIComponent(secret)}`;

  console.log(`[register-printify-webhook] Mode: ${APPLY ? 'APPLY (will call Printify)' : 'DRY RUN (no changes — pass --apply to execute)'}`);
  console.log(`[register-printify-webhook] Target URL: ${fullUrl}\n`);

  let existing;
  try {
    existing = await listPrintifyWebhooks(env);
  } catch (err) {
    console.error('[register-printify-webhook] Could not list existing webhooks:', err.message);
    process.exit(1);
  }
  console.log(`Found ${existing.length} existing webhook(s) for this shop:`);
  for (const w of existing) console.log(`  - ${w.topic} -> ${w.url} (id ${w.id})`);
  console.log('');

  for (const topic of REQUIRED_TOPICS) {
    const matches = existing.filter((w) => w.topic === topic);
    const exactMatch = matches.find((w) => w.url === fullUrl);
    const sameEndpointMatches = matches.filter((w) => w !== exactMatch && sameEndpoint(w.url));
    const unrelatedMatches = matches.filter((w) => w !== exactMatch && !sameEndpoint(w.url));

    if (exactMatch) {
      console.log(`[${topic}] Already registered with the correct url. (id ${exactMatch.id}) — no change needed.`);
    } else if (sameEndpointMatches.length > 0) {
      const [first, ...rest] = sameEndpointMatches;
      console.log(`[${topic}] Exists at this endpoint but with a different/missing key ("${first.url}"). ${APPLY ? 'Updating url...' : 'Would update url.'}`);
      if (APPLY) {
        try {
          await updatePrintifyWebhook(env, first.id, { url: fullUrl });
          console.log(`[${topic}] Updated (id ${first.id}).`);
        } catch (err) {
          console.error(`[${topic}] Update failed:`, err.message);
        }
      }
      if (rest.length > 0) console.log(`  ${rest.length} additional duplicate(s) at this endpoint left untouched (${rest.map((w) => w.id).join(', ')}).`);
    } else {
      console.log(`[${topic}] Not registered yet. ${APPLY ? 'Creating...' : 'Would create.'}`);
      if (APPLY) {
        try {
          const created = await createPrintifyWebhook(env, { topic, url: fullUrl });
          console.log(`[${topic}] Created (id ${created.id}).`);
        } catch (err) {
          console.error(`[${topic}] Creation failed:`, err.message);
        }
      }
    }

    if (unrelatedMatches.length > 0) {
      console.log(`  ${unrelatedMatches.length} entr${unrelatedMatches.length === 1 ? 'y' : 'ies'} for this topic at a DIFFERENT URL left untouched (${unrelatedMatches.map((w) => `${w.id} -> ${w.url}`).join(', ')}).`);
    }
  }

  console.log('\n--- Summary ---');
  if (!APPLY) {
    console.log('Dry run only — nothing was created or changed. Re-run with --apply to execute.');
  } else {
    console.log(`Done. PRINTIFY_WEBHOOK_SECRET must be set to this exact value in the matching Cloudflare environment`);
    console.log('(Preview for a preview URL, Production for the production URL) for incoming events to verify:\n');
    console.log(`  ${secret}\n`);
  }
}

main().catch((err) => {
  console.error('[register-printify-webhook] Fatal error:', err.message);
  process.exit(1);
});
