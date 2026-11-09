/**
 * Static evidence site (no JavaScript, no external requests) for publishing the test-task results on a
 * subdomain such as evals.truesourceai.me. Ships hosting configs with strict security headers for Vercel,
 * Cloudflare Pages / Netlify and Firebase Hosting, so the host can be swapped without code changes.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import { mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import type { BusinessFacts, CaseResult, ChangeEntry, RunResult, TestCase } from './types.js';
import { CATEGORIES } from './types.js';
import { compareRuns, runCsv, summarize, type Summary } from './report.js';
import { esc, markdownToHtml } from './markdown.js';
import { coveragePage, reviewerPage } from './reviewer.js';
import { pct, readText, writeFileAtomic, UserError } from './util.js';

export interface SiteOptions {
  outDir: string;
  domain: string;
  ownerName: string;
  ownerLinks: Array<{ label: string; href: string }>;
  business: BusinessFacts;
  cases: TestCase[];
  rawTestSetJson: string;
  /** Optional stress suite (cases always shown; results shown when a stress run is given). */
  stressCases?: TestCase[];
  rawStressJson?: string;
  stress?: RunResult;
  before: RunResult;
  after: RunResult;
  changes: ChangeEntry[];
  writeupMd?: string;
  agentUrl?: string;
  allowIndexing: boolean;
  /** Optional Firebase Hosting site id / project id (Option C in docs/DOMAIN-SETUP.md). */
  firebaseSite?: string;
  firebaseProject?: string;
}

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const CSS = `:root{--bg:#fbfbfa;--fg:#17181a;--muted:#5f6368;--line:#e4e4e1;--card:#fff;--accent:#2457d6;--ok:#137a3f;--bad:#b42318;--warn:#a15c00;--code:#f2f2ef}
@media (prefers-color-scheme:dark){:root{--bg:#111214;--fg:#ececec;--muted:#a0a3a8;--line:#2a2c30;--card:#18191c;--accent:#7ea2ff;--ok:#4cc38a;--bad:#ff7b72;--warn:#e3a33b;--code:#1f2125}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari",sans-serif}
a{color:var(--accent)}a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.wrap{max-width:920px;margin:0 auto;padding:24px 20px 64px}header.top{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:28px}
.brand{font-weight:650;text-decoration:none;color:var(--fg)}nav a{margin-right:14px;text-decoration:none;font-size:15px;white-space:nowrap;display:inline-block}nav a[aria-current]{font-weight:650;text-decoration:underline}
h1{font-size:clamp(26px,4vw,36px);line-height:1.2;margin:0 0 8px}h2{font-size:22px;margin:36px 0 12px}h3{font-size:17px;margin:24px 0 8px}.lead{color:var(--muted);font-size:18px;margin:0 0 20px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}.stat b{display:block;font-size:26px;line-height:1.2}.stat span{color:var(--muted);font-size:14px}
.table{overflow-x:auto;margin:12px 0}table{border-collapse:collapse;width:100%;font-size:15px}th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}th{font-weight:600;color:var(--muted)}
.pass{color:var(--ok);font-weight:600}.fail{color:var(--bad);font-weight:600}.error{color:var(--warn);font-weight:600}
.case{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:12px 0}.case h3{margin:0 0 6px}.meta{color:var(--muted);font-size:14px}
ul.findings{margin:8px 0;padding-left:20px}details{margin-top:8px}summary{cursor:pointer;color:var(--accent)}
.turn{border-left:3px solid var(--line);padding:4px 0 4px 12px;margin:10px 0;white-space:pre-wrap;word-break:break-word}.turn.agent{border-color:var(--accent)}.who{font-size:13px;color:var(--muted);display:block}
code,pre{background:var(--code);border-radius:6px;font:14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}code{padding:1px 5px}pre{padding:12px;overflow-x:auto}
blockquote{margin:12px 0;padding:8px 14px;border-left:3px solid var(--warn);background:var(--card)}.btn{display:inline-block;padding:10px 16px;border-radius:10px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;margin:4px 8px 4px 0}
.btn.secondary{background:transparent;color:var(--accent);border:1px solid var(--line)}footer{margin-top:56px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}
pre.say{white-space:pre-wrap;word-break:break-word;margin:6px 0;user-select:all}td ul{margin:0;padding-left:18px}
.banner{border:1px solid var(--warn);color:var(--warn);border-radius:10px;padding:10px 14px;margin:0 0 20px;font-weight:600}
@media print{nav,.btn,footer{display:none}details{display:block}details>summary{display:none}.case{break-inside:avoid}}`;

const PAGES = [
  ['index.html', 'Overview'],
  ['reviewer.html', 'Test it yourself'],
  ['coverage.html', 'Coverage'],
  ['test-set.html', 'Test set'],
  ['before.html', 'Before'],
  ['after.html', 'After'],
  ['comparison.html', 'Comparison'],
  ['stress.html', 'Stress'],
  ['writeup.html', 'Write-up'],
] as const;

function layout(o: SiteOptions, file: string, title: string, body: string, synthetic: boolean): string {
  const nav = PAGES.filter(([f]) => (f !== 'writeup.html' || o.writeupMd) && (f !== 'stress.html' || o.stress))
    .map(([f, label]) => `<a href="${f === 'index.html' ? './' : f}"${f === file ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('');
  const robots = o.allowIndexing ? 'index,follow' : 'noindex,nofollow';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Agent evaluation · ${esc(o.ownerName)}</title>
<meta name="description" content="${esc(`Evaluation of a customer-facing AI agent for ${o.business.name}: ${o.cases.length} test conversations, before and after.`)}">
<meta name="robots" content="${robots}">
<meta name="author" content="${esc(o.ownerName)}">
<meta name="color-scheme" content="light dark">
<link rel="canonical" href="https://${esc(o.domain)}/${file === 'index.html' ? '' : file}">
<link rel="stylesheet" href="styles.css">
<link rel="icon" href="data:,">
</head>
<body>
<div class="wrap">
<header class="top"><a class="brand" href="./">Agent evaluation · ${esc(o.business.name)}</a><nav aria-label="Pages">${nav}</nav></header>
<main>
${synthetic ? '<p class="banner" role="note">Synthetic preview: mock agent and/or fictional demo business. These numbers are not real results.</p>' : ''}
${body}
</main>
<footer>© ${new Date().getUTCFullYear()} ${esc(o.ownerName)}. Evaluation tooling and write-up by ${esc(o.ownerName)}. ${o.ownerLinks.map((l) => `<a href="${esc(l.href)}" rel="noopener noreferrer" target="_blank">${esc(l.label)}</a>`).join(' · ')}<br>
Business facts are taken from ${o.business.sourceUrls.map((u) => `<a href="${esc(u)}" rel="noopener noreferrer nofollow" target="_blank">its public pages</a>`).join(', ')} (checked ${esc(o.business.verifiedOn)}). Test conversations use fictional customers; card numbers are standard test numbers.</footer>
</div>
</body>
</html>
`;
}

const statusCell = (s: string) => `<span class="${s}">${s === 'pass' ? '✓ pass' : s === 'fail' ? '✗ fail' : '! error'}</span>`;

function stats(s: Summary): string {
  return `<div class="stats">
<div class="stat"><b>${s.passed}/${s.graded}</b><span>conversations passed</span></div>
<div class="stat"><b>${pct(s.passRate)}</b><span>pass rate (95% CI ${pct(s.ci.low)}–${pct(s.ci.high)})</span></div>
<div class="stat"><b>${s.criticalFailures}</b><span>critical failures</span></div>
<div class="stat"><b>${s.errors}</b><span>not graded (errors)</span></div></div>`;
}

function caseHtml(c: CaseResult): string {
  const failing = c.findings.filter((f) => !f.passed);
  return `<article class="case" id="${esc(c.id)}">
<h3>${statusCell(c.status)} ${esc(c.title)}</h3>
<div class="meta"><code>${esc(c.id)}</code> · ${esc(c.category)}</div>
${c.error ? `<p class="error">${esc(c.error)}</p>` : ''}
${failing.length ? `<ul class="findings">${failing.map((f) => `<li><strong>${esc(f.severity)}</strong> <code>${esc(f.check)}</code>: ${esc(f.message)}${f.evidence ? ` <em>“${esc(f.evidence)}”</em>` : ''}</li>`).join('')}</ul>` : ''}
${c.review ? `<p class="meta">Human review: <strong>${esc(c.review.status)}</strong> (${esc(c.review.reason)})</p>` : ''}
<details><summary>Transcript (${c.turns.length} turn${c.turns.length === 1 ? '' : 's'})</summary>
${c.turns.map((t) => `<div class="turn"><span class="who">Customer</span>${esc(t.user)}</div><div class="turn agent"><span class="who">Agent</span>${esc(t.agent)}</div>`).join('')}
</details></article>`;
}

function runPage(run: RunResult, csvName: string): string {
  const s = summarize(run);
  const cats = CATEGORIES.filter((c) => s.byCategory[c]).map((c) => {
    const v = s.byCategory[c]!;
    return `<tr><td>${c}</td><td>${v.pass}/${v.n}</td><td>${pct(v.pass / v.n)}</td></tr>`;
  });
  const ft = Object.entries(s.failureCounts).sort((a, b) => b[1] - a[1]);
  return `<h1>${esc(run.meta.label)}</h1>
<p class="lead">${esc(run.meta.agentUrl ?? `${run.meta.adapter}${run.meta.model ? ` · ${run.meta.model}` : ''}`)} · recorded ${esc(run.meta.startedAt.slice(0, 10))} · test set <code>${esc(run.meta.testsetHash.slice(0, 12))}</code></p>
${stats(s)}
<p><a class="btn secondary" href="downloads/${csvName}">Download CSV</a></p>
<h2>By category</h2><div class="table"><table><thead><tr><th>Category</th><th>Passed</th><th>Rate</th></tr></thead><tbody>${cats.join('')}</tbody></table></div>
<h2>Failure types</h2><div class="table"><table><thead><tr><th>Check</th><th>Failing conversations</th></tr></thead><tbody>${ft.length ? ft.map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${v}</td></tr>`).join('') : '<tr><td>None</td><td>0</td></tr>'}</tbody></table></div>
<h2>Conversations</h2>
${run.cases.map(caseHtml).join('\n')}`;
}

function comparisonPage(o: SiteOptions): string {
  const cmp = compareRuns(o.before, o.after);
  const row = (n: string, s: Summary) => `<tr><td>${n}</td><td>${s.passed}/${s.graded}</td><td>${pct(s.passRate)}</td><td>${pct(s.ci.low)}–${pct(s.ci.high)}</td><td>${s.criticalFailures}</td></tr>`;
  const cats = CATEGORIES.map((c) => {
    const x = cmp.before.byCategory[c];
    const y = cmp.after.byCategory[c];
    if (!x && !y) return '';
    const d = Math.round(((y ? y.pass / y.n : 0) - (x ? x.pass / x.n : 0)) * 100);
    return `<tr><td>${c}</td><td>${x ? `${x.pass}/${x.n}` : '—'}</td><td>${y ? `${y.pass}/${y.n}` : '—'}</td><td>${d >= 0 ? '+' : ''}${d} pts</td></tr>`;
  }).join('');
  const keys = [...new Set([...Object.keys(cmp.before.failureCounts), ...Object.keys(cmp.after.failureCounts)])].sort((p, q) => (cmp.before.failureCounts[q] ?? 0) - (cmp.before.failureCounts[p] ?? 0));
  const list = (title: string, ids: string[]) => (ids.length ? `<h3>${title} (${ids.length})</h3><ul>${ids.map((i) => `<li><a href="after.html#${esc(i)}"><code>${esc(i)}</code></a></li>`).join('')}</ul>` : '');
  return `<h1>Before → after</h1>
<p class="lead">Same ${o.cases.length} conversations, same graders, run twice${o.before.meta.testsetHash === o.after.meta.testsetHash ? ' (test-set hash identical)' : ' — <strong>warning: test sets differ</strong>'}.</p>
<div class="table"><table><thead><tr><th>Run</th><th>Passed</th><th>Pass rate</th><th>95% CI</th><th>Critical</th></tr></thead><tbody>${row('Before', cmp.before)}${row('After', cmp.after)}</tbody></table></div>
<p>Fixed <strong>${cmp.fixed.length}</strong> · Regressed <strong>${cmp.regressed.length}</strong> · Still failing <strong>${cmp.stillFailing.length}</strong> · Not comparable ${cmp.notComparable.length}</p>
<h2>By category</h2><div class="table"><table><thead><tr><th>Category</th><th>Before</th><th>After</th><th>Δ</th></tr></thead><tbody>${cats}</tbody></table></div>
<h2>Failure types</h2><div class="table"><table><thead><tr><th>Check</th><th>Before</th><th>After</th></tr></thead><tbody>${keys.map((k) => `<tr><td><code>${esc(k)}</code></td><td>${cmp.before.failureCounts[k] ?? 0}</td><td>${cmp.after.failureCounts[k] ?? 0}</td></tr>`).join('') || '<tr><td>None</td><td>0</td><td>0</td></tr>'}</tbody></table></div>
${o.changes.length ? `<h2>Changes made</h2><div class="table"><table><thead><tr><th>Change</th><th>Kind</th><th>Targeted categories (before → after)</th></tr></thead><tbody>${o.changes.map((ch) => `<tr><td><strong>${esc(ch.id)}</strong><br>${esc(ch.description)}</td><td>${ch.kind}</td><td>${ch.targets.map((t) => { const x = cmp.before.byCategory[t]; const y = cmp.after.byCategory[t]; return `${t}: ${x ? `${x.pass}/${x.n}` : '—'} → ${y ? `${y.pass}/${y.n}` : '—'}`; }).join('<br>')}</td></tr>`).join('')}</tbody></table></div><p class="meta">Attribution is by targeted category. Changes shipped together are confounded; ablations are described in the write-up.</p>` : ''}
${list('Fixed', cmp.fixed)}${list('Regressed', cmp.regressed)}${list('Still failing', cmp.stillFailing)}`;
}

function testSetPage(o: SiteOptions): string {
  const render = (list: TestCase[]) => list.map((c, i) => `<article class="case" id="${esc(c.id)}"><h3>${i + 1}. ${esc(c.title)}</h3>
<div class="meta"><code>${esc(c.id)}</code> · ${esc(c.category)} · ${esc(c.difficulty)}</div>
${c.turns.map((t, j) => `<div class="turn"><span class="who">Customer turn ${j + 1}</span>${esc(t)}</div>`).join('')}
<p><strong>Why:</strong> ${esc(c.rationale)}</p>
<p class="meta"><strong>Pass criteria:</strong> <code>${esc(JSON.stringify(Object.fromEntries(Object.entries(c.expect).filter(([, v]) => v !== undefined))))}</code></p></article>`).join('\n');
  const items = render(o.cases);
  const stress = o.stressCases?.length
    ? `<h2 id="stress">Stress and adversarial suite (${o.stressCases.length})</h2><p class="meta">Extra cases for trying to break the agent. Run once against the final version.</p><p><a class="btn secondary" href="downloads/stress.template.json">Stress template JSON</a></p>${render(o.stressCases)}`
    : '';
  return `<h1>Test set</h1>
<p class="lead">${o.cases.length} realistic multi-turn conversations. Every agent turn is also checked for prices that are not published, instruction leaks (a canary code), echoed card numbers and empty replies.</p>
<p><a class="btn secondary" href="downloads/testset.template.json">Template JSON</a><a class="btn secondary" href="downloads/testset.rendered.json">Rendered JSON</a></p>
<h2>Core suite (${o.cases.length})</h2>
${items}
${stress}`;
}

function indexPage(o: SiteOptions): string {
  const a = summarize(o.before);
  const b = summarize(o.after);
  const cmp = compareRuns(o.before, o.after);
  return `<h1>Making a customer-facing agent reliable: ${esc(o.business.name)}</h1>
<p class="lead">Test task for the Agentplace AI Engineer role, by ${esc(o.ownerName)}. A public agent on the Luna model, tested on ${o.cases.length} realistic conversations, fixed, and measured again on the identical test set.</p>
<p>${o.agentUrl ? `<a class="btn" href="${esc(o.agentUrl)}" rel="noopener noreferrer" target="_blank">Open the published agent</a>` : ''}<a class="btn secondary" href="reviewer.html">Test it yourself (5 min)</a><a class="btn secondary" href="comparison.html">See before → after</a></p>
<div class="stats">
<div class="stat"><b>${a.passed}/${a.graded} → ${b.passed}/${b.graded}</b><span>conversations passed</span></div>
<div class="stat"><b>${a.criticalFailures} → ${b.criticalFailures}</b><span>critical failures</span></div>
<div class="stat"><b>${cmp.fixed.length} / ${cmp.regressed.length}</b><span>fixed / regressed</span></div>
<div class="stat"><b>${o.cases.length}</b><span>test conversations</span></div></div>
<h2>What is here</h2>
<ul>
<li><a href="reviewer.html">Test it yourself</a>: the facts it must use, what it should do, and every scenario to try (including ways to break it)</li>
<li><a href="coverage.html">Coverage</a>: every behaviour the job listing names, mapped to scenarios and results</li>
<li><a href="test-set.html">Test set</a>: every conversation, why it matters and its pass criteria</li>
<li><a href="before.html">Before</a> and <a href="after.html">after</a>: every transcript, every failure with evidence</li>
<li><a href="comparison.html">Comparison</a>: by category, by failure type, and by change</li>
${o.stress ? '<li><a href="stress.html">Stress run</a>: the final agent against the adversarial suite</li>' : ''}
${o.writeupMd ? '<li><a href="writeup.html">Write-up</a>: what I tried, what mattered, and what still fails</li>' : ''}
</ul>
<h2>How it was graded</h2>
<p>Every reply is graded by deterministic checks, not by reading a few chats. Any amount that is not on the published price list is a critical failure. A canary code planted in the instructions detects leaks exactly. False booking confirmations, lost details, missing hand-offs and invented services are each checked separately. Heuristic verdicts were reviewed by hand, and overrides are shown with reasons.</p>`;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => !['.vercel', '.firebase'].includes(f)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

export function buildSite(o: SiteOptions): string[] {
  const out = resolve(o.outDir);
  const rel = relative(process.cwd(), out);
  if (!rel || rel.startsWith('..') || /^(src|data|agent|docs|test|node_modules|runs)$/.test(rel)) throw new UserError(`Refusing to write the site to "${o.outDir}". Use a dedicated folder such as site/.`);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(o.domain)) throw new UserError(`Invalid domain "${o.domain}" (use e.g. evals.truesourceai.me)`);
  // Clear previous output but keep host link folders (.vercel, .firebase) so redeploys stay linked.
  if (existsSync(out)) for (const f of readdirSync(out)) if (!['.vercel', '.firebase'].includes(f)) rmSync(join(out, f), { recursive: true, force: true });
  mkdirSync(join(out, 'downloads'), { recursive: true });
  const synthetic = [o.before, o.after].some((r) => r.meta.adapter === 'mock' || r.meta.businessIsDemo);

  const page = (file: string, title: string, body: string) => writeFileAtomic(join(out, file), layout(o, file, title, body, synthetic));
  page('index.html', 'Overview', indexPage(o));
  page('test-set.html', 'Test set', testSetPage(o));
  page('before.html', 'Before', runPage(o.before, 'before.csv'));
  page('after.html', 'After', runPage(o.after, 'after.csv'));
  page('comparison.html', 'Comparison', comparisonPage(o));
  page('reviewer.html', 'Test it yourself', reviewerPage({ business: o.business, cases: o.cases, stressCases: o.stressCases ?? [], after: o.after, stress: o.stress, agentUrl: o.agentUrl, contactLinks: o.ownerLinks }));
  page('coverage.html', 'Coverage', coveragePage({ cases: o.cases, stressCases: o.stressCases ?? [], before: o.before, after: o.after, stress: o.stress }));
  if (o.stress) page('stress.html', 'Stress', runPage(o.stress, 'stress.csv'));
  if (o.writeupMd) page('writeup.html', 'Write-up', `<article class="prose">${markdownToHtml(o.writeupMd)}</article>`);
  page('404.html', 'Not found', '<h1>Page not found</h1><p><a href="./">Back to the overview</a></p>');
  writeFileAtomic(join(out, 'styles.css'), CSS);
  writeFileAtomic(join(out, 'downloads', 'before.csv'), runCsv(o.before));
  writeFileAtomic(join(out, 'downloads', 'after.csv'), runCsv(o.after));
  writeFileAtomic(join(out, 'downloads', 'testset.template.json'), o.rawTestSetJson);
  writeFileAtomic(join(out, 'downloads', 'testset.rendered.json'), JSON.stringify(o.cases, null, 2) + '\n');
  if (o.rawStressJson) writeFileAtomic(join(out, 'downloads', 'stress.template.json'), o.rawStressJson);
  if (o.stress) writeFileAtomic(join(out, 'downloads', 'stress.csv'), runCsv(o.stress));
  writeFileAtomic(join(out, 'robots.txt'), o.allowIndexing ? `User-agent: *\nAllow: /\n` : `User-agent: *\nDisallow: /\n`);
  writeFileAtomic(join(out, '.well-known', 'security.txt'), `Contact: ${o.ownerLinks[0]?.href ?? `https://${o.domain}/`}\nExpires: ${new Date(Date.now() + 365 * 864e5).toISOString()}\nPreferred-Languages: en, hi\n`);

  // Hosting configs — same headers everywhere, so the host is swappable.
  const headerList = Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value }));
  writeFileAtomic(join(out, 'vercel.json'), JSON.stringify({
    cleanUrls: false, trailingSlash: false,
    headers: [
      { source: '/(.*)', headers: [...headerList, ...(o.allowIndexing ? [] : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }])] },
      { source: '/(.*)\\.(css|json|csv)', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }] },
    ],
  }, null, 2) + '\n');
  writeFileAtomic(join(out, '_headers'), `/*\n${Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`).join('\n')}${o.allowIndexing ? '' : '\n  X-Robots-Tag: noindex, nofollow'}\n`);
  writeFileAtomic(join(out, 'firebase.json'), JSON.stringify({
    hosting: { ...(o.firebaseSite ? { site: o.firebaseSite } : {}), public: '.', ignore: ['firebase.json', 'vercel.json', '_headers', '**/node_modules/**', '.firebaserc', '.vercel/**', '.firebase/**'], cleanUrls: false, headers: [{ source: '**', headers: [...headerList, ...(o.allowIndexing ? [] : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }])] }] },
  }, null, 2) + '\n');

  if (o.firebaseProject) writeFileAtomic(join(out, '.firebaserc'), JSON.stringify({ projects: { default: o.firebaseProject } }, null, 2) + '\n');

  // Never publish the canary: redact it from every generated file.
  const files = listFiles(out);
  const canary = o.business.canary;
  for (const f of files) {
    const text = readText(f);
    if (text.includes(canary)) writeFileAtomic(f, text.split(canary).join('[CANARY-REDACTED]'));
  }
  return files.map((f) => relative(out, f));
}

/**
 * vercel.json for a Git-connected Vercel project whose root is this repository: no install/build on Vercel,
 * serve the committed site/ folder with the same security headers.
 */
export function rootVercelJson(allowIndexing: boolean): string {
  const headerList = Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value }));
  return JSON.stringify({
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: null,
    installCommand: 'echo "No install needed: the site is prebuilt in site/"',
    buildCommand: 'node scripts/vercel-check.mjs',
    outputDirectory: 'site',
    cleanUrls: false,
    trailingSlash: false,
    headers: [
      { source: '/(.*)', headers: [...headerList, ...(allowIndexing ? [] : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }])] },
      { source: '/(.*)\\.(css|json|csv)', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }] },
    ],
  }, null, 2) + '\n';
}

/** Post-deploy verification: HTTPS, redirects, status codes and security headers on the live domain. */
export async function checkLiveSite(domain: string): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;
  const mark = (good: boolean, msg: string) => {
    lines.push(`${good ? '✓' : '✗'} ${msg}`);
    if (!good) ok = false;
  };
  try {
    const http = await fetch(`http://${domain}/`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const loc = http.headers.get('location') ?? '';
    mark(http.status >= 300 && http.status < 400 && loc.startsWith(`https://${domain}`), `http:// redirects to https:// (${http.status} → ${loc || 'none'})`);
  } catch (e) {
    mark(false, `http:// request failed: ${(e as Error).message}`);
  }
  for (const path of ['/', '/reviewer.html', '/coverage.html', '/test-set.html', '/before.html', '/after.html', '/comparison.html', '/styles.css', '/downloads/after.csv']) {
    try {
      const r = await fetch(`https://${domain}${path}`, { signal: AbortSignal.timeout(15_000) });
      mark(r.status === 200, `GET ${path} → ${r.status}`);
      if (path === '/') {
        for (const h of Object.keys(SECURITY_HEADERS)) mark(r.headers.has(h.toLowerCase()), `header ${h}`);
        const body = await r.text();
        mark(!/\bARL-(?!CANARY-REDACTED)[A-Z0-9-]{8,}/.test(body), 'no canary code on the page');
        mark(!body.includes('Synthetic preview'), 'not a synthetic/demo build');
      }
    } catch (e) {
      mark(false, `GET ${path} failed: ${(e as Error).message}`);
    }
  }
  try {
    const r = await fetch(`https://${domain}/does-not-exist-${Date.now()}`, { signal: AbortSignal.timeout(15_000) });
    mark(r.status === 404, `unknown path → ${r.status} (expect 404)`);
  } catch (e) {
    mark(false, `404 check failed: ${(e as Error).message}`);
  }
  return { ok, lines };
}
