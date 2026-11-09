# Security

- Report vulnerabilities privately to the repository owner (contact via the GitHub profile). Please do not open a public issue.
- Design controls (input validation, escaping, path confinement, secret redaction, HTTPS-only remote endpoints, zero runtime dependencies) are listed in [docs/RISK-REGISTER.md](docs/RISK-REGISTER.md).
- Never commit `.env`, `data/business.json` with private details, or `runs/` containing real conversations.
