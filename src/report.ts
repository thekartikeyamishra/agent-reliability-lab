/**
 * Markdown/CSV reports, before/after comparison and the write-up draft.
 * All agent text is escaped before it reaches Markdown.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import type { CaseResult, Category, ChangeEntry, ReviewOverride, RunResult } from './types.js';
import { CATEGORIES } from './types.js';
import { mdEscape, pct, wilson } from './util.js';

export function applyReviews(run: RunResult, reviews: Record<string, ReviewOverride>): RunResult {
  return {
    ...run,
    cases: run.cases.map((c) => {
      const r = reviews[c.id];
      if (!r || c.status === 'error') return c;
      return {
        ...c,
        status: r.status,
        review: r,
        findings: [...c.findings, { check: 'human_review', severity: 'major', passed: r.status === 'pass', message: `Reviewed by ${r.reviewer}: ${r.reason}`, source: 'review' }],
      };
    }),
  };
}

export interface Summary {
  total: number;
  graded: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  ci: { low: number; high: number };
  byCategory: Record<string, { n: number; pass: number }>;
  failureCounts: Record<string, number>;
  criticalFailures: number;
  latency?: { p50: number; p95: number };
  tokens?: { input: number; output: number };
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

export function summarize(run: RunResult): Summary {
  const graded = run.cases.filter((c) => c.status !== 'error');
  const passed = graded.filter((c) => c.status === 'pass').length;
  const byCategory: Summary['byCategory'] = {};
  const failureCounts: Record<string, number> = {};
  let criticalFailures = 0;
  for (const c of graded) {
    const k = (byCategory[c.category] ??= { n: 0, pass: 0 });
    k.n++;
    if (c.status === 'pass') k.pass++;
    if (c.review?.status === 'pass') continue; // a human cleared this case; its rule findings stay visible but are not counted
    const seen = new Set<string>();
    for (const f of c.findings) {
      if (f.passed || f.severity === 'minor') continue;
      // Generic pattern checks are only meaningful together with the category they guard.
      const key = /^must_|^judge/.test(f.check) ? `${f.check} · ${c.category}` : f.check;
      if (seen.has(key)) continue; // count conversations, not turns
      seen.add(key);
      failureCounts[key] = (failureCounts[key] ?? 0) + 1;
      if (f.severity === 'critical') criticalFailures++;
    }
  }
  const lat = run.cases.flatMap((c) => c.turns.map((t) => t.latencyMs).filter((x): x is number => typeof x === 'number'));
  const tin = run.cases.flatMap((c) => c.turns.map((t) => t.inputTokens ?? 0)).reduce((a, b) => a + b, 0);
  const tout = run.cases.flatMap((c) => c.turns.map((t) => t.outputTokens ?? 0)).reduce((a, b) => a + b, 0);
  return {
    total: run.cases.length,
    graded: graded.length,
    passed,
    failed: graded.length - passed,
    errors: run.cases.length - graded.length,
    passRate: graded.length ? passed / graded.length : 0,
    ci: wilson(passed, graded.length),
    byCategory,
    failureCounts,
    criticalFailures,
    latency: lat.length ? { p50: quantile(lat, 0.5), p95: quantile(lat, 0.95) } : undefined,
    tokens: tin + tout > 0 ? { input: tin, output: tout } : undefined,
  };
}

function banner(run: RunResult): string {
  if (run.meta.adapter === 'mock' || run.meta.businessIsDemo)
    return '> ⚠️ **SYNTHETIC PIPELINE SELF-TEST** — mock agent and/or fictional demo business. Do not submit these numbers.\n\n';
  return '';
}

export function runReport(run: RunResult): string {
  const s = summarize(run);
  const m = run.meta;
  const out: string[] = [];
  out.push(`# Evaluation report — ${mdEscape(m.label)}`, '', banner(run));
  out.push('| | |', '|---|---|');
  out.push(`| Run id | \`${m.runId}\` |`, `| Agent | ${m.agentUrl ? mdEscape(m.agentUrl) : mdEscape(m.adapter + (m.model ? ` · ${m.model}` : ''))} |`);
  out.push(`| Business | ${mdEscape(m.businessId)} |`, `| Test set hash | \`${m.testsetHash.slice(0, 12)}\` |`, `| Started | ${m.startedAt} |`);
  out.push('', '## Result', '');
  out.push(`**${s.passed}/${s.graded} conversations passed (${pct(s.passRate)}; 95% CI ${pct(s.ci.low)}–${pct(s.ci.high)})**  `);
  out.push(`Critical failures: **${s.criticalFailures}** · Errors (not graded): ${s.errors}`);
  if (s.latency) out.push(`Latency per turn: p50 ${s.latency.p50} ms · p95 ${s.latency.p95} ms`);
  if (s.tokens) out.push(`Tokens: ${s.tokens.input} in / ${s.tokens.output} out`);
  out.push('', '## By category', '', '| Category | Passed | Rate |', '|---|---|---|');
  for (const cat of CATEGORIES) {
    const v = s.byCategory[cat];
    if (v) out.push(`| ${cat} | ${v.pass}/${v.n} | ${pct(v.pass / v.n)} |`);
  }
  out.push('', '## Failure types', '', '| Check | Failing conversations |', '|---|---|');
  const ft = Object.entries(s.failureCounts).sort((a, b) => b[1] - a[1]);
  if (!ft.length) out.push('| — | 0 |');
  for (const [k, v] of ft) out.push(`| ${k} | ${v} |`);
  out.push('', '## Conversations', '');
  for (const c of run.cases) out.push(caseBlock(c));
  return out.join('\n') + '\n';
}

function caseBlock(c: CaseResult): string {
  const icon = c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : '⚠️';
  const lines = [`### ${icon} \`${c.id}\` — ${mdEscape(c.title)} (${c.category})`, ''];
  if (c.error) lines.push(`**Error:** ${mdEscape(c.error)}`, '');
  const failing = c.findings.filter((f) => !f.passed);
  if (failing.length) {
    for (const f of failing) lines.push(`- **${f.severity}** \`${f.check}\` — ${mdEscape(f.message)}${f.evidence ? ` · _“${mdEscape(f.evidence)}”_` : ''}`);
    lines.push('');
  }
  if (c.review) lines.push(`_Human review: ${c.review.status} — ${mdEscape(c.review.reason)}_`, '');
  lines.push('<details><summary>Transcript</summary>', '');
  c.turns.forEach((t, i) => {
    lines.push(`**Customer ${i + 1}:** ${mdEscape(t.user)}  `, `**Agent ${i + 1}:** ${mdEscape(t.agent).replace(/\n/g, '  \n')}`, '');
  });
  lines.push('</details>', '');
  return lines.join('\n');
}

export function runCsv(run: RunResult): string {
  const esc = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; // neutralise spreadsheet formula injection
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = [['id', 'category', 'status', 'failed_checks', 'final_reply'].join(',')];
  for (const c of run.cases) {
    const failed = c.findings.filter((f) => !f.passed && f.severity !== 'minor').map((f) => f.check).join(' ');
    rows.push([c.id, c.category, c.status, failed, c.turns.at(-1)?.agent ?? ''].map((x) => esc(String(x))).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

export interface Comparison {
  before: Summary;
  after: Summary;
  fixed: string[];
  regressed: string[];
  stillFailing: string[];
  stablePass: string[];
  notComparable: string[];
}

export function compareRuns(a: RunResult, b: RunResult): Comparison {
  const byId = new Map(b.cases.map((c) => [c.id, c]));
  const r: Comparison = { before: summarize(a), after: summarize(b), fixed: [], regressed: [], stillFailing: [], stablePass: [], notComparable: [] };
  for (const c of a.cases) {
    const d = byId.get(c.id);
    if (!d || c.status === 'error' || d.status === 'error') r.notComparable.push(c.id);
    else if (c.status === 'fail' && d.status === 'pass') r.fixed.push(c.id);
    else if (c.status === 'pass' && d.status === 'fail') r.regressed.push(c.id);
    else if (c.status === 'fail') r.stillFailing.push(c.id);
    else r.stablePass.push(c.id);
  }
  return r;
}

export function compareReport(a: RunResult, b: RunResult, changes: ChangeEntry[]): string {
  const cmp = compareRuns(a, b);
  const out: string[] = [];
  out.push(`# Before → after: ${mdEscape(a.meta.label)} → ${mdEscape(b.meta.label)}`, '', banner(a) || banner(b));
  if (a.meta.testsetHash !== b.meta.testsetHash)
    out.push('> ❗ The two runs used different test sets (hash mismatch). The comparison is not valid.\n');
  const row = (name: string, x: Summary) => `| ${name} | ${x.passed}/${x.graded} | ${pct(x.passRate)} | ${pct(x.ci.low)}–${pct(x.ci.high)} | ${x.criticalFailures} |`;
  out.push('| Run | Passed | Pass rate | 95% CI | Critical failures |', '|---|---|---|---|---|', row('Before', cmp.before), row('After', cmp.after), '');
  out.push(`Fixed: **${cmp.fixed.length}** · Regressed: **${cmp.regressed.length}** · Still failing: **${cmp.stillFailing.length}** · Not comparable: ${cmp.notComparable.length}`, '');
  out.push('## By category', '', '| Category | Before | After | Δ |', '|---|---|---|---|');
  for (const cat of CATEGORIES) {
    const x = cmp.before.byCategory[cat];
    const y = cmp.after.byCategory[cat];
    if (!x && !y) continue;
    const xr = x ? x.pass / x.n : 0;
    const yr = y ? y.pass / y.n : 0;
    out.push(`| ${cat} | ${x ? `${x.pass}/${x.n}` : '—'} | ${y ? `${y.pass}/${y.n}` : '—'} | ${yr - xr >= 0 ? '+' : ''}${Math.round((yr - xr) * 100)} pts |`);
  }
  out.push('', '## Failure types', '', '| Check | Before | After |', '|---|---|---|');
  const keys = new Set([...Object.keys(cmp.before.failureCounts), ...Object.keys(cmp.after.failureCounts)]);
  for (const k of [...keys].sort((p, q) => (cmp.before.failureCounts[q] ?? 0) - (cmp.before.failureCounts[p] ?? 0)))
    out.push(`| ${k} | ${cmp.before.failureCounts[k] ?? 0} | ${cmp.after.failureCounts[k] ?? 0} |`);
  if (changes.length) {
    out.push('', '## Changes and the categories they targeted', '', '| Change | Kind | Targeted categories: before → after |', '|---|---|---|');
    for (const ch of changes) {
      const cells = ch.targets.map((t: Category) => {
        const x = cmp.before.byCategory[t];
        const y = cmp.after.byCategory[t];
        return `${t} ${x ? `${x.pass}/${x.n}` : '—'}→${y ? `${y.pass}/${y.n}` : '—'}`;
      });
      out.push(`| **${mdEscape(ch.id)}** ${mdEscape(ch.description)} | ${ch.kind} | ${cells.join('<br>')} |`);
    }
    out.push('', '_Attribution is by targeted category. Changes shipped together are confounded; to prove which one mattered, revert one change at a time and rerun (ablation)._');
  }
  const list = (title: string, ids: string[]) => ids.length && out.push('', `## ${title}`, '', ...ids.map((i) => `- \`${i}\``));
  list('Fixed', cmp.fixed);
  list('Regressed', cmp.regressed);
  list('Still failing', cmp.stillFailing);
  return out.join('\n') + '\n';
}

export function writeupDraft(a: RunResult, b: RunResult, changes: ChangeEntry[], agentUrl?: string): string {
  const cmp = compareRuns(a, b);
  const top = Object.entries(cmp.before.failureCounts).sort((x, y) => y[1] - x[1]).slice(0, 4);
  return `# Agentplace AI Engineer test task — write-up
${banner(a) || banner(b)}
**Candidate:** Kartikeya Mishra · **Agent:** ${agentUrl ?? '<published agent link>'} · **Model:** Luna (free)

## Result
- Before: **${cmp.before.passed}/${cmp.before.graded}** conversations passed (${pct(cmp.before.passRate)}), ${cmp.before.criticalFailures} critical failures.
- After: **${cmp.after.passed}/${cmp.after.graded}** passed (${pct(cmp.after.passRate)}), ${cmp.after.criticalFailures} critical failures.
- ${cmp.fixed.length} fixed, ${cmp.regressed.length} regressed, ${cmp.stillFailing.length} still failing. Same ${b.cases.length}-conversation test set both times (hash \`${a.meta.testsetHash.slice(0, 12)}\`).

## How I tested
${b.cases.length} multi-turn conversations across ${new Set(b.cases.map((c) => c.category)).size} categories (known/unknown prices, invented services, booking with missing or changing details, off-topic, prompt injection, discount pressure, hand-off, privacy/safety, Hindi/Hinglish). Every reply is graded by deterministic checks — e.g. any amount not on the published price list is a critical failure, a canary code planted in the instructions detects leaks exactly — so before and after are measured the same way, not judged by impression.

## Biggest failures before
${top.map(([k, v]) => `- \`${k}\` — ${v} conversations`).join('\n') || '- none'}

## What I changed
${changes.map((c) => `- **${c.id}** (${c.kind}): ${c.description}`).join('\n') || '- <list each change>'}

## Which changes mattered
<!-- Write this yourself from the comparison table. Be specific: which change moved which category, and what you would ablate to confirm. -->

## What is still failing and what I would do next
${cmp.stillFailing.length ? cmp.stillFailing.map((i) => `- \`${i}\` — <why, and the next fix>`).join('\n') : '- Nothing in this suite. Next: grow the suite from real conversations and rerun weekly.'}

## Limitations
- ${b.cases.length} conversations is a small sample (the confidence intervals above are wide); single run per case, so model randomness is not averaged out.
- Some checks are heuristics (marked in the report); every borderline verdict was reviewed by hand and overrides are recorded with reasons.
`;
}
