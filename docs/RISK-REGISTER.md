# Risk register: points of failure and fallbacks

| # | Failure point | Impact | Fallback / control (in code) |
|---|---|---|---|
| 1 | Agentplace has no public API for published agents | Cannot automate runs | `record` interactive recorder (clipboard, resumable). The `http` adapter is ready if an endpoint becomes available. |
| 2 | Agentplace or Luna changes or goes away | Tooling stops working | No dependency on Agentplace in code. Adapters for transcript, any OpenAI-compatible endpoint (local Ollama, offline) and generic HTTP. A new provider means one ~50-line adapter. |
| 3 | Model provider outage, rate limit (429) or throttling | Run aborts or results are skewed | Timeouts, retries with exponential backoff plus full jitter, `Retry-After` honoured, per-endpoint circuit breaker, multi-URL failover (`ARL_BASE_URLS=a,b`), concurrency and `--rpm` limits |
| 4 | Outage silently counted as a failure or pass | Wrong conclusions | Infrastructure errors are status `error` and excluded from pass rates. Reports show error counts. |
| 5 | Crash or Ctrl+C mid-run | Lost work | Checkpoint after every case (atomic write) and automatic resume. The checkpoint is keyed to test set, model and brief, so a stale resume is impossible. |
| 6 | Falling back to a different model mid-run | Mixed results that look valid | Deliberately **not** done. Failover only moves between endpoints serving the same model id. |
| 7 | Test set or facts edited between before and after | Invalid comparison | SHA-256 hash of the rendered test set. Grading refuses mismatched transcripts; compare warns on hash mismatch. |
| 8 | Recorded customer message differs from the test | Invalid case | Per-turn verification. A mismatch becomes `error`. |
| 9 | Heuristic grader false positive or negative | Wrong verdict | Messages flag heuristics. Human overrides need a reason and reviewer and are shown in reports. Unit tests cover each grader. |
| 10 | LLM judge wrong, down, or manipulated by transcript text | Wrong verdict | The judge is advisory by default, cannot clear rule failures, transcript is delimited as data, outages fall back to rules-only |
| 11 | Agent output contains HTML, Markdown or spreadsheet formulas | Report or CSV injection | All agent text escaped in Markdown. CSV cells starting with `= + - @` are neutralised. Control characters stripped. Length capped. |
| 12 | Malicious or oversized input files | Crash or path traversal | 10 MB cap, BOM-safe JSON parsing, strict schema validation, run ids restricted to a slug and confined to `runs/` |
| 13 | API keys leaking into reports or logs | Credential exposure | Keys only read from env, never written. Error messages pass through secret redaction. `.env` is git-ignored. HTTPS is required for remote hosts. |
| 14 | Supply-chain attack via npm packages | Compromised machine | Zero runtime dependencies. Only `typescript` and `@types/node` at dev time. Lockfile committed and `npm ci` used. |
| 15 | Personal data in transcripts (names, phones) | DPDP / GDPR exposure | Test personas are fictional. Card numbers in tests are standard test numbers (4111…). `runs/` and `data/business.json` are git-ignored. Do not paste real customer data. |
| 16 | Business facts wrong or outdated | Agent and grader both wrong | `sourceUrls` and `verifiedOn` required. The demo flag blocks accidental submission of fictional data (banner in every report). |
| 17 | Windows specifics (CRLF, encoding, clipboard) | Broken files or garbled Hindi | BOM stripping, `.gitattributes`, UTF-8 clipboard via PowerShell `Set-Clipboard`, CI on `windows-latest` |
