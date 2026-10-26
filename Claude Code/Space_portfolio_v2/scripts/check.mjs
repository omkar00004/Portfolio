// Content guard. Run: node scripts/check.mjs
// Fails if private CV details leak, a stale figure comes back, or copy breaks the house rules.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = read('index.html'), main = read('js/main.js');
const all = html + main;

for (const banned of ['8767813546', 'nishap', 'bkc.met.edu', '9.55', 'Aahana', 'Northeastern'])
  assert(!all.includes(banned), `must not appear: ${banned}`);
assert(!/[—]|&mdash;/.test(all), 'no em dashes in copy');
assert(html.includes('8.42/10'), 'GPA is 8.42/10');

const links = [...html.matchAll(/<a\b[^>]*>/g)].map(m => m[0]);
for (const a of links) {
  const href = a.match(/href="([^"]+)"/)?.[1] ?? '';
  assert(!href.startsWith('http:'), `insecure link: ${href}`);
  if (a.includes('target="_blank"')) assert(/rel="[^"]*\bnoopener\b/.test(a), `missing rel=noopener: ${href}`);
}
console.log(`ok: ${links.length} links checked`);
