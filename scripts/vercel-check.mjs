// Runs on Vercel instead of a build. The site is generated locally from your private runs and committed in site/.
// Copyright (c) 2026 Kartikeya Mishra. MIT License.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'site';
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  console.error('Fix on your PC:');
  console.error('  npm run build');
  console.error('  node dist/cli.js site            (or: node dist/cli.js site --demo   for a labelled preview)');
  console.error('  git add site vercel.json ; git commit -m "Publish site" ; git push\n');
  process.exit(1);
};

if (!existsSync(join(SITE, 'index.html'))) fail('site/index.html not found — the evidence site has not been built and committed.');

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    if (f === '.vercel' || f === '.firebase') continue;
    const p = join(d, f);
    statSync(p).isDirectory() ? walk(p) : files.push(p);
  }
};
walk(SITE);

for (const f of files.filter((x) => /\.(html|json|csv|txt|md)$/.test(x))) {
  const text = readFileSync(f, 'utf8');
  if (/\bARL-(?!CANARY-REDACTED)[A-Z0-9]{8,}/.test(text)) fail(`${f} contains a canary code. Rebuild with "node dist/cli.js site" (it redacts automatically).`);
}
for (const req of ['test-set.html', 'before.html', 'after.html', 'comparison.html', 'reviewer.html', 'coverage.html', '404.html', 'styles.css']) {
  if (!existsSync(join(SITE, req))) fail(`site/${req} is missing — rebuild the site.`);
}
const synthetic = readFileSync(join(SITE, 'index.html'), 'utf8').includes('Synthetic preview');
console.log(`✓ site/ OK — ${files.length} files${synthetic ? ' (SYNTHETIC PREVIEW: fine for testing the domain, rebuild with real runs before applying)' : ''}`);
