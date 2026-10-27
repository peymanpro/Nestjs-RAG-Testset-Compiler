import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownDocuments } from "../src/documents.ts";
import { normalizeSourcePath } from "../src/hash.ts";
import { analyzeCorpusDrift, generateTestset, validateTestset } from "../src/testset.ts";
import { OpenAICompatibleSynthesizer, RuleBasedDemoSynthesizer } from "../src/synthesizers.ts";
import type { EvidenceSection, MarkdownDocument, SyntheticCandidate, Testset } from "../src/types.ts";

const documents: MarkdownDocument[] = [
  { path: "refunds.md", content: "# Refund policy\n\n## Eligibility\n- Customers may request a refund within 7 days of purchase.\n- Refunds for shipped orders require support review.\n- Cancelled orders are exempt from this restriction.\n" },
  { path: "support.md", content: "# Support\n\n## Availability\n- Support is available Monday through Friday.\n- Standard shipping takes 3 to 5 business days.\n" },
];

test("parses heading-scoped sections and ignores headings inside fenced code", () => {
  const sections = parseMarkdownDocuments([{ path: "guide.md", content: "Intro text\n\n```md\n# Not a heading\n```\n\n## Real heading\nBody." }]);
  assert.equal(sections.length, 2);
  assert.equal(sections[0]?.title, "(preamble)");
  assert.equal(sections[1]?.title, "Real heading");
});

test("gives repeated headings distinct section identifiers", () => {
  const sections = parseMarkdownDocuments([{ path: "policy.md", content: "## Rules\nFirst.\n\n## Rules\nSecond." }]);
  assert.equal(sections.length, 2);
  assert.notEqual(sections[0]?.id, sections[1]?.id);
  assert.equal(sections[1]?.occurrence, 2);
});

test("generates reproducible evidence-linked cases with the demo synthesizer", async () => {
  const first = await generateTestset(documents, new RuleBasedDemoSynthesizer(), { strictEvidence: true });
  const second = await generateTestset(documents, new RuleBasedDemoSynthesizer(), { strictEvidence: true });
  assert.deepEqual(first, second);
  assert.ok(first.cases.some((item) => item.type === "single-hop"));
  assert.ok(first.cases.some((item) => item.type === "multi-hop" && item.evidence.length === 2));
  assert.ok(first.cases.some((item) => item.expectedBehavior === "abstain" && item.evidence.length === 0));
  assert.equal(validateTestset(documents, first).valid, true);
});

test("fails strict generation when evidence points at a missing section", async () => {
  const badSynthesizer = { generate: async (): Promise<SyntheticCandidate[]> => [{
    question: "What is the refund window?",
    expectedAnswer: "Seven days.",
    type: "single-hop",
    expectedBehavior: "answer",
    evidence: [{ sourcePath: "absent.md", sectionTitle: "Missing", sectionId: "absent.md::Missing::1", quote: "Not here." }],
  }] };
  await assert.rejects(() => generateTestset(documents, badSynthesizer, { strictEvidence: true }), /validation error/i);
});

test("reports a broken evidence quote and corrupted quote hash", async () => {
  const set = await generateTestset(documents, new RuleBasedDemoSynthesizer());
  const mutated = structuredClone(set) as Testset;
  const target = mutated.cases.find((item) => item.evidence.length > 0)!;
  target.evidence[0]!.quote = "This quote does not exist.";
  const report = validateTestset(documents, mutated);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === "EVIDENCE_QUOTE_NOT_FOUND"));
  assert.ok(report.issues.some((issue) => issue.code === "EVIDENCE_HASH_MISMATCH"));
});

test("detects duplicate normalized questions without masking hard errors", async () => {
  const set = await generateTestset(documents, new RuleBasedDemoSynthesizer());
  const original = set.cases[0]!;
  const duplicate = { ...structuredClone(original), id: "case-duplicate", question: `  ${original.question.toUpperCase()}!!!  ` };
  const report = validateTestset(documents, { ...set, cases: [...set.cases, duplicate] });
  assert.ok(report.issues.some((issue) => issue.code === "DUPLICATE_QUESTION"));
  assert.equal(report.valid, true, "duplicate questions are warnings, not malformed evidence");
  const sameIdReport = validateTestset(documents, { ...set, cases: [...set.cases, original] });
  assert.ok(sameIdReport.issues.some((issue) => issue.code === "DUPLICATE_ID"));
});

test("marks changed evidence stale, changed context for review, unaffected cases current", async () => {
  const set = await generateTestset(documents, new RuleBasedDemoSynthesizer());
  const changed: MarkdownDocument[] = documents.map((document) => ({
    ...document,
    content: document.path === "refunds.md"
      ? document.content.replace("within 7 days of purchase", "within 10 days of purchase")
      : document.content,
  }));
  const report = analyzeCorpusDrift(changed, set);
  const refundWindow = set.cases.find((item) => item.question.startsWith("How long after purchase"))!;
  const cancelled = set.cases.find((item) => item.question.startsWith("Does this refund restriction"))!;
  const shipping = set.cases.find((item) => item.question.startsWith("How long does standard shipping"))!;
  const abstention = set.cases.find((item) => item.expectedBehavior === "abstain")!;
  assert.equal(report.entries.find((item) => item.caseId === refundWindow.id)?.status, "stale");
  assert.equal(report.entries.find((item) => item.caseId === cancelled.id)?.status, "needs-review");
  assert.equal(report.entries.find((item) => item.caseId === shipping.id)?.status, "current");
  assert.equal(report.entries.find((item) => item.caseId === abstention.id)?.status, "needs-review");
  assert.equal(report.counts.current + report.counts["needs-review"] + report.counts.stale, set.cases.length);
});

test("does not silently remap evidence when duplicate source sections shift", async () => {
  const source: MarkdownDocument[] = [{ path: "policy.md", content: "# Policy\n\n## Eligibility\nCustomers may request a refund within 7 days of purchase.\nRegion A applies.\n\n## Eligibility\nCustomers may request a refund within 7 days of purchase.\nRegion B applies.\n" }];
  const sections = parseMarkdownDocuments(source);
  const secondSection = sections[1]!;
  const set = await generateTestset(source, { generate: async () => [{
    question: "What is the refund window for region B?",
    expectedAnswer: "Customers may request a refund within 7 days of purchase.",
    type: "single-hop",
    expectedBehavior: "answer",
    evidence: [{ sourcePath: "policy.md", sectionTitle: "Eligibility", sectionId: secondSection.id, quote: "Customers may request a refund within 7 days of purchase." }],
  }] });
  const changed: MarkdownDocument[] = [{ path: "policy.md", content: "# Policy\n\n## Eligibility\nCustomers may request a refund within 7 days of purchase.\nRegion A applies.\n" }];
  assert.equal(analyzeCorpusDrift(changed, set).entries[0]?.status, "stale");
});

test("rejects unsafe and duplicate source paths", () => {
  assert.throws(() => normalizeSourcePath("../secret.md"), /relative|parent segments/i);
  assert.throws(() => parseMarkdownDocuments([{ path: "a.md", content: "One" }, { path: "a.md", content: "Two" }]), /duplicate source path/i);
});

test("flags a corpus fingerprint mismatch during validation", async () => {
  const set = await generateTestset(documents, new RuleBasedDemoSynthesizer());
  const changed = [...documents, { path: "new.md", content: "A new statement." }];
  const report = validateTestset(changed, set);
  assert.equal(report.valid, true);
  assert.ok(report.issues.some((issue) => issue.code === "CORPUS_HASH_MISMATCH"));
});

test("calls an OpenAI-compatible endpoint and parses structured candidate JSON", async () => {
  const section: EvidenceSection = parseMarkdownDocuments(documents)[0]!;
  let requestBody: Record<string, unknown> | undefined;
  const fakeFetch: typeof fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cases: [{
      question: "How long after purchase may a customer request a refund?",
      expectedAnswer: "Customers may request a refund within 7 days of purchase.",
      type: "single-hop",
      expectedBehavior: "answer",
      evidence: [{ sourcePath: section.sourcePath, sectionTitle: section.title, sectionId: section.id, quote: "Customers may request a refund within 7 days of purchase." }],
    }] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const synthesizer = new OpenAICompatibleSynthesizer({ apiKey: "test-key", model: "test-model", fetch: fakeFetch });
  const candidates = await synthesizer.generate([section]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.evidence[0]?.sectionId, section.id);
  assert.equal(requestBody?.model, "test-model");
  assert.equal(requestBody?.response_format && (requestBody.response_format as { type: string }).type, "json_object");
});

test("does not include provider response bodies in HTTP error messages", async () => {
  const fakeFetch: typeof fetch = async () => new Response("sensitive provider diagnostics", { status: 500 });
  const synthesizer = new OpenAICompatibleSynthesizer({ apiKey: "test-key", model: "test-model", fetch: fakeFetch });
  await assert.rejects(() => synthesizer.generate(parseMarkdownDocuments(documents)), (error: unknown) => {
    assert.match(String(error), /HTTP 500/);
    assert.doesNotMatch(String(error), /sensitive provider diagnostics/);
    return true;
  });
});

test("rejects oversized corpus input before making a network request", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
  const synthesizer = new OpenAICompatibleSynthesizer({ apiKey: "test-key", model: "test-model", maxInputCharacters: 10, fetch: fakeFetch });
  await assert.rejects(() => synthesizer.generate(parseMarkdownDocuments(documents)), /exceeds maxInputCharacters/);
  assert.equal(called, false);
});
