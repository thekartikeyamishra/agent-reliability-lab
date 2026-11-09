/**
 * Money extraction. Only currency-anchored amounts are extracted, so phone numbers, times and dates never
 * count as prices. Handles ₹/Rs/INR/$/€/£, Indian digit grouping (1,20,000), "k" and "lakh".
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
export interface Money {
  amount: number;
  index: number;
  raw: string;
}

const NUM = String.raw`(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const MULT = String.raw`(?:\s?(k|lakh|lakhs|lac|lacs|crore|cr)(?![a-z]))?`;
const PREFIX = String.raw`(?:₹|(?<![a-z])rs\.?|(?<![a-z])inr|us\$|\$|(?<![a-z])usd|€|(?<![a-z])eur|£|(?<![a-z])gbp)`;
const SUFFIX = String.raw`(?:\s?(?:rupees?|rs\.?(?![a-z])|inr(?![a-z])|dollars?|usd(?![a-z])|euros?|eur(?![a-z])|pounds?(?! of)|gbp(?![a-z])|\/-))`;

const PREFIX_RE = new RegExp(`${PREFIX}\\s?${NUM}${MULT}`, 'giu');
const SUFFIX_RE = new RegExp(`${NUM}${MULT}${SUFFIX}`, 'giu');
/** "1.5 lakh" / "2 crore" are money in Indian usage even with no currency word. */
const INDIAN_RE = new RegExp(String.raw`${NUM}\s?(lakh|lakhs|lac|lacs|crore|cr)(?![a-z])`, 'giu');

function toNumber(num: string, mult: string | undefined): number {
  const base = Number(num.replace(/,/g, ''));
  switch ((mult ?? '').toLowerCase()) {
    case 'k':
      return base * 1_000;
    case 'lakh':
    case 'lakhs':
    case 'lac':
    case 'lacs':
      return base * 100_000;
    case 'crore':
    case 'cr':
      return base * 10_000_000;
    default:
      return base;
  }
}

export function extractMoney(text: string): Money[] {
  const out: Money[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  for (const re of [PREFIX_RE, SUFFIX_RE, INDIAN_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      const amount = toNumber(m[1] ?? '', m[2]);
      if (!Number.isFinite(amount)) continue;
      taken.push([start, end]);
      out.push({ amount, index: start, raw: m[0].trim() });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

export function isAllowed(amount: number, allowed: number[]): boolean {
  return allowed.some((a) => Math.abs(a - amount) < 0.01);
}

/** Luhn-valid 13–19 digit sequences (payment card numbers). */
export function findCardNumbers(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(/(?:\d[ -]?){12,18}\d/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = Number(digits[i]);
      if (dbl) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      dbl = !dbl;
    }
    if (sum % 10 === 0) hits.push(digits);
  }
  return hits;
}
