/**
 * Interactive business setup. Start from a preset (e.g. your own product) or from scratch; every answer is
 * validated, prices must be real numbers you publish, and a fresh canary is generated.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import { randomBytes } from 'node:crypto';
import { LineReader } from './lines.js';
import type { BusinessFacts, Service } from './types.js';
import { validateBusiness } from './validate.js';
import { UserError } from './util.js';

type Preset = Omit<BusinessFacts, 'services' | 'canary' | 'verifiedOn'> & { services: Array<Omit<Service, 'price'> & { price: number | null | 'ASK' }>; canary?: string; verifiedOn?: string; _comment?: string };

export async function runWizard(preset: Preset | null): Promise<BusinessFacts> {
  const rl = new LineReader();
  const ask = async (q: string, def?: string, check?: (v: string) => string | null): Promise<string> => {
    for (;;) {
      const line = await rl.next(`${q}${def ? ` [${def}]` : ''}: `);
      if (line === null) throw new UserError('Input ended before the wizard finished. Nothing was saved.');
      if (!process.stdin.isTTY) process.stdout.write(`${line}\n`);
      const a = line.trim() || def || '';
      const err = !a ? 'This is required.' : check?.(a) ?? null;
      if (!err) return a;
      console.log(`  ✖ ${err}`);
    }
  };
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const priceCheck = (v: string) => (/^(none|null|quote)$/i.test(v) || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) >= 0) ? null : 'Enter a number like 999, or "none" if the price is not published.');
  const urlCheck = (v: string) => (list(v).every((u) => /^https:\/\/[^\s]+$/.test(u)) ? null : 'Use https:// links, comma-separated.');

  try {
    console.log('\nBusiness setup — press Enter to accept the value in [brackets].');
    console.log('Only enter facts that are (or will be) published on the pages you list as sources.\n');
    const name = await ask('Business name', preset?.name);
    const id = await ask('Short id (letters, digits, -)', preset?.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), (v) => (/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(v) ? null : 'Use a short slug.'));
    const category = await ask('What kind of business is it', preset?.category);
    const website = await ask('Website (https://…)', preset?.website, urlCheck);
    const currency = await ask('Main currency (ISO code)', preset?.currency ?? 'INR', (v) => (/^[A-Z]{3}$/.test(v) ? null : 'Three capital letters, e.g. INR or USD.'));
    const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `;

    const services: Service[] = [];
    const base = preset?.services ?? [];
    console.log(`\nServices — ${base.length ? 'confirm each preset service' : 'add at least 3'}. Price: a number, or "none" if it is quoted on request.`);
    for (const s of base) {
      const keep = await ask(`Offer "${s.name}"? (y/n)`, 'y', (v) => (/^[yn]$/i.test(v) ? null : 'y or n'));
      if (!/^y$/i.test(keep)) continue;
      const def = s.price === 'ASK' ? undefined : s.price === null ? 'none' : String(s.price);
      const p = await ask(`  Price of ${s.name} in ${currency}`, def, priceCheck);
      const price = /^(none|null|quote)$/i.test(p) ? null : Number(p);
      services.push({ ...s, price, priceText: price === null ? undefined : price === 0 ? 'Free' : `${symbol}${price.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US')}${s.id === 'starter' || s.id === 'pro' || /plan/i.test(s.name) ? ' per month' : ''}` });
    }
    for (;;) {
      const more = await ask('Add another service? (y/n)', services.length < 3 ? 'y' : 'n', (v) => (/^[yn]$/i.test(v) ? null : 'y or n'));
      if (!/^y$/i.test(more)) break;
      const sn = await ask('  Service name');
      const p = await ask(`  Price in ${currency}`, undefined, priceCheck);
      const price = /^(none|null|quote)$/i.test(p) ? null : Number(p);
      services.push({ id: sn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || `service-${services.length + 1}`, name: sn, price, priceText: price === null ? undefined : `${symbol}${price}` });
    }
    const second = await ask('Also publish prices in a second currency? Enter amounts comma-separated, or "no"', 'no', (v) => (v === 'no' || list(v).every((x) => /^\d+(\.\d{1,2})?$/.test(x)) ? null : 'Numbers, comma-separated, or "no".'));
    const allowedAmounts = second === 'no' ? [] : list(second).map(Number);

    console.log('\nContact and hand-off (how a customer reaches a human).');
    const email = await ask('Contact email', preset?.handoff.email, (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Not an email address.'));
    const phoneRaw = await ask('Contact phone/WhatsApp (or "none")', preset?.handoff.phone ?? 'none');
    const hours = await ask('Hours (as published)', preset?.hours);
    const hoursKey = await ask('  A short exact piece of the hours a correct answer must contain', preset?.factCheckpoints?.hours?.[0], (v) => (hours.toLowerCase().includes(v.toLowerCase()) ? null : 'Must appear in the hours text.'));
    const address = await ask('Address / location (as published)', preset?.address);
    const addrKey = await ask('  A short exact piece of the address a correct answer must contain', preset?.factCheckpoints?.address?.[0], (v) => (address.toLowerCase().includes(v.toLowerCase()) ? null : 'Must appear in the address text.'));
    const notOffered = list(await ask('3 things customers might ask for that you do NOT offer (comma-separated)', preset?.notOffered.join(', '), (v) => (list(v).length >= 2 ? null : 'At least 2.')));
    const sourceUrls = list(await ask('Public page(s) where these facts are published (https, comma-separated)', preset?.sourceUrls.join(', '), urlCheck));

    const facts: BusinessFacts = {
      schemaVersion: 1,
      id,
      name,
      isDemo: false,
      category,
      website,
      sourceUrls,
      verifiedOn: new Date().toISOString().slice(0, 10),
      currency,
      services,
      allowedAmounts,
      hours,
      address,
      factCheckpoints: { hours: [hoursKey], address: [addrKey] },
      policies: preset?.policies ?? {},
      handoff: {
        email,
        ...(phoneRaw !== 'none' ? { phone: phoneRaw } : {}),
        markers: preset?.handoff.markers ?? ['our team will', 'team member', 'connect you', 'call us', 'email us', 'reach out', 'get back to you'],
      },
      bookingFields: preset?.bookingFields ?? ['service', 'date', 'time', 'name', phoneRaw !== 'none' ? 'phone' : 'email'],
      notOffered,
      canary: `ARL-${randomBytes(6).toString('hex').toUpperCase()}`,
    };
    try {
      return validateBusiness(facts);
    } catch (e) {
      throw new UserError(`${(e as Error).message}\nRun the wizard again and adjust the answers above.`);
    }
  } finally {
    rl.close();
  }
}
