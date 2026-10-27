export type ScenarioType = "single-hop" | "multi-hop" | "unanswerable" | "custom";
export type ExpectedBehavior = "answer" | "abstain";
export type DriftStatus = "current" | "needs-review" | "stale";
export type IssueSeverity = "error" | "warning";

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

export interface SyntheticCandidate {
  question: string;
  expectedAnswer: string;
  type: ScenarioType;
  expectedBehavior: ExpectedBehavior;
  evidence: EvidenceInput[];
}

export interface TestCase {
  id: string;
  question: string;
  expectedAnswer: string;
  type: ScenarioType;
  expectedBehavior: ExpectedBehavior;
  evidence: EvidenceReference[];
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

export interface ScenarioSynthesizer {
  generate(sections: EvidenceSection[]): Promise<SyntheticCandidate[]>;
}

export interface GenerateTestsetOptions {
  /** If true, throw when any candidate has invalid or ambiguous evidence. */
  strictEvidence?: boolean;
}
