import { parseMarkdownDocuments } from "./documents.ts";
import { corpusFingerprint, normalizeQuestion, normalizeText, normalizeSourcePath, sha256 } from "./hash.ts";
import type {
  ClaimInput, ClaimReference, DriftEntry, DriftReport, DriftStatus, EvidenceInput, EvidenceReference, GenerateTestsetOptions,
  MarkdownDocument, ScenarioSynthesizer, SyntheticCandidate, TestCase, Testset,
  ValidationIssue, ValidationResult,
} from "./types.ts";

function lookupSection(
  sections: ReturnType<typeof parseMarkdownDocuments>,
  sourcePath: string,
  title: string,
  id?: string,
) {
  const normalizedPath = normalizeSourcePath(sourcePath);
  if (id) return sections.find((section) => section.id === id && section.sourcePath === normalizedPath && section.title === title);
  const matches = sections.filter((section) => section.sourcePath === normalizedPath && section.title === title);
  return matches.length === 1 ? matches[0] : undefined;
}

function stableCaseId(candidate: SyntheticCandidate): string {
  const evidenceKey = candidate.evidence
    .map((item) => `${item.sourcePath}\0${item.sectionId ?? item.sectionTitle}\0${normalizeText(item.quote)}`)
    .sort()
    .join("\n");
  return `case-${sha256(`${normalizeQuestion(candidate.question)}\n${evidenceKey}`).slice(7, 19)}`;
}


function resolveEvidenceReference(
  sections: ReturnType<typeof parseMarkdownDocuments>,
  input: EvidenceInput,
): EvidenceReference {
  const section = lookupSection(sections, input.sourcePath, input.sectionTitle, input.sectionId);
  return {
    ...input,
    sourcePath: normalizeSourcePath(input.sourcePath),
    sectionId: section?.id ?? input.sectionId ?? "",
    sectionHashAtGeneration: section?.contentHash ?? "",
    quoteHash: sha256(normalizeText(input.quote)),
  };
}

function stableClaimId(claim: ClaimInput, evidence: EvidenceReference[]): string {
  const evidenceKey = evidence
    .map((item) => `${item.sourcePath}\0${item.sectionId}\0${item.quoteHash}`)
    .sort()
    .join("\n");
  return `claim-${sha256(`${normalizeQuestion(claim.text)}\n${evidenceKey}`).slice(7, 19)}`;
}

export async function generateTestset(
  documents: MarkdownDocument[],
  synthesizer: ScenarioSynthesizer,
  options: GenerateTestsetOptions = {},
): Promise<Testset> {
  const sections = parseMarkdownDocuments(documents);
  const corpusHash = corpusFingerprint(documents);
  const candidates = await synthesizer.generate(sections);
  const cases: TestCase[] = candidates.map((candidate) => {
    const evidence = candidate.evidence.map((input) => resolveEvidenceReference(sections, input));
    const claims: ClaimReference[] | undefined = candidate.claims?.map((claim) => {
      const claimEvidence = claim.evidence.map((input) => resolveEvidenceReference(sections, input));
      return {
        id: stableClaimId(claim, claimEvidence),
        text: claim.text.trim(),
        ...(claim.kind ? { kind: claim.kind } : {}),
        evidence: claimEvidence,
        textHash: sha256(normalizeText(claim.text)),
      };
    });
    return {
      id: stableCaseId(candidate),
      question: candidate.question.trim(),
      expectedAnswer: candidate.expectedAnswer.trim(),
      type: candidate.type,
      expectedBehavior: candidate.expectedBehavior,
      evidence,
      ...(claims ? { claims } : {}),
      corpusHashAtGeneration: corpusHash,
    };
  });

  const result: Testset = { schemaVersion: 1, corpusHash, cases };
  if (options.strictEvidence) {
    const validation = validateTestset(documents, result);
    const evidenceErrors = validation.issues.filter((issue) => issue.severity === "error");
    if (evidenceErrors.length > 0) {
      throw new Error(`Generated test set contains ${evidenceErrors.length} validation error(s): ${evidenceErrors.map((issue) => issue.code).join(", ")}`);
    }
  }
  return result;
}

export function validateTestset(documents: MarkdownDocument[], testset: Testset): ValidationResult {
  const sections = parseMarkdownDocuments(documents);
  const currentCorpusHash = corpusFingerprint(documents);
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();
  const questions = new Map<string, string>();

  if (testset.schemaVersion !== 1) {
    issues.push({ code: "UNSUPPORTED_SCHEMA_VERSION", severity: "error", message: `Unsupported schema version: ${String(testset.schemaVersion)}` });
  }
  if (!Array.isArray(testset.cases)) {
    issues.push({ code: "INVALID_CASES_COLLECTION", severity: "error", message: "Test set cases must be an array." });
    return { valid: false, checkedCases: 0, issues };
  }
  if (testset.corpusHash !== currentCorpusHash) {
    issues.push({ code: "CORPUS_HASH_MISMATCH", severity: "warning", message: "The current corpus differs from the corpus used to generate this test set; run drift analysis." });
  }


  const validateEvidenceReferences = (
    references: EvidenceReference[],
    caseId: string,
    codePrefix: "EVIDENCE" | "CLAIM_EVIDENCE",
  ): void => {
    for (const evidence of references) {
      let section;
      try {
        section = lookupSection(sections, evidence.sourcePath, evidence.sectionTitle, evidence.sectionId);
      } catch {
        section = undefined;
      }
      if (!section) {
        issues.push({ code: `${codePrefix}_SECTION_MISSING`, severity: "error", caseId, message: `Evidence section not found or ambiguous: ${evidence.sourcePath} :: ${evidence.sectionTitle}.` });
        continue;
      }
      if (!section.content.includes(evidence.quote)) {
        issues.push({ code: `${codePrefix}_QUOTE_NOT_FOUND`, severity: "error", caseId, message: `Evidence quote no longer exists verbatim in ${evidence.sourcePath} :: ${evidence.sectionTitle}.` });
      }
      if (sha256(normalizeText(evidence.quote)) !== evidence.quoteHash) {
        issues.push({ code: `${codePrefix}_HASH_MISMATCH`, severity: "error", caseId, message: "Stored evidence quote hash does not match the stored quote." });
      }
    }
  };

  for (const testCase of testset.cases) {
    if (ids.has(testCase.id)) issues.push({ code: "DUPLICATE_ID", severity: "error", caseId: testCase.id, message: `Duplicate test-case ID: ${testCase.id}` });
    ids.add(testCase.id);

    const normalizedQuestion = normalizeQuestion(testCase.question);
    const priorQuestionId = questions.get(normalizedQuestion);
    if (normalizedQuestion && priorQuestionId) {
      issues.push({ code: "DUPLICATE_QUESTION", severity: "warning", caseId: testCase.id, message: `Question duplicates test case ${priorQuestionId} after normalization.` });
    } else if (normalizedQuestion) questions.set(normalizedQuestion, testCase.id);

    if (!testCase.question.trim() || !testCase.expectedAnswer.trim()) {
      issues.push({ code: "EMPTY_QUESTION_OR_ANSWER", severity: "error", caseId: testCase.id, message: "Question and expected answer must both be non-empty." });
    }
    if (testCase.expectedBehavior === "answer" && testCase.evidence.length === 0) {
      issues.push({ code: "EVIDENCE_REQUIRED", severity: "error", caseId: testCase.id, message: "Answerable test cases must reference at least one evidence quote." });
    }
    if (testCase.expectedBehavior === "abstain" && testCase.evidence.length > 0) {
      issues.push({ code: "ABSTENTION_HAS_EVIDENCE", severity: "warning", caseId: testCase.id, message: "An abstention case includes evidence; review whether the expected behavior is consistent." });
    }
    if (!["single-hop", "multi-hop", "unanswerable", "custom"].includes(testCase.type)) {
      issues.push({ code: "UNKNOWN_SCENARIO_TYPE", severity: "error", caseId: testCase.id, message: `Unknown scenario type: ${String(testCase.type)}` });
    }
    if (!["answer", "abstain"].includes(testCase.expectedBehavior)) {
      issues.push({ code: "UNKNOWN_EXPECTED_BEHAVIOR", severity: "error", caseId: testCase.id, message: `Unknown expected behavior: ${String(testCase.expectedBehavior)}` });
    }

    validateEvidenceReferences(testCase.evidence, testCase.id, "EVIDENCE");

    if (testCase.claims !== undefined) {
      if (!Array.isArray(testCase.claims)) {
        issues.push({ code: "INVALID_CLAIMS_COLLECTION", severity: "error", caseId: testCase.id, message: "Test-case claims must be an array when provided." });
        continue;
      }
      const claimIds = new Set<string>();
      const claimTexts = new Set<string>();
      for (const claim of testCase.claims) {
        if (!claim || typeof claim !== "object") {
          issues.push({ code: "INVALID_CLAIM", severity: "error", caseId: testCase.id, message: "Each claim must be an object." });
          continue;
        }
        if (!claim.text?.trim()) {
          issues.push({ code: "EMPTY_CLAIM_TEXT", severity: "error", caseId: testCase.id, message: "Claim text must not be empty." });
        }
        if (claimIds.has(claim.id)) {
          issues.push({ code: "DUPLICATE_CLAIM_ID", severity: "error", caseId: testCase.id, message: `Duplicate claim ID: ${claim.id}.` });
        }
        claimIds.add(claim.id);
        const normalizedClaim = normalizeQuestion(claim.text ?? "");
        if (normalizedClaim && claimTexts.has(normalizedClaim)) {
          issues.push({ code: "DUPLICATE_CLAIM", severity: "warning", caseId: testCase.id, message: "A claim duplicates another claim in the same test case after normalization." });
        }
        if (normalizedClaim) claimTexts.add(normalizedClaim);
        if (sha256(normalizeText(claim.text ?? "")) !== claim.textHash) {
          issues.push({ code: "CLAIM_HASH_MISMATCH", severity: "error", caseId: testCase.id, message: "Stored claim text hash does not match the claim text." });
        }
        if (claim.kind !== undefined && !["fact", "condition", "exception", "temporal", "numeric", "causal", "other"].includes(claim.kind)) {
          issues.push({ code: "UNKNOWN_CLAIM_KIND", severity: "error", caseId: testCase.id, message: `Unsupported claim kind: ${String(claim.kind)}.` });
        }
        if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) {
          issues.push({ code: "CLAIM_EVIDENCE_REQUIRED", severity: "error", caseId: testCase.id, message: `Claim ${claim.id || "(unknown)"} must cite at least one evidence quote.` });
        } else {
          validateEvidenceReferences(claim.evidence, testCase.id, "CLAIM_EVIDENCE");
        }
      }
    }
  }
  return { valid: !issues.some((issue) => issue.severity === "error"), checkedCases: testset.cases.length, issues };
}

export function analyzeCorpusDrift(documents: MarkdownDocument[], testset: Testset): DriftReport {
  const sections = parseMarkdownDocuments(documents);
  const currentCorpusHash = corpusFingerprint(documents);
  const entries: DriftEntry[] = testset.cases.map((testCase) => {
    const reasons: string[] = [];
    let status: DriftStatus = "current";

    if (testCase.expectedBehavior === "abstain") {
      if (currentCorpusHash !== testCase.corpusHashAtGeneration) {
        status = "needs-review";
        reasons.push("The corpus changed; re-check that no current source answers this previously unanswerable question.");
      }
      return { caseId: testCase.id, question: testCase.question, status, reasons };
    }
    if (testCase.evidence.length === 0) {
      return { caseId: testCase.id, question: testCase.question, status: "stale", reasons: ["Answerable test case has no evidence references."] };
    }

    let needsReview = false;
    const dependencies = [...testCase.evidence, ...(testCase.claims ?? []).flatMap((claim) => claim.evidence ?? [])];
    for (const evidence of dependencies) {
      const section = lookupSection(sections, evidence.sourcePath, evidence.sectionTitle, evidence.sectionId);
      if (!section) {
        status = "stale";
        reasons.push(`Evidence section was removed or is ambiguous: ${evidence.sourcePath} :: ${evidence.sectionTitle}.`);
        continue;
      }
      if (!section.content.includes(evidence.quote)) {
        status = "stale";
        reasons.push(`Evidence quote was removed or changed: ${evidence.sourcePath} :: ${evidence.sectionTitle}.`);
        continue;
      }
      if (section.contentHash !== evidence.sectionHashAtGeneration) {
        needsReview = true;
        reasons.push(`The evidence section changed but the quote remains; review surrounding context: ${evidence.sourcePath} :: ${evidence.sectionTitle}.`);
      }
    }
    if (status !== "stale" && needsReview) status = "needs-review";
    if (status === "current") reasons.push("All referenced sections and evidence quotes are unchanged.");
    return { caseId: testCase.id, question: testCase.question, status, reasons };
  });

  const counts: DriftReport["counts"] = {
    current: entries.filter((entry) => entry.status === "current").length,
    "needs-review": entries.filter((entry) => entry.status === "needs-review").length,
    stale: entries.filter((entry) => entry.status === "stale").length,
  };
  return { corpusHash: currentCorpusHash, counts, entries };
}
