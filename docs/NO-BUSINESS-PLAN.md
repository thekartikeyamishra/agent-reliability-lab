# No business of your own? Use your own product: TrueSource AI

The task needs "a public agent for a real business". You don't need someone else's café. **TrueSource AI is a real business you own**, on a domain you control. That solves the three hard problems at once:

| Problem | Someone else's business | TrueSource AI |
|---|---|---|
| Permission to publish an agent in their name | Need written consent | You are the owner |
| Real contact for hand-off | Their phone (strangers might call them) | Your own email |
| Facts you can verify | Copied from their site, may change | You publish them yourself |
| Value after the application | None | A working sales assistant for your platform |

The agent becomes the **TrueSource AI assistant**. It answers questions about plans and prices, recommends a plan, refuses things you don't offer (for example "guaranteed #1 ranking"), and collects strategy-call requests for you to confirm.

---

## Step 1: Decide your real prices (10 minutes, your decision)

The preset already has six services. Three are left for you to price, because only you can set them:
- **Starter plan** (per month), **Pro plan** (per month), **1:1 Growth Strategy Call** (one-off)
- **Free Website Growth Audit** = Free
- **Agency plan** and **Done-for-you implementation** = "quoted on request". These are needed for the "unknown price" tests.

These are **public offers you must honour** if someone pays. Use prices you would really charge. If your TrueSource platform code already has a pricing table, use the same numbers. Ask your CA whether to show prices "inclusive of GST" or "+ GST", and state it in the service description.

## Step 2: Run the wizard

```powershell
npm run build
node dist/cli.js wizard --preset truesource-ai
```
Press **Enter** to accept each default. Type the three prices when asked. Change anything that isn't true:
- **Hours:** only promise what you can keep.
- **Location:** "Online service, based in Lucknow, India". Change it if you'd rather not publish the city.
- **Email:** the address you want customers to use.
- **Not offered:** three things people might ask for that you don't do.
- **Source page:** where the facts will be published, `https://truesourceai.me/pricing.html` by default.

It writes `data\business.json`, generates a new secret leak-detection code (canary), and validates everything. Then run `node dist/cli.js validate`. It should say OK with no DEMO warning.

## Step 3: Publish the facts page (before building the agent)

```powershell
node dist/cli.js facts-page        # → out\facts\pricing.html + out\facts\facts.json
```
This page comes from the **same file** the agent and the graders use, so the website, the agent and the tests can never disagree. It also includes schema.org data, so search engines and AI assistants read the same facts. That's a small SEO/AI-visibility bonus for TrueSource.

Where to publish it (pick one):
- **A. On truesourceai.me (best).** Copy both files into your TrueSource Next.js project's `public\` folder and redeploy. Next.js serves `public\pricing.html` at `https://truesourceai.me/pricing.html` with no code changes. Add a "Pricing" link in your site footer.
- **B. On the evidence subdomain (fallback).** The `site` command already includes it at `https://evals.truesourceai.me/facts/pricing.html`. If you use this, rerun the wizard with that URL as the source page, **before** recording anything.

Open the URL in a private window and check every price.

## Step 4: Build the agent on Agentplace

```powershell
node dist/cli.js brief --version v1
```
Paste `out\brief.v1.md` into the Agentplace Builder, choose **Luna**, name it **"TrueSource AI Assistant"** and publish. Then follow [SUBMISSION-GUIDE.md](SUBMISSION-GUIDE.md) from Step 3 (record before → fix → record after → compare → site → email).

When the agent asks for a contact, the recording uses fictional customers (Rahul, Meera…), so your inbox gets nothing from the tests.

## Step 5 (after applying): keep it earning
- Agentplace supports custom domains. You can point `assistant.truesourceai.me` at the agent and link it from your landing page as a 24/7 pre-sales assistant.
- Rerun the suite whenever you change prices or the agent (`record` → `run` → `compare`). That turns the tool into your regression gate.

## Saying it in the email
"I built the agent for my own product, TrueSource AI (truesourceai.me), so every fact is published by me and verifiable at <facts page link>, and hand-offs go to a real inbox."

This is a strength: you own the business end to end.
