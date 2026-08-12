#!/usr/bin/env node
// Runs every tests/*.test.mjs file as a separate process (so one file's
// module-level state/mocks — e.g. global.fetch stubs — can never leak into
// another) and fails the overall run if any file exits non-zero.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith('.test.mjs')).sort();

let failedFiles = 0;
for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(process.execPath, [path.join(TESTS_DIR, file)], { stdio: 'inherit' });
  if (result.status !== 0) failedFiles++;
}

console.log(`\n${files.length} test file(s) run, ${failedFiles} failed.`);
process.exit(failedFiles > 0 ? 1 : 0);
