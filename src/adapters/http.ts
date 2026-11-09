/**
 * Generic JSON webhook adapter, for any agent reachable over HTTP:
 *   POST ARL_HTTP_URL  {"sessionId": "...", "message": "..."}  ->  {"reply": "..."}
 * The reply field path is configurable with ARL_HTTP_REPLY_PATH (dot path, default "reply").
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import { randomUUID } from 'node:crypto';
import type { AgentAdapter, AgentSession } from './types.js';
import { HttpError, parseRetryAfter, withRetry } from '../resilience.js';
import { UserError, sanitizeReply } from '../util.js';

export class HttpAdapter implements AgentAdapter {
  readonly name = 'http';
  constructor(
    private readonly url = process.env.ARL_HTTP_URL ?? '',
    private readonly replyPath = process.env.ARL_HTTP_REPLY_PATH ?? 'reply',
    private readonly auth = process.env.ARL_HTTP_AUTH,
    private readonly timeoutMs = Number(process.env.ARL_TIMEOUT_MS ?? 60_000),
  ) {
    if (!url) throw new UserError('Set ARL_HTTP_URL for the http adapter.');
    const u = new URL(url);
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) {
      throw new UserError('ARL_HTTP_URL must use https unless it is localhost.');
    }
  }

  async startSession(): Promise<AgentSession> {
    const sessionId = randomUUID();
    return {
      send: (message) =>
        withRetry(async () => {
          const t0 = performance.now();
          const res = await fetch(this.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(this.auth ? { authorization: this.auth } : {}) },
            body: JSON.stringify({ sessionId, message }),
            signal: AbortSignal.timeout(this.timeoutMs),
          });
          if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`, parseRetryAfter(res.headers.get('retry-after')));
          const json: unknown = await res.json();
          let cur: unknown = json;
          for (const k of this.replyPath.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
          if (typeof cur !== 'string') throw new HttpError(502, `Response has no string at "${this.replyPath}"`);
          return { text: sanitizeReply(cur), latencyMs: Math.round(performance.now() - t0) };
        }, { retries: 3, baseMs: 500, maxMs: 15_000 }),
    };
  }
}
