# Architecture

## Core pipeline

1. `MarkdownDocument[]` is normalized and fingerprinted.
2. `parseMarkdownDocuments` creates heading-scoped evidence sections with section IDs and hashes.
3. A `ScenarioSynthesizer` returns candidates. The built-in OpenAI-compatible adapter implements this interface using `fetch`; custom adapters can use any provider.
4. `generateTestset` resolves each candidate's evidence to source sections and stores quote and section hashes.
5. `validateTestset` checks structure, duplicate identities/questions, source resolution, exact quote presence, and quote integrity.
6. `analyzeCorpusDrift` compares evidence and corpus fingerprints with a later corpus.

## Trust boundaries

A model response is untrusted input. Strict evidence validation ensures citations refer to exact source material, but does not prove a quote entails the expected answer. A deployment should add semantic checks and human review where correctness matters.

## Drift semantics

Section IDs include the relative source path, heading title, and occurrence count. This deliberately favors conservative invalidation over silently remapping evidence when duplicate headings shift. Editing a cited section while leaving its quote intact yields `needs-review`; removing the section or quote yields `stale`. Unanswerable cases are corpus-wide claims and are flagged for review when any corpus content changes.

## Current constraints

The initial parser is a lightweight heading parser, not a CommonMark implementation. The provider adapter passes the full parsed corpus in one request, protected by `maxInputCharacters`; chunked generation requires a design that preserves the corpus-wide context needed for valid unanswerable cases.
