import { parseMarkdownDocuments } from "./documents.ts";
import { corpusFingerprint, normalizeText } from "./hash.ts";
import { analyzeCorpusDrift } from "./testset.ts";
import type {
  ChangeImpactEntry,
  ChangeImpactReport,
  MarkdownDocument,
  SectionChange,
  TestCase,
  Testset,
} from "./types.ts";

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "any", "are", "because", "been", "before",
  "being", "between", "can", "does", "for", "from", "has", "have", "how", "into",
  "its", "may", "more", "not", "only", "our", "should", "that", "the", "their",
  "then", "there", "these", "this", "those", "through", "under", "was", "were",
  "what", "when", "where", "which", "with", "would", "you", "your",
]);

function terms(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((term) => term.length >= 3 && !STOP_WORDS.has(term)) ?? [],
  );
}

function relatedByTerms(caseTerms: Set<string>, changedText: string): boolean {
  if (caseTerms.size === 0) return false;
  const changedTerms = terms(changedText);
  let matches = 0;
  for (const term of caseTerms) if (changedTerms.has(term)) matches += 1;
  return matches > 0 && (matches >= 2 || matches / caseTerms.size >= 0.2);
}

function caseTerms(testCase: TestCase): Set<string> {
  return terms([
    testCase.question,
    testCase.expectedAnswer,
    ...(testCase.claims ?? []).map((claim) => claim.text),
  ].join(" "));
}

function evidenceSectionIds(testCase: TestCase): Set<string> {
  return new Set([
    ...testCase.evidence.map((evidence) => evidence.sectionId),
    ...(testCase.claims ?? []).flatMap((claim) => claim.evidence.map((evidence) => evidence.sectionId)),
  ]);
}

/**
 * Compares a baseline corpus with a changed corpus and classifies which test cases
 * need attention. It uses exact evidence dependencies first, then a deterministic
 * lexical relevance heuristic to catch likely cross-document impacts.
 *
 * "unaffected" means no direct or lexical signal was found; it is not a proof of
 * semantic independence. Review results before treating them as a release gate.
 */
export function analyzeChangeImpact(
  previousDocuments: MarkdownDocument[],
  currentDocuments: MarkdownDocument[],
  testset: Testset,
): ChangeImpactReport {
  const previousCorpusHash = corpusFingerprint(previousDocuments);
  const currentCorpusHash = corpusFingerprint(currentDocuments);
  const previousSections = parseMarkdownDocuments(previousDocuments);
  const currentSections = parseMarkdownDocuments(currentDocuments);
  const previousById = new Map(previousSections.map((section) => [section.id, section]));
  const currentById = new Map(currentSections.map((section) => [section.id, section]));
  const changes: SectionChange[] = [];
  const changeText = new Map<string, string>();

  for (const previous of previousSections) {
    const current = currentById.get(previous.id);
    if (!current) {
      changes.push({
        sectionId: previous.id,
        sourcePath: previous.sourcePath,
        sectionTitle: previous.title,
        kind: "removed",
        previousHash: previous.contentHash,
      });
      changeText.set(previous.id, `${previous.title}\n${previous.content}`);
    } else if (current.contentHash !== previous.contentHash) {
      changes.push({
        sectionId: previous.id,
        sourcePath: current.sourcePath,
        sectionTitle: current.title,
        kind: "modified",
        previousHash: previous.contentHash,
        currentHash: current.contentHash,
      });
      changeText.set(current.id, `${previous.title}\n${previous.content}\n${current.title}\n${current.content}`);
    }
  }
  for (const current of currentSections) {
    if (!previousById.has(current.id)) {
      changes.push({
        sectionId: current.id,
        sourcePath: current.sourcePath,
        sectionTitle: current.title,
        kind: "added",
        currentHash: current.contentHash,
      });
      changeText.set(current.id, `${current.title}\n${current.content}`);
    }
  }
  changes.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.sectionId.localeCompare(b.sectionId));

  const driftByCase = new Map(analyzeCorpusDrift(currentDocuments, testset).entries.map((entry) => [entry.caseId, entry]));
  const entries: ChangeImpactEntry[] = testset.cases.map((testCase) => {
    const reasons: string[] = [];
    const linkedSectionIds = evidenceSectionIds(testCase);
    const changedLinked = changes.filter((change) => linkedSectionIds.has(change.sectionId));
    const words = caseTerms(testCase);
    const lexicalChanges = changes.filter((change) =>
      !linkedSectionIds.has(change.sectionId) && relatedByTerms(words, changeText.get(change.sectionId) ?? ""),
    );
    const related = new Set([
      ...changedLinked.map((change) => change.sectionId),
      ...lexicalChanges.map((change) => change.sectionId),
    ]);
    const affectedClaimIds = (testCase.claims ?? [])
      .filter((claim) => {
        if (claim.evidence.some((evidence) => changes.some((change) => change.sectionId === evidence.sectionId))) return true;
        return changes.some((change) => relatedByTerms(terms(claim.text), changeText.get(change.sectionId) ?? ""));
      })
      .map((claim) => claim.id);

    const drift = driftByCase.get(testCase.id);
    let status: ChangeImpactEntry["status"] = "unaffected";

    if (drift?.status === "stale") {
      status = "stale";
      reasons.push(...drift.reasons);
    } else if (testCase.expectedBehavior === "abstain" && previousCorpusHash !== currentCorpusHash) {
      status = "needs-review";
      reasons.push("The corpus changed; re-check whether the previously unanswerable question can now be answered.");
      for (const change of changes) related.add(change.sectionId);
    } else if (drift?.status === "needs-review") {
      status = "needs-review";
      reasons.push(...drift.reasons);
    } else if (changedLinked.length > 0) {
      status = "needs-review";
      reasons.push("At least one section cited by this test case or its claims changed; review the expected answer and supporting claims.");
    } else if (lexicalChanges.length > 0) {
      status = "needs-review";
      reasons.push("Changed sections share key terms with this test case; review possible cross-document effects.");
    } else {
      reasons.push("No changed evidence dependency or lexical relevance signal was found.");
    }

    if (testset.corpusHash !== previousCorpusHash) {
      reasons.push("The test set fingerprint does not match the supplied baseline corpus; impact classification may omit changes that predate this comparison.");
    }

    const recommendedAction: ChangeImpactEntry["recommendedAction"] =
      status === "stale" ? "regenerate" : status === "needs-review" ? "review" : "keep";
    return {
      caseId: testCase.id,
      question: testCase.question,
      status,
      recommendedAction,
      reasons: [...new Set(reasons)],
      relatedSectionIds: [...related].sort(),
      affectedClaimIds,
    };
  });

  return {
    previousCorpusHash,
    currentCorpusHash,
    testsetMatchesPreviousCorpus: testset.corpusHash === previousCorpusHash,
    sectionChanges: changes,
    counts: {
      unaffected: entries.filter((entry) => entry.status === "unaffected").length,
      "needs-review": entries.filter((entry) => entry.status === "needs-review").length,
      stale: entries.filter((entry) => entry.status === "stale").length,
    },
    entries,
    limitations: [
      "Impact detection combines exact evidence dependencies with lexical overlap; it does not establish semantic entailment or prove that an apparently unaffected case is independent.",
      "A stale result means at least one required evidence dependency is no longer valid; regenerate or manually repair that case before relying on it.",
      ...(testset.corpusHash !== previousCorpusHash
        ? ["The supplied test set was not generated from the baseline corpus; changes before that baseline cannot be reconstructed from this comparison."]
        : []),
    ],
  };
}
