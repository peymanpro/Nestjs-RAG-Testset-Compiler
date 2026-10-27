export type ScenarioType = "single-hop" | "multi-hop" | "unanswerable" | "custom";
export type ExpectedBehavior = "answer" | "abstain";
export type DriftStatus = "current" | "needs-review" | "stale";
export type IssueSeverity = "error" | "warning";
export type ClaimKind = "fact" | "condition" | "exception" | "temporal" | "numeric" | "causal" | "other";

export interface MarkdownDocument {
  /** Path relative to the corpus root, normalized to forward slashes. */
  path: string;
  content: string;
}

export interface EvidenceSection {
  /** Stable within the same document structure; duplicate headings include an occurrence suffix. */
  id: string;
  sourcePath: string;
  title: string;
  occurrence: number;
  content: string;
  contentHash: string;
  lineStart: number;
  lineEnd: number;
}

export interface EvidenceInput {
  sourcePath: string;
  sectionTitle: string;
  quote: string;
  /** Required to disambiguate repeated headings. */
  sectionId?: string;
}

export interface EvidenceReference extends EvidenceInput {
  sectionId: string;
  sectionHashAtGeneration: string;
  quoteHash: string;
}

/** An atomic assertion returned by a synthesizer and supported by one or more evidence quotes. */
export interface ClaimInput {
  text: string;
  evidence: EvidenceInput[];
  kind?: ClaimKind;
}

/** A claim with stable identity and integrity metadata, linked to its exact source evidence. */
export interface ClaimReference extends ClaimInput {
  id: string;
  textHash: string;
  evidence: EvidenceReference[];
}

export interface SyntheticCandidate {
  question: string;
  expectedAnswer: string;
  type: ScenarioType;
  expectedBehavior: ExpectedBehavior;
  evidence: EvidenceInput[];
  /** Optional for compatibility with custom synthesizers that have not added claim extraction yet. */
  claims?: ClaimInput[];
}

export interface TestCase {
  id: string;
  question: string;
  expectedAnswer: string;
  type: ScenarioType;
  expectedBehavior: ExpectedBehavior;
  evidence: EvidenceReference[];
  /** Optional, additive metadata. Older schemaVersion 1 test sets remain readable. */
  claims?: ClaimReference[];
  /** Negative cases depend on the entire corpus, not only one quote. */
  corpusHashAtGeneration: string;
}

export interface Testset {
  schemaVersion: 1;
  corpusHash: string;
  cases: TestCase[];
}

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  caseId?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  checkedCases: number;
  issues: ValidationIssue[];
}

export interface DriftEntry {
  caseId: string;
  question: string;
  status: DriftStatus;
  reasons: string[];
}

export interface DriftReport {
  corpusHash: string;
  counts: Record<DriftStatus, number>;
  entries: DriftEntry[];
}

export type SectionChangeKind = "added" | "modified" | "removed";
export type ChangeImpactStatus = "unaffected" | "needs-review" | "stale";
export type ChangeImpactAction = "keep" | "review" | "regenerate";

export interface SectionChange {
  sectionId: string;
  sourcePath: string;
  sectionTitle: string;
  kind: SectionChangeKind;
  previousHash?: string;
  currentHash?: string;
}

export interface ChangeImpactEntry {
  caseId: string;
  question: string;
  status: ChangeImpactStatus;
  recommendedAction: ChangeImpactAction;
  reasons: string[];
  /** Section IDs that directly or lexically relate to this test case. */
  relatedSectionIds: string[];
  /** Claim IDs whose supporting evidence or claim text is affected by the change. */
  affectedClaimIds: string[];
}

export interface ChangeImpactReport {
  previousCorpusHash: string;
  currentCorpusHash: string;
  sectionChanges: SectionChange[];
  counts: Record<ChangeImpactStatus, number>;
  entries: ChangeImpactEntry[];
  limitations: string[];
}

export interface ScenarioSynthesizer {
  generate(sections: EvidenceSection[]): Promise<SyntheticCandidate[]>;
}

export interface GenerateTestsetOptions {
  /** If true, throw when any candidate has invalid or ambiguous evidence. */
  strictEvidence?: boolean;
}
