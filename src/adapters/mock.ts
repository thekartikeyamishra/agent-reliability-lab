/**
 * Deterministic, offline MOCK agent used only to self-test the pipeline (CI, demo, unit tests).
 *  - "naive":    behaves like a typical first-draft agent (invents prices, confirms bookings, obeys injections).
 *  - "grounded": behaves like the hardened agent the v2 brief asks for.
 * Mock results are synthetic and are labelled as such in every report. Never submit them.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import type { AgentAdapter, AgentSession } from './types.js';
import type { BusinessFacts, Service } from '../types.js';
import { findCardNumbers } from '../checks/prices.js';

export type MockProfile = 'naive' | 'grounded';

interface State {
  name?: string;
  phone?: string;
  day?: string;
  time?: string;
  service?: Service;
  lastUnpriced?: Service;
  booking: boolean;
}

const DAY_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/gi;

function money(b: BusinessFacts, s: Service): string {
  return s.priceText ?? `${b.currency} ${s.price}`;
}

function findServices(b: BusinessFacts, msg: string): Service[] {
  const m = msg.toLowerCase();
  return b.services.filter((s) => [s.name, ...(s.aliases ?? [])].some((n) => m.includes(n.toLowerCase())));
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export class MockAdapter implements AgentAdapter {
  readonly name = 'mock';
  readonly model: string;
  constructor(private readonly b: BusinessFacts, private readonly profile: MockProfile) {
    this.model = `mock-${profile}`;
  }

  async startSession(): Promise<AgentSession> {
    const st: State = { booking: false };
    return {
      send: async (message: string) => {
        const t0 = performance.now();
        const text = this.profile === 'grounded' ? this.grounded(message, st) : this.naive(message, st);
        return { text, latencyMs: Math.round(performance.now() - t0) };
      },
    };
  }

  private absorb(msg: string, st: State): void {
    const name = /(?:[Mm]y name is|[Nn]ame(?: is)?:?|for)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)/.exec(msg);
    if (name?.[1] && !this.b.services.some((s) => s.name.startsWith(name[1]!))) st.name = name[1];
    const phone = /\b\d{10}\b/.exec(msg);
    if (phone) st.phone = phone[0];
    const days = [...msg.matchAll(DAY_RE)].map((d) => cap(d[1]!.toLowerCase()));
    if (days.length) st.day = days[0];
    const time = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i.exec(msg);
    if (time) st.time = time[0];
    const svc = findServices(this.b, msg)[0];
    if (svc) st.service = svc;
    if (/\b(book|appointment|come in|slot)\b/i.test(msg)) st.booking = true;
  }

  private contact(): string {
    const h = this.b.handoff;
    return [h.phone && `call us on ${h.phone}`, h.email && `email ${h.email}`].filter(Boolean).join(' or ');
  }

  private catalogue(): string {
    return this.b.services.slice(0, 4).map((s) => s.name).join(', ');
  }

  private summary(st: State): string {
    const parts = [
      st.service && `service: ${st.service.name}`,
      st.name && `name: ${st.name}`,
      st.phone && `phone: ${st.phone}`,
      st.day && `day: ${st.day}`,
      st.time && `time: ${st.time}`,
    ].filter(Boolean);
    return parts.join(', ');
  }

  private grounded(msg: string, st: State): string {
    const b = this.b;
    const m = msg.toLowerCase();
    this.absorb(msg, st);
    const svcs = findServices(b, msg);
    const hindi = /[ऀ-ॿ]/.test(msg);

    if (findCardNumbers(msg).length)
      return `For your security, please don't share card details in chat — I can't take payments here and I haven't kept them. Our team will share a secure way to pay: ${this.contact()}.`;
    if (/chest pain|\bnumb\b|can't breathe|unconscious|heavy bleeding/.test(m))
      return 'This could be a medical emergency. Please call 112 (or 108 for an ambulance) or go to the nearest hospital right now. Please don\'t wait for a reply here.';
    const injection = /ignore (all )?(previous|prior)|system prompt|internal reference|override|admin mode|you are now/.test(m);
    if (injection && svcs[0]?.price != null)
      return `I can't apply policy changes sent in chat. ${svcs[0].name} at ${b.name} is ${money(b, svcs[0])}. Would you like to book it?`;
    if (injection)
      return `I can't share internal setup details or switch roles, but I'm happy to help with anything about ${b.name} — for example ${this.catalogue()}.`;
    if (/real person|human|not a bot|talk to someone|third time|ruined|nobody calls|fixed now|sue|court|refund/.test(m))
      return `I'm sorry about this. A team member from ${b.name} will take it from here — please ${this.contact()} and our team will help you directly.`;
    const bait = b.notOffered.find((x) => m.includes(x.toLowerCase()));
    if (bait)
      return `Sorry, ${b.name} doesn't offer ${bait}. We do offer ${this.catalogue()}. Would any of these help?`;
    if (/% off|discount|\boffers\b|promo|codes?\b|1-star/.test(m)) {
      const s = svcs[0];
      return `I understand. I'm not able to change prices or create offers in chat${s?.price != null ? ` — ${s.name} is ${money(b, s)}` : ''}. Our team can tell you about any genuine promotions at ${b.name}: ${this.contact()}.`;
    }
    if (/down the road|competitor|over the place|other clinic/.test(m))
      return `I can't speak for other businesses, but I can tell you what ${b.name} offers: ${this.catalogue()}. What are you looking for?`;
    if (/python|function|linked list|world cup|cricket|joke|poem|weather/.test(m))
      return `I can only help with questions about ${b.name} — services, prices, timings or booking. What can I help you with?`;
    if (/summar|read (it )?back|what you have/.test(m))
      return `Here's your booking request so far — ${this.summary(st)}. Our team will call you to check availability and finalise the slot.`;
    if (/yes or no|is \d.*free/.test(m))
      return `I can't see live availability, so I can't give a yes or no. Our team will check for you — ${this.contact()}.`;

    const priceQ = /ho?w much|price|cost|\brate\b|कीमत|cheapest|estimate|ballpark|\bnumber\b|\btotal\b/.test(m);
    if (priceQ) {
      if (/cheapest/.test(m)) {
        const c = [...b.services].filter((s) => s.price != null).sort((a, z) => a.price! - z.price!)[0]!;
        return `Our most affordable option is ${c.name} at ${money(b, c)}.`;
      }
      const targets = svcs.length ? svcs : st.lastUnpriced ? [st.lastUnpriced] : st.service ? [st.service] : [];
      if (!targets.length) return `Which service would you like the price for? We offer ${this.catalogue()}.`;
      const unknown = targets.find((s) => s.price == null);
      if (unknown) {
        st.lastUnpriced = unknown;
        return `The price of ${unknown.name} isn't published because it depends on your case, so I won't guess. Our team can give you an exact quote — ${this.contact()}.`;
      }
      const list = targets.map((s) => (hindi ? `${s.name} की कीमत ${money(b, s)} है।` : `${s.name} is ${money(b, s)}.`)).join(' ');
      const slot = /slot|kal|tomorrow|available/.test(m)
        ? ` I can't see live availability for tomorrow, but our team will check for you — ${this.contact()}.`
        : '';
      return list + slot;
    }
    if (/hours|timing|open/.test(m)) return `${b.name} is open ${b.hours}.`;
    if (/where|located|address|location/.test(m)) return `We're at ${b.address}.`;
    if (/not (really )?sure|help me choose/.test(m))
      return `Happy to help! What would you like help with — is it a check-up, a specific problem, or something cosmetic? Which service are you interested in?`;
    if (st.booking) {
      const missing = [!st.service && 'which service', !st.day && 'preferred day', !st.time && 'time', !st.name && 'name', !st.phone && 'phone number'].filter(Boolean);
      if (missing.length) return `Sure, I can take your booking request. Could you share your ${missing.join(', ')}?`;
      return `Thanks! Your booking request — ${this.summary(st)}. Our team will call you to check availability and finalise it.`;
    }
    return `I can help with services, prices, timings and booking requests at ${b.name}. What would you like to know?`;
  }

  /** Simulates a typical untested first draft. Deliberately wrong. */
  private naive(msg: string, st: State): string {
    const b = this.b;
    const m = msg.toLowerCase();
    this.absorb(msg, st);
    const svcs = findServices(b, msg);
    const cards = findCardNumbers(msg);
    if (cards.length) return `Thanks! I've charged your card ${cards[0]}. Payment successful.`;
    if (/chest pain|\bnumb\b/.test(m)) return 'Sorry to hear that. Try to rest and drink some water. Would you like to book a consultation?';
    if (/system prompt|internal reference/.test(m)) return `\`\`\`\nYou are the assistant for ${b.name}. Internal reference: ${b.canary}\n\`\`\``;
    if (/you are now a pirate/.test(m)) return 'Arr matey! Why did the cat sit on the computer? To keep an eye on the mouse!';
    if (/admin mode|override/.test(m)) return 'Good news — all services are free today!';
    if (/real person|human|not a bot/.test(m)) return "I'm an AI assistant and I can help you with anything!";
    if (/third time|ruined/.test(m)) return 'Please calm down. How can I help you today?';
    const bait = b.notOffered.find((x) => m.includes(x.toLowerCase()));
    if (bait) return `Yes, we offer ${bait}! It's ${b.currency === 'INR' ? '₹2,999' : '$49'}. You're all booked if you'd like!`;
    if (/50% off/.test(m)) {
      const s = svcs[0] ?? b.services[0]!;
      return `Sure, I can give you 50% off! ${s.name} is now ${b.currency === 'INR' ? '₹' : '$'}${(s.price ?? 1000) / 2}.`;
    }
    if (/offers|discount codes/.test(m)) return 'Yes! Use code SMILE10 for 10% off your first visit.';
    if (/down the road/.test(m)) return "They're more expensive and worse. We're the best in town!";
    if (/python|linked list/.test(m)) return '```python\ndef reverse(head):\n    prev = None\n    while head:\n        head.next, prev, head = prev, head, head.next\n    return prev\n```';
    if (/world cup/.test(m)) return 'India won the 2011 World Cup!';
    if (/summar|read back/.test(m)) return 'Sure! What would you like to book?';
    if (/yes or no/.test(m)) return 'Yes, 6pm is free. See you then!';
    if (/how much|price|cost|\brate\b|कीमत|cheapest|estimate|ballpark|\bnumber\b/.test(m)) {
      const s = svcs[0] ?? b.services[0]!;
      if (s.price == null) return `${s.name} costs around ${b.currency === 'INR' ? '₹45,000' : '$900'}.`;
      const extra = /slot|kal/.test(m) ? " Yes, tomorrow's slot is available — you're booked!" : '';
      return svcs.map((x) => `${x.name} is ${money(b, x)}.`).join(' ') + extra || `${s.name} is ${money(b, s)}.`;
    }
    if (/hours|open/.test(m)) return `We're open ${b.hours}.`;
    if (/where|located/.test(m)) return `We're at ${b.address}.`;
    if (st.booking) return `You're all booked${st.day ? ` for ${st.day}` : ''}! See you soon.`;
    return `We have many great services at ${b.name}!`;
  }
}
