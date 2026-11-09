# Requirements trace: Agentplace AI Engineer listing → this project

Every line of the listing (agentplace.io/careers/ai-engineer, read 9 Nov 2026) and how it is met.
"You" marks the parts only the candidate can do.

## Test task
| Listing line | How it is met |
|---|---|
| Sign up, build a **public agent for a real business** with the **free Luna** model | **You**, in the Agentplace UI. `brief.v1.md` plus `knowledge.md` are generated from verified facts with source URLs. The guide covers business choice and consent. |
| **≥ 20 realistic test conversations** | 33 multi-turn conversations (`data/tests/testset.json`). The validator refuses fewer than 20. |
| Hard cases: **off-topic** | `offtopic-code`, `offtopic-trivia`, `offtopic-competitor` |
| Hard cases: **missing details** | `booking-bare`, `booking-no-contact`, `booking-vague-date`, `recommend-unsure` |
| Hard cases: **unknown prices** | `price-unknown`, `price-unknown-pressure` (3-turn pressure), plus a global check that any unpublished amount in any reply is critical |
| Hard cases: **attempts to push the agent off task** | `inject-persona`, `inject-extract` (canary), `inject-fake-admin`, `pressure-discount` |
| **Record failures** | `runs/before/report.md`, `cases.csv` and `result.json`, with evidence snippets and severity |
| Fix by changing **instructions, knowledge, or workflow** | `brief.v2.md` (instructions), negative knowledge in `knowledge.md`, booking workflow rules. Logged in `agent/changes.json` with `kind` and `targets`. |
| **Rerun the same tests** | Test-set hash lock. `compare` refuses runs made on different test sets. |
| **Before and after results** | `comparison.md`: pass rate with 95% CI, fixed and regressed cases, per category, per failure type |
| **Explain which changes mattered** | The change → targeted-category table, plus the ablation procedure in the guide. **You** write the explanation. |
| Submit **agent link, test set, write-up** | `out/test-set.md`, the reports, `writeup.draft.md` and the email template |
| Applications without the task are not considered | The checklist in SUBMISSION-GUIDE.md |

## Responsibilities
| Listing line | Evidence in this project |
|---|---|
| Build **evaluation sets and pipelines** testing agent behaviour in realistic conversations | Templated multi-turn test set, runner, graders, reports, CI |
| Improve **prompts, tool calling, retrieval** so agents stay accurate and on task | v1 → v2 brief; knowledge structured for retrieval (explicit "not offered" and "price not published" entries) |
| **Compare models on quality, latency and cost** | `arl models`: pass rate, critical failures, p50/p95 latency and cost per conversation on the same suite |
| Find **common failure patterns** and fix them **platform-wide** | Failure taxonomy across categories. The test set and graders are business-agnostic, so one suite regression-tests any agent. |
| Work with product and design on **asking questions, recommending, hand-off** | Dedicated categories: `booking_missing_details`, `recommendation`, `handoff` |

## Requirements
| Listing line | Evidence |
|---|---|
| Shipping LLM features to real users | **You**: your resume and email (for example ATS Scanner Pro, TheBharatAI) |
| **Writing evals and using them to make decisions** | The whole project. Changes are kept or reverted based on measured deltas. |
| Strong **Python or TypeScript** | Strict TypeScript (`noUncheckedIndexedAccess`), zero runtime dependencies, unit-tested |
| **Measuring before and after**, not impressions from a few chats | Hash-locked reruns, confidence intervals, error status kept separate from pass/fail, human overrides recorded with reasons |
| **Clear written communication** about what was tried and learned | Write-up draft structure: result, method, failures, changes, what mattered, what still fails, limitations |

## Nice to have
| Listing line | Evidence |
|---|---|
| Agent frameworks / multi-step tool use | Multi-turn sessions and adapter interface; booking workflow evaluated across turns |
| Voice agents or customer-facing chat | Customer-facing chat throughout; Hindi and Hinglish cases |

## What this does not guarantee
No project can guarantee selection. Agentplace says the strongest candidates are invited to interview. What you control: a real agent, honest numbers, a clear explanation of which change mattered, and replying quickly.
