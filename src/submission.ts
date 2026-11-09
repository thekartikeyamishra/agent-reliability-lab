/**
 * Pre-send checks, a filled-in application email, and a submission pack (with a write-up PDF when Chrome or Edge
 * is installed). Every number comes from the recorded runs — nothing is typed by hand, so nothing can drift.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BusinessFacts, ChangeEntry, RunResult } from './types.js';
import { compareRuns, summarize } from './report.js';
import { pct, readText } from './util.js';

export interface Check {
  level: 'ok' | 'warn' | 'fail';
  msg: string;
}

export function extractSection(md: string, heading: string): string {
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.toLowerCase().includes(heading.toLowerCase()));
  if (start < 0) return '';
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(l)) break;
    body.push(l);
  }
  return body.join('\n').trim();
}

const PLACEHOLDER_RE = /<(?:published agent link|link|why[^>]*|list each change|one sentence[^>]*|N|K|business|city|[^<>\n]{0,40}\.\.\.)>|<[A-Z][A-Z _-]{3,}>/;

export function preflight(o: {
  business: BusinessFacts; coreHash: string; before?: RunResult; after?: RunResult; stress?: RunResult; stressHash?: string;
  changes: ChangeEntry[]; writeupPath: string; siteDir: string;
}): Check[] {
  const c: Check[] = [];
  const add = (cond: boolean, ok: string, bad: string, level: 'fail' | 'warn' = 'fail') => c.push(cond ? { level: 'ok', msg: ok } : { level, msg: bad });
  add(!o.business.isDemo, `Business facts are real (${o.business.name})`, 'Business facts are still the DEMO — run the wizard');
  add(!!o.business.sourceUrls.length, `Facts published at ${o.business.sourceUrls[0]}`, 'No source URL for the facts');
  for (const [name, r] of [['before', o.before], ['after', o.after]] as const) {
    if (!r) {
      c.push({ level: 'fail', msg: `No "${name}" run — record and grade it` });
      continue;
    }
    const s = summarize(r);
    add(r.meta.adapter !== 'mock' && !r.meta.businessIsDemo, `"${name}" run is real (${r.meta.adapter})`, `"${name}" run is synthetic (mock/demo)`);
    add(s.errors === 0, `"${name}": all ${s.total} conversations graded`, `"${name}": ${s.errors} conversation(s) not graded (status error)`);
    add(r.meta.testsetHash === o.coreHash, `"${name}" matches the current test set`, `"${name}" was recorded on a different test set or facts`);
  }
  if (o.before && o.after) {
    const cmp = compareRuns(o.before, o.after);
    add(cmp.after.passRate >= cmp.before.passRate, `After ≥ before (${pct(cmp.before.passRate)} → ${pct(cmp.after.passRate)})`, 'After is worse than before — explain it or fix the agent', 'warn');
    add(!!o.after.meta.agentUrl && /^https:\/\//.test(o.after.meta.agentUrl), `Agent link: ${o.after.meta.agentUrl}`, 'No https agent link on the "after" recording (re-record with --agent-url or pass --agent-url)');
  }
  add(o.changes.length > 0, `${o.changes.length} change(s) logged in agent/changes.json`, 'agent/changes.json is empty — log what you changed');
  if (!existsSync(o.writeupPath)) c.push({ level: 'fail', msg: `No final write-up at ${o.writeupPath} (copy writeup.draft.md → writeup.md and finish it)` });
  else {
    const md = readText(o.writeupPath);
    add(!PLACEHOLDER_RE.test(md.replace(/<!--[\s\S]*?-->/g, '')), 'Write-up has no <placeholders>', 'Write-up still contains <placeholders>');
    add(extractSection(md, 'which changes mattered').length >= 80, '"Which changes mattered" is written', '"Which changes mattered" is empty or too short — this is the part they read most');
    add(!md.includes('SYNTHETIC'), 'Write-up is not synthetic', 'Write-up contains the SYNTHETIC banner');
  }
  if (o.stress) add(o.stress.meta.testsetHash === o.stressHash && o.stress.meta.adapter !== 'mock', `Stress run included (${summarize(o.stress).passed}/${summarize(o.stress).graded})`, 'Stress run is synthetic or from a different stress set', 'warn');
  else c.push({ level: 'warn', msg: 'No stress run (optional, but it shows robustness) — record --run stress --tests data/tests/stress.json' });
  const idx = join(o.siteDir, 'index.html');
  if (!existsSync(idx)) c.push({ level: 'fail', msg: 'Site not built — run: node dist/cli.js site' });
  else {
    const html = readText(idx);
    add(!html.includes('Synthetic preview'), 'Site is a real build', 'Site is the synthetic demo preview — rebuild with real runs');
    if (o.after) {
      const resultPath = join(resolve('runs'), o.after.meta.runId, 'result.json');
      if (existsSync(resultPath)) add(statSync(idx).mtimeMs >= statSync(resultPath).mtimeMs, 'Site is newer than the latest results', 'Results changed after the site was built — rebuild the site', 'warn');
    }
  }
  return c;
}

export function emailText(o: { business: BusinessFacts; before: RunResult; after: RunResult; stress?: RunResult; domain: string; writeupMd?: string; ownerName: string; ownerLinks: Array<{ label: string; href: string }> }): string {
  const cmp = compareRuns(o.before, o.after);
  const a = cmp.before;
  const b = cmp.after;
  const st = o.stress ? summarize(o.stress) : undefined;
  const mattered = o.writeupMd ? extractSection(o.writeupMd, 'which changes mattered').split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').replace(/[*_`]/g, '').trim() : '';
  const site = `https://${o.domain}`;
  const own = o.business.website && /truesourceai\.me/.test(o.business.website);
  return `To: nikita@agentplace.io
Subject: Application: AI Engineer
Attach: Writeup-${o.ownerName.replace(/\s+/g, '-')}.pdf, your resume (PDF)

Hi Nikita,

I'm applying for the remote AI Engineer role. Everything for the test task is on one page: ${site}

- Published agent (Luna): ${o.after.meta.agentUrl ?? '<agent link>'} (assistant for ${o.business.name}${own ? ', my own product, so every fact is published by me and verifiable' : ''}: ${o.business.sourceUrls[0]})
- Test set: ${o.before.cases.length} multi-turn conversations across ${new Set(o.before.cases.map((c) => c.category)).size} categories, incl. unknown prices, invented services, missing/changed booking details, off-topic, prompt injection, discount pressure and hand-off: ${site}/test-set.html
- Results: ${a.passed}/${a.graded} → ${b.passed}/${b.graded} passing, critical failures ${a.criticalFailures} → ${b.criticalFailures}, same hash-locked test set: ${site}/comparison.html${st ? `\n- Stress suite on the final agent: ${st.passed}/${st.graded} (encoded/translated injections, role-play, privacy probes, flip-flopping bookings): ${site}/stress.html` : ''}
- Write-up: ${site}/writeup.html (PDF attached)
- Try it yourself in 5 minutes, including ways to break it: ${site}/reviewer.html

What mattered most: ${mattered || '<ONE SENTENCE FROM YOUR WRITE-UP>'}

I graded with deterministic checks rather than reading chats. Any amount not on the published price list is a critical failure, and a canary code in the instructions detects leaks exactly.

About me: <ONE OR TWO LINES: LLM FEATURES YOU HAVE SHIPPED TO REAL USERS, WITH NUMBERS>

Thanks,
${o.ownerName}
${o.ownerLinks.map((l) => l.href.replace(/^https:\/\/(www\.)?/, '')).join(' · ')}
`;
}

/** Print a page to PDF with a locally installed Chrome or Edge. Returns false if no browser was found. */
export function printPdf(htmlPath: string, pdfPath: string): boolean {
  const candidates =
    process.platform === 'win32'
      ? [
          `${process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  const exe = candidates.find((p) => p && existsSync(p));
  if (!exe) return false;
  mkdirSync(resolve(pdfPath, '..'), { recursive: true });
  const url = `file:///${resolve(htmlPath).replace(/\\/g, '/').replace(/^\/+/, '')}`;
  const r = spawnSync(exe, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${resolve(pdfPath)}`, url], { timeout: 90_000, stdio: 'ignore' });
  return r.status === 0 && existsSync(pdfPath);
}
