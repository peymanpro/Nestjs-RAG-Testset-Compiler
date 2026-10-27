# Architecture

## Core pipeline

1. `MarkdownDocument[]` is normalized and fingerprinted.
2. `parseMarkdownDocuments` creates heading-scoped evidence sections with section IDs and hashes.
3. A `ScenarioSynthesizer` returns candidates. The built-in OpenAI-compatible adapter implements this interface using `fetch`; custom adapters can use any provider.
4. `generateTestset` resolves each candidate's evidence to source sections and stores quote and section hashes. Optional claims are assigned stable IDs and text hashes, with claim-specific evidence references.
5. `validateTestset` checks structure, duplicate identities/questions, source resolution, exact quote presence, quote integrity, and any supplied claim references. Claim fields are additive and do not invalidate older schema-version 1 test sets.
6. `analyzeCorpusDrift` compares evidence, claim dependencies, and corpus fingerprints with a later corpus.
7. `analyzeChangeImpact` compares baseline and current section sets, maps additions/modifications/removals to direct evidence dependencies, then applies a deterministic lexical-overlap heuristic to surface possible cross-document effects.

## Trust boundaries

A model response is untrusted input. Strict evidence validation ensures citations refer to exact source material, but does not prove a quote entails the expected answer. A deployment should add semantic checks and human review where correctness matters.

## Drift semantics

Section IDs include the relative source path, heading title, and occurrence count. This deliberately favors conservative invalidation over silently remapping evidence when duplicate headings shift. Editing a cited section while leaving its quote intact yields `needs-review`; removing the section or quote yields `stale`. Unanswerable cases are corpus-wide claims and are flagged for review when any corpus content changes.

## Change-impact semantics

The impact engine returns `unaffected`, `needs-review`, or `stale`, along with a recommended `keep`, `review`, or `regenerate` action. A directly cited section change is prioritized over lexical similarity. New or modified sections that share relevant terms with a case are flagged for review even when they are not directly cited. Previously unanswerable cases are reviewed after any corpus change. The report includes whether its test set fingerprint matches the supplied baseline.

This is deterministic triage, not a semantic guarantee: lexical similarity can miss paraphrases and can over-report unrelated cases. `unaffected` means no signal was found—not proof of independence. Stale cases may require regeneration or manual repair.

## Current constraints

The initial parser is a lightweight heading parser, not a CommonMark implementation. The provider adapter passes the full parsed corpus in one request, protected by `maxInputCharacters`; chunked generation requires a design that preserves the corpus-wide context needed for valid unanswerable cases.
