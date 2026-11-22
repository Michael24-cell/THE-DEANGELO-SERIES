// Converts every PNG/JPG referenced by the site's pages into a compressed
// WebP under img/ (kebab-case names), and rewrites those page references.
// Originals stay in place: catalog.js (Stripe, emails) and og:image/JSON-LD
// use absolute PNG URLs, which are deliberately left untouched.
// Usage: node scripts/convert-images-webp.mjs [--dry-run]
import fs from 'fs';
import { execFileSync } from 'child_process';

const DRY = process.argv.includes('--dry-run');
const SKIP = new Set(['deangeloseries-favicon.png', 'hero-social-preview.png', 'd-favicon.png']);
const RENAMES = {
  'New york chystler hoodie.png': 'new-york-chrysler-hoodie',
  'piaza san marco tee.png': 'piazza-san-marco-tee-flat',
  'bella-hoodie.png': 'japan-hoodie',
  'wavesoflife-mock.png': 'waves-of-life-source',
  'wind-sea.png': 'wind-and-sea-source',
  'Venezia-Original.png': 'venezia-source',
  'leaningtowerofpisa tee.png': 'leaning-tower-of-pisa-tee',
  'leaningtowerofpisa tee model.png': 'leaning-tower-of-pisa-tee-model',
};
const kebab = (f) => RENAMES[f] ?? f.replace(/\.(png|jpe?g)$/i, '')
  .toLowerCase().replace(/&/g, ' and ').replace(/villa de este/g, 'villa d este')
  .replace(/['’,]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const pages = fs.readdirSync('.').filter((f) => /\.(html|js)$/.test(f));
const images = fs.readdirSync('.').filter((f) => /\.(png|jpe?g)$/i.test(f) && !SKIP.has(f));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const texts = Object.fromEntries(pages.map((f) => [f, fs.readFileSync(f, 'utf8')]));

const plan = [];
for (const img of images.sort((a, b) => b.length - a.length)) {
  const variants = [...new Set([img, img.replace(/&/g, '&amp;'), img.replace(/ /g, '%20'), encodeURI(img)])];
  const re = new RegExp(`(?<![\\w.%/-])(${variants.map(esc).join('|')})(?![\\w])`, 'g');
  if (!pages.some((f) => re.test(texts[f]))) continue;
  plan.push({ img, re, out: `img/${kebab(img)}.webp` });
}
const outs = plan.map((p) => p.out);
const dup = outs.find((o, i) => outs.indexOf(o) !== i);
if (dup) throw new Error(`Name collision: ${dup}`);

if (!DRY) fs.mkdirSync('img', { recursive: true });
let before = 0, after = 0;
for (const p of plan) {
  before += fs.statSync(p.img).size;
  if (!DRY && !fs.existsSync(p.out)) {
    execFileSync('cwebp', ['-quiet', '-q', '80', '-m', '6', '-metadata', 'none', p.img, '-o', p.out]);
  }
  if (!DRY) after += fs.statSync(p.out).size;
  for (const f of pages) texts[f] = texts[f].replace(p.re, p.out);
  console.log(`${p.img}  ->  ${p.out}`);
}
if (!DRY) for (const f of pages) fs.writeFileSync(f, texts[f]);
console.log(`\n${plan.length} images. ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
