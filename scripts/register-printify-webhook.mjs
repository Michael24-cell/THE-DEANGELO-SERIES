#!/usr/bin/env node
// Registers this site's Printify webhook — Printify has no dashboard form
// for this; webhooks are managed entirely through their REST API (confirmed
// directly against developers.printify.com — Webhooks section, not
// guessed). See functions/_lib/printify.js's listPrintifyWebhooks /
// createPrintifyWebhook / updatePrintifyWebhook.
//
// PROTECTED / LOCAL ONLY. Plain Node script, not an HTTP endpoint. Run
// manually by someone with PRINTIFY_API_TOKEN and PRINTIFY_SHOP_ID.
//
// What it does, per required topic (order:sent-to-production, order:updated,
// order:shipment:created, order:shipment:delivered):
//   - Lists Printify's existing webhooks for this shop.
//   - If a webhook for that topic already points at our URL: leaves it
//     alone (Printify never returns a webhook's secret again after
//     creation, so this script cannot recover an existing one — see the
//     printed guidance below if you don't already have it saved).
//   - If a webhook for that topic exists but points somewhere else (e.g. a
//     stale test URL): updates its url in place — this does NOT change its
//     secret.
//   - If no webhook exists for that topic: creates one. Creation is the
//     ONLY call that returns a usable secret, since Printify only shows it
//     once.
//
// Printify's API takes one topic per webhook object — there is no
// documented way to subscribe one webhook to multiple topics — so this
// makes up to 4 separate calls, all pointing at the same url.
//
// IMPORTANT — single-secret assumption: functions/api/printify-webhook.js
// verifies every incoming event against exactly one PRINTIFY_WEBHOOK_SECRET
// value, regardless of topic. This script checks whether the secrets
// returned across multiple newly-created webhooks in the same run actually
// match, and warns loudly if they don't — that would mean the webhook
// handler needs to accept more than one valid secret before this works for
// every topic. Never silently assumes they match.
//
// Safety:
//   - Defaults to --dry-run (lists + prints what it WOULD do). Pass --apply
//     to actually call Printify's API.
//   - Never deletes or recreates an existing, correctly-pointed webhook —
//     doing that would invalidate whatever secret is already in use
//     elsewhere. There is no --recreate flag; do that manually via the API
//     (or ask for it explicitly) if you deliberately want a fresh secret.
//   - Never logs PRINTIFY_API_TOKEN or any Authorization header value.
//
// Usage:
//   PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... node scripts/register-printify-webhook.mjs
//   PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... node scripts/register-printify-webhook.mjs --apply

import { listPrintifyWebhooks, createPrintifyWebhook, updatePrintifyWebhook } from '../functions/_lib/printify.js';

const APPLY = process.argv.includes('--apply');
const WEBHOOK_URL = 'https://thedeangeloseries.com/api/printify-webhook';
const REQUIRED_TOPICS = [
  'order:sent-to-production',
  'order:updated',
  'order:shipment:created',
  'order:shipment:delivered',
];

async function main() {
  console.log(`[register-printify-webhook] Mode: ${APPLY ? 'APPLY (will call Printify)' : 'DRY RUN (no changes — pass --apply to execute)'}`);
  console.log(`[register-printify-webhook] Target URL: ${WEBHOOK_URL}\n`);

  const env = {
    PRINTIFY_API_TOKEN: process.env.PRINTIFY_API_TOKEN,
    PRINTIFY_SHOP_ID: process.env.PRINTIFY_SHOP_ID,
  };
  if (!env.PRINTIFY_API_TOKEN || !env.PRINTIFY_SHOP_ID) {
    console.error('[register-printify-webhook] PRINTIFY_API_TOKEN and PRINTIFY_SHOP_ID must both be set in the environment.');
    process.exit(1);
  }

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

  const newSecretsByTopic = {};

  for (const topic of REQUIRED_TOPICS) {
    const match = existing.find((w) => w.topic === topic);

    if (match && match.url === WEBHOOK_URL) {
      console.log(`[${topic}] Already registered and points at the right URL. (id ${match.id}) — no change needed.`);
      continue;
    }

    if (match) {
      console.log(`[${topic}] Exists but points at "${match.url}" instead of ours. ${APPLY ? 'Updating url...' : 'Would update url.'}`);
      if (!APPLY) continue;
      try {
        await updatePrintifyWebhook(env, match.id, { url: WEBHOOK_URL });
        console.log(`[${topic}] Updated. This does NOT change its secret — if you don't already have it, see the note below.`);
      } catch (err) {
        console.error(`[${topic}] Update failed:`, err.message);
      }
      continue;
    }

    console.log(`[${topic}] Not registered yet. ${APPLY ? 'Creating...' : 'Would create.'}`);
    if (!APPLY) continue;
    try {
      const created = await createPrintifyWebhook(env, { topic, url: WEBHOOK_URL });
      newSecretsByTopic[topic] = created.secret;
      console.log(`[${topic}] Created (id ${created.id}).`);
    } catch (err) {
      console.error(`[${topic}] Creation failed:`, err.message);
    }
  }

  console.log('\n--- Summary ---');
  const secretValues = [...new Set(Object.values(newSecretsByTopic).filter(Boolean))];

  if (!APPLY) {
    console.log('Dry run only — nothing was created or changed. Re-run with --apply to execute.');
  } else if (secretValues.length === 0) {
    console.log('No new webhooks were created this run (everything already existed or only needed a URL update).');
    console.log('If you do not already have a working PRINTIFY_WEBHOOK_SECRET saved from when these were first created,');
    console.log('Printify will not show it to you again — you would need to delete the affected webhook(s) via the API');
    console.log('and re-run this script to mint a fresh one. Ask for that explicitly if you want it done.');
  } else if (secretValues.length === 1) {
    console.log('New webhook(s) created, all sharing the same secret. Set this in Cloudflare as PRINTIFY_WEBHOOK_SECRET');
    console.log('(Production AND Preview environments):\n');
    console.log(`  ${secretValues[0]}\n`);
  } else {
    console.log('WARNING: the newly-created webhooks returned DIFFERENT secrets per topic:');
    for (const [topic, secret] of Object.entries(newSecretsByTopic)) console.log(`  ${topic}: ${secret}`);
    console.log('\nThe current webhook handler (functions/api/printify-webhook.js) only checks incoming requests');
    console.log('against ONE PRINTIFY_WEBHOOK_SECRET value for every topic — with different secrets per topic, only');
    console.log('one topic\'s events would ever pass signature verification. This needs a code change (accept multiple');
    console.log('valid secrets) before registering webhooks this way will fully work. Flag this before setting any one');
    console.log('of these values in Cloudflare.');
  }
}

main().catch((err) => {
  console.error('[register-printify-webhook] Fatal error:', err.message);
  process.exit(1);
});
