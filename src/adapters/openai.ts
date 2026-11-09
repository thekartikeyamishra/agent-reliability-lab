/**
 * Any OpenAI-compatible Chat Completions endpoint: Ollama / LM Studio / vLLM (local, free, offline), or any
 * hosted provider exposing the same API. Several base URLs can be given for automatic failover.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import type { AgentAdapter, AgentReply, AgentSession } from './types.js';
import { Failover, HttpError, parseRetryAfter, withRetry } from '../resilience.js';
import { UserError, sanitizeReply } from '../util.js';

export interface OpenAIConfig {
  baseUrls: string[];
  apiKey?: string;
  model: string;
  systemPrompt: string;
  temperature?: number;
  timeoutMs?: number;
  retries?: number;
  maxTokens?: number;
}

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

export function openAIConfigFromEnv(systemPrompt: string, overrides: Partial<OpenAIConfig> = {}): OpenAIConfig {
  const baseUrls = (overrides.baseUrls ?? (process.env.ARL_BASE_URLS ?? 'http://localhost:11434/v1').split(','))
    .map((u) => u.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  for (const u of baseUrls) {
    let url: URL;
    try {
      url = new URL(u);
    } catch {
      throw new UserError(`ARL_BASE_URLS contains an invalid URL: ${u}`);
    }
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !local) throw new UserError(`Refusing to send data over plain HTTP to a remote host: ${u}`);
  }
  const model = overrides.model ?? process.env.ARL_MODEL;
  if (!model) throw new UserError('Set ARL_MODEL (e.g. "llama3.1:8b" for Ollama) or pass --model.');
  return {
    baseUrls,
    apiKey: overrides.apiKey ?? process.env.ARL_API_KEY,
    model,
    systemPrompt,
    temperature: overrides.temperature ?? Number(process.env.ARL_TEMPERATURE ?? 0.2),
    timeoutMs: overrides.timeoutMs ?? Number(process.env.ARL_TIMEOUT_MS ?? 60_000),
    retries: overrides.retries ?? Number(process.env.ARL_RETRIES ?? 3),
    maxTokens: overrides.maxTokens ?? 600,
  };
}

export class OpenAICompatibleAdapter implements AgentAdapter {
  readonly name = 'openai-compatible';
  readonly model: string;
  private failover: Failover<string>;

  constructor(private readonly cfg: OpenAIConfig) {
    this.model = cfg.model;
    this.failover = new Failover(cfg.baseUrls);
  }

  async startSession(): Promise<AgentSession> {
    const history: Msg[] = [{ role: 'system', content: this.cfg.systemPrompt }];
    return {
      send: async (message: string): Promise<AgentReply> => {
        history.push({ role: 'user', content: message });
        const reply = await this.complete(history);
        history.push({ role: 'assistant', content: reply.text });
        return reply;
      },
    };
  }

  private async complete(messages: Msg[]): Promise<AgentReply> {
    return withRetry(
      () =>
        this.failover.exec(async (base) => {
          const started = performance.now();
          const res = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
            },
            body: JSON.stringify({
              model: this.cfg.model,
              messages,
              temperature: this.cfg.temperature,
              max_tokens: this.cfg.maxTokens,
            }),
            signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 60_000),
          });
          if (!res.ok) {
            const body = (await res.text().catch(() => '')).slice(0, 300);
            throw new HttpError(res.status, `HTTP ${res.status} from ${new URL(base).host}: ${body}`, parseRetryAfter(res.headers.get('retry-after')));
          }
          const json = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const text = json.choices?.[0]?.message?.content;
          if (typeof text !== 'string') throw new HttpError(502, 'Malformed completion: no choices[0].message.content');
          return {
            text: sanitizeReply(text),
            latencyMs: Math.round(performance.now() - started),
            inputTokens: json.usage?.prompt_tokens,
            outputTokens: json.usage?.completion_tokens,
          };
        }),
      { retries: this.cfg.retries ?? 3, baseMs: 500, maxMs: 15_000 },
    );
  }
}
