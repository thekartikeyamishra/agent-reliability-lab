/**
 * Core domain types for Agent Reliability Lab.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */

export type Severity = 'critical' | 'major' | 'minor';
export type CaseStatus = 'pass' | 'fail' | 'error';

export const CATEGORIES = [
  'pricing_known',
  'pricing_unknown',
  'invented_service',
  'business_info',
  'recommendation',
  'booking_complete',
  'booking_missing_details',
  'booking_detail_retention',
  'off_topic',
  'prompt_injection',
  'policy_pressure',
  'handoff',
  'safety_privacy',
  'language',
  'robustness',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Service {
  id: string;
  name: string;
  aliases?: string[];
  /** Exact price in the business currency. null = price not published (agent must NOT quote one). */
  price: number | null;
  /** Human text exactly as published, e.g. "₹1,200" or "from $49". */
  priceText?: string;
  durationMin?: number;
  description?: string;
  /** Can be booked as an appointment/call. If fewer than 2 services are marked, paid services are used. */
  bookable?: boolean;
}

export interface BusinessFacts {
  schemaVersion: 1;
  id: string;
  name: string;
  /** true only for the bundled fictional example. Never submit a demo business. */
  isDemo?: boolean;
  category: string;
  website?: string;
  /** Public pages the facts were copied from (provenance for every fact). */
  sourceUrls: string[];
  /** ISO date the facts were last checked against sourceUrls. */
  verifiedOn: string;
  currency: string;
  services: Service[];
  /** Extra amounts that may legitimately be quoted (deposits, fees) — must also be published. */
  allowedAmounts?: number[];
  hours?: string;
  address?: string;
  /** Short exact strings a correct answer must contain, e.g. { "hours": ["10 am"], "address": ["Hazratganj"] }. */
  factCheckpoints?: Record<string, string[]>;
  policies?: Record<string, string>;
  handoff: {
    phone?: string;
    email?: string;
    /** Phrases that count as a hand-off to a human (lower-case). */
    markers: string[];
  };
  bookingFields: string[];
  /** Services/products this business does NOT offer — used as hallucination bait. */
  notOffered: string[];
  /** Random secret embedded in the agent instructions. If it ever appears in a reply, the instructions leaked. */
  canary: string;
}

export interface Expectations {
  mustInclude?: string[];
  mustIncludeAny?: string[];
  mustNotInclude?: string[];
  mustMatch?: string[];
  mustNotMatch?: string[];
  /** The final reply must not quote any amount at all. */
  noPriceMentioned?: boolean;
  /** Final reply must quote this service's catalogue price. Value is a service index or id. */
  quotesPriceOf?: string;
  /** A term the agent must not affirm (e.g. a service the business does not offer). */
  denyBait?: string;
  /** Final reply must hand off to a human / give the contact route. */
  handoff?: boolean;
  /** Final reply must ask for at least one of these booking fields. */
  askFor?: string[];
  /** Values the final reply must still contain (detail retention across turns). */
  recall?: string[];
  /** Agent must not claim a booking is confirmed (it cannot verify availability). */
  noConfirmBooking?: boolean;
  /** Final reply must steer back to the business (mentions its name or a service). */
  staysOnTask?: boolean;
  maxChars?: number;
}

export interface TestCase {
  id: string;
  category: Category;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  /** User turns. May contain {{placeholders}} resolved against BusinessFacts. */
  turns: string[];
  expect: Expectations;
  rationale: string;
}

export interface TestSet {
  schemaVersion: 1;
  name: string;
  /** "core" = the before/after suite (≥ 20 cases). "stress" = extra adversarial cases (≥ 10). */
  purpose?: 'core' | 'stress';
  cases: TestCase[];
}

export interface Turn {
  user: string;
  agent: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface Finding {
  check: string;
  severity: Severity;
  passed: boolean;
  message: string;
  turnIndex?: number;
  evidence?: string;
  source: 'rule' | 'judge' | 'review';
}

export interface CaseResult {
  id: string;
  category: Category;
  title: string;
  status: CaseStatus;
  error?: string;
  turns: Turn[];
  findings: Finding[];
  review?: ReviewOverride;
}

export interface RunMeta {
  runId: string;
  label: string;
  adapter: string;
  model?: string;
  agentUrl?: string;
  businessId: string;
  businessIsDemo: boolean;
  testsetHash: string;
  startedAt: string;
  finishedAt?: string;
  toolVersion: string;
}

export interface RunResult {
  meta: RunMeta;
  cases: CaseResult[];
}

export interface ReviewOverride {
  status: 'pass' | 'fail';
  reason: string;
  reviewer: string;
}

export interface Transcript {
  schemaVersion: 1;
  runId: string;
  agentUrl?: string;
  agentVersion?: string;
  testsetHash: string;
  recordedAt: string;
  cases: Record<string, { turns: Turn[] }>;
}

export interface ChangeEntry {
  id: string;
  kind: 'instructions' | 'knowledge' | 'workflow';
  description: string;
  targets: Category[];
}
