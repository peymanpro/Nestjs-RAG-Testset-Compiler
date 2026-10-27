#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { analyzeCorpusDrift, generateTestset, validateTestset } from "./testset.ts";
import { loadDocuments, readJson, writeJson } from "./io.ts";
import { OpenAICompatibleSynthesizer, RuleBasedDemoSynthesizer } from "./synthesizers.ts";
import type { Testset } from "./types.ts";

interface Arguments { command: string; values: Map<string, string>; flags: Set<string> }

function parseArgs(args: string[]): Arguments {
  const command = args[0] ?? "help";
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const item = args[index]!;
    if (!item.startsWith("--")) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    if (index + 1 < args.length && !args[index + 1]!.startsWith("--")) values.set(key, args[++index]!);
    else flags.add(key);
  }
  return { command, values, flags };
}

function required(args: Arguments, name: string): string {
  const value = args.values.get(name);
  if (!value) throw new Error(`Missing required option --${name}.`);
  return value;
}

function printHelp(): void {
  console.log(`NestJS RAG Testset Compiler\n\nCommands:\n  generate --docs <dir> --out <file> [--provider demo|openai-compatible]\n  validate --docs <dir> --dataset <file>\n  diff --docs <dir> --dataset <file> [--report-only]\n\nOpenAI-compatible provider environment:\n  NESTJS_RAG_TESTSET_API_KEY      Required API key\n  NESTJS_RAG_TESTSET_MODEL        Required model name\n  NESTJS_RAG_TESTSET_BASE_URL     Optional base URL (default: https://api.openai.com/v1)\n\nExamples:\n  nestjs-rag-testset generate --docs ./docs --out ./eval/testset.json\n  nestjs-rag-testset generate --provider openai-compatible --docs ./docs --out ./eval/testset.json\n  nestjs-rag-testset validate --docs ./docs --dataset ./eval/testset.json\n  nestjs-rag-testset diff --docs ./docs --dataset ./eval/testset.json`);
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.command === "help" || args.command === "--help" || args.command === "-h") { printHelp(); return 0; }

  if (args.command === "generate") {
    const documents = await loadDocuments(required(args, "docs"));
    const provider = args.values.get("provider") ?? "demo";
    const synthesizer = provider === "demo"
      ? new RuleBasedDemoSynthesizer()
      : provider === "openai-compatible"
        ? new OpenAICompatibleSynthesizer({
            apiKey: process.env.NESTJS_RAG_TESTSET_API_KEY ?? "",
            model: process.env.NESTJS_RAG_TESTSET_MODEL ?? "",
            ...(process.env.NESTJS_RAG_TESTSET_BASE_URL ? { baseUrl: process.env.NESTJS_RAG_TESTSET_BASE_URL } : {}),
          })
        : undefined;
    if (!synthesizer) throw new Error(`Unsupported provider: ${provider}. Use demo or openai-compatible.`);
    const testset = await generateTestset(documents, synthesizer, { strictEvidence: true });
    await writeJson(required(args, "out"), testset);
    console.log(JSON.stringify({ output: required(args, "out"), cases: testset.cases.length, corpusHash: testset.corpusHash }, null, 2));
    return 0;
  }

  if (args.command === "validate") {
    const documents = await loadDocuments(required(args, "docs"));
    const testset = await readJson<Testset>(required(args, "dataset"));
    const report = validateTestset(documents, testset);
    console.log(JSON.stringify(report, null, 2));
    return report.valid ? 0 : 1;
  }

  if (args.command === "diff") {
    const documents = await loadDocuments(required(args, "docs"));
    const testset = await readJson<Testset>(required(args, "dataset"));
    const report = analyzeCorpusDrift(documents, testset);
    console.log(JSON.stringify(report, null, 2));
    const hasDrift = report.counts.stale > 0 || report.counts["needs-review"] > 0;
    return hasDrift && !args.flags.has("report-only") ? 1 : 0;
  }

  throw new Error(`Unknown command: ${args.command}. Run nestjs-rag-testset help.`);
}

const executedFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === executedFile) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "An unexpected error occurred.");
    process.exitCode = 1;
  });
}
