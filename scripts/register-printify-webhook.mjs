#!/usr/bin/env node
// Registers this site's Printify webhook — Printify has no dashboard form
// for this; webhooks are managed entirely through their REST API (confirmed
// directly against developers.printify.com — Webhooks section, not
// guessed). See functions/_lib/printify.js's listPrintifyWebhooks /
// createPrintifyWebhook / updatePrintifyWebhook / deletePrintifyWebhook.
//
// PROTECTED / LOCAL ONLY. Plain Node script, not an HTTP endpoint. Run
// manually by someone with PRINTIFY_API_TOKEN and PRINTIFY_SHOP_ID.
//
// Target URL defaults to production; pass --url=<...> to point at a
// different one (e.g. a preview deployment) — useful for proving the whole
// delete/recreate/secret flow works before ever touching production.
//
// What it does, per required topic (order:sent-to-production, order:updated,
// order:shipment:created, order:shipment:delivered):
//   - Lists ALL of Printify's existing webhooks for this shop (a topic can
//     have more than one entry — e.g. a stale one from earlier testing next
//     to a correct one; this script checks every entry for a topic, not
//     just the first it finds).
//   - Without --recreate:
//       - An entry already pointing at the target URL: left alone.
//       - An entry for this topic pointing elsewhere (stale): its url is
//         updated in place — this does NOT change its secret.
//       - No entry for this topic at all: creates one.
//       - Any additional entries beyond the first for the same topic are
//         reported as extra duplicates, never touched (pass --recreate to
//         clean them up).
//   - With --recreate: deletes EVERY existing entry for a topic (regardless
//     of what url it points at) and creates one fresh in their place. This
//     is the only way to get a secret we can actually verify — Printify
//     never re-shows an existing webhook's secret, only at creation.
//
// Printify's API takes one topic per webhook object — there is no
// documented way to subscribe one webhook to multiple topics — so this
// makes up to 4 separate calls (times 2 if deleting first), all against the
// same target url.
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
//   - --recreate is never assumed — deleting a live webhook is only ever
//     done when explicitly requested via that flag.
//   - Never logs PRINTIFY_API_TOKEN or any Authorization header value.
//
// Usage:
//   PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... node scripts/register-printify-webhook.mjs
//   PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... node scripts/register-printify-webhook.mjs --apply
//   PRINTIFY_API_TOKEN=... PRINTIFY_SHOP_ID=... node scripts/register-printify-webhook.mjs --url=https://printify-test.the-deangelo-series.pages.dev/api/printify-webhook --recreate --apply

import { listPrintifyWebhooks, createPrintifyWebhook, updatePrintifyWebhook, deletePrintifyWebhook } from '../functions/_lib/printify.js';

const APPLY = process.argv.includes('--apply');
const RECREATE = process.argv.includes('--recreate');
const urlArg = process.argv.find((a) => a.startsWith('--url='));
const WEBHOOK_URL = urlArg ? urlArg.slice('--url='.length) : 'https://thedeangeloseries.com/api/printify-webhook';
const REQUIRED_TOPICS = [
  'order:sent-to-production',
  'order:updated',
  'order:shipment:created',
  'order:shipment:delivered',
];

async function main() {
  console.log(`[register-printify-webhook] Mode: ${APPLY ? 'APPLY (will call Printify)' : 'DRY RUN (no changes — pass --apply to execute)'}${RECREATE ? ' + RECREATE (deletes existing entries for these topics first)' : ''}`);
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
    const matches = existing.filter((w) => w.topic === topic);
    const exactMatch = matches.find((w) => w.url === WEBHOOK_URL);
    const staleMatches = matches.filter((w) => w !== exactMatch);

    if (RECREATE) {
      // Only ever deletes entries already pointing at OUR target URL — an
      // entry for this topic sitting at a different URL is a separate
      // concern and must never be touched just because --recreate was
      // passed for a different target.
      const toDelete = matches.filter((w) => w.url === WEBHOOK_URL);
      const untouched = matches.filter((w) => w.url !== WEBHOOK_URL);

      if (toDelete.length === 0) {
        console.log(`[${topic}] Nothing at this URL to recreate. ${APPLY ? 'Creating...' : 'Would create.'}`);
      } else {
        console.log(`[${topic}] Recreating — ${APPLY ? 'deleting' : 'would delete'} ${toDelete.length} existing entr${toDelete.length === 1 ? 'y' : 'ies'} at this URL (${toDelete.map((w) => w.id).join(', ')}).`);
        if (APPLY) {
          for (const w of toDelete) {
            try {
              await deletePrintifyWebhook(env, w.id);
            } catch (err) {
              console.error(`[${topic}] Delete of ${w.id} failed:`, err.message);
            }
          }
        }
      }
      if (untouched.length > 0) {
        console.log(`  ${untouched.length} entr${untouched.length === 1 ? 'y' : 'ies'} for this topic at a DIFFERENT url left untouched (${untouched.map((w) => `${w.id} -> ${w.url}`).join(', ')}).`);
      }
      if (!APPLY) continue;
      try {
        const created = await createPrintifyWebhook(env, { topic, url: WEBHOOK_URL });
        newSecretsByTopic[topic] = created.secret;
        console.log(`[${topic}] Created fresh (id ${created.id}).`);
      } catch (err) {
        console.error(`[${topic}] Creation failed:`, err.message);
      }
      continue;
    }

    if (exactMatch) {
      console.log(`[${topic}] Already registered and points at the right URL. (id ${exactMatch.id}) — no change needed.`);
      if (staleMatches.length > 0) {
        console.log(`  Also found ${staleMatches.length} extra duplicate(s) for this topic pointing elsewhere (${staleMatches.map((w) => `${w.id} -> ${w.url}`).join(', ')}) — not touched. Pass --recreate to clean these up.`);
      }
      continue;
    }

    if (staleMatches.length > 0) {
      const [first, ...rest] = staleMatches;
      console.log(`[${topic}] Exists but points at "${first.url}" instead of ours. ${APPLY ? 'Updating url...' : 'Would update url.'}`);
      if (rest.length > 0) console.log(`  ${rest.length} additional duplicate(s) for this topic left untouched (${rest.map((w) => w.id).join(', ')}).`);
      if (!APPLY) continue;
      try {
        await updatePrintifyWebhook(env, first.id, { url: WEBHOOK_URL });
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
    console.log('Dry run only — nothing was created, deleted, or changed. Re-run with --apply to execute.');
  } else if (secretValues.length === 0) {
    console.log('No new webhooks were created this run (everything already existed or only needed a URL update).');
    console.log('If you do not already have a working PRINTIFY_WEBHOOK_SECRET saved from when these were first created,');
    console.log('re-run with --recreate --apply to delete and recreate them, which mints a fresh, known secret.');
  } else if (secretValues.length === 1) {
    console.log(`New webhook(s) created for ${WEBHOOK_URL}, all sharing the same secret. Set this as PRINTIFY_WEBHOOK_SECRET`);
    console.log('in the matching Cloudflare environment (Preview for a preview URL, Production for the production URL):\n');
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
