// Static safety assertions for workers/reconcile-shipments.js — the Worker
// MUST be strictly read-only against Printify. Rather than trusting a code
// comment, this greps the actual EXECUTABLE source (comments stripped, so
// the module's own explanatory prose about what NOT to do can't accidentally
// satisfy or fail these checks) for anything that could mutate a Printify
// order — a future edit that reintroduces a POST/PUT/PATCH/DELETE call, or
// imports createPrintifyOrder/sendPrintifyOrderToProduction, fails this test.
//
// Run: node tests/reconcile-shipments-worker-safety.test.mjs (or `npm test`)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_SOURCE_RAW = readFileSync(path.join(REPO_ROOT, 'workers/reconcile-shipments.js'), 'utf8');
const PRINTIFY_LIB_SOURCE = readFileSync(path.join(REPO_ROOT, 'functions/_lib/printify.js'), 'utf8');

// Strips // line comments and /* */ block comments (naive but sufficient for
// this repo's plain, string-literal-light style) so prose ABOUT forbidden
// identifiers/methods (this file's own module header, for one) can never be
// mistaken for the code actually using them.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const WORKER_CODE = stripComments(WORKER_SOURCE_RAW);

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  PASS:', label); }
  else { fail++; console.log('  FAIL:', label, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function run() {
  console.log('--- Forbidden Printify mutation functions never called or imported (code, not comments) ---');
  for (const name of ['createPrintifyOrder', 'sendPrintifyOrderToProduction']) {
    ok(`"${name}" does not appear in executable code`, !WORKER_CODE.includes(name));
  }

  console.log('\n--- Forbidden Printify endpoint paths never referenced in code ---');
  for (const p of ['/cancel.json', '/send_to_production.json', '/orders.json']) {
    ok(`"${p}" does not appear in executable code`, !WORKER_CODE.includes(p));
  }

  console.log('\n--- No HTTP mutation method token in executable code ---');
  const mutatingMethodPattern = /\b(POST|PUT|PATCH|DELETE)\b/;
  ok('no POST/PUT/PATCH/DELETE token in executable code', !mutatingMethodPattern.test(WORKER_CODE), WORKER_CODE.match(mutatingMethodPattern));

  console.log('\n--- Only the safe, GET-only Printify import allow-list is used ---');
  const importMatch = WORKER_CODE.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/functions\/_lib\/printify\.js['"]/);
  ok('imports from functions/_lib/printify.js', !!importMatch);
  if (importMatch) {
    const imported = importMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    const ALLOWED = new Set(['getPrintifyOrder', 'PrintifyConfigError', 'PrintifyApiError']);
    const disallowed = imported.filter((name) => !ALLOWED.has(name));
    ok('every imported printify.js identifier is on the safe allow-list', disallowed.length === 0, { imported, disallowed });
    ok('getPrintifyOrder specifically is imported (the only Printify call this Worker makes)', imported.includes('getPrintifyOrder'));
  }

  console.log('\n--- getPrintifyOrder() itself only ever issues a GET request ---');
  const fnStart = PRINTIFY_LIB_SOURCE.indexOf('export async function getPrintifyOrder');
  ok('getPrintifyOrder() function found in functions/_lib/printify.js', fnStart !== -1);
  if (fnStart !== -1) {
    const fnEnd = PRINTIFY_LIB_SOURCE.indexOf('\n}', fnStart);
    const body = PRINTIFY_LIB_SOURCE.slice(fnStart, fnEnd);
    ok('getPrintifyOrder() body specifies GET explicitly', /['"]GET['"]/.test(body), body);
    ok('getPrintifyOrder() body contains no mutating method token', !mutatingMethodPattern.test(body), body);
  }

  console.log('\n--- The Worker exposes only scheduled(), never fetch() (never HTTP-reachable) ---');
  ok('no "async fetch(" handler defined', !/\basync\s+fetch\s*\(/.test(WORKER_CODE));
  ok('exposes a scheduled() handler', /\bscheduled\s*\(/.test(WORKER_CODE));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

run();
