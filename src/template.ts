/**
 * {{placeholder}} rendering against business facts, so one test set works for any business.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import type { BusinessFacts, TestCase } from './types.js';
import { UserError } from './util.js';

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function lookup(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(part);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[part];
    } else return undefined;
  }
  return cur;
}

export function templateContext(b: BusinessFacts): Record<string, unknown> {
  // Paid services first, so {{priced.0}} is a real paid item (a free item would make weak price tests).
  const pricedAll = b.services.filter((s) => typeof s.price === 'number');
  const priced = [...pricedAll.filter((s) => (s.price as number) > 0), ...pricedAll.filter((s) => s.price === 0)];
  const unpriced = b.services.filter((s) => s.price === null);
  const marked = b.services.filter((s) => s.bookable);
  const bookable = marked.length >= 2 ? marked : [...marked, ...priced.filter((s) => !marked.includes(s))];
  const cheapest = [...priced].sort((a, z) => (a.price as number) - (z.price as number))[0];
  return {
    business: b,
    services: b.services,
    priced,
    unpriced,
    notOffered: b.notOffered,
    handoff: b.handoff,
    canary: b.canary,
    cheapest,
    bookable,
    factCheckpoints: b.factCheckpoints ?? {},
  };
}

export function render(text: string, ctx: Record<string, unknown>, where: string): string {
  return text.replace(PLACEHOLDER, (_m, path: string) => {
    const v = lookup(ctx, path);
    if (v === undefined || v === null || typeof v === 'object') {
      throw new UserError(`${where}: placeholder {{${path}}} has no value in business facts.`);
    }
    return String(v);
  });
}

export function renderCase(c: TestCase, ctx: Record<string, unknown>): TestCase {
  const r = (s: string, field: string) => render(s, ctx, `case ${c.id} ${field}`);
  const arr = (a: string[] | undefined, field: string) => a?.map((s) => r(s, field));
  const e = c.expect;
  return {
    ...c,
    title: r(c.title, 'title'),
    turns: c.turns.map((t, i) => r(t, `turn ${i + 1}`)),
    expect: {
      ...e,
      mustInclude: arr(e.mustInclude, 'mustInclude'),
      mustIncludeAny: arr(e.mustIncludeAny, 'mustIncludeAny'),
      mustNotInclude: arr(e.mustNotInclude, 'mustNotInclude'),
      recall: arr(e.recall, 'recall'),
      denyBait: e.denyBait ? r(e.denyBait, 'denyBait') : undefined,
      quotesPriceOf: e.quotesPriceOf ? r(e.quotesPriceOf, 'quotesPriceOf') : undefined,
    },
  };
}
