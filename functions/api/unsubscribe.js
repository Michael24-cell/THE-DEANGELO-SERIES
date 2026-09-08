// Cloudflare Pages Function — one-click unsubscribe from release-announcement email
// Route: GET /api/unsubscribe?email=...&token=...
//
// The link in every release-announcement email (see
// functions/_lib/email-templates.js's newReleaseTemplate and
// scripts/send-release-email.mjs) points here. Deliberately a plain GET
// with no confirmation step, per standard one-click-unsubscribe practice —
// asking someone to log in or click again to leave a mailing list is the
// kind of dark pattern this should never become.
//
// Requires BOTH email and the token minted for that email
// (orders-db.js's upsertSubscriber) — the token, not the email address
// alone, is what authorizes the change, so this can't be used to
// unsubscribe a stranger's address by guessing it from an order
// confirmation or a leaked list.

import { unsubscribeByToken } from '../_lib/orders-db.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get('email') || '';
  const token = url.searchParams.get('token') || '';

  if (!email || !token) {
    return page('This unsubscribe link is missing information and can\'t be used. If you followed a link from an email, try copying the full link into your browser.', 400);
  }

  if (!env.DB) {
    console.error('[unsubscribe] Missing D1 binding: DB');
    return page('Something went wrong on our end. Please email support@thedeangeloseries.com and we\'ll remove you by hand.', 500);
  }

  const result = await unsubscribeByToken(env, { email, token });

  if (result === 'not_found') {
    return page('This unsubscribe link isn\'t valid. If you\'d still like to stop receiving release announcements, email support@thedeangeloseries.com and we\'ll take care of it.', 400);
  }

  // 'unsubscribed' and 'already_unsubscribed' show the same success
  // message — from the visitor's side both mean "you will not get another
  // one," and distinguishing them invites confusion, not clarity.
  return page(`You’re unsubscribed. ${escapeHtml(email)} will not receive release-announcement email going forward. (Order and shipping updates for anything you’ve already bought are unaffected — those aren’t marketing email.)`, 200);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(message, status) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe — The DeAngelo Series</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0A0A0A;color:#F5F5F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px}
  .card{max-width:440px;text-align:center}
  .brand{font-size:11px;letter-spacing:.3em;text-transform:uppercase;opacity:.55;margin-bottom:24px}
  p{font-size:1rem;line-height:1.6;font-weight:300}
  a{color:#F5F5F1}
</style>
</head>
<body>
  <div class="card">
    <p class="brand">The DeAngelo Series</p>
    <p>${message}</p>
  </div>
</body>
</html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
