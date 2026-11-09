/**
 * Turns business facts into (1) the knowledge text you paste into the agent and (2) rendered builder briefs.
 * Negative knowledge ("we do NOT offer…", "price not published…") is written out explicitly: models fill gaps,
 * so the gaps have to be stated.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import type { BusinessFacts } from './types.js';
import { render, templateContext } from './template.js';

export function knowledgeMarkdown(b: BusinessFacts): string {
  const lines: string[] = [];
  lines.push(`# ${b.name} — business knowledge`, '');
  lines.push(`Type of business: ${b.category}`);
  if (b.address) lines.push(`Address: ${b.address}`);
  if (b.hours) lines.push(`Opening hours: ${b.hours}`);
  if (b.website) lines.push(`Website: ${b.website}`);
  lines.push('', '## Services and published prices', '');
  for (const s of b.services) {
    const price = s.price === null ? 'PRICE NOT PUBLISHED — do not estimate; offer a quote from the team' : (s.priceText ?? `${b.currency} ${s.price}`);
    const extra = [s.bookable ? 'can be booked' : '', s.durationMin ? `${s.durationMin} min` : '', s.aliases?.length ? `also called: ${s.aliases.join(', ')}` : '', s.description ?? '']
      .filter(Boolean)
      .join('; ');
    lines.push(`- **${s.name}** — ${price}${extra ? ` (${extra})` : ''}`);
  }
  lines.push('', '## Services we do NOT offer', '');
  lines.push(`We do not offer: ${b.notOffered.join(', ')}. We also do not offer anything that is not listed above.`);
  if (b.policies && Object.keys(b.policies).length) {
    lines.push('', '## Policies', '');
    for (const [k, v] of Object.entries(b.policies)) lines.push(`- ${k}: ${v}`);
  }
  lines.push('', '## Reaching a human', '');
  if (b.handoff.phone) lines.push(`- Phone / WhatsApp: ${b.handoff.phone}`);
  if (b.handoff.email) lines.push(`- Email: ${b.handoff.email}`);
  lines.push('', '## Facts the assistant does not have', '');
  lines.push('- Live availability or calendar slots', '- Discounts, offers or promo codes (none unless listed above)', '- Information about other businesses');
  return lines.join('\n') + '\n';
}

export function renderBrief(template: string, b: BusinessFacts): string {
  const contactLine = [b.handoff.phone && `phone/WhatsApp ${b.handoff.phone}`, b.handoff.email && `email ${b.handoff.email}`].filter(Boolean).join(' or ');
  const ctx = { ...templateContext(b), knowledge: knowledgeMarkdown(b), bookingFieldList: b.bookingFields.join(', '), contactLine };
  return render(template, ctx, 'brief');
}
