# RAG Testset Compiler is a TypeScript library for evidence-linked RAG regression tests.

[![CI](https://github.com/peymanpro/RAG-Testset-Compiler/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/peymanpro/RAG-Testset-Compiler/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-brightgreen)](https://nodejs.org/)

**Turn a document corpus into an evidence-linked RAG regression test set, validate every citation, and identify cases affected by corpus changes.** The core is provider-agnostic TypeScript; an OpenAI-compatible adapter and an optional NestJS module are included.

> **Status: Alpha.** APIs may change before `1.0.0`. Evidence and drift checks are deterministic, but they do not prove semantic entailment or that a RAG system's answer is correct. Review the limitations below before production use.

## Why this library exists

Synthetic RAG test generation already exists in projects such as Ragas and Promptfoo. RAG Testset Compiler focuses on the lifecycle after generation: every answerable case is linked to exact source evidence, its originating section is fingerprinted, and corpus changes produce explicit `current`, `needs-review`, or `stale` outcomes.

The project does not claim to be the first test-set generator or a replacement for established evaluation frameworks. Its product hypothesis is that evidence provenance and test-set maintenance can be a useful, framework-friendly TypeScript building block.

## Features

- **Evidence-linked test cases:** source path, section ID, exact quote, quote hash, and section fingerprint.
- **Corpus drift analysis:** detect removed sections or quotes, identify changed context, and re-review abstention cases after any corpus change.
- **Validation:** detect missing or ambiguous sources, broken quotes, hash mismatches, empty cases, duplicate IDs, and normalized duplicate questions.
- **Provider-agnostic synthesis:** implement the small `ScenarioSynthesizer` interface for any model or generation approach.
- **OpenAI-compatible adapter:** use a chat-completions endpoint with native `fetch`; no runtime provider SDK is required.
- **NestJS integration:** optional dynamic module and injectable service under `rag-testset-compiler/nestjs`.
- **CLI:** generate, validate, and diff JSON test sets; CI-friendly exit codes.
- **npm and pnpm:** use either package manager for development and installation.
- **Offline demo:** deterministic sample generation runs without API keys or network access.

## Requirements

- Node.js `>=22.13.0`.
- npm or pnpm. The repository currently pins pnpm `12.15.0` for maintainers; consumers may install the package with npm or pnpm.

## Installation

```bash
npm install rag-testset-compiler
# or
pnpm add rag-testset-compiler
```

For the NestJS adapter, install NestJS in your application as well. The peer dependency is optional for users of the core library.

```bash
npm install @nestjs/common
# or
pnpm add @nestjs/common
```

## Quick start

```ts
import {
  generateTestset,
  validateTestset,
  analyzeCorpusDrift,
  OpenAICompatibleSynthesizer,
} from "rag-testset-compiler";
import type { MarkdownDocument } from "rag-testset-compiler";

const documents: MarkdownDocument[] = [
  {
    path: "refunds.md",
    content: `# Refund policy\n\n## Eligibility\nCustomers may request a refund within 7 days of purchase.`,
  },
];

const synthesizer = new OpenAICompatibleSynthesizer({
  apiKey: process.env.RAG_TESTSET_API_KEY!,
  model: process.env.RAG_TESTSET_MODEL!,
  // Optional: use any provider with a compatible /chat/completions endpoint.
  baseUrl: process.env.RAG_TESTSET_BASE_URL,
});

const testset = await generateTestset(documents, synthesizer, { strictEvidence: true });
const validation = validateTestset(documents, testset);
if (!validation.valid) throw new Error(JSON.stringify(validation.issues));

// Store the JSON test set in version control. Re-run after source changes.
const drift = analyzeCorpusDrift(documents, testset);
console.log(drift.counts);
```

The provider returns candidate cases. `generateTestset` attaches verified section metadata and hashes; `strictEvidence: true` rejects cases with missing or ambiguous evidence. This does not establish semantic correctness, so keep human review and evaluation of the actual RAG system in your workflow.

## CLI

The CLI accepts Markdown (`.md`) and text (`.txt`) files recursively. The default `demo` provider is deterministic and recognizes only a small set of sample policy patterns; it is for smoke tests and examples, not general-purpose generation.

```bash
# Generate the included demo test set without an API key
npm run demo
# or
pnpm demo

# Validate the generated file against the current corpus
npm run validate

# Report drift without returning a failing exit code
npm run diff

# Compare against the changed-corpus fixture; exit code 1 is expected
npm run diff:changed
```

Use the LLM adapter for general-purpose generation:

```bash
RAG_TESTSET_API_KEY=... \
RAG_TESTSET_MODEL=your-model \
RAG_TESTSET_BASE_URL=https://api.openai.com/v1 \
node --experimental-strip-types src/cli.ts generate \
  --provider openai-compatible --docs ./docs --out ./eval/rag-testset.json
```

On Windows PowerShell, set the environment variables with `$env:RAG_TESTSET_API_KEY = "..."` and `$env:RAG_TESTSET_MODEL = "..."` before invoking the command.

CLI commands:

```text
rag-testset generate --docs <dir> --out <file> [--provider demo|openai-compatible]
rag-testset validate --docs <dir> --dataset <file>
rag-testset diff --docs <dir> --dataset <file> [--report-only]
rag-testset help
```

`validate` returns a non-zero exit code when it finds an error. `diff` returns a non-zero exit code when any case is stale or needs review, unless `--report-only` is set.

## NestJS integration

```ts
import { Module } from "@nestjs/common";
import { RagTestsetModule } from "rag-testset-compiler/nestjs";
import { OpenAICompatibleSynthesizer } from "rag-testset-compiler";

@Module({
  imports: [
    RagTestsetModule.register({
      synthesizer: new OpenAICompatibleSynthesizer({
        apiKey: process.env.RAG_TESTSET_API_KEY!,
        model: process.env.RAG_TESTSET_MODEL!,
      }),
      strictEvidence: true,
    }),
  ],
})
export class EvaluationModule {}
```

Inject `RagTestsetService` into an application service and call `generate(documents)`, `validate(documents, testset)`, or `diff(documents, testset)`. Keep model calls and source access scoped to the task; do not expose API keys in logs.

## Implement a custom synthesizer

```ts
import type {
  EvidenceSection,
  ScenarioSynthesizer,
  SyntheticCandidate,
} from "rag-testset-compiler";

export class MySynthesizer implements ScenarioSynthesizer {
  async generate(sections: EvidenceSection[]): Promise<SyntheticCandidate[]> {
    // Ask your preferred model to create cases with exact quotes and section IDs.
    // Validate model output before returning it.
    return [];
  }
}
```

For answerable cases, each evidence item must identify a real `sectionId` and include an exact quote from that section. Unanswerable cases should use `expectedBehavior: "abstain"` and an empty evidence array. `strictEvidence` checks structural and lexical provenance; it cannot independently establish entailment.

## Test-case lifecycle

Each generated case records a stable ID, question, expected answer, scenario type, expected behavior, evidence references, and the corpus fingerprint at generation time. Each evidence reference records a source path, section ID, exact quote, quote hash, and section hash.

- `current`: each cited section and quote remains unchanged.
- `needs-review`: the quoted evidence remains but its surrounding section has changed, or an abstention case needs rechecking because the corpus changed.
- `stale`: a referenced section or quote disappeared, or an answerable case has no evidence.

A `stale` status is a conservative maintenance signal—not proof that the answer is false. Similarly, `current` means the tracked evidence did not change; it does not mean the generated answer is semantically correct.

## Development

```bash
# npm
npm install
npm run typecheck
npm test
npm run build
npm run check:package

# pnpm
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check:package
```

The GitHub Actions workflow tests npm and pnpm across the supported Node.js release lines. Build output and package contents are generated from `src/` during `npm run build` / `pnpm build`.

## Security and privacy

The OpenAI-compatible adapter sends the selected corpus sections to the configured endpoint. Review your provider's data-handling terms before using confidential documents. API keys are passed through headers and are not intentionally included in error messages. Configure endpoints only for trusted providers. Source paths must be relative; symlinks are skipped by the CLI loader.

See [SECURITY.md](SECURITY.md) for vulnerability reporting guidance.

## Limitations

- Semantic correctness and entailment are not provable with exact-quote checks alone.
- The demo synthesizer uses hand-written templates and only recognizes a few English-language sample patterns.
- The Markdown parser is intentionally lightweight, not a complete CommonMark implementation.
- The OpenAI-compatible adapter sends the full parsed corpus in one request and enforces a configurable character limit; very large corpora need pre-filtering or a future batching strategy.
- There is no vector database, embedding model, PDF parser, retrieval engine, or hosted dashboard in this package.
- The package is Alpha; review generated cases before using them as release gates.

## License

MIT. See [LICENSE](LICENSE).
