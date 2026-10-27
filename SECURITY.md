# Security Policy

## Supported versions

This project is in Alpha. Security fixes target the latest published or repository-supported release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository, or contact the maintainers through the GitHub profile if private reporting is unavailable.

Please include the affected version, reproduction steps, impact, and any suggested mitigation. Do not include real secrets, customer data, or confidential source documents in reports.

## Security considerations

- Treat generated questions and answers as untrusted model output until validated and reviewed.
- The OpenAI-compatible adapter sends the corpus provided to it to the configured endpoint.
- Keep provider API keys in environment variables or a secret manager; never commit them.
- Structural evidence validation does not prove entailment or authorization.
- The CLI skips symlinks and rejects absolute or parent-traversing source paths.
