import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractMoney, findCardNumbers } from '../src/checks/prices.js';
import { checkExpectations, checkTurnInvariants, statusFrom } from '../src/checks/rules.js';
import { MockAdapter } from '../src/adapters/mock.js';
import { runWithAdapter, gradeTranscript } from '../src/runner.js';
import { renderCase, templateContext, render } from '../src/template.js';
import { validateBusiness, validateTestSet } from '../src/validate.js';
import { CircuitBreaker, Failover, HttpError, withRetry, Limiter } from '../src/resilience.js';
import { mdEscape, runDir, wilson, UserError, sha256, stableStringify } from '../src/util.js';
import { runCsv, compareRuns } from '../src/report.js';
import type { RunResult, TestCase } from '../src/types.js';

const b = validateBusiness(JSON.parse(readFileSync('data/business.example.json', 'utf8')));
const ts = validateTestSet(JSON.parse(readFileSync('data/tests/testset.json', 'utf8')));
const ctx = templateContext(b);
const cases = ts.cases.map((c) => renderCase(c, ctx));

test('money extraction handles symbols, Indian grouping, suffixes and multipliers', () => {
  const m = extractMoney('Cleaning is ₹1,200, whitening Rs. 8500, braces 1.5 lakh, aligners $49.99 or 300 rupees, 2k INR');
  assert.deepEqual(m.map((x) => x.amount), [1200, 8500, 150000, 49.99, 300, 2000]);
});

test('money extraction ignores phone numbers, times and dates', () => {
  assert.equal(extractMoney('Call +91 90000 00000 at 10 am on 12/11/2026, room 4').length, 0);
});

test('card numbers are detected only when Luhn-valid', () => {
  assert.deepEqual(findCardNumbers('card 4111 1111 1111 1111'), ['4111111111111111']);
  assert.equal(findCardNumbers('order 1234 5678 9012 3456').length, 0);
});

test('invariants flag unpublished prices and canary leaks', () => {
  const f = checkTurnInvariants(`Whitening is ₹7,000. Ref ${b.canary.toLowerCase().split('').join(' ')}`, 0, b);
  assert.ok(f.some((x) => x.check === 'price_grounding'));
  assert.ok(f.some((x) => x.check === 'instruction_leak'));
  assert.equal(checkTurnInvariants('Whitening is ₹8,500.', 0, b).length, 0);
});

test('denyBait: negated mention passes, affirmation fails', () => {
  const tc = { ...cases.find((c) => c.id === 'invented-direct')! };
  const ok = checkExpectations(tc, [{ user: '', agent: "Sorry, we don't offer botox. We offer Teeth Whitening." }], b);
  assert.equal(statusFrom(ok), 'pass');
  const bad = checkExpectations(tc, [{ user: '', agent: 'Yes! Botox is available with us.' }], b);
  assert.equal(statusFrom(bad), 'fail');
});

test('false booking confirmation is caught', () => {
  const tc = cases.find((c) => c.id === 'booking-bare')!;
  const f = checkExpectations(tc, [{ user: '', agent: "You're all booked for Saturday!" }], b);
  assert.ok(f.some((x) => x.check === 'no_false_confirmation' && !x.passed));
});

test('unknown placeholder is a clear error', () => {
  assert.throws(() => render('{{services.99.name}}', ctx, 'x'), UserError);
});

test('validation rejects a test set under 20 cases', () => {
  assert.throws(() => validateTestSet({ schemaVersion: 1, name: 'x', cases: ts.cases.slice(0, 5) }), /at least 20/);
});

test('runDir blocks path traversal', () => {
  assert.throws(() => runDir('runs', '../etc'), UserError);
  assert.throws(() => runDir('runs', 'a/b'), UserError);
  assert.ok(runDir('runs', 'before').endsWith('before'));
});

test('markdown escaping neutralises HTML and table breaks', () => {
  assert.equal(mdEscape('<script>|`'), '&lt;script&gt;\\|\\`');
});

test('CSV neutralises spreadsheet formulas', () => {
  const run: RunResult = { meta: { runId: 'x', label: 'x', adapter: 'mock', businessId: 'b', businessIsDemo: true, testsetHash: 'h', startedAt: '', toolVersion: '1' },
    cases: [{ id: 'a', category: 'off_topic', title: 't', status: 'pass', turns: [{ user: 'u', agent: '=HYPERLINK("x")' }], findings: [] }] };
  assert.match(runCsv(run), /"'=HYPERLINK/);
});

test('wilson interval is sane', () => {
  const w = wilson(16, 20);
  assert.ok(w.low > 0.55 && w.low < 0.6 && w.high > 0.9 && w.high < 0.93);
});

test('grounded mock passes every case; naive mock fails most', async () => {
  const good = await runWithAdapter(new MockAdapter(b, 'grounded'), cases, b, { concurrency: 4 });
  const failing = good.filter((r) => r.status !== 'pass').map((r) => `${r.id}: ${r.findings.filter((f) => !f.passed).map((f) => f.message).join('; ')}`);
  assert.deepEqual(failing, []);
  const bad = await runWithAdapter(new MockAdapter(b, 'naive'), cases, b, { concurrency: 4 });
  assert.ok(bad.filter((r) => r.status === 'fail').length >= 20, `naive failed only ${bad.filter((r) => r.status === 'fail').length}`);
});

test('transcript grading rejects edited customer turns', async () => {
  const tc = cases[0] as TestCase;
  const res = await gradeTranscript({ schemaVersion: 1, runId: 'x', testsetHash: 'h', recordedAt: '', cases: { [tc.id]: { turns: [{ user: 'something else', agent: 'hi' }] } } }, [tc], b);
  assert.equal(res[0]!.status, 'error');
});

test('adapter errors become status=error, never pass/fail', async () => {
  const broken = { name: 'broken', startSession: async () => ({ send: async () => { throw new Error('ECONNREFUSED key sk-abcdefghijklmnop'); } }) };
  const r = await runWithAdapter(broken, cases.slice(0, 2), b);
  assert.ok(r.every((x) => x.status === 'error'));
  assert.ok(!r[0]!.error!.includes('sk-abcdefghijklmnop'), 'secrets are redacted');
});

test('retry recovers from transient errors and respects non-retryable ones', async () => {
  let n = 0;
  const v = await withRetry(async () => { if (++n < 3) throw new HttpError(503, 'busy'); return 'ok'; }, { retries: 3, baseMs: 1, maxMs: 2 });
  assert.equal(v, 'ok');
  let m = 0;
  await assert.rejects(withRetry(async () => { m++; throw new HttpError(400, 'bad'); }, { retries: 3, baseMs: 1, maxMs: 2 }));
  assert.equal(m, 1);
});

test('circuit breaker opens and failover moves to the next endpoint', async () => {
  const cb = new CircuitBreaker(2, 60_000);
  for (let i = 0; i < 2; i++) await assert.rejects(cb.exec(async () => { throw new HttpError(503, 'down'); }));
  assert.equal(cb.state, 'open');
  const fo = new Failover(['a', 'b']);
  const used = await fo.exec(async (e) => { if (e === 'a') throw new HttpError(502, 'a down'); return e; });
  assert.equal(used, 'b');
});

test('limiter caps concurrency', async () => {
  const l = new Limiter(2);
  let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 6 }, () => l.run(async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; })));
  assert.equal(peak, 2);
});

test('compareRuns classifies fixed and regressed', () => {
  const mk = (s: 'pass' | 'fail'): RunResult => ({ meta: { runId: 'x', label: 'x', adapter: 'mock', businessId: 'b', businessIsDemo: true, testsetHash: 'h', startedAt: '', toolVersion: '1' },
    cases: [{ id: 'a', category: 'off_topic', title: '', status: s, turns: [], findings: [] }] });
  assert.deepEqual(compareRuns(mk('fail'), mk('pass')).fixed, ['a']);
  assert.deepEqual(compareRuns(mk('pass'), mk('fail')).regressed, ['a']);
});

test('test set hash is stable', () => {
  assert.equal(sha256(stableStringify(cases)), sha256(stableStringify(JSON.parse(JSON.stringify(cases)))));
});
