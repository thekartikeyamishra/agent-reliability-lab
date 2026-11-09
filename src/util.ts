/**
 * Small, dependency-free utilities: safe file IO, hashing, text helpers, statistics.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';

export const TOOL_VERSION = '1.0.0';
const MAX_INPUT_BYTES = 10 * 1024 * 1024; // 10 MB hard cap on any input file

export class UserError extends Error {
  override name = 'UserError';
}

/** Read and parse JSON with a size cap and a readable error. */
export function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new UserError(`File not found: ${path}`);
  const size = statSync(path).size;
  if (size > MAX_INPUT_BYTES) throw new UserError(`File too large (${size} bytes): ${path}`);
  const raw = readFileSync(path, 'utf8').replace(/^﻿/, ''); // strip BOM (Windows editors)
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new UserError(`Invalid JSON in ${path}: ${(e as Error).message}`);
  }
}

export function readText(path: string): string {
  if (!existsSync(path)) throw new UserError(`File not found: ${path}`);
  if (statSync(path).size > MAX_INPUT_BYTES) throw new UserError(`File too large: ${path}`);
  return readFileSync(path, 'utf8').replace(/^﻿/, '');
}

/** Atomic write: write to a temp file then rename, so a crash never leaves a half-written file. */
export function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, path);
}

export function writeJson(path: string, data: unknown): void {
  writeFileAtomic(path, JSON.stringify(data, null, 2) + '\n');
}

const RUN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** Validate a run id and return its directory, guaranteed to stay inside the runs root. */
export function runDir(root: string, runId: string): string {
  if (!RUN_ID_RE.test(runId) || runId.includes('..')) {
    throw new UserError(`Invalid run id "${runId}". Use letters, digits, ".", "_" or "-" (max 64).`);
  }
  const base = resolve(root);
  const dir = resolve(base, runId);
  const rel = relative(base, dir);
  if (rel.startsWith('..') || isAbsolute(rel) || rel.includes(`..${sep}`)) {
    throw new UserError('Run directory escapes the runs root.');
  }
  return dir;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function includesCI(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

/** Remove control characters (except newline/tab) and cap length. Used on everything recorded from an agent. */
export function sanitizeReply(text: string, max = 20_000): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n');
  return cleaned.length > max ? cleaned.slice(0, max) + ' …[truncated]' : cleaned;
}

/** Escape text so agent output can never inject HTML/Markdown structure into reports. */
export function mdEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`');
}

export function snippet(text: string, around: number, width = 60): string {
  const start = Math.max(0, around - width);
  const end = Math.min(text.length, around + width);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
}

/** Wilson score interval (95%) — honest uncertainty on small test sets. */
export function wilson(passes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const p = passes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (centre - margin) / denom), high: Math.min(1, (centre + margin) / denom) };
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      rej(new Error('aborted'));
    }, { once: true });
  });
}

/** Redact anything that looks like a secret before it is logged or written to a report. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|rk|key|api)[-_][A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/g, 'Bearer [REDACTED]');
}
