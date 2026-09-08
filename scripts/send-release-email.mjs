#!/usr/bin/env node
// Sends the "new piece released" announcement to every currently-subscribed
// email (migrations/0005's subscribers table, subscribed = 1).
//
// PROTECTED / LOCAL ONLY. This is a plain Node script, not an HTTP endpoint —
// nothing in functions/ exposes bulk-send capability to the internet, and
// this file must stay that way. It must be run manually by someone with:
//   - `wrangler` authenticated against this Cloudflare account (same as the
//     reconciliation scripts and D1 migrations in this repo).
//   - RESEND_API_KEY, FROM_EMAIL in the environment (REPLY_TO_EMAIL/
//     SUPPORT_EMAIL optional — see functions/_lib/resend.js).
//   - SITE_URL, if not thedeangeloseries.com (used to build the unsubscribe
//     link — see functions/api/unsubscribe.js).
//
// Safety:
//   - Defaults to --dry-run (prints the recipient count, the rendered
//     subject, and the first few addresses — sends nothing). Pass --apply
//     to actually call Resend.
//   - --local points at the local D1 SQLite state instead of the real
//     database (for rehearsing the script itself, not for sending real
//     announcement email).
//   - --preview targets the PREVIEW D1 database (deangelo-series-orders-
//     preview) instead of production. Use this while testing the
//     subscribe -> announce -> unsubscribe flow end to end with a handful
//     of real test checkouts, before ever pointing this at production
//     subscribers.
//   - --limit N caps how many recipients are actually mailed, oldest
//     subscriber first — useful for a small first real send to sanity-check
//     deliverability/rendering before mailing everyone.
//   - Every send carries a per-recipient Resend Idempotency-Key derived from
//     (email, title), so accidentally running the same announcement twice
//     does not double-mail anyone within the same day.
//
// Usage:
//   RESEND_API_KEY=... FROM_EMAIL=... node scripts/send-release-email.mjs \
//     --title "New York" --blurb "Chrysler Building and Empire State Building, 2019." \
//     --url "https://thedeangeloseries.com/product.html?p=new-york-crew" \
//     --image "https://thedeangeloseries.com/new%20york%20crew%20model.png"
//   ...same... --apply
//   ...same... --preview --apply --limit 5   (small first real send)

import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { newReleaseTemplate } from '../functions/_lib/email-templates.js';
import { sendEmail, stableIdempotencyKey } from '../functions/_lib/resend.js';

if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APPLY = process.argv.includes('--apply');
const LOCAL = process.argv.includes('--local');
const PREVIEW = process.argv.includes('--preview');
const D1_DATABASE = PREVIEW ? 'deangelo-series-orders-preview' : 'deangelo-series-orders';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const TITLE = argValue('--title');
const BLURB = argValue('--blurb');
const URL_ = argValue('--url');
const IMAGE = argValue('--image');
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : undefined;
const SEND_DELAY_MS = 350; // stay well under Resend's rate limit on a plain sequential loop

function d1Query(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', D1_DATABASE, LOCAL ? '--local' : '--remote', '--json', '--command', sql],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(out)[0]?.results ?? [];
}

/**
 * Pure enough to unit-test without touching D1/Resend: given the list of
 * {email, unsubscribe_token} rows and the campaign fields, builds exactly
 * what would be sent to each recipient.
 */
export function buildSends(subscribers, { title, blurb, url, image, siteUrl = 'https://thedeangeloseries.com' }) {
  return subscribers.map((s) => {
    const unsubscribeUrl = `${siteUrl}/api/unsubscribe?email=${encodeURIComponent(s.email)}&token=${encodeURIComponent(s.unsubscribe_token)}`;
    const template = newReleaseTemplate({ title, blurb, imageUrl: image, url, unsubscribeUrl });
    return { email: s.email, template };
  });
}

async function main() {
  if (!TITLE || !BLURB || !URL_) {
    console.error('[send-release-email] --title, --blurb, and --url are all required. --image is optional but recommended.');
    process.exit(1);
  }
  if (APPLY && (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL)) {
    console.error('[send-release-email] --apply requires RESEND_API_KEY and FROM_EMAIL in the environment.');
    process.exit(1);
  }

  const env = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    FROM_EMAIL: process.env.FROM_EMAIL,
    REPLY_TO_EMAIL: process.env.REPLY_TO_EMAIL,
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
  };
  const siteUrl = (process.env.SITE_URL || 'https://thedeangeloseries.com').replace(/\/+$/, '');

  console.log(`[send-release-email] Mode: ${APPLY ? 'APPLY (will call Resend)' : 'DRY RUN (no email sent — pass --apply to send)'} — ${LOCAL ? 'LOCAL D1' : PREVIEW ? 'PREVIEW D1' : 'PRODUCTION D1'}`);

  const rows = d1Query(`SELECT email, unsubscribe_token FROM subscribers WHERE subscribed = 1 ORDER BY created_at ASC`);
  const limited = LIMIT ? rows.slice(0, LIMIT) : rows;
  console.log(`[send-release-email] ${rows.length} subscribed email(s)${LIMIT ? `, sending to the first ${limited.length} (--limit ${LIMIT})` : ''}.`);

  const sends = buildSends(limited, { title: TITLE, blurb: BLURB, url: URL_, image: IMAGE, siteUrl });

  if (!APPLY) {
    console.log(`\n[send-release-email] Subject: ${sends[0]?.template.subject ?? '(no recipients)'}`);
    console.log('[send-release-email] First few recipients:', limited.slice(0, 5).map((r) => r.email));
    console.log('\n[send-release-email] This was a dry run — re-run with --apply to actually send.');
    return;
  }

  let sent = 0, failed = 0;
  for (const { email, template } of sends) {
    const idempotencyKey = await stableIdempotencyKey([email, TITLE], 60 * 60 * 24);
    const result = await sendEmail({ env, to: email, subject: template.subject, html: template.html, text: template.text, idempotencyKey });
    if (result.ok) {
      sent++;
      console.log(`[send-release-email] Sent to ${email} (${result.id})`);
    } else {
      failed++;
      console.error(`[send-release-email] FAILED for ${email}: ${result.error}`);
    }
    await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
  }

  console.log(`\n[send-release-email] Done — ${sent} sent, ${failed} failed, ${sends.length} attempted.`);
}

// pathToFileURL(), not plain `file://${process.argv[1]}` template
// concatenation — this repo's directory name has a space in it
// ("THE DEANGELO SERIES"), which import.meta.url always URL-encodes
// (%20) but naive string concatenation never does, so the naive
// comparison used elsewhere in this repo's scripts is silently always
// false here and main() would never run.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[send-release-email] Fatal error:', err);
    process.exit(1);
  });
}
