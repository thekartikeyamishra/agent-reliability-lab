/**
 * Public facts/pricing page generated from the SAME business.json the agent and the graders use — one source of
 * truth, so the website, the agent's knowledge and the tests can never drift apart. Includes schema.org JSON-LD
 * so search engines and AI assistants read the same facts.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import { join } from 'node:path';
import type { BusinessFacts } from './types.js';
import { esc } from './markdown.js';
import { writeFileAtomic } from './util.js';

export function publicFacts(b: BusinessFacts): Record<string, unknown> {
  // Never publish the canary or internal grading hints.
  const { canary: _c, factCheckpoints: _f, isDemo: _d, ...rest } = b;
  return { ...rest, generatedAt: new Date().toISOString() };
}

export function factsPageHtml(b: BusinessFacts, pageUrl: string): string {
  const priced = b.services.filter((s) => typeof s.price === 'number');
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: b.name,
    url: b.website,
    description: b.category,
    ...(b.handoff.email ? { email: b.handoff.email } : {}),
    ...(b.handoff.phone ? { telephone: b.handoff.phone } : {}),
    ...(b.address ? { address: b.address } : {}),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `${b.name} services`,
      itemListElement: b.services.map((s) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: s.name, ...(s.description ? { description: s.description } : {}) },
        ...(typeof s.price === 'number' ? { price: s.price.toFixed(2), priceCurrency: b.currency } : {}),
        url: pageUrl,
      })),
    },
  };
  // JSON inside <script type="application/ld+json"> must not be able to close the tag.
  const ldJson = JSON.stringify(ld).replace(/</g, '\\u003c');
  const rows = b.services
    .map((s) => `<tr><td><strong>${esc(s.name)}</strong>${s.description ? `<br><span class="m">${esc(s.description)}</span>` : ''}</td><td>${s.price === null ? 'Quoted on request' : esc(s.priceText ?? `${b.currency} ${s.price}`)}</td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pricing and services · ${esc(b.name)}</title>
<meta name="description" content="${esc(`${b.name}: services, published prices, hours and how to reach a person.`)}">
<link rel="canonical" href="${esc(pageUrl)}">
<script type="application/ld+json">${ldJson}</script>
<style>
:root{--bg:#fbfbfa;--fg:#17181a;--m:#5f6368;--line:#e4e4e1;--a:#2457d6}@media (prefers-color-scheme:dark){:root{--bg:#111214;--fg:#ececec;--m:#a0a3a8;--line:#2a2c30;--a:#7ea2ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}.w{max-width:760px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:30px;line-height:1.2;margin:0 0 6px}h2{font-size:20px;margin:32px 0 10px}.m{color:var(--m);font-size:14px}a{color:var(--a)}
table{width:100%;border-collapse:collapse}td{border-bottom:1px solid var(--line);padding:10px 8px;vertical-align:top}td:last-child{white-space:nowrap;text-align:right;font-weight:600}
</style>
</head>
<body><main class="w">
<h1>${esc(b.name)}: services and pricing</h1>
<p class="m">${esc(b.category)}${b.website ? ` · <a href="${esc(b.website)}">${esc(b.website.replace(/^https:\/\//, ''))}</a>` : ''}</p>
<h2>Services</h2>
<table>${rows}</table>
${b.allowedAmounts?.length ? `<p class="m">Prices are also available in another currency at checkout.</p>` : ''}
${priced.length ? '' : '<p class="m">Prices are quoted on request.</p>'}
<h2>What we don't offer</h2>
<p>${esc(b.notOffered.join(', '))}, and anything else not listed above.</p>
${b.hours ? `<h2>Hours</h2><p>${esc(b.hours)}</p>` : ''}
${b.address ? `<h2>Location</h2><p>${esc(b.address)}</p>` : ''}
<h2>Talk to a person</h2>
<p>${b.handoff.email ? `Email <a href="mailto:${esc(b.handoff.email)}">${esc(b.handoff.email)}</a>` : ''}${b.handoff.email && b.handoff.phone ? ' · ' : ''}${b.handoff.phone ? `Phone / WhatsApp ${esc(b.handoff.phone)}` : ''}</p>
${b.policies && Object.keys(b.policies).length ? `<h2>Policies</h2><ul>${Object.entries(b.policies).map(([k, v]) => `<li><strong>${esc(k.charAt(0).toUpperCase() + k.slice(1))}:</strong> ${esc(v)}</li>`).join('')}</ul>` : ''}
<p class="m">Last updated ${esc(b.verifiedOn)}. Machine-readable version: <a href="facts.json">facts.json</a>.</p>
</main></body>
</html>
`;
}

export function writeFactsPage(b: BusinessFacts, outDir: string): string[] {
  const url = b.sourceUrls[0] ?? b.website ?? '';
  const html = factsPageHtml(b, url);
  const json = JSON.stringify(publicFacts(b), null, 2) + '\n';
  if (html.includes(b.canary) || json.includes(b.canary)) throw new Error('canary leaked into the public facts page');
  const page = (url.split('/').pop() || 'pricing.html').replace(/[^a-z0-9._-]/gi, '') || 'pricing.html';
  const fileName = page.endsWith('.html') ? page : 'pricing.html';
  writeFileAtomic(join(outDir, fileName), html);
  writeFileAtomic(join(outDir, 'facts.json'), json);
  return [fileName, 'facts.json'];
}
