## [0.1.1](https://github.com/peymanpro/Nestjs-RAG-Testset-Compiler/compare/v0.1.0...v0.1.1) (2026-10-27)


### Bug Fixes

* **ci:** upgrade semantic-release for npm OIDC publishing ([d7e9f50](https://github.com/peymanpro/Nestjs-RAG-Testset-Compiler/commit/d7e9f503ca73c7b693809d741a06feaff2019ae7))
* **package:** keep CLI bin valid with npm 12 ([53796d4](https://github.com/peymanpro/Nestjs-RAG-Testset-Compiler/commit/53796d49f1da9807c0def9d7e5171920892f91eb))

# Changelog

All notable changes to this project are documented here.

## 0.1.0 - 2026-10-27

- Add evidence-linked test-set data types and Markdown section parsing.
- Add structural validation for evidence citations, hashes, IDs, and duplicate questions.
- Add corpus drift analysis with `current`, `needs-review`, and `stale` statuses.
- Add deterministic offline demo generation and an OpenAI-compatible synthesis adapter.
- Add CLI commands for generation, validation, and drift reports.
- Add optional NestJS dynamic module and service.
- Add npm/pnpm CI, package build checks, and release publishing workflow.
- Use NestJS-prefixed package and CLI names before the first public release.
