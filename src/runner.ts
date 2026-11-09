/**
 * Runs the suite against an adapter (or grades recorded transcripts), with checkpoint/resume.
 * Infrastructure errors become status "error" — never "pass" and never "fail" — so an outage cannot be
 * mistaken for an agent regression or improvement.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import { existsSync } from 'node:fs';
import type { AgentAdapter } from './adapters/types.js';
import type { BusinessFacts, CaseResult, TestCase, Transcript, Turn } from './types.js';
import { gradeCase, statusFrom } from './checks/rules.js';
import { judgeAvailable, judgeCase } from './judge.js';
import { Limiter } from './resilience.js';
import { normalize, readJson, redactSecrets, sanitizeReply, writeJson } from './util.js';

export interface RunOptions {
  concurrency?: number;
  rpm?: number;
  checkpointPath?: string;
  /** Identifies what produced the checkpoint; a mismatch (different tests/adapter/model) discards it. */
  checkpointKey?: string;
  fresh?: boolean;
  judge?: boolean;
  judgeStrict?: boolean;
  onProgress?: (done: number, total: number, r: CaseResult) => void;
}

export async function finalize(tc: TestCase, turns: Turn[], b: BusinessFacts, o: RunOptions): Promise<CaseResult> {
  const findings = gradeCase(tc, turns, b);
  if (o.judge && judgeAvailable()) findings.push(...(await judgeCase(b, tc, turns, !!o.judgeStrict)));
  return { id: tc.id, category: tc.category, title: tc.title, status: statusFrom(findings), turns, findings };
}

export async function runWithAdapter(adapter: AgentAdapter, cases: TestCase[], b: BusinessFacts, o: RunOptions = {}): Promise<CaseResult[]> {
  const done = new Map<string, CaseResult>();
  if (o.checkpointPath && !o.fresh && existsSync(o.checkpointPath)) {
    const cp = readJson<{ key?: string; results?: CaseResult[] }>(o.checkpointPath);
    if (cp.key === (o.checkpointKey ?? '') && Array.isArray(cp.results)) {
      for (const r of cp.results) if (r.status !== 'error') done.set(r.id, r);
      if (done.size) console.log(`Resuming: ${done.size} case(s) already completed (use --fresh to start over).`);
    }
  }
  const limiter = new Limiter(Math.max(1, o.concurrency ?? 2), o.rpm ?? 0);
  let count = done.size;
  const save = () => o.checkpointPath && writeJson(o.checkpointPath, { key: o.checkpointKey ?? '', results: [...done.values()] });

  await Promise.all(
    cases.map((tc) =>
      done.has(tc.id)
        ? Promise.resolve()
        : limiter.run(async () => {
            const turns: Turn[] = [];
            let result: CaseResult;
            try {
              const session = await adapter.startSession(tc.id);
              for (const user of tc.turns) {
                const r = await session.send(user);
                turns.push({ user, agent: sanitizeReply(r.text), latencyMs: r.latencyMs, inputTokens: r.inputTokens, outputTokens: r.outputTokens });
              }
              result = await finalize(tc, turns, b, o);
            } catch (e) {
              result = { id: tc.id, category: tc.category, title: tc.title, status: 'error', error: redactSecrets(String((e as Error).message ?? e)).slice(0, 500), turns, findings: [] };
            }
            done.set(tc.id, result);
            save();
            o.onProgress?.(++count, cases.length, result);
          }),
    ),
  );
  return cases.map((c) => done.get(c.id)!).filter(Boolean);
}

export async function gradeTranscript(t: Transcript, cases: TestCase[], b: BusinessFacts, o: RunOptions = {}): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  for (const tc of cases) {
    const rec = t.cases[tc.id];
    const base = { id: tc.id, category: tc.category, title: tc.title, findings: [] };
    if (!rec || rec.turns.length === 0) {
      out.push({ ...base, status: 'error', error: 'Not recorded yet.', turns: [] });
      continue;
    }
    if (rec.turns.length !== tc.turns.length) {
      out.push({ ...base, status: 'error', error: `Expected ${tc.turns.length} turns, transcript has ${rec.turns.length}.`, turns: rec.turns });
      continue;
    }
    const mismatch = rec.turns.findIndex((turn, i) => normalize(turn.user) !== normalize(tc.turns[i]!));
    if (mismatch >= 0) {
      out.push({ ...base, status: 'error', error: `Turn ${mismatch + 1}: recorded customer message differs from the test set — results would not be comparable.`, turns: rec.turns });
      continue;
    }
    if (rec.turns.some((x) => !x.agent.trim())) {
      out.push({ ...base, status: 'error', error: 'One or more agent replies are empty — finish recording this case.', turns: rec.turns });
      continue;
    }
    const turns = rec.turns.map((x) => ({ ...x, agent: sanitizeReply(x.agent) }));
    const r = await finalize(tc, turns, b, o);
    out.push(r);
    o.onProgress?.(out.length, cases.length, r);
  }
  return out;
}
