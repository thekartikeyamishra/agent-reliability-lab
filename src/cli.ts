#!/usr/bin/env node
/**
 * Agent Reliability Lab — command line.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MockAdapter, type MockProfile } from './adapters/mock.js';
import { HttpAdapter } from './adapters/http.js';
import { OpenAICompatibleAdapter, openAIConfigFromEnv } from './adapters/openai.js';
import type { AgentAdapter } from './adapters/types.js';
import { knowledgeMarkdown, renderBrief } from './knowledge.js';
import { buildSite, checkLiveSite } from './site.js';
import { runWizard } from './wizard.js';
import { writeFactsPage } from './facts-page.js';
import { emailText, preflight, printPdf } from './submission.js';
import { recordInteractive } from './record.js';
import { applyReviews, compareReport, runCsv, runReport, summarize, writeupDraft } from './report.js';
import { gradeTranscript, runWithAdapter } from './runner.js';
import { renderCase, templateContext } from './template.js';
import type { BusinessFacts, ChangeEntry, ReviewOverride, RunResult, TestCase, Transcript } from './types.js';
import { TOOL_VERSION, UserError, nowIso, pct, readJson, readText, runDir, sha256, stableStringify, writeFileAtomic, writeJson } from './util.js';
import { validateBusiness, validateChanges, validateTestSet, validateTranscript } from './validate.js';

const ROOT = process.cwd();

// Load .env from the project folder if present (Node 22 built-in; real environment variables take precedence).
const ENV_FILE = join(ROOT, '.env');
if (existsSync(ENV_FILE)) {
  try {
    const before = { ...process.env };
    process.loadEnvFile(ENV_FILE);
    Object.assign(process.env, before);
  } catch (e) {
    console.error(`✖ Could not read .env: ${(e as Error).message}`);
    process.exit(1);
  }
}
const RUNS = join(ROOT, 'runs');
const OUT = join(ROOT, 'out');

type Flags = Record<string, string | true>;

function parseArgs(argv: string[]): { cmd: string; flags: Flags } {
  const [cmd = 'help', ...rest] = argv;
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('--')) throw new UserError(`Unexpected argument "${a}". Flags look like --name value.`);
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return { cmd, flags };
}

const str = (f: Flags, k: string, d?: string): string | undefined => (typeof f[k] === 'string' ? (f[k] as string) : d);
const num = (f: Flags, k: string, d: number): number => {
  const v = str(f, k);
  if (v === undefined) return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new UserError(`--${k} must be a non-negative number`);
  return n;
};

function loadBusiness(f: Flags): BusinessFacts {
  const p = resolve(ROOT, str(f, 'business', 'data/business.json')!);
  if (!existsSync(p)) throw new UserError(`No business facts at ${p}. Run "npm run arl -- init" first, then fill data/business.json from the business's public website.`);
  return validateBusiness(readJson(p));
}

function loadCases(f: Flags, b: BusinessFacts): { cases: TestCase[]; hash: string } {
  return loadCasesFrom(resolve(ROOT, str(f, 'tests', 'data/tests/testset.json')!), b);
}

const STRESS_PATH = 'data/tests/stress.json';

function loadCasesFrom(path: string, b: BusinessFacts): { cases: TestCase[]; hash: string } {
  const ts = validateTestSet(readJson(path));
  const ctx = templateContext(b);
  const cases = ts.cases.map((c) => renderCase(c, ctx));
  for (const c of cases) {
    const q = c.expect.quotesPriceOf;
    if (q && !b.services.some((s) => (s.id === q || s.name === q) && typeof s.price === 'number'))
      throw new UserError(`Test "${c.id}" expects the price of "${q}", but that service has no published price in your business facts.`);
  }
  return { cases, hash: sha256(stableStringify(cases)) };
}

function loadChanges(): ChangeEntry[] {
  const p = join(ROOT, 'agent', 'changes.json');
  return existsSync(p) ? validateChanges(readJson(p)) : [];
}

function loadReviews(dir: string): Record<string, ReviewOverride> {
  const p = join(dir, 'review.json');
  if (!existsSync(p)) return {};
  const r = readJson<Record<string, ReviewOverride>>(p);
  for (const [id, v] of Object.entries(r)) {
    if (id.startsWith('_')) continue;
    if (!v || !['pass', 'fail'].includes(v.status) || !v.reason?.trim() || !v.reviewer?.trim())
      throw new UserError(`review.json: "${id}" needs status (pass|fail), a reason and a reviewer.`);
  }
  return Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));
}

function writeRun(dir: string, run: RunResult): void {
  writeJson(join(dir, 'result.json'), run);
  const reviewed = applyReviews(run, loadReviews(dir));
  writeFileAtomic(join(dir, 'report.md'), runReport(reviewed));
  writeFileAtomic(join(dir, 'cases.csv'), runCsv(reviewed));
  if (!existsSync(join(dir, 'review.json')))
    writeJson(join(dir, 'review.json'), { _example: { status: 'pass', reason: 'Heuristic false positive: the reply declines the service in a sentence the negation check missed.', reviewer: 'Kartikeya Mishra' } });
}

function printSummary(run: RunResult, dir: string): void {
  const s = summarize(applyReviews(run, loadReviews(dir)));
  console.log(`\n${run.meta.label}: ${s.passed}/${s.graded} passed (${pct(s.passRate)}, 95% CI ${pct(s.ci.low)}–${pct(s.ci.high)}), critical failures ${s.criticalFailures}, errors ${s.errors}`);
  console.log(`Report: ${join(dir, 'report.md')}`);
}

function makeAdapter(kind: string, f: Flags, b: BusinessFacts): AgentAdapter {
  switch (kind) {
    case 'mock':
      return new MockAdapter(b, (str(f, 'profile', 'grounded') as MockProfile) === 'naive' ? 'naive' : 'grounded');
    case 'openai': {
      const v = str(f, 'brief', 'v2')!;
      if (!/^v\d+$/.test(v)) throw new UserError('--brief must look like v1 or v2');
      const system = renderBrief(readText(join(ROOT, 'agent', `brief.${v}.md`)), b);
      return new OpenAICompatibleAdapter(openAIConfigFromEnv(system, { model: str(f, 'model') }));
    }
    case 'http':
      return new HttpAdapter();
    default:
      throw new UserError(`Unknown adapter "${kind}". Use transcript | mock | openai | http.`);
  }
}

async function cmdRun(f: Flags): Promise<RunResult> {
  const b = loadBusiness(f);
  const { cases, hash } = loadCases(f, b);
  const runId = str(f, 'run');
  if (!runId) throw new UserError('--run <id> is required (e.g. --run before)');
  const dir = runDir(RUNS, runId);
  mkdirSync(dir, { recursive: true });
  const kind = str(f, 'adapter', 'transcript')!;
  const opts = {
    concurrency: num(f, 'concurrency', 2),
    rpm: num(f, 'rpm', 0),
    judge: f.judge === true,
    judgeStrict: f['judge-strict'] === true,
    onProgress: (d: number, t: number, r: { id: string; status: string }) => process.stdout.write(`\r[${d}/${t}] ${r.status.padEnd(5)} ${r.id.padEnd(30)}`),
  };
  const meta = {
    runId, label: str(f, 'label', runId)!, adapter: kind, businessId: b.id, businessIsDemo: !!b.isDemo,
    testsetHash: hash, startedAt: nowIso(), toolVersion: TOOL_VERSION,
  };
  let run: RunResult;
  if (kind === 'transcript') {
    const t = validateTranscript(readJson(join(dir, 'transcript.json')));
    if (t.testsetHash !== hash) throw new UserError('transcript.json was recorded against a different test set or business facts. Re-record, or restore the original files.');
    run = { meta: { ...meta, agentUrl: t.agentUrl }, cases: await gradeTranscript(t, cases, b, opts) };
  } else {
    const adapter = makeAdapter(kind, f, b);
    const checkpointKey = `${hash}|${kind}|${adapter.model ?? ''}|${str(f, 'brief', '')}|${TOOL_VERSION}`;
    run = { meta: { ...meta, model: adapter.model }, cases: await runWithAdapter(adapter, cases, b, { ...opts, checkpointPath: join(dir, 'checkpoint.json'), checkpointKey, fresh: f.fresh === true || kind === 'mock' }) };
  }
  run.meta.finishedAt = nowIso();
  writeRun(dir, run);
  printSummary(run, dir);
  return run;
}

async function cmdRecord(f: Flags): Promise<void> {
  const b = loadBusiness(f);
  if (b.isDemo) console.warn('⚠️  You are recording against the DEMO business facts. Fill data/business.json with your real business first.');
  const { cases, hash } = loadCases(f, b);
  const dir = runDir(RUNS, str(f, 'run') ?? (() => { throw new UserError('--run <id> is required'); })());
  const path = join(dir, 'transcript.json');
  let t: Transcript;
  if (existsSync(path)) {
    t = validateTranscript(readJson(path));
    if (t.testsetHash !== hash) throw new UserError('Existing transcript belongs to a different test set. Use a new --run id.');
  } else {
    const url = str(f, 'agent-url');
    if (url && !/^https:\/\//.test(url)) throw new UserError('--agent-url must be an https link');
    t = { schemaVersion: 1, runId: str(f, 'run')!, agentUrl: url, agentVersion: str(f, 'agent-version'), testsetHash: hash, recordedAt: nowIso(), cases: {} };
  }
  await recordInteractive(path, t, cases, f['no-clipboard'] !== true);
}

async function cmdCompare(f: Flags): Promise<void> {
  const a = str(f, 'before', 'before')!;
  const c = str(f, 'after', 'after')!;
  const da = runDir(RUNS, a);
  const dc = runDir(RUNS, c);
  const ra = applyReviews(readJson<RunResult>(join(da, 'result.json')), loadReviews(da));
  const rc = applyReviews(readJson<RunResult>(join(dc, 'result.json')), loadReviews(dc));
  const changes = loadChanges();
  const dir = runDir(RUNS, `compare-${a}-vs-${c}`.slice(0, 64));
  writeFileAtomic(join(dir, 'comparison.md'), compareReport(ra, rc, changes));
  writeFileAtomic(join(dir, 'writeup.draft.md'), writeupDraft(ra, rc, changes, str(f, 'agent-url') ?? rc.meta.agentUrl ?? ra.meta.agentUrl));
  const sa = summarize(ra);
  const sc = summarize(rc);
  console.log(`Before ${sa.passed}/${sa.graded} (${pct(sa.passRate)}) → After ${sc.passed}/${sc.graded} (${pct(sc.passRate)})`);
  console.log(`Comparison: ${join(dir, 'comparison.md')}\nWrite-up draft: ${join(dir, 'writeup.draft.md')}`);
}

interface ModelSpec { label: string; baseUrls: string[]; model: string; apiKeyEnv?: string; usdPerMInput?: number; usdPerMOutput?: number }

async function cmdModels(f: Flags): Promise<void> {
  const b = loadBusiness(f);
  const { cases, hash } = loadCases(f, b);
  const cfg = readJson<{ models: ModelSpec[] }>(resolve(ROOT, str(f, 'config', 'models.json')!));
  if (!Array.isArray(cfg.models) || !cfg.models.length) throw new UserError('models.json needs a non-empty "models" array');
  const system = renderBrief(readText(join(ROOT, 'agent', `brief.${str(f, 'brief', 'v2')}.md`)), b);
  const rows: string[] = ['| Model | Passed | Rate | Critical | p50 ms | p95 ms | Cost / conversation (USD) |', '|---|---|---|---|---|---|---|'];
  for (const m of cfg.models) {
    const runId = `model-${m.label}`.replace(/[^a-z0-9._-]/gi, '-').slice(0, 64);
    const dir = runDir(RUNS, runId);
    console.log(`\n▶ ${m.label}`);
    const adapter = new OpenAICompatibleAdapter(openAIConfigFromEnv(system, {
      baseUrls: m.baseUrls, model: m.model, apiKey: m.apiKeyEnv ? process.env[m.apiKeyEnv] : undefined,
    }));
    const results = await runWithAdapter(adapter, cases, b, {
      concurrency: num(f, 'concurrency', 2), rpm: num(f, 'rpm', 0), checkpointPath: join(dir, 'checkpoint.json'),
      checkpointKey: `${hash}|${m.model}|${m.baseUrls.join(',')}|${str(f, 'brief', 'v2')}`, fresh: f.fresh === true,
      onProgress: (d, t, r) => process.stdout.write(`\r[${d}/${t}] ${r.status.padEnd(5)} ${r.id.padEnd(30)}`),
    });
    const run: RunResult = { meta: { runId, label: m.label, adapter: 'openai', model: m.model, businessId: b.id, businessIsDemo: !!b.isDemo, testsetHash: hash, startedAt: nowIso(), finishedAt: nowIso(), toolVersion: TOOL_VERSION }, cases: results };
    writeRun(dir, run);
    const s = summarize(run);
    const cost = s.tokens ? ((s.tokens.input * (m.usdPerMInput ?? 0) + s.tokens.output * (m.usdPerMOutput ?? 0)) / 1e6 / Math.max(1, s.graded)).toFixed(5) : 'n/a';
    rows.push(`| ${m.label} | ${s.passed}/${s.graded} | ${pct(s.passRate)} | ${s.criticalFailures} | ${s.latency?.p50 ?? '—'} | ${s.latency?.p95 ?? '—'} | ${cost} |`);
  }
  const out = join(RUNS, 'models.md');
  writeFileAtomic(out, `# Model comparison (same brief, same ${cases.length} conversations)\n\n${rows.join('\n')}\n`);
  console.log(`\n\nModel comparison: ${out}`);
}

interface SiteConfig { domain: string; ownerName: string; ownerLinks: Array<{ label: string; href: string }>; allowIndexing?: boolean; firebaseSite?: string; firebaseProject?: string }

function loadSiteConfig(): SiteConfig {
  const p = join(ROOT, 'site.config.json');
  const c = existsSync(p) ? readJson<SiteConfig>(p) : { domain: 'evals.truesourceai.me', ownerName: 'Kartikeya Mishra', ownerLinks: [] };
  if (typeof c.domain !== 'string' || typeof c.ownerName !== 'string' || !Array.isArray(c.ownerLinks)) throw new UserError('site.config.json needs domain, ownerName and ownerLinks');
  for (const l of c.ownerLinks) if (!/^https:\/\//.test(l?.href ?? '')) throw new UserError(`site.config.json: link "${l?.label}" must be https`);
  return c;
}

async function cmdSite(f: Flags): Promise<void> {
  const demo = f.demo === true;
  const cfg = loadSiteConfig();
  if (demo) await cmdDemo();
  const bf: Flags = demo ? { ...f, business: 'data/business.example.json' } : f;
  const b = loadBusiness(bf);
  const { cases } = loadCases(bf, b);
  const a = demo ? 'demo-before' : str(f, 'before', 'before')!;
  const c = demo ? 'demo-after' : str(f, 'after', 'after')!;
  const da = runDir(RUNS, a);
  const dc = runDir(RUNS, c);
  const before = applyReviews(readJson<RunResult>(join(da, 'result.json')), loadReviews(da));
  const after = applyReviews(readJson<RunResult>(join(dc, 'result.json')), loadReviews(dc));
  const synthetic = [before, after].some((r) => r.meta.adapter === 'mock' || r.meta.businessIsDemo);
  if (synthetic && !demo && f['allow-demo'] !== true)
    throw new UserError('These runs are synthetic (mock agent or demo business). Record real runs, or pass --allow-demo for a local preview only.');
  const errors = after.cases.filter((x) => x.status === 'error').length + before.cases.filter((x) => x.status === 'error').length;
  if (errors && !demo) console.warn(`⚠️  ${errors} case(s) are status "error" (not recorded or mismatched). Finish recording before publishing.`);
  const cmpDir = runDir(RUNS, `compare-${a}-vs-${c}`.slice(0, 64));
  const writeupPath = str(f, 'writeup') ?? join(cmpDir, 'writeup.md');
  let writeupMd: string | undefined;
  if (existsSync(writeupPath)) writeupMd = readText(writeupPath);
  else if (demo && existsSync(join(cmpDir, 'writeup.draft.md'))) writeupMd = readText(join(cmpDir, 'writeup.draft.md'));
  else console.warn(`ℹ️  No final write-up at ${writeupPath} — copy writeup.draft.md to writeup.md, finish it, and rebuild. Building without it.`);
  if (writeupMd && /<[a-z ]*link[^>]*>|<published agent link>/i.test(writeupMd) && !demo) console.warn('⚠️  The write-up still contains <placeholders>. Fill them in before publishing.');
  const agentUrl = str(f, 'agent-url') ?? after.meta.agentUrl ?? before.meta.agentUrl;
  if (agentUrl && !/^https:\/\//.test(agentUrl)) throw new UserError('--agent-url must be https');
  const outDir = str(f, 'out', 'site')!;
  const stressFile = resolve(ROOT, STRESS_PATH);
  const stressSet = existsSync(stressFile) ? loadCasesFrom(stressFile, b) : undefined;
  const stressId = demo ? 'demo-stress' : str(f, 'stress', 'stress')!;
  const stressDir = runDir(RUNS, stressId);
  let stress: RunResult | undefined;
  if (stressSet && existsSync(join(stressDir, 'result.json'))) {
    stress = applyReviews(readJson<RunResult>(join(stressDir, 'result.json')), loadReviews(stressDir));
    if (stress.meta.testsetHash !== stressSet.hash) {
      console.warn('⚠️  The stress run used a different stress set or business facts — not included.');
      stress = undefined;
    } else if ((stress.meta.adapter === 'mock' || stress.meta.businessIsDemo) && !demo && f['allow-demo'] !== true) {
      console.warn('⚠️  The stress run is synthetic — not included.');
      stress = undefined;
    }
  } else if (stressSet && !demo) {
    console.log(`ℹ️  No stress run found (runs/${stressId}). The scenarios are still listed; record them with: node dist/cli.js record --run stress --tests ${STRESS_PATH}`);
  }
  const files = buildSite({
    outDir, domain: str(f, 'domain', cfg.domain)!, ownerName: cfg.ownerName, ownerLinks: cfg.ownerLinks,
    business: b, cases, rawTestSetJson: readText(resolve(ROOT, str(f, 'tests', 'data/tests/testset.json')!)),
    stressCases: stressSet?.cases, rawStressJson: stressSet ? readText(stressFile) : undefined, stress,
    before, after, changes: demo ? (existsSync(join(ROOT, 'agent', 'changes.example.json')) ? validateChanges(readJson(join(ROOT, 'agent', 'changes.example.json'))) : []) : loadChanges(),
    writeupMd, agentUrl, allowIndexing: f.index === true || cfg.allowIndexing === true,
    firebaseSite: cfg.firebaseSite || undefined, firebaseProject: cfg.firebaseProject || undefined,
  });
  const factFiles = writeFactsPage(b, join(resolve(outDir), 'facts'));
  console.log(`Included the business facts page the agent was graded against: facts/${factFiles[0]}`);
  console.log(`\nBuilt ${files.length + factFiles.length} files in ${resolve(outDir)}${synthetic ? ' (SYNTHETIC PREVIEW — do not deploy)' : ''}`);
  console.log(`Preview: open ${join(resolve(outDir), 'index.html')} in your browser. Deploy: docs/DOMAIN-SETUP.md`);
}

async function cmdCheckSite(f: Flags): Promise<void> {
  const domain = str(f, 'domain', loadSiteConfig().domain)!;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new UserError('Invalid --domain');
  console.log(`Checking https://${domain} …`);
  const r = await checkLiveSite(domain);
  for (const l of r.lines) console.log(l);
  console.log(r.ok ? '\nAll checks passed.' : '\nSome checks failed — see docs/DOMAIN-SETUP.md (Troubleshooting).');
  if (!r.ok) process.exitCode = 1;
}

async function cmdWizard(f: Flags): Promise<void> {
  const target = join(ROOT, 'data', 'business.json');
  if (existsSync(target) && f.force !== true) {
    const cur = readJson<{ isDemo?: boolean }>(target);
    if (!cur.isDemo) throw new UserError('data/business.json already holds real facts. Re-run with --force to replace it (this changes the test set hash — do it before recording, never between before and after).');
  }
  const presetName = str(f, 'preset');
  let preset = null;
  if (presetName) {
    if (!/^[a-z0-9-]+$/.test(presetName)) throw new UserError('Invalid preset name');
    const p = join(ROOT, 'data', 'presets', `${presetName}.json`);
    if (!existsSync(p)) throw new UserError(`No preset "${presetName}". Available: truesource-ai`);
    preset = readJson(p);
  }
  const facts = await runWizard(preset as Parameters<typeof runWizard>[0]);
  writeJson(target, facts);
  const ch = join(ROOT, 'agent', 'changes.json');
  if (!existsSync(ch)) writeJson(ch, []);
  console.log(`\n✓ Saved ${target}`);
  console.log('Next: node dist/cli.js facts-page   → publish the page on your site BEFORE building the agent');
}

function cmdFactsPage(f: Flags): void {
  const b = loadBusiness(f);
  const out = join(OUT, 'facts');
  const files = writeFactsPage(b, out);
  console.log(`Wrote ${files.map((x) => join(out, x)).join(' and ')}`);
  console.log(`Publish both so that ${b.sourceUrls[0]} serves the page (see docs/NO-BUSINESS-PLAN.md).`);
}

function loadSubmissionContext(f: Flags) {
  const b = loadBusiness(f);
  const core = loadCases(f, b);
  const a = str(f, 'before', 'before')!;
  const c = str(f, 'after', 'after')!;
  const read = (id: string): RunResult | undefined => {
    const d = runDir(RUNS, id);
    return existsSync(join(d, 'result.json')) ? applyReviews(readJson<RunResult>(join(d, 'result.json')), loadReviews(d)) : undefined;
  };
  const before = read(a);
  const after = read(c);
  const stress = read(str(f, 'stress', 'stress')!);
  const stressHash = existsSync(join(ROOT, STRESS_PATH)) ? loadCasesFrom(join(ROOT, STRESS_PATH), b).hash : undefined;
  const writeupPath = str(f, 'writeup') ?? join(runDir(RUNS, `compare-${a}-vs-${c}`.slice(0, 64)), 'writeup.md');
  return { b, coreHash: core.hash, before, after, stress, stressHash, writeupPath, cfg: loadSiteConfig(), siteDir: resolve(str(f, 'site', 'site')!) };
}

function printChecks(checks: Array<{ level: string; msg: string }>): boolean {
  for (const x of checks) console.log(`${x.level === 'ok' ? '✓' : x.level === 'warn' ? '⚠' : '✗'} ${x.msg}`);
  const fails = checks.filter((x) => x.level === 'fail').length;
  console.log(fails ? `\n${fails} blocking problem(s). Fix them before sending.` : '\nReady to send.');
  return fails === 0;
}

async function cmdPreflight(f: Flags): Promise<boolean> {
  const x = loadSubmissionContext(f);
  const checks = preflight({ business: x.b, coreHash: x.coreHash, before: x.before, after: x.after, stress: x.stress, stressHash: x.stressHash, changes: loadChanges(), writeupPath: x.writeupPath, siteDir: x.siteDir });
  if (f.online === true) {
    const live = await checkLiveSite(x.cfg.domain);
    for (const l of live.lines) checks.push({ level: l.startsWith('✓') ? 'ok' : 'fail', msg: `live: ${l.slice(2)}` });
    for (const u of x.b.sourceUrls) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
        checks.push(r.ok ? { level: 'ok', msg: `Facts page online: ${u}` } : { level: 'fail', msg: `Facts page ${u} → HTTP ${r.status}` });
      } catch (e) {
        checks.push({ level: 'fail', msg: `Facts page ${u} unreachable: ${(e as Error).message}` });
      }
    }
  } else checks.push({ level: 'warn', msg: 'Live domain not checked — add --online once deployed' });
  const ok = printChecks(checks);
  if (!ok) process.exitCode = 1;
  return ok;
}

async function cmdPack(f: Flags): Promise<void> {
  const ok = await cmdPreflight(f);
  if (!ok && f.force !== true) throw new UserError('Not packing until the blocking problems are fixed (or pass --force for a draft pack).');
  const x = loadSubmissionContext(f);
  if (!x.before || !x.after) throw new UserError('Need both before and after runs.');
  const out = join(OUT, 'submission');
  const writeupMd = existsSync(x.writeupPath) ? readText(x.writeupPath) : undefined;
  writeFileAtomic(join(out, 'email.txt'), emailText({ business: x.b, before: x.before, after: x.after, stress: x.stress, domain: x.cfg.domain, writeupMd, ownerName: x.cfg.ownerName, ownerLinks: x.cfg.ownerLinks }));
  writeFileAtomic(join(out, 'before-report.md'), runReport(x.before));
  writeFileAtomic(join(out, 'after-report.md'), runReport(x.after));
  if (x.stress) writeFileAtomic(join(out, 'stress-report.md'), runReport(x.stress));
  writeFileAtomic(join(out, 'comparison.md'), compareReport(x.before, x.after, loadChanges()));
  if (writeupMd) writeFileAtomic(join(out, 'writeup.md'), writeupMd);
  const pdfName = `Writeup-${x.cfg.ownerName.replace(/\s+/g, '-')}.pdf`;
  const writeupHtml = join(x.siteDir, 'writeup.html');
  const pdf = existsSync(writeupHtml) && printPdf(writeupHtml, join(out, pdfName));
  writeFileAtomic(join(out, 'README.txt'), `Submission pack — ${x.cfg.ownerName}\n\nemail.txt          the email to send (fill the <ONE OR TWO LINES> about you)\n${pdf ? pdfName : '(write-up PDF)  open site/writeup.html in Edge/Chrome → Ctrl+P → Save as PDF'}   attach this\nbefore-report.md, after-report.md, comparison.md${x.stress ? ', stress-report.md' : ''}, writeup.md   backup copies of what is on https://${x.cfg.domain}\n`);
  if (readText(join(out, 'email.txt')).includes('<ONE')) console.log('\n⚠ email.txt still has a <CAPITALISED> line for you to write (about you / what mattered). Fill it before sending.');
  console.log(`\nPack written to ${out}${pdf ? ` (incl. ${pdfName})` : ' — no Chrome/Edge found for the PDF; see README.txt'}`);
}

function cmdInit(): void {
  const target = join(ROOT, 'data', 'business.json');
  if (existsSync(target)) {
    console.log('data/business.json already exists — leaving it untouched.');
  } else {
    copyFileSync(join(ROOT, 'data', 'business.example.json'), target);
    const b = readJson<BusinessFacts>(target);
    b.canary = newCanary();
    b.isDemo = true; // stays true until you replace the demo facts with real ones
    writeJson(target, b);
    console.log('Created data/business.json from the demo. Replace EVERY fact with the real business, copied from its public pages,');
    console.log('list those pages in sourceUrls, set verifiedOn, and set "isDemo": false.');
  }
  const ch = join(ROOT, 'agent', 'changes.json');
  if (!existsSync(ch)) writeJson(ch, []);
}

function newCanary(): string {
  return `ARL-${randomBytes(6).toString('hex').toUpperCase()}`;
}

async function cmdDemo(): Promise<void> {
  const f: Flags = { business: 'data/business.example.json' };
  const before = await cmdRun({ ...f, adapter: 'mock', profile: 'naive', run: 'demo-before', label: 'Demo: naive draft agent (mock)' });
  const after = await cmdRun({ ...f, adapter: 'mock', profile: 'grounded', run: 'demo-after', label: 'Demo: hardened agent (mock)' });
  if (existsSync(join(ROOT, STRESS_PATH)))
    await cmdRun({ ...f, tests: STRESS_PATH, adapter: 'mock', profile: 'grounded', run: 'demo-stress', label: 'Demo: stress suite, hardened agent (mock)' });
  const dir = runDir(RUNS, 'compare-demo-before-vs-demo-after');
  const changes = existsSync(join(ROOT, 'agent', 'changes.example.json')) ? validateChanges(readJson(join(ROOT, 'agent', 'changes.example.json'))) : [];
  writeFileAtomic(join(dir, 'comparison.md'), compareReport(before, after, changes));
  writeFileAtomic(join(dir, 'writeup.draft.md'), writeupDraft(before, after, changes));
  console.log(`\nDemo comparison: ${join(dir, 'comparison.md')}`);
}

function cmdEnv(): void {
  const show = (k: string) => {
    const v = process.env[k];
    if (!v) return `${k} = (not set)`;
    return /KEY|AUTH/.test(k) ? `${k} = set (${v.length} chars, hidden)` : `${k} = ${v}`;
  };
  console.log(existsSync(ENV_FILE) ? `Loaded ${ENV_FILE}` : 'No .env file found (copy .env.example to .env)');
  for (const k of ['ARL_BASE_URLS', 'ARL_MODEL', 'ARL_API_KEY', 'ARL_TIMEOUT_MS', 'ARL_RETRIES', 'ARL_JUDGE_MODEL', 'ARL_JUDGE_BASE_URLS', 'ARL_JUDGE_API_KEY', 'ARL_HTTP_URL', 'ARL_HTTP_REPLY_PATH', 'ARL_HTTP_AUTH'])
    console.log('  ' + show(k));
}

async function cmdPing(f: Flags): Promise<void> {
  const cfg = openAIConfigFromEnv('Reply with exactly: OK', { model: str(f, 'model'), retries: 0 });
  console.log(`Pinging ${cfg.baseUrls.join(', ')} with model ${cfg.model} …`);
  const t0 = Date.now();
  let r;
  try {
    r = await (await new OpenAICompatibleAdapter(cfg).startSession()).send('ping');
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    throw new UserError(`Model endpoint not reachable (${msg.slice(0, 160)}).\n  Local: is Ollama running? (open the Ollama app, or run "ollama serve") and did you "ollama pull ${cfg.model}"?\n  Hosted: check ARL_BASE_URLS and ARL_API_KEY.`);
  }
  console.log(`✓ Reply in ${Date.now() - t0} ms: ${r.text.slice(0, 80)}`);
}

const HELP = `Agent Reliability Lab ${TOOL_VERSION} — evaluation harness for customer-facing AI agents

  wizard [--preset truesource-ai] [--force]
                               guided setup of data/business.json (use your own product as the business)
  facts-page                   write out/facts/pricing.html + facts.json — the public page your agent's facts come from
  init                         create data/business.json (+ fresh canary) and agent/changes.json
  canary                       print a new random canary code
  validate                     check business facts, test set and briefs
  knowledge                    write out/knowledge.md (paste into your agent's knowledge)
  brief --version v1|v2        write out/brief.<v>.md (paste into the Agentplace Builder)
  cases                        write out/test-set.md (human-readable rendered test set)
  record --run <id> [--agent-url https://…] [--no-clipboard]
                               record replies from a published agent, case by case (resumable)
  run --run <id> [--adapter transcript|mock|openai|http] [--profile naive|grounded]
      [--brief v2] [--model m] [--judge] [--judge-strict] [--concurrency 2] [--rpm 0] [--label "…"] [--fresh]
  report --run <id>            rebuild report.md after editing runs/<id>/review.json
  compare --before <id> --after <id> [--agent-url …]
                               before/after tables + write-up draft
  models [--config models.json]  compare models on quality, latency and cost (OpenAI-compatible endpoints)
  site [--before before --after after] [--writeup path] [--agent-url …] [--domain evals.truesourceai.me]
       [--out site] [--index] [--demo]
                               build the static evidence site for your domain (no JS, strict security headers)
  check-site [--domain …]      verify the live site: HTTPS redirect, pages, security headers, no canary leak
  env                          show which settings are loaded (secrets hidden)
  ping [--model m]             one tiny request to check your model endpoint works
  preflight [--online]         every check before you send (real runs, no placeholders, site built, live domain)
  pack [--force]               out/submission: filled-in email, write-up PDF, reports
  demo                         end-to-end self-test with a mock agent and the fictional demo business

  Common: --business <path> (default data/business.json)  --tests <path> (default data/tests/testset.json)
`;

async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case 'init':
      return cmdInit();
    case 'canary':
      return console.log(newCanary());
    case 'validate': {
      const b = loadBusiness(flags);
      const { cases, hash } = loadCases(flags, b);
      for (const v of ['v1', 'v2']) renderBrief(readText(join(ROOT, 'agent', `brief.${v}.md`)), b);
      loadChanges();
      console.log(`OK — ${b.name}${b.isDemo ? ' (DEMO facts)' : ''}: ${b.services.length} services, ${cases.length} test conversations, test set ${hash.slice(0, 12)}.`);
      if (b.isDemo) console.warn('⚠️  isDemo is true. Replace the facts with your real business before recording.');
      return;
    }
    case 'knowledge': {
      const p = join(OUT, 'knowledge.md');
      writeFileAtomic(p, knowledgeMarkdown(loadBusiness(flags)));
      return console.log(`Wrote ${p}`);
    }
    case 'brief': {
      const v = str(flags, 'version', 'v2')!;
      if (!/^v\d+$/.test(v)) throw new UserError('--version must look like v1 or v2');
      const p = join(OUT, `brief.${v}.md`);
      writeFileAtomic(p, renderBrief(readText(join(ROOT, 'agent', `brief.${v}.md`)), loadBusiness(flags)));
      return console.log(`Wrote ${p}`);
    }
    case 'cases': {
      const b = loadBusiness(flags);
      const { cases } = loadCases(flags, b);
      const md = cases.map((c, i) => `## ${i + 1}. ${c.id} — ${c.title} (${c.category}, ${c.difficulty})\n\n${c.turns.map((t, j) => `${j + 1}. ${t}`).join('\n')}\n\n_Why:_ ${c.rationale}\n\n_Pass criteria:_ \`${JSON.stringify(Object.fromEntries(Object.entries(c.expect).filter(([, v]) => v !== undefined)))}\`\n`).join('\n');
      const p = join(OUT, 'test-set.md');
      writeFileAtomic(p, `# Test set — ${b.name}\n\n${cases.length} conversations. Every agent turn is also checked for: unpublished prices, instruction leaks (canary), echoed card numbers, empty replies.\n\n${md}`);
      return console.log(`Wrote ${p}`);
    }
    case 'record':
      return cmdRecord(flags);
    case 'run':
      await cmdRun(flags);
      return;
    case 'report': {
      const dir = runDir(RUNS, str(flags, 'run') ?? 'before');
      const run = readJson<RunResult>(join(dir, 'result.json'));
      writeRun(dir, run);
      return printSummary(run, dir);
    }
    case 'compare':
      return cmdCompare(flags);
    case 'models':
      return cmdModels(flags);
    case 'demo':
      return cmdDemo();
    case 'wizard':
      return cmdWizard(flags);
    case 'facts-page':
      return cmdFactsPage(flags);
    case 'env':
      return cmdEnv();
    case 'preflight':
      await cmdPreflight(flags);
      return;
    case 'pack':
      return cmdPack(flags);
    case 'ping':
      return cmdPing(flags);
    case 'site':
      return cmdSite(flags);
    case 'check-site':
      return cmdCheckSite(flags);
    case 'help':
    case '--help':
    case '-h':
      return console.log(HELP);
    default:
      throw new UserError(`Unknown command "${cmd}".\n\n${HELP}`);
  }
}

main().catch((e: unknown) => {
  if (e instanceof UserError) console.error(`\n✖ ${e.message}`);
  else console.error('\n✖ Unexpected error:', e);
  process.exitCode = 1;
});
