# Change-impact analysis

## Purpose

`analyzeChangeImpact(previousDocuments, currentDocuments, testset)` compares two corpus snapshots and identifies regression-test cases that should be kept, reviewed, or regenerated. Unlike corpus drift analysis, it uses both snapshots to list added, modified, and removed sections and traces those changes to test-case evidence and optional claim records.

## API

```ts
import { analyzeChangeImpact } from "nestjs-rag-testset-compiler";

const report = analyzeChangeImpact(previousDocuments, currentDocuments, testset);

console.log(report.sectionChanges);
console.log(report.counts);

for (const entry of report.entries) {
  if (entry.status !== "unaffected") {
    console.log(entry.caseId, entry.recommendedAction, entry.reasons);
  }
}
```

The report includes corpus fingerprints, a `testsetMatchesPreviousCorpus` flag, section-level changes, per-case status, related section IDs, affected claim IDs, and explicit limitations. A mismatched baseline flag is important: the comparison cannot reconstruct corpus changes that occurred before the supplied baseline snapshot.

## Statuses and actions

| Status | Meaning | Recommended action |
| --- | --- | --- |
| `unaffected` | No direct evidence change or lexical relevance signal was found. | `keep` |
| `needs-review` | A cited section changed, a related section may affect the case, or a previously unanswerable question must be rechecked. | `review` |
| `stale` | Required evidence disappeared or no longer matches its source. | `regenerate` |

The `stale` status takes precedence over review. A reviewer may decide to regenerate a case or repair it manually; the engine does not call an LLM or mutate datasets automatically.

## CLI

Compare a baseline directory and a changed directory:

```bash
nestjs-rag-testset impact --before ./docs-before --after ./docs --dataset ./eval/testset.json --out ./eval/impact-report.json
```

The command prints the detailed report to standard output. When `--out` is provided, it also writes the full JSON report to that path. It exits with code 1 when any case is stale or needs review; add `--report-only` to collect results without failing the process.

A repository smoke-test uses the included fixtures:

```bash
npm run demo
npm run impact
```

## Claim provenance

A `SyntheticCandidate` may contain `claims`. Each claim has natural-language text, an optional kind (`fact`, `condition`, `exception`, `temporal`, `numeric`, `causal`, or `other`), and one or more evidence quotes. Generated claims receive a deterministic ID and a text hash; their evidence references retain source path, section ID, quote hash, and section hash. Validation checks claim text integrity and the validity of each citation.

Claim metadata is optional and additive. Existing `schemaVersion: 1` datasets without claims remain supported. Claims are traceability metadata, not a proof that the claim is entailed by its evidence. The demo synthesizer's claim records illustrate the shape; model-generated claims still need semantic review.

## Impact heuristic and limitations

1. Exact evidence links are checked first. A change to a linked section makes the case a review candidate; a missing section or quote makes it stale.
2. Added or modified sections are compared with the question, expected answer, and claim text using a deterministic token-overlap heuristic. Likely cross-document effects are flagged for review even without a direct citation.
3. Previously unanswerable cases are reviewed whenever the corpus fingerprint changes, because a new source may answer them.

The heuristic is intentionally dependency-light and does not use embeddings, an LLM judge, or a vector database. It can miss semantic relationships expressed with different wording and can flag cases that share terms but are unrelated. Therefore, `unaffected` is not proof that a case is semantically independent. Use the report to prioritize review, not as a correctness oracle.

The engine does not automatically regenerate cases or run your production retriever/generator. Those are deliberately separate steps so corpus impact, test-set mutation, and evaluation results remain auditable.
