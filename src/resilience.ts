/**
 * Failure handling for every network call: timeouts, retries with exponential backoff + jitter (honouring
 * Retry-After), per-endpoint circuit breakers, multi-endpoint failover, concurrency and rate limits.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import { sleep } from './util.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfterMs?: number) {
    super(message);
    this.name = 'HttpError';
  }
}

export class CircuitOpenError extends Error {
  override name = 'CircuitOpenError';
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return RETRYABLE_STATUS.has(err.status);
  if (err instanceof CircuitOpenError) return false;
  const e = err as { name?: string; code?: string };
  return e?.name === 'TimeoutError' || e?.name === 'AbortError' || e?.name === 'TypeError' /* fetch network failure */ ||
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(e?.code ?? '');
}

export function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000);
  const at = Date.parse(h);
  return Number.isNaN(at) ? undefined : Math.min(Math.max(0, at - Date.now()), 60_000);
}

export interface RetryOptions {
  retries: number;
  baseMs: number;
  maxMs: number;
  onRetry?: (attempt: number, err: unknown, waitMs: number) => void;
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === o.retries || !isRetryable(err)) throw err;
      const backoff = Math.min(o.maxMs, o.baseMs * 2 ** attempt);
      const jittered = Math.round(Math.random() * backoff); // full jitter
      const wait = err instanceof HttpError && err.retryAfterMs !== undefined ? Math.max(err.retryAfterMs, jittered) : jittered;
      o.onRetry?.(attempt + 1, err, wait);
      await sleep(wait);
    }
  }
  throw lastErr;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  constructor(private readonly threshold = 5, private readonly cooldownMs = 30_000) {}

  get state(): 'closed' | 'open' | 'half-open' {
    if (this.failures < this.threshold) return 'closed';
    return Date.now() - this.openedAt >= this.cooldownMs ? 'half-open' : 'open';
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') throw new CircuitOpenError('Circuit open: endpoint is failing, cooling down.');
    try {
      const r = await fn();
      this.failures = 0;
      return r;
    } catch (e) {
      // Only infrastructure failures trip the breaker; a 400 is our bug, not the endpoint's health.
      if (isRetryable(e)) {
        this.failures++;
        if (this.failures >= this.threshold) this.openedAt = Date.now();
      }
      throw e;
    }
  }
}

/** Tries endpoints in order; each has its own breaker, so one dead provider never stalls the run. */
export class Failover<E> {
  private breakers: CircuitBreaker[];
  constructor(private readonly endpoints: E[], threshold = 5, cooldownMs = 30_000) {
    if (!endpoints.length) throw new Error('Failover needs at least one endpoint');
    this.breakers = endpoints.map(() => new CircuitBreaker(threshold, cooldownMs));
  }
  async exec<T>(fn: (endpoint: E) => Promise<T>): Promise<T> {
    let last: unknown;
    for (let i = 0; i < this.endpoints.length; i++) {
      try {
        return await this.breakers[i]!.exec(() => fn(this.endpoints[i]!));
      } catch (e) {
        last = e;
        if (!(e instanceof CircuitOpenError) && !isRetryable(e)) throw e; // a non-retryable error would fail everywhere
      }
    }
    throw last;
  }
}

/** Simple semaphore + minimum interval between starts (requests-per-minute cap). */
export class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  private nextStart = 0;
  constructor(private readonly concurrency: number, private readonly rpm = 0) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      if (this.rpm > 0) {
        const gap = 60_000 / this.rpm;
        const now = Date.now();
        const startAt = Math.max(now, this.nextStart);
        this.nextStart = startAt + gap;
        if (startAt > now) await sleep(startAt - now);
      }
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
