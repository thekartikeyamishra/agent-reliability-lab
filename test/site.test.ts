import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToHtml, inline } from '../src/markdown.js';
import { buildSite, SECURITY_HEADERS } from '../src/site.js';
import { MockAdapter } from '../src/adapters/mock.js';
import { runWithAdapter } from '../src/runner.js';
import { renderCase, templateContext } from '../src/template.js';
import { validateBusiness, validateTestSet } from '../src/validate.js';
import type { RunResult } from '../src/types.js';

test('markdown escapes raw HTML and unsafe links', () => {
  const html = markdownToHtml('# Hi\n\n<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://a.com)\n\n<!-- hidden -->');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('href="https://a.com"'));
  assert.ok(!html.includes('hidden'));
  assert.match(html, /<h1>Hi<\/h1>/);
});

test('markdown renders tables, lists, code and bold', () => {
  const html = markdownToHtml('| a | b |\n|---|---|\n| 1 | **2** |\n\n- one\n- two\n\n```\n<x>\n```');
  assert.match(html, /<table>.*<td><strong>2<\/strong><\/td>/s);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<pre><code>&lt;x&gt;<\/code><\/pre>/);
  assert.equal(inline('`<b>`'), '<code>&lt;b&gt;</code>');
});

test('site build: pages exist, no inline script, canary redacted, headers configured', async () => {
  const b = validateBusiness(JSON.parse(readFileSync('data/business.example.json', 'utf8')));
  const raw = readFileSync('data/tests/testset.json', 'utf8');
  const cases = validateTestSet(JSON.parse(raw)).cases.map((c) => renderCase(c, templateContext(b)));
  const mk = async (p: 'naive' | 'grounded'): Promise<RunResult> => ({
    meta: { runId: p, label: p, adapter: 'mock', businessId: b.id, businessIsDemo: true, testsetHash: 'h', startedAt: '2026-11-09T00:00:00Z', toolVersion: '1' },
    cases: await runWithAdapter(new MockAdapter(b, p), cases, b),
  });
  const out = 'site-test-tmp';
  try {
    const files = buildSite({ outDir: out, domain: 'evals.example.com', ownerName: 'K M', ownerLinks: [{ label: 'L', href: 'https://x.com' }],
      business: b, cases, rawTestSetJson: raw, before: await mk('naive'), after: await mk('grounded'), changes: [], writeupMd: '# W\n\ntext', agentUrl: 'https://agent.example.com', allowIndexing: false });
    for (const f of ['index.html', 'before.html', 'after.html', 'comparison.html', 'test-set.html', 'writeup.html', '404.html', 'vercel.json', '_headers', 'firebase.json', 'robots.txt'])
      assert.ok(files.includes(f), `missing ${f}`);
    for (const f of files.filter((x) => x.endsWith('.html'))) {
      const html = readFileSync(join(out, f), 'utf8');
      assert.ok(!/<script/i.test(html), `${f} has a script tag`);
      assert.ok(!html.includes(b.canary), `${f} leaks the canary`);
      assert.ok(html.includes('noindex'));
    }
    const vercel = JSON.parse(readFileSync(join(out, 'vercel.json'), 'utf8'));
    const keys = vercel.headers[0].headers.map((h: { key: string }) => h.key);
    for (const k of Object.keys(SECURITY_HEADERS)) assert.ok(keys.includes(k), `vercel.json missing ${k}`);
    assert.match(readFileSync(join(out, 'robots.txt'), 'utf8'), /Disallow: \//);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('site build refuses dangerous output dirs and bad domains', async () => {
  const b = validateBusiness(JSON.parse(readFileSync('data/business.example.json', 'utf8')));
  const base = { domain: 'evals.example.com', ownerName: 'K', ownerLinks: [], business: b, cases: [], rawTestSetJson: '{}', changes: [], allowIndexing: false,
    before: { meta: {} as RunResult['meta'], cases: [] }, after: { meta: {} as RunResult['meta'], cases: [] } };
  assert.throws(() => buildSite({ ...base, outDir: 'src' }));
  assert.throws(() => buildSite({ ...base, outDir: '..' }));
  assert.throws(() => buildSite({ ...base, outDir: 'site-x', domain: 'not a domain' }));
});

test('facts page: no canary, JSON-LD cannot break out of its script tag, unpublished prices say "Quoted on request"', async () => {
  const { factsPageHtml, publicFacts } = await import('../src/facts-page.js');
  const b = validateBusiness(JSON.parse(readFileSync('data/business.example.json', 'utf8')));
  const evil = { ...b, name: 'X</script><script>alert(1)</script>' };
  const html = factsPageHtml(evil, 'https://example.com/pricing.html');
  assert.ok(!html.includes(b.canary));
  assert.equal((html.match(/<script/g) ?? []).length, 1, 'only the ld+json script tag');
  assert.match(html, /Quoted on request/);
  assert.ok(!JSON.stringify(publicFacts(b)).includes(b.canary));
});

test('TrueSource preset has prices to fill and bookable services', () => {
  const p = JSON.parse(readFileSync('data/presets/truesource-ai.json', 'utf8'));
  assert.ok(p.services.some((s: { price: unknown }) => s.price === 'ASK'));
  assert.ok(p.services.filter((s: { bookable?: boolean }) => s.bookable).length >= 2);
});

test('stress suite validates and renders for both the demo and the TrueSource preset shape', async () => {
  const { validateTestSet: v } = await import('../src/validate.js');
  const st = v(JSON.parse(readFileSync('data/tests/stress.json', 'utf8')));
  assert.equal(st.purpose, 'stress');
  const b = validateBusiness(JSON.parse(readFileSync('data/business.example.json', 'utf8')));
  const cases = st.cases.map((c) => renderCase(c, templateContext(b)));
  assert.ok(cases.length >= 15);
  assert.ok(cases.some((c) => c.turns[0]!.includes('{{7*7}}')), 'template-injection probe left intact');
});

test('computed totals are minor, invented amounts critical', async () => {
  const { checkTurnInvariants } = await import('../src/checks/rules.js');
  const b = validateBusiness(JSON.parse(readFileSync('data/business.example.json', 'utf8')));
  const tot = checkTurnInvariants('3 sessions come to ₹3,600.', 0, b);
  assert.equal(tot[0]!.severity, 'minor');
  const bad = checkTurnInvariants('It is ₹3,333.', 0, b);
  assert.equal(bad[0]!.severity, 'critical');
});

test('preflight blocks demo facts and missing runs; email has every link', async () => {
  const { preflight, emailText, extractSection } = await import('../src/submission.js');
  const b = validateBusiness(JSON.parse(readFileSync('data/business.example.json', 'utf8')));
  const checks = preflight({ business: b, coreHash: 'h', changes: [], writeupPath: 'nope.md', siteDir: 'nope' });
  assert.ok(checks.filter((c) => c.level === 'fail').length >= 4);
  const raw = readFileSync('data/tests/testset.json', 'utf8');
  const cases = validateTestSet(JSON.parse(raw)).cases.map((c) => renderCase(c, templateContext(b)));
  const run = async (p: 'naive' | 'grounded'): Promise<RunResult> => ({ meta: { runId: p, label: p, adapter: 'transcript', agentUrl: 'https://a.example', businessId: b.id, businessIsDemo: false, testsetHash: 'h', startedAt: '', toolVersion: '1' }, cases: await runWithAdapter(new MockAdapter(b, p), cases, b) });
  const mail = emailText({ business: b, before: await run('naive'), after: await run('grounded'), domain: 'evals.example.com', writeupMd: '## Which changes mattered\n\nThe knowledge change mattered.', ownerName: 'K M', ownerLinks: [] });
  for (const p of ['Subject: Application: AI Engineer', 'nikita@agentplace.io', '/reviewer.html', '/comparison.html', 'The knowledge change mattered.']) assert.ok(mail.includes(p), p);
  assert.equal(extractSection('# A\n\n## Which changes mattered\n\nX\n\n## Next\nY', 'which changes mattered'), 'X');
});

test('root vercel.json: no build on Vercel, serves site/, keeps every security header', async () => {
  const { rootVercelJson } = await import('../src/site.js');
  const v = JSON.parse(rootVercelJson(false));
  assert.equal(v.outputDirectory, 'site');
  assert.equal(v.framework, null);
  assert.match(v.buildCommand, /vercel-check/);
  const keys = v.headers[0].headers.map((h: { key: string }) => h.key);
  for (const k of Object.keys(SECURITY_HEADERS)) assert.ok(keys.includes(k), k);
  assert.ok(keys.includes('X-Robots-Tag'));
});
