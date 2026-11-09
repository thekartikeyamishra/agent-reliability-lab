# Application email

**To:** nikita@agentplace.io
**Subject:** Application: AI Engineer

---

Hi Nikita,

I'm applying for the remote AI Engineer role. Everything for the test task is on one page: **https://evals.truesourceai.me**

- **Published agent (Luna):** <link>, an assistant for <business>, <city>
- **Test set:** <N> multi-turn conversations across <K> categories, including unknown prices, invented services, missing and changed booking details, off-topic requests, prompt injection, discount pressure and hand-off: https://evals.truesourceai.me/test-set.html
- **Results:** <before X/N> → <after Y/N> passing, critical failures <a> → <b>, measured on the same hash-locked test set: https://evals.truesourceai.me/comparison.html
- **Write-up:** https://evals.truesourceai.me/writeup.html (PDF attached)

What mattered most: <one sentence, e.g. "Listing what the business does NOT offer in the knowledge fixed every invented-service failure; the instruction change alone did not (ablation in the write-up).">

I graded with deterministic checks rather than reading chats. Any amount not on the published price list is a critical failure, and a canary code in the instructions detects leaks. The tooling is open source and can be reused for regression testing across agents: <repo link>.

About me: <one or two lines, e.g. LLM features you have shipped to real users, with numbers>.

Thanks,
Kartikeya Mishra
kartikeyamishra.info · linkedin.com/in/thekartikeyamishra · github.com/thekartikeyamishra
