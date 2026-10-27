# Contributing

Thanks for helping improve RAG Testset Compiler.

## Before opening a pull request

1. Open an issue for a substantial feature or behavior change.
2. Keep pull requests focused and commits small.
3. Add or update tests for behavioral changes.
4. Update README or `docs/` when the public API or CLI changes.
5. Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run check:package` (or the pnpm equivalents).
6. Do not commit credentials, provider responses containing private corpus data, generated `dist/`, or local environment files.

## Design principles

- Keep core runtime dependencies at zero where practical.
- Keep provider integration behind `ScenarioSynthesizer`.
- Do not treat model-generated identity, source paths, section IDs, or evidence as trusted until validated.
- Preserve deterministic behavior for hashes, source parsing, test-set validation, and drift reports.
- Document where checks are structural rather than semantic.

## Commit style

Use short imperative messages, for example `feat: add evidence validator` or `test: cover duplicate heading drift`.
