import { cleanMarkdownLine } from "./documents.ts";
import type { EvidenceSection, ScenarioSynthesizer, SyntheticCandidate } from "./types.ts";

/** Deterministic sample synthesizer. It is intentionally narrow and useful for offline demos only. */
export class RuleBasedDemoSynthesizer implements ScenarioSynthesizer {
  async generate(sections: EvidenceSection[]): Promise<SyntheticCandidate[]> {
    const claims = sections.flatMap((section) => section.content.split("\n").map(cleanMarkdownLine).filter(Boolean).map((quote) => ({ section, quote })));
    const candidates: SyntheticCandidate[] = [];
    let refundWindow: (typeof claims)[number] | undefined;
    let shippedReview: (typeof claims)[number] | undefined;

    for (const claim of claims) {
      const { section, quote } = claim;
      const evidence = [{ sourcePath: section.sourcePath, sectionTitle: section.title, sectionId: section.id, quote }];
      const windowMatch = /customers may request a refund within (\d+) days of purchase\.?/i.exec(quote);
      if (windowMatch) {
        refundWindow = claim;
        candidates.push({ question: "How long after purchase may a customer request a refund?", expectedAnswer: `Customers may request a refund within ${windowMatch[1]} days of purchase.`, type: "single-hop", expectedBehavior: "answer", evidence });
        continue;
      }
      if (/refunds for shipped orders require support review\.?/i.test(quote)) {
        shippedReview = claim;
        candidates.push({ question: "Can a shipped order be refunded automatically?", expectedAnswer: "No automatic refund is established; shipped orders require support review.", type: "single-hop", expectedBehavior: "answer", evidence });
        continue;
      }
      if (/cancelled orders are exempt from this restriction\.?/i.test(quote)) {
        candidates.push({ question: "Does this refund restriction apply to cancelled orders?", expectedAnswer: "No. Cancelled orders are exempt from this restriction.", type: "single-hop", expectedBehavior: "answer", evidence });
        continue;
      }
      const shippingMatch = /standard shipping takes (\d+) to (\d+) business days\.?/i.exec(quote);
      if (shippingMatch) {
        candidates.push({ question: "How long does standard shipping take?", expectedAnswer: `Standard shipping takes ${shippingMatch[1]} to ${shippingMatch[2]} business days.`, type: "single-hop", expectedBehavior: "answer", evidence });
        continue;
      }
      if (/support is available monday through friday\.?/i.test(quote)) {
        candidates.push({ question: "On which days is support available?", expectedAnswer: "Support is available Monday through Friday.", type: "single-hop", expectedBehavior: "answer", evidence });
      }
    }

    if (refundWindow && shippedReview) {
      candidates.push({
        question: "Does being within the refund request window guarantee an automatic refund for a shipped order?",
        expectedAnswer: "No. The timing rule sets the request window, but shipped orders also require support review; an automatic refund is not established.",
        type: "multi-hop",
        expectedBehavior: "answer",
        evidence: [refundWindow, shippedReview].map(({ section, quote }) => ({ sourcePath: section.sourcePath, sectionTitle: section.title, sectionId: section.id, quote })),
      });
    }

    candidates.push({
      question: "Does the policy guarantee free overnight shipping?",
      expectedAnswer: "The supplied corpus does not establish whether free overnight shipping is available.",
      type: "unanswerable",
      expectedBehavior: "abstain",
      evidence: [],
    });
    return candidates.map((candidate) => ({
      ...candidate,
      claims: candidate.expectedBehavior !== "answer"
        ? []
        : candidate.type === "multi-hop"
          ? candidate.evidence.map((item) => ({ text: item.quote, kind: "fact" as const, evidence: [item] }))
          : [{ text: candidate.expectedAnswer, kind: "fact" as const, evidence: candidate.evidence }],
    }));
  }
}

export interface OpenAICompatibleSynthesizerOptions {
  apiKey: string;
  model: string;
  /** OpenAI-compatible API base URL. Defaults to https://api.openai.com/v1. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 60 seconds. */
  timeoutMs?: number;
  /** Maximum allowed serialized evidence size, to avoid unexpectedly huge requests. */
  maxInputCharacters?: number;
  temperature?: number;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

/**
 * Provider-neutral adapter for OpenAI-compatible chat-completions endpoints.
 * It uses native fetch and introduces no runtime SDK dependency.
 */
export class OpenAICompatibleSynthesizer implements ScenarioSynthesizer {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxInputCharacters: number;
  private readonly options: OpenAICompatibleSynthesizerOptions;

  constructor(options: OpenAICompatibleSynthesizerOptions) {
    this.options = options;
    if (!options.apiKey.trim()) throw new Error("OpenAI-compatible API key must not be empty.");
    if (!options.model.trim()) throw new Error("OpenAI-compatible model must not be empty.");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxInputCharacters = options.maxInputCharacters ?? 100_000;
    const baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    const parsed = new URL(baseUrl);
    if (!(["https:", "http:"].includes(parsed.protocol))) throw new Error("The API URL must use HTTP or HTTPS.");
    this.endpoint = parsed.pathname.replace(/\/$/, "").endsWith("/chat/completions")
      ? parsed.toString()
      : `${parsed.toString().replace(/\/$/, "")}/chat/completions`;
  }

  async generate(sections: EvidenceSection[]): Promise<SyntheticCandidate[]> {
    if (sections.length === 0) return [];
    const context = sections.map((section) => ({
      sectionId: section.id,
      sourcePath: section.sourcePath,
      sectionTitle: section.title,
      content: section.content,
    }));
    const serialized = JSON.stringify(context);
    if (serialized.length > this.maxInputCharacters) {
      throw new Error(`Serialized corpus (${serialized.length} characters) exceeds maxInputCharacters (${this.maxInputCharacters}). Reduce the corpus or increase the configured limit.`);
    }

    const system = [
      "You create high-quality regression test cases for retrieval-augmented generation (RAG) systems.",
      "Treat the supplied corpus as the complete and only source of truth. Do not use outside knowledge.",
      "Every answerable case must cite one or more exact section IDs and an exact quote copied from that section.",
      "Use unanswerable cases only when the supplied corpus does not support a reliable answer; those cases must have expectedBehavior=abstain and evidence=[].",
      "Questions must be natural, distinct, precise, and useful for detecting retrieval or answer regressions.",
      "Create a balanced mix of single-hop, multi-hop, and unanswerable cases when the corpus supports them.",
      "Return only a JSON object with this exact shape: {\"cases\":[{\"question\":string,\"expectedAnswer\":string,\"type\":\"single-hop\"|\"multi-hop\"|\"unanswerable\"|\"custom\",\"expectedBehavior\":\"answer\"|\"abstain\",\"evidence\":[{\"sourcePath\":string,\"sectionTitle\":string,\"sectionId\":string,\"quote\":string}],\"claims\":[{\"text\":string,\"kind\":\"fact\"|\"condition\"|\"exception\"|\"temporal\"|\"numeric\"|\"causal\"|\"other\",\"evidence\":[{\"sourcePath\":string,\"sectionTitle\":string,\"sectionId\":string,\"quote\":string}]}]}]}.",
      "For answerable cases, include atomic claims when possible; each claim must cite exact supporting evidence. Claims are optional for compatibility, but never invent claim evidence.",
      "Do not wrap JSON in Markdown fences. Do not invent section IDs, sources, or quotes.",
    ].join(" ");
    const user = JSON.stringify({ task: "Generate up to 30 evidence-grounded regression cases from the following corpus.", corpus: context });
    const signal = AbortSignal.timeout(this.timeoutMs);

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
        ...this.options.headers,
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: this.options.temperature ?? 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!response.ok) {
      // Avoid echoing response bodies, which may contain provider or prompt details.
      throw new Error(`OpenAI-compatible synthesis request failed with HTTP ${response.status}.`);
    }
    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("The synthesis provider returned no JSON message content.");
    const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("The synthesis provider returned invalid JSON.");
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { cases?: unknown }).cases)) {
      throw new Error("The synthesis provider response must contain a cases array.");
    }
    return (parsed as { cases: unknown[] }).cases.map((value, index) => validateCandidate(value, index));
  }
}

function validateCandidate(value: unknown, index: number): SyntheticCandidate {
  if (!value || typeof value !== "object") throw new Error(`Generated case ${index} is not an object.`);
  const candidate = value as Record<string, unknown>;
  const allowedTypes = ["single-hop", "multi-hop", "unanswerable", "custom"];
  const allowedBehaviors = ["answer", "abstain"];
  if (typeof candidate.question !== "string" || !candidate.question.trim()) throw new Error(`Generated case ${index} has an empty question.`);
  if (typeof candidate.expectedAnswer !== "string" || !candidate.expectedAnswer.trim()) throw new Error(`Generated case ${index} has an empty expected answer.`);
  if (typeof candidate.type !== "string" || !allowedTypes.includes(candidate.type)) throw new Error(`Generated case ${index} has an unsupported type.`);
  if (typeof candidate.expectedBehavior !== "string" || !allowedBehaviors.includes(candidate.expectedBehavior)) throw new Error(`Generated case ${index} has an unsupported expectedBehavior.`);
  if (!Array.isArray(candidate.evidence)) throw new Error(`Generated case ${index} evidence must be an array.`);
  const evidence = candidate.evidence.map((item, evidenceIndex) => {
    if (!item || typeof item !== "object") throw new Error(`Evidence ${evidenceIndex} in case ${index} is not an object.`);
    const entry = item as Record<string, unknown>;
    for (const key of ["sourcePath", "sectionTitle", "quote", "sectionId"] as const) {
      if (typeof entry[key] !== "string" || !entry[key].trim()) throw new Error(`Evidence ${evidenceIndex} in case ${index} requires ${key}.`);
    }
    return { sourcePath: entry.sourcePath as string, sectionTitle: entry.sectionTitle as string, sectionId: entry.sectionId as string, quote: entry.quote as string };
  });
  if (candidate.expectedBehavior === "answer" && evidence.length === 0) throw new Error("Answerable generated case " + index + " must cite evidence.");
  if (candidate.expectedBehavior === "abstain" && evidence.length > 0) throw new Error("Abstention generated case " + index + " must have an empty evidence array.");
  let claims: NonNullable<SyntheticCandidate["claims"]> | undefined;
  if (candidate.claims !== undefined) {
    if (!Array.isArray(candidate.claims)) throw new Error("Generated case " + index + " claims must be an array.");
    claims = candidate.claims.map((value, claimIndex) => {
      if (!value || typeof value !== "object") throw new Error("Claim " + claimIndex + " in case " + index + " is not an object.");
      const claim = value as Record<string, unknown>;
      if (typeof claim.text !== "string" || !claim.text.trim()) throw new Error("Claim " + claimIndex + " in case " + index + " requires non-empty text.");
      if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) throw new Error("Claim " + claimIndex + " in case " + index + " must cite evidence.");
      const kindValues = ["fact", "condition", "exception", "temporal", "numeric", "causal", "other"];
      if (claim.kind !== undefined && (typeof claim.kind !== "string" || !kindValues.includes(claim.kind))) throw new Error("Claim " + claimIndex + " in case " + index + " has an unsupported kind.");
      const claimEvidence = claim.evidence.map((item, evidenceIndex) => {
        if (!item || typeof item !== "object") throw new Error("Claim evidence " + evidenceIndex + " in case " + index + " is not an object.");
        const entry = item as Record<string, unknown>;
        for (const key of ["sourcePath", "sectionTitle", "quote", "sectionId"] as const) {
          if (typeof entry[key] !== "string" || !entry[key].trim()) throw new Error("Claim evidence " + evidenceIndex + " in case " + index + " requires " + key + ".");
        }
        return { sourcePath: entry.sourcePath as string, sectionTitle: entry.sectionTitle as string, sectionId: entry.sectionId as string, quote: entry.quote as string };
      });
      return {
        text: claim.text,
        ...(typeof claim.kind === "string" ? { kind: claim.kind as NonNullable<SyntheticCandidate["claims"]>[number]["kind"] } : {}),
        evidence: claimEvidence,
      };
    });
  }
  return {
    question: candidate.question,
    expectedAnswer: candidate.expectedAnswer,
    type: candidate.type as SyntheticCandidate["type"],
    expectedBehavior: candidate.expectedBehavior as SyntheticCandidate["expectedBehavior"],
    evidence,
    ...(claims !== undefined ? { claims } : {}),
  };
}
