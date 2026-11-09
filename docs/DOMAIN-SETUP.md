# Publishing on your domain: evals.truesourceai.me

**Why a subdomain:** `truesourceai.me` already serves your TrueSource AI landing and booking site. Publishing the evidence on **`evals.truesourceai.me`** means you change no existing records and risk nothing on the main site. It is also a single CNAME that can point at any host.

**What gets published:** a static site with no JavaScript, no cookies, no forms and no external requests. It holds the overview, test set, before and after reports, comparison and write-up. It is `noindex` by default, so it is for the people you send the link to and stays out of Google. Security headers are pre-configured for every host (CSP `default-src 'none'`, HSTS, no framing, nosniff, a strict permissions policy). The canary code is redacted automatically.

---

## 1. Build the site (after your real before/after runs)

```powershell
copy runs\compare-before-vs-after\writeup.draft.md runs\compare-before-vs-after\writeup.md
code runs\compare-before-vs-after\writeup.md      # finish it, remove every <placeholder>
npm run build
node dist/cli.js site --before before --after after --agent-url https://YOUR-AGENT-LINK
start site\index.html                             # preview locally in your browser
```

The command refuses to build from mock or demo runs. `node dist/cli.js site --demo` builds a clearly labelled preview for trying the flow; **never deploy it**.
If you want search engines to index it, add `--index` or set `"allowIndexing": true` in `site.config.json`.

## 2. Deploy: pick ONE host (all free)

### Option A: Vercel (recommended if truesourceai.me is already on Vercel)
```powershell
cd site
npx vercel@latest login
npx vercel@latest --prod          # project name: agent-evals; it picks up site\vercel.json (headers)
cd ..
```
Then go to **Vercel dashboard → agent-evals → Settings → Domains → Add `evals.truesourceai.me`**.
Vercel shows the exact DNS record to add. If the domain's nameservers are already Vercel's, it is automatic.

### Option B: Cloudflare Pages (unlimited bandwidth on the free plan)
```powershell
npx wrangler@latest login
npx wrangler@latest pages deploy site --project-name agent-evals --branch main
```
Then go to **Cloudflare dashboard → Workers & Pages → agent-evals → Custom domains → Set up `evals.truesourceai.me`**. Headers come from `site\_headers`.

### Option C: Firebase Hosting (if you prefer your Firebase account)
Set `"firebaseSite": "agent-evals-km"` and `"firebaseProject": "YOUR_PROJECT_ID"` in `site.config.json`, rebuild the site, then:
```powershell
npx firebase-tools@latest login
npx firebase-tools@latest hosting:sites:create agent-evals-km --project YOUR_PROJECT_ID
cd site
npx firebase-tools@latest deploy --only hosting
cd ..
```
Then go to **Firebase console → Hosting → agent-evals-km → Add custom domain → `evals.truesourceai.me`** and add the records it shows. Use a separate hosting site so the deploy can never overwrite anything else in that project.

## 3. DNS at your registrar (where truesourceai.me is managed)

Add **one** record and change nothing else:

| Type | Host / Name | Value | TTL |
|---|---|---|---|
| CNAME | `evals` | the target your host shows (Vercel: usually `cname.vercel-dns.com`; Cloudflare: `agent-evals.pages.dev`) | Auto / 3600 |

- **Do not edit** the `@`/apex A records, `www`, or any MX/TXT records. They run your main site and email.
- If the domain has **CAA** records, they must allow your host's certificate authority (Let's Encrypt for Vercel and Firebase; Let's Encrypt or Google Trust Services for Cloudflare). No CAA records is fine.
- Firebase may ask for A records plus a TXT verification on `evals` instead. Use exactly what its console shows.

Check propagation (usually minutes, at most 24 hours):
```powershell
Resolve-DnsName evals.truesourceai.me
```

## 4. Verify the live site

```powershell
node dist/cli.js check-site --domain evals.truesourceai.me
```
This checks that http redirects to https, every page (including Test it yourself and Coverage) returns 200, unknown paths return 404, all security headers are present, the canary is not on the page, and it is not a demo build. Fix anything marked ✗ (see Troubleshooting) before you email the links.

Then open it on your phone in a private tab, and run a free scan at securityheaders.com (expect grade A).

## 5. Updating or switching hosts
- Re-run the `site` command, then the same deploy command. Each deploy is atomic, and Vercel, Cloudflare and Firebase all let you roll back to the previous deploy in the dashboard.
- **Host down or changed its terms?** Deploy the same `site\` folder to another option above and repoint the single `evals` CNAME. No code changes.
- Keep a copy of the built `site\` folder (zip it) as your offline backup.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `check-site` says DNS / fetch failed | Record not propagated yet, or a typo in Host (it must be `evals`, not `evals.truesourceai.me` on most registrars) |
| SSL certificate error | Wait 5–30 minutes after DNS resolves. Check CAA records. Remove any conflicting A/AAAA record on `evals`. |
| Headers missing | Vercel: deploy from inside `site\` so `vercel.json` is the project root. Cloudflare: `_headers` must be in the deployed folder root. Firebase: deploy from `site\`. |
| http does not redirect | Turn on "Always Use HTTPS" (Cloudflare) or the host's force-HTTPS setting (Vercel and Firebase do it automatically) |
| Old content showing | Hard refresh (Ctrl+F5). CSS is cached for one hour. |

## Ownership and cost
- You keep the domain, the code and the content. Hosts only serve copies.
- All three options are free at this traffic level. Vercel's free Hobby plan is for personal, non-commercial projects, which a job-application portfolio is. Use Cloudflare Pages if this ever becomes commercial.
