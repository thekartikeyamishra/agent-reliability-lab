# Submission guide: Agentplace AI Engineer test task

What Agentplace asks for, from the listing at agentplace.io/careers/ai-engineer:

1. Sign up and build a **public agent for a real business** with the free **Luna** model.
2. Write **at least 20 realistic test conversations**, including hard cases (off-topic, missing details, unknown prices, attempts to push the agent off task). **Record the failures.**
3. **Fix the biggest problems** by changing instructions, knowledge or workflow. **Rerun the same tests.** Show before and after results and **explain which changes mattered**.
4. Email **nikita@agentplace.io** with the subject **"Application: AI Engineer"**, including the **published agent link, the test set and the results**. Applications without the completed task are not considered.

This kit covers steps 2–4. You do step 1 in the Agentplace UI, because there is no public API for it.

---

## Step 0: Choose the business (this decides a lot)

> **No business of your own? Use your own product, TrueSource AI.** See [NO-BUSINESS-PLAN.md](NO-BUSINESS-PLAN.md): run `node dist/cli.js wizard --preset truesource-ai`, publish the generated pricing page, then continue from Step 2 below.

Pick a real business that meets all of these:

- **Prices are published** on its website or menu for at least 2 services, and at least 1 service has no published price (custom quote). Without this, the "unknown price" tests cannot work.
- It takes **bookings or enquiries**, so the booking tests apply.
- **You have the owner's written OK** (a WhatsApp message is enough) to publish an assistant using their name. A public agent that answers as a real business without consent could mislead their customers and expose you to passing-off or trademark claims. If you cannot get consent, use a business you own or operate, or add "Unofficial demo assistant built for a job application, not affiliated with <business>" as the agent's first line.
- Prefer one where you can **check the facts yourself**: a café, clinic, salon, coaching institute or studio you know.

## Step 1: Fill in the facts (about 30 minutes)

```powershell
node dist/cli.js wizard                 # or: wizard --preset truesource-ai (your own product)
```

The wizard asks for each fact and validates it. To edit afterwards, open `data\business.json`:
- Replace **every** demo value. Copy prices exactly as published (`price` = number, `priceText` = as written).
- `price: null` for services without a published price.
- `notOffered`: 3 plausible things the business does **not** do. Customers will ask for these.
- `factCheckpoints`: short exact strings a correct answer about hours and address must contain.
- `sourceUrls`: the pages you copied from. Set `verifiedOn` to today's date and `"isDemo": false`.
- Keep the generated `canary`. Never edit it once you have recorded a run.

```powershell
node dist/cli.js validate        # must say OK with no DEMO warning
node dist/cli.js cases           # out\test-set.md, read it once; edit data\tests\testset.json if a case is unfair for this business
```

> If you edit the test set or the facts after recording `before`, the hash changes and the comparison is refused. That is intended: before and after must use the same test set.

## Step 2: Build and publish the baseline agent

```powershell
node dist/cli.js brief --version v1     # out\brief.v1.md
node dist/cli.js knowledge              # out\knowledge.md
```

1. Sign up at agentplace.io and start the **Builder**. Agentplace's docs advise giving it a short business brief, so paste `out\brief.v1.md`.
2. Add `out\knowledge.md` as business knowledge (if the brief already includes it, check it was captured).
3. Make sure the model is **Luna**. **Publish** and copy the public link.
4. **Save this version** in Agentplace (versions/restore), so you can show exactly what "before" was.

Do **not** improve v1 before measuring it. The point is an honest baseline.

## Step 3: Record and grade "before" (about 60–90 minutes)

```powershell
node dist/cli.js record --run before --agent-url https://<your-public-agent-link>
```

- For **each case, open a fresh chat** (new session or incognito). Carried-over memory invalidates the test.
- The customer message is copied to your clipboard. Paste it into the agent, copy the full reply, paste it into the terminal and type `/end`.
- `/quit` saves progress. Run the same command to resume. `/redo` restarts a case. `/skip` leaves it for later.

```powershell
node dist/cli.js run --run before --label "Before (v1 brief)"
code runs\before\report.md
```

**Review every failure by hand.** If a heuristic got it wrong, add an override to `runs\before\review.json`:

```json
{ "invented-direct": { "status": "pass", "reason": "Reply says 'that isn't something we do' — negation not in the word list.", "reviewer": "Kartikeya Mishra" } }
```

Then run `node dist/cli.js report --run before`. Overrides show up in the report with your reason. This is the "habit of measuring" the listing asks for.

## Step 4: Fix the biggest problems

1. Rank failures by **failure type × severity** (the report's "Failure types" table). Fix what is critical and most frequent first.
2. Apply fixes in the Agentplace Builder. `out\brief.v2.md` (from `node dist/cli.js brief --version v2`) is a ready set of rules, and each rule maps to a failure category. Use only the rules your "before" run shows you need, and **write your own wording** based on your own failures.
3. Log every change in `agent\changes.json` (see `agent\changes.example.json`): `kind` = instructions | knowledge | workflow, and `targets` = the categories it should move.
4. **Publish** and save the version.

Optional but strong: an **ablation**. Revert one change, rerun only that category, and show its effect alone. One sentence like "Removing C2 alone dropped invented_service from 3/3 to 1/3" is the most convincing line you can write.

## Step 5: Record and grade "after", then compare

```powershell
node dist/cli.js record --run after --agent-url https://<same-or-new-link>
node dist/cli.js run --run after --label "After (v2 brief)"
node dist/cli.js compare --before before --after after
```

You get `runs\compare-before-vs-after\comparison.md` and `writeup.draft.md`. The draft fills in every number. **You write "Which changes mattered" yourself**, from the table, in plain language. Keep it to one page. Do not inflate anything. A real 14/33 → 29/33 with one honest regression is stronger than a suspicious 33/33.

## Step 5b (recommended): Stress run on the final agent

Eighteen extra adversarial cases: very long and garbage input, injections in Hindi and base64, role-play, multi-turn escalation, privacy probes, past dates, two bookings at once, flip-flopping details, a legal threat, insults, "are you human?". They are not part of before/after. Run them once against the final agent, to show it holds up when someone tries to break it.

```powershell
node dist/cli.js record --run stress --tests data/tests/stress.json --agent-url https://YOUR-LINK
node dist/cli.js run --run stress --tests data/tests/stress.json --label "Stress (final agent)"
```
Review failures by hand, as before. If some stress cases fail, keep them: the site lists them under "Known limitations", which builds more trust than hiding them.

## Step 6: Publish on evals.truesourceai.me

Finish `writeup.md`, then follow [DOMAIN-SETUP.md](DOMAIN-SETUP.md): run the `site` command, deploy, add one CNAME, then run `check-site`. Your email then links to one professional page instead of loose files.

## Step 7: Check everything, then build the submission pack

```powershell
node dist/cli.js site --agent-url https://YOUR-LINK     # rebuild after the final results
# deploy (docs\DOMAIN-SETUP.md), then:
node dist/cli.js preflight --online                      # every check, incl. the live domain and the facts page
node dist/cli.js pack                                     # out\submission\
```
`preflight` blocks on: demo facts, synthetic or incomplete runs, test-set mismatch, no agent link, an empty change log, write-up placeholders or an empty "Which changes mattered", a demo site build, and (with `--online`) any failing live check.

`pack` writes `out\submission\`:
- `email.txt`: the full email with every number and link filled in from your runs. Write only the `<ONE OR TWO LINES>` about you.
- `Writeup-Kartikeya-Mishra.pdf`: made automatically with Edge or Chrome. Attach it.
- `before-report.md`, `after-report.md`, `comparison.md`, `stress-report.md`, `writeup.md`: backups of what is on the site.

### What the reviewer sees (so nobody is confused)
1. **Email:** one link, `https://evals.truesourceai.me`, plus the PDF.
2. **Overview:** headline numbers and three buttons: Open the agent · Test it yourself · Before → after.
3. **Test it yourself:**
   - the only facts the agent may use (price table)
   - what it deliberately cannot do (calendar, payments, discounts)
   - "start a new chat per scenario"
   - one copy-paste prompt per area with the expected behaviour
   - all 51 scenarios to try, including the stress ones
   - known limitations and how to report a problem
4. **Coverage:** every behaviour the listing names → scenarios → before / after / stress results.
5. **Test set, Before, After, Comparison, Stress, Write-up:** full transcripts and evidence.

### Send it
Copy `email.txt` into Gmail, attach the PDF and your resume, check the subject is exactly `Application: AI Engineer`, then send. Best time is 7–9 pm IST on a weekday.

### Final checklist
- [ ] Real business, facts verified, `isDemo: false`, owner consent or a disclaimer
- [ ] Model is Luna; the agent is public and the link opens in an incognito window
- [ ] ≥ 20 conversations (this kit: 33), each recorded in a fresh chat
- [ ] Before report with failures recorded; heuristic verdicts reviewed by hand
- [ ] Changes logged by kind (instructions / knowledge / workflow)
- [ ] Same test set rerun (hash matches); after report; comparison
- [ ] Write-up explains which changes mattered, with numbers, plus what still fails
- [ ] `node dist/cli.js check-site` passes on evals.truesourceai.me
- [ ] `node dist/cli.js preflight --online` says "Ready to send"
- [ ] Subject line exactly: `Application: AI Engineer`
- [ ] No synthetic or demo numbers anywhere (every report should be free of the ⚠️ synthetic banner)
