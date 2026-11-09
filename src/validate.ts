/**
 * Hand-written schema validation (no runtime dependencies). Every input is untrusted until it passes here.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import { CATEGORIES, type BusinessFacts, type TestSet, type Transcript, type ChangeEntry } from './types.js';
import { UserError } from './util.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 5000): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => isStr(x));
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

class Collector {
  errors: string[] = [];
  need(cond: boolean, msg: string): boolean {
    if (!cond) this.errors.push(msg);
    return cond;
  }
  throwIfAny(what: string): void {
    if (this.errors.length) {
      throw new UserError(`${what} is invalid:\n  - ${this.errors.slice(0, 40).join('\n  - ')}`);
    }
  }
}

export function validateBusiness(v: unknown): BusinessFacts {
  const c = new Collector();
  if (!c.need(isObj(v), 'root must be an object')) c.throwIfAny('Business facts');
  const b = v as Obj;
  c.need(b.schemaVersion === 1, 'schemaVersion must be 1');
  c.need(isStr(b.id, 64) && ID_RE.test(b.id as string), 'id must be a short slug');
  c.need(isStr(b.name, 200), 'name is required');
  c.need(isStr(b.category, 200), 'category is required (e.g. "dental clinic")');
  c.need(isStr(b.currency, 8), 'currency is required (ISO code, e.g. INR, USD)');
  c.need(isStrArr(b.sourceUrls) && (b.sourceUrls as string[]).length > 0, 'sourceUrls: list the public pages every fact was copied from');
  if (isStrArr(b.sourceUrls)) for (const u of b.sourceUrls) c.need(/^https?:\/\//.test(u), `sourceUrls: "${u}" is not an http(s) URL`);
  c.need(isStr(b.verifiedOn, 30) && !Number.isNaN(Date.parse(b.verifiedOn as string)), 'verifiedOn must be an ISO date');
  c.need(Array.isArray(b.services) && (b.services as unknown[]).length >= 2, 'services: at least 2 services are required');
  const ids = new Set<string>();
  (Array.isArray(b.services) ? (b.services as unknown[]) : []).forEach((s, i) => {
    if (!c.need(isObj(s), `services[${i}] must be an object`)) return;
    const so = s as Obj;
    c.need(isStr(so.id, 64) && ID_RE.test(so.id as string), `services[${i}].id must be a slug`);
    if (isStr(so.id)) {
      c.need(!ids.has(so.id), `services[${i}].id "${so.id}" is duplicated`);
      ids.add(so.id);
    }
    c.need(isStr(so.name, 200), `services[${i}].name is required`);
    c.need(so.price === null || (typeof so.price === 'number' && Number.isFinite(so.price) && so.price >= 0),
      `services[${i}].price must be a non-negative number, or null if not published`);
    if (so.aliases !== undefined) c.need(isStrArr(so.aliases), `services[${i}].aliases must be strings`);
    if (so.bookable !== undefined) c.need(typeof so.bookable === 'boolean', `services[${i}].bookable must be true or false`);
  });
  const priced = (Array.isArray(b.services) ? (b.services as Obj[]) : []).filter((s) => typeof s?.price === 'number');
  const unpriced = (Array.isArray(b.services) ? (b.services as Obj[]) : []).filter((s) => s?.price === null);
  c.need(priced.filter((s) => (s.price as number) > 0).length >= 2, 'at least 2 services must have a published price above zero');
  c.need(unpriced.length >= 1, 'at least 1 service must have price: null (tests "unknown price" behaviour). If every price is published, add a real service whose price varies (e.g. "custom quote").');
  if (b.allowedAmounts !== undefined)
    c.need(Array.isArray(b.allowedAmounts) && (b.allowedAmounts as unknown[]).every((n) => typeof n === 'number'), 'allowedAmounts must be numbers');
  const h = b.handoff as Obj | undefined;
  if (c.need(isObj(h), 'handoff is required')) {
    c.need(isStrArr(h!.markers) && (h!.markers as string[]).length > 0, 'handoff.markers: phrases that mean "I am connecting you to a human"');
    c.need(isStr(h!.phone) || isStr(h!.email), 'handoff needs a phone or email customers can reach a human on');
  }
  if (b.factCheckpoints !== undefined) {
    c.need(isObj(b.factCheckpoints) && Object.values(b.factCheckpoints as Obj).every(isStrArr), 'factCheckpoints must map keys to string lists');
  }
  c.need(isStrArr(b.bookingFields) && (b.bookingFields as string[]).length >= 2, 'bookingFields: at least 2 (e.g. name, phone, date)');
  c.need(isStrArr(b.notOffered) && (b.notOffered as string[]).length >= 2, 'notOffered: at least 2 things the business does NOT offer');
  c.need(isStr(b.canary, 100) && /^[A-Z0-9-]{8,}$/.test(b.canary as string), 'canary: 8+ chars of A-Z, 0-9 or "-" (run `arl canary` to generate one)');
  c.throwIfAny('Business facts');
  return v as BusinessFacts;
}

const EXPECT_KEYS = new Set([
  'mustInclude', 'mustIncludeAny', 'mustNotInclude', 'mustMatch', 'mustNotMatch', 'noPriceMentioned',
  'quotesPriceOf', 'denyBait', 'handoff', 'askFor', 'recall', 'noConfirmBooking', 'staysOnTask', 'maxChars',
]);

export function validateTestSet(v: unknown): TestSet {
  const c = new Collector();
  if (!c.need(isObj(v), 'root must be an object')) c.throwIfAny('Test set');
  const t = v as Obj;
  c.need(t.schemaVersion === 1, 'schemaVersion must be 1');
  c.need(isStr(t.name), 'name is required');
  const cases = Array.isArray(t.cases) ? (t.cases as unknown[]) : [];
  c.need(t.purpose === undefined || t.purpose === 'core' || t.purpose === 'stress', 'purpose must be "core" or "stress"');
  const min = t.purpose === 'stress' ? 10 : 20;
  c.need(cases.length >= min, t.purpose === 'stress' ? `a stress set needs at least 10 cases (found ${cases.length})` : `the AgentPlace task requires at least 20 test conversations (found ${cases.length})`);
  const seen = new Set<string>();
  cases.forEach((raw, i) => {
    if (!c.need(isObj(raw), `cases[${i}] must be an object`)) return;
    const k = raw as Obj;
    const where = `cases[${i}]${isStr(k.id) ? ` (${k.id})` : ''}`;
    if (c.need(isStr(k.id, 64) && ID_RE.test(k.id as string), `${where}.id must be a slug`)) {
      c.need(!seen.has(k.id as string), `${where}.id is duplicated`);
      seen.add(k.id as string);
    }
    c.need((CATEGORIES as readonly string[]).includes(k.category as string), `${where}.category must be one of ${CATEGORIES.join(', ')}`);
    c.need(isStr(k.title), `${where}.title is required`);
    c.need(['easy', 'medium', 'hard'].includes(k.difficulty as string), `${where}.difficulty must be easy|medium|hard`);
    c.need(isStrArr(k.turns) && (k.turns as string[]).length >= 1 && (k.turns as string[]).length <= 12, `${where}.turns must be 1–12 user messages`);
    c.need(isStr(k.rationale), `${where}.rationale: say why this case matters`);
    if (c.need(isObj(k.expect), `${where}.expect is required`)) {
      const e = k.expect as Obj;
      const keys = Object.keys(e);
      c.need(keys.length > 0, `${where}.expect must contain at least one expectation`);
      for (const key of keys) c.need(EXPECT_KEYS.has(key), `${where}.expect.${key} is not a known expectation`);
      for (const key of ['mustMatch', 'mustNotMatch'] as const) {
        if (e[key] === undefined) continue;
        if (c.need(isStrArr(e[key]), `${where}.expect.${key} must be strings`))
          for (const re of e[key] as string[]) {
            try {
              new RegExp(re, 'iu');
            } catch {
              c.need(false, `${where}.expect.${key}: invalid regex ${re}`);
            }
            c.need(re.length <= 300, `${where}.expect.${key}: regex too long`);
          }
      }
    }
  });
  c.throwIfAny('Test set');
  return v as TestSet;
}

export function validateTranscript(v: unknown): Transcript {
  const c = new Collector();
  if (!c.need(isObj(v), 'root must be an object')) c.throwIfAny('Transcript');
  const t = v as Obj;
  c.need(t.schemaVersion === 1, 'schemaVersion must be 1');
  c.need(isStr(t.testsetHash, 128), 'testsetHash is required');
  c.need(isObj(t.cases), 'cases must be an object keyed by test id');
  if (isObj(t.cases)) {
    for (const [id, val] of Object.entries(t.cases)) {
      if (!c.need(isObj(val) && Array.isArray((val as Obj).turns), `cases.${id}.turns must be an array`)) continue;
      ((val as Obj).turns as unknown[]).forEach((turn, i) => {
        c.need(isObj(turn) && typeof (turn as Obj).user === 'string' && typeof (turn as Obj).agent === 'string',
          `cases.${id}.turns[${i}] needs "user" and "agent" strings`);
      });
    }
  }
  c.throwIfAny('Transcript');
  return v as Transcript;
}

export function validateChanges(v: unknown): ChangeEntry[] {
  const c = new Collector();
  if (!c.need(Array.isArray(v), 'changes must be an array')) c.throwIfAny('Change log');
  (v as unknown[]).forEach((raw, i) => {
    const e = raw as Obj;
    if (!c.need(isObj(raw), `[${i}] must be an object`)) return;
    c.need(isStr(e.id, 64), `[${i}].id is required`);
    c.need(['instructions', 'knowledge', 'workflow'].includes(e.kind as string), `[${i}].kind must be instructions|knowledge|workflow`);
    c.need(isStr(e.description), `[${i}].description is required`);
    c.need(Array.isArray(e.targets) && (e.targets as unknown[]).every((x) => (CATEGORIES as readonly string[]).includes(x as string)),
      `[${i}].targets must be test categories`);
  });
  c.throwIfAny('Change log');
  return v as ChangeEntry[];
}
