# Agent Reliability Lab

An evaluation harness for customer-facing AI agents, built for the **Agentplace AI Engineer** test task. It measures an agent on realistic conversations, fixes what fails and measures again. It does not rely on reading a few chats.

- **33 core multi-turn conversations plus an 18-case stress suite** across 14 failure categories: known prices, unknown prices, invented services, bookings with missing details, lost booking details, off-topic requests, prompt injection, discount pressure, hand-off, privacy and safety, Hindi and Hinglish. The test set is written once as templates, so it works for any business.
- **Deterministic graders.** Any amount that is not a published price fails as critical. A canary code planted in the agent's instructions catches leaks exactly. Echoed card numbers, false booking confirmations, lost details, missing hand-offs and invented services are each checked separately.
- **Before → after comparison.** Same test set (hash-locked), pass rate with 95% confidence intervals, fixed and regressed cases, failure types, and each change mapped to the categories it targeted. It also drafts the write-up.
- **Works without an API.** Agentplace public agents are recorded with an interactive recorder that copies each customer message to the clipboard. It can also drive any OpenAI-compatible model (local Ollama for free) or any HTTP agent, and compare models on quality, latency and cost.
- **Reviewer-friendly.** A "Test it yourself" page (facts, expected behaviour, copy-paste prompts, ways to break it, known limitations) and a coverage matrix from the job listing to results.
- **Publishes to your domain.** A static evidence site on `evals.truesourceai.me`, with ready configs for Vercel, Cloudflare Pages or Firebase, plus a live-domain checker.
- **Zero runtime dependencies.** It runs offline. 29 unit tests, CI on Windows and Linux.

> Owner: **Kartikeya Mishra** · MIT License · see [docs/LEGAL-AND-OWNERSHIP.md](docs/LEGAL-AND-OWNERSHIP.md)

## Quick start (Windows, VS Code, PowerShell)

```powershell
# Node.js 22 LTS required: https://nodejs.org
cd agent-reliability-lab
.\scripts\setup.ps1          # install, build, run tests, run the demo, create data\business.json
```

Or step by step: `npm ci` → `npm run build` → `npm test` → `npm run demo`.
All commands are also in **VS Code → Terminal → Run Task → "ARL: …"**.

## Doing the Agentplace test task

**No business of your own?** Use your own product: `node dist/cli.js wizard --preset truesource-ai` → `node dist/cli.js facts-page` → publish. See [docs/NO-BUSINESS-PLAN.md](docs/NO-BUSINESS-PLAN.md).

The full walkthrough is in **[docs/SUBMISSION-GUIDE.md](docs/SUBMISSION-GUIDE.md)**. In short:

```powershell
node dist/cli.js init                         # 1. create data\business.json, then fill it with REAL facts
node dist/cli.js validate
node dist/cli.js brief --version v1           # 2. out\brief.v1.md → paste into the Agentplace Builder, publish
node dist/cli.js record --run before --agent-url https://…   # 3. record 33 conversations
node dist/cli.js run --run before --label "Before (v1)"      #    grade them → runs\before\report.md
node dist/cli.js brief --version v2           # 4. apply the fixes in the Builder, republish
node dist/cli.js record --run after --agent-url https://…
node dist/cli.js run --run after --label "After (v2)"
node dist/cli.js compare --before before --after after       # 5. comparison.md + writeup.draft.md
node dist/cli.js site --agent-url https://…                 # 6. build the site → deploy → check-site
```

## Commands

| Command | What it does |
|---|---|
| `wizard [--preset truesource-ai]` | Guided, validated setup of your business facts (prices, contacts, what you don't offer) |
| `facts-page` | Public pricing/facts page plus `facts.json`, generated from the same file the agent and graders use |
| `env` / `ping` | Show loaded settings (secrets hidden) / one tiny request to check a model endpoint |
| `init` | Creates `data/business.json` (with a fresh canary) and `agent/changes.json` |
| `validate` | Validates business facts, test set and both briefs |
| `knowledge` / `brief --version v1\|v2` / `cases` | Writes the knowledge text, the Builder briefs and a readable test set to `out/` |
| `record --run <id>` | Interactive, resumable recording from a published agent |
| `run --run <id> --adapter transcript\|mock\|openai\|http` | Grades a recording, or drives an agent directly |
| `report --run <id>` | Rebuilds the report after you add human reviews in `runs/<id>/review.json` |
| `compare --before <id> --after <id>` | Before/after tables and a write-up draft |
| `models --config models.json` | Model comparison: pass rate, critical failures, p50/p95 latency, cost per conversation |
| `site` | Builds the static evidence site for **evals.truesourceai.me** (no JS, strict security headers, canary redacted). See [docs/DOMAIN-SETUP.md](docs/DOMAIN-SETUP.md). |
| `check-site` | Verifies the live domain: HTTPS redirect, pages, security headers, no canary leak |
| `preflight [--online]` | Every check before sending: real runs, no placeholders, site built, live domain and facts page |
| `pack` | `out/submission/`: filled-in email, write-up PDF (via Edge/Chrome), report backups |
| `demo` | End-to-end self-test with a mock agent and a fictional business (results are labelled synthetic) |

## How grading works

Each conversation is graded in two layers.

1. **Invariants on every agent turn:** unpublished price (critical), canary leak (critical), echoed card number (critical), empty reply.
2. **Expectations on the final turn** (per test): quotes the right price, quotes no price, denies a bait service, hands off to a human, asks for missing booking details, recalls earlier details, never claims a confirmed booking, stays on task, plus regex must/must-not checks.

A conversation **fails** on any critical or major failure. Minor failures (for example, replying in English to a Hindi question) are reported but do not fail the case. Infrastructure problems are recorded as **error**, never as pass or fail, so an outage cannot look like a regression.

Some checks are heuristics, such as negation detection for invented services. Their messages say so. If a verdict is wrong, record a human override with a reason in `runs/<id>/review.json`. Overrides appear in every report. An optional LLM judge (`--judge`) can add findings but can never clear a rule failure.

## Project layout

```
agent/      brief.v1.md (baseline) · brief.v2.md (hardened) · changes.json (what you changed and why)
data/       business.example.json (fictional demo) · business.json (yours, git-ignored) · tests/testset.json
docs/       SUBMISSION-GUIDE · REQUIREMENTS-TRACE · RISK-REGISTER · LEGAL-AND-OWNERSHIP · APPLICATION-EMAIL
src/        cli · runner · checks/ · adapters/ · report · resilience · validate · template · knowledge · judge
test/       unit tests (node:test)
runs/       generated: transcript.json · result.json · report.md · cases.csv · review.json
```
