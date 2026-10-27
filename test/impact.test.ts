import assert from "node:assert/strict";
import test from "node:test";
import { analyzeChangeImpact } from "../src/impact.ts";
import { parseMarkdownDocuments } from "../src/documents.ts";
import { generateTestset, validateTestset } from "../src/testset.ts";
import type { MarkdownDocument, SyntheticCandidate, Testset } from "../src/types.ts";

const baseline: MarkdownDocument[] = [
  { path: "refunds.md", content: "# Refund policy\n\n## Eligibility\nCustomers may request a refund within 7 days of purchase.\n" },
  { path: "shipping.md", content: "# Shipping\n\n## Delivery window\nStandard shipping takes 3 to 5 business days.\n" },
];

async function createTestset(documents: MarkdownDocument[]): Promise<Testset> {
  const sections = parseMarkdownDocuments(documents);
  const refund = sections.find((section) => section.sourcePath === "refunds.md")!;
  const shipping = sections.find((section) => section.sourcePath === "shipping.md")!;
  const refundEvidence = {
    sourcePath: refund.sourcePath,
    sectionTitle: refund.title,
    sectionId: refund.id,
    quote: "Customers may request a refund within 7 days of purchase.",
  };
  const shippingEvidence = {
    sourcePath: shipping.sourcePath,
    sectionTitle: shipping.title,
    sectionId: shipping.id,
    quote: "Standard shipping takes 3 to 5 business days.",
  };
  const candidates: SyntheticCandidate[] = [
    {
      question: "What is the refund request window?",
      expectedAnswer: "Customers may request a refund within 7 days.",
      type: "single-hop",
      expectedBehavior: "answer",
      evidence: [refundEvidence],
      claims: [{ text: "The refund request window is 7 days.", kind: "temporal", evidence: [refundEvidence] }],
    },
    {
      question: "How long does standard shipping take?",
      expectedAnswer: "Standard shipping takes 3 to 5 business days.",
      type: "single-hop",
      expectedBehavior: "answer",
      evidence: [shippingEvidence],
      claims: [{ text: "Standard shipping takes 3 to 5 business days.", kind: "temporal", evidence: [shippingEvidence] }],
    },
    {
      question: "Does the policy guarantee free overnight shipping?",
      expectedAnswer: "The corpus does not establish whether free overnight shipping is available.",
      type: "unanswerable",
      expectedBehavior: "abstain",
      evidence: [],
      claims: [],
    },
  ];
  return generateTestset(documents, { generate: async () => candidates }, { strictEvidence: true });
}

test("adds stable claims linked to validated evidence without breaking schema version 1", async () => {
  const first = await createTestset(baseline);
  const second = await createTestset(baseline);
  assert.equal(first.schemaVersion, 1);
  assert.deepEqual(first, second);
  const refundCase = first.cases.find((item) => item.question.startsWith("What is the refund"))!;
  assert.equal(refundCase.claims?.length, 1);
  assert.match(refundCase.claims![0]!.id, /^claim-/);
  assert.match(refundCase.claims![0]!.textHash, /^sha256:/);
  assert.equal(refundCase.claims![0]!.evidence[0]!.quote, refundCase.evidence[0]!.quote);
  assert.equal(validateTestset(baseline, first).valid, true);
});

test("validates claim text integrity and exact evidence provenance", async () => {
  const set = await createTestset(baseline);
  const mutated = structuredClone(set) as Testset;
  mutated.cases[0]!.claims![0]!.text = "The refund request window is 30 days.";
  const report = validateTestset(baseline, mutated);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === "CLAIM_HASH_MISMATCH"));
});

test("reports stale direct dependencies, unaffected unrelated cases, and corpus-wide abstention review", async () => {
  const set = await createTestset(baseline);
  const changed = baseline.map((document) => ({
    ...document,
    content: document.path === "refunds.md"
      ? document.content.replace("within 7 days of purchase", "within 14 days of purchase")
      : document.content,
  }));
  const report = analyzeChangeImpact(baseline, changed, set);
  assert.equal(report.testsetMatchesPreviousCorpus, true);
  assert.equal(report.sectionChanges.length, 1);
  assert.equal(report.sectionChanges[0]?.kind, "modified");
  const refundCase = set.cases.find((item) => item.question.startsWith("What is the refund"))!;
  const shippingCase = set.cases.find((item) => item.question.startsWith("How long does standard"))!;
  const abstention = set.cases.find((item) => item.expectedBehavior === "abstain")!;
  const refundEntry = report.entries.find((item) => item.caseId === refundCase.id)!;
  const shippingEntry = report.entries.find((item) => item.caseId === shippingCase.id)!;
  const abstentionEntry = report.entries.find((item) => item.caseId === abstention.id)!;
  assert.equal(refundEntry.status, "stale");
  assert.equal(refundEntry.recommendedAction, "regenerate");
  assert.deepEqual(refundEntry.affectedClaimIds, [refundCase.claims![0]!.id]);
  assert.equal(shippingEntry.status, "unaffected");
  assert.equal(shippingEntry.recommendedAction, "keep");
  assert.equal(abstentionEntry.status, "needs-review");
  assert.equal(abstentionEntry.recommendedAction, "review");
  assert.equal(report.counts.stale, 1);
  assert.equal(report.counts["needs-review"], 1);
  assert.equal(report.counts.unaffected, 1);
});

test("flags changed context for review even when the original evidence quote remains", async () => {
  const set = await createTestset(baseline);
  const changed = baseline.map((document) => ({
    ...document,
    content: document.path === "refunds.md"
      ? document.content.replace(
          "Customers may request a refund within 7 days of purchase.",
          "Customers may request a refund within 7 days of purchase. Requests with incomplete documentation may be denied.",
        )
      : document.content,
  }));
  const report = analyzeChangeImpact(baseline, changed, set);
  const refundCase = set.cases.find((item) => item.question.startsWith("What is the refund"))!;
  const entry = report.entries.find((item) => item.caseId === refundCase.id)!;
  assert.equal(entry.status, "needs-review");
  assert.equal(entry.recommendedAction, "review");
  assert.ok(entry.reasons.some((reason) => /surrounding context/i.test(reason)));
});

test("uses lexical overlap to flag likely cross-document impacts", async () => {
  const set = await createTestset(baseline);
  const changed = [...baseline, {
    path: "exceptions.md",
    content: "# Refund exceptions\n\n## Eligibility\nRefund requests may be denied when a purchase has incomplete documentation.\n",
  }];
  const report = analyzeChangeImpact(baseline, changed, set);
  const refundCase = set.cases.find((item) => item.question.startsWith("What is the refund"))!;
  const entry = report.entries.find((item) => item.caseId === refundCase.id)!;
  assert.equal(entry.status, "needs-review");
  assert.ok(entry.relatedSectionIds.some((id) => id.startsWith("exceptions.md::")));
});

test("does not report impact when the baseline and current corpora are identical", async () => {
  const set = await createTestset(baseline);
  const report = analyzeChangeImpact(baseline, baseline, set);
  assert.equal(report.testsetMatchesPreviousCorpus, true);
  assert.deepEqual(report.counts, { unaffected: 3, "needs-review": 0, stale: 0 });
  assert.equal(report.sectionChanges.length, 0);
});
