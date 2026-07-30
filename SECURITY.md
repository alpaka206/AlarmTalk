# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | ✅ |

Older versions receive no fixes. Always upgrade to the latest released version.

## Reporting a Vulnerability

Please report security issues **privately**, not through public GitHub issues.

1. **Do not** create a public issue or PR describing the vulnerability.
2. Open a private report via GitHub Private Vulnerability Reporting for this repository.
3. Include:
   - A clear description of the issue
   - Step-by-step reproduction
   - Potential impact
   - Suggested fix, if you have one

### What to expect

- **Acknowledgment** within 48 hours.
- **Initial assessment** within 7 days.
- **Resolution** target: critical issues patched within 14 days.

## Scope

In scope:

- Authentication / authorization bypass
- SQL injection, XSS, CSRF
- API key or secret exposure
- Voice data privacy leaks
- Privilege escalation
- Remote code execution

Out of scope:

- Denial of service against the public API
- Social engineering of the maintainers or end users
- Issues in third-party dependencies (please report upstream)
- Issues requiring prior physical access to a user's device

## Recognition

Responsible reporters are credited in release notes unless they request anonymity.

## Security Practices for Contributors

- Never commit API keys, tokens, or secrets. The `.gitignore` already covers the obvious patterns; double-check anything unusual.
- Use environment variables / Cloudflare Worker secrets for all sensitive configuration.
- Voice data must be encrypted in transit and stored in a private R2 bucket.
- Follow the OWASP Top 10 guidance.
- Every PR requires a review before merging to `main`.

For the internal threat model, response headers, rate limits, and rotation policy, see the security policy section of [`docs/standards/README.md`](docs/standards/README.md).
