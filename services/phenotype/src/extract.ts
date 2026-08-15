// services/phenotype/src/extract.ts
//
// Phenotype extraction and candidate construction (Requirement 5.1-5.8).
//
// `extractPhenotypes` requests phenotype extraction through the AI_Gateway
// (the SOLE Bedrock path; task type "phenotype_extraction") and maps the
// grounded AI output to `PhenotypeCandidate` records. It never confirms a
// candidate: every produced candidate is stored "pending_review" (Req 5.6),
// unless its term cannot be resolved to a valid HPO id, in which case it is
// retained as "unresolved" and flagged for review (Req 5.7). If the gateway is
// unavailable, rejects, needs review, or returns unparseable output, extraction
// is cancelled: an error indication is returned and any existing candidates are
// preserved unchanged (Req 5.8).
//
// The 60-second bound (Req 5.1) is enforced by the gateway's own invocation
// timeout; a timeout surfaces here as a gateway failure and is reported as a
// non-completing extraction.

import {
  createEnvelope,
  type AccessClassification,
  type Assertion,
  type HpoMapping,
  type PhenotypeCandidate,
  type ProvenanceRef
} from "@udn/domain";
import {
  parseAiResponse,
  type AuthorizedScope,
  type GenerativeInvocationResult,
  type GenerativeRequest,
  type GroundedStatement
} from "@udn/ai-gateway";

import {
  defaultAssertionClassifier,
  type AssertionClassifier
} from "./assertion.js";
import type { HpoResolver } from "./hpo-resolver.js";

/** Maximum number of HPO mappings a candidate may carry (Req 5.2). */
export const MAX_HPO_MAPPINGS = 20;

/** Maximum number of alternative HPO mappings a candidate may carry (Req 5.5). */
export const MAX_ALTERNATIVES = 10;

/** Default trusted system instruction for the phenotype-extraction task. */
export const DEFAULT_PHENOTYPE_SYSTEM_INSTRUCTIONS =
  "Extract clinical phenotype observations from the provided synthetic case " +
  "documents. Return grounded statements only; link each statement to the " +
  "source object it is drawn from. Do not infer a diagnosis.";

/**
 * A source document presented to the model as untrusted case data. Each
 * document carries the id of the source object it represents so produced
 * candidates can link back to their supporting source (Req 5.4).
 */
export interface SourceDocument {
  /** Identifier of the supporting source object (Req 5.4). */
  readonly sourceObjectId: string;
  /** The untrusted document content. */
  readonly content: string;
}

/**
 * The narrow gateway seam `extractPhenotypes` depends on. The concrete
 * `AiGateway` from @udn/ai-gateway satisfies this, and tests can inject a fake
 * implementing only `invoke` — no AWS required.
 */
export interface PhenotypeExtractionGateway {
  invoke(request: GenerativeRequest): Promise<GenerativeInvocationResult>;
}

/** Options controlling a phenotype-extraction request. */
export interface ExtractPhenotypesOptions {
  /** HPO resolution seam (Req 5.2, 5.5, 5.7). */
  readonly resolver: HpoResolver;
  /** Identity of the invoking user (passed to the gateway; recorded as creator). */
  readonly invokingUserId: string;
  /**
   * Existing phenotype candidates for the case. Returned unchanged on failure
   * so extraction never destroys prior state (Req 5.8).
   */
  readonly existingCandidates?: readonly PhenotypeCandidate[];
  /** Assertion classifier (Req 5.3); defaults to {@link defaultAssertionClassifier}. */
  readonly assertionClassifier?: AssertionClassifier;
  /** Trusted system instructions; defaults to {@link DEFAULT_PHENOTYPE_SYSTEM_INSTRUCTIONS}. */
  readonly systemInstructions?: string;
  /** The invoking user's authorised access scope, forwarded to the gateway (Req 19.6). */
  readonly authorizedScope?: AuthorizedScope;
  /** Prompt template version, forwarded to the gateway for caching (Req 32.2). */
  readonly promptTemplateVersion?: string;
  /** Origin recorded on each candidate's envelope; defaults to "phenotype_extraction". */
  readonly source?: string;
  /** Access classification for produced candidates; defaults to "clinical". */
  readonly accessClassification?: AccessClassification;
  /** Clock for envelope timestamps; defaults to `new Date().toISOString()`. */
  readonly now?: () => string;
}

/** Why a phenotype extraction did not complete (Req 5.8). */
export type PhenotypeExtractionFailureReason =
  /** The gateway threw or was otherwise unreachable. */
  | "gateway_unavailable"
  /** The gateway rejected the request (config, task-type, or invocation failure). */
  | "gateway_rejected"
  /** The gateway flagged its output for review; no confirmed candidates result. */
  | "gateway_needs_review"
  /** The gateway returned output that did not conform to the response schema. */
  | "invalid_response";

/** Successful extraction: newly produced candidates, all awaiting review. */
export interface ExtractPhenotypesSuccess {
  readonly outcome: "extracted";
  /** Produced candidates (pending_review, or unresolved when unmappable). */
  readonly candidates: readonly PhenotypeCandidate[];
}

/** Failed extraction: existing candidates are preserved unchanged (Req 5.8). */
export interface ExtractPhenotypesFailure {
  readonly outcome: "failed";
  /** Machine-readable failure classification. */
  readonly reason: PhenotypeExtractionFailureReason;
  /** Human-readable description reporting that extraction did not complete. */
  readonly detail: string;
  /** Existing candidates, returned unchanged so no prior state is lost (Req 5.8). */
  readonly candidates: readonly PhenotypeCandidate[];
  /** Underlying cause, when available (e.g. a gateway error). */
  readonly cause?: unknown;
}

/** Result of {@link extractPhenotypes}. */
export type ExtractPhenotypesResult =
  | ExtractPhenotypesSuccess
  | ExtractPhenotypesFailure;

/** Clamp to [0, 1] and round to two decimals to match the 0.00-1.00 domain. */
function normaliseConfidence(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * 100) / 100;
}

/** Filter to valid/known ids, normalise confidence, dedupe by id, sort desc. */
function sanitiseMappings(
  mappings: readonly HpoMapping[],
  resolver: HpoResolver,
  excludeIds: ReadonlySet<string> = new Set()
): HpoMapping[] {
  const seen = new Set<string>(excludeIds);
  const kept: HpoMapping[] = [];
  for (const mapping of mappings) {
    if (!resolver.isValidHpoId(mapping.hpoId) || seen.has(mapping.hpoId)) {
      continue;
    }
    seen.add(mapping.hpoId);
    kept.push({ hpoId: mapping.hpoId, confidence: normaliseConfidence(mapping.confidence) });
  }
  kept.sort((a, b) => b.confidence - a.confidence);
  return kept;
}

/** Build a single candidate from one grounded statement. */
function toCandidate(
  statement: GroundedStatement,
  caseId: string,
  options: ExtractPhenotypesOptions,
  nowFn: () => string
): PhenotypeCandidate {
  const classifier = options.assertionClassifier ?? defaultAssertionClassifier;
  const assertion: Assertion = classifier.classify(statement.statement);
  const confidence = normaliseConfidence(statement.confidence);

  const resolution = options.resolver.resolve(statement.statement);
  const mappings = sanitiseMappings(resolution.mappings, options.resolver).slice(
    0,
    MAX_HPO_MAPPINGS
  );
  const chosenIds = new Set(mappings.map((m) => m.hpoId));
  const alternatives = sanitiseMappings(
    resolution.alternatives ?? [],
    options.resolver,
    chosenIds
  ).slice(0, MAX_ALTERNATIVES);

  const [primarySource] = statement.sourceRefs;
  // A candidate is resolvable only when it maps to at least one valid HPO term
  // AND links to a supporting source object (Req 5.4, 5.7).
  const resolvable = mappings.length > 0 && primarySource !== undefined;
  const status: PhenotypeCandidate["status"] = resolvable
    ? "pending_review" // Req 5.6
    : "unresolved"; // Req 5.7

  const sourceObjectRef = primarySource ?? "";
  const now = nowFn();
  const provenance: ProvenanceRef = {
    sourceId: sourceObjectRef,
    versionId: options.promptTemplateVersion ?? "1",
    createdById: options.invokingUserId,
    ingestedAt: now
  };

  const envelope = createEnvelope({
    entityType: "PhenotypeCandidate",
    caseId,
    source: options.source ?? "phenotype_extraction",
    status,
    provenance,
    accessClassification: options.accessClassification ?? "clinical",
    createdById: options.invokingUserId,
    now
  });

  return {
    ...envelope,
    entityType: "PhenotypeCandidate",
    status,
    assertion,
    confidence,
    hpoMappings: mappings,
    alternatives,
    sourceObjectRef,
    aiExtracted: true
  };
}

/**
 * Extract phenotype candidates for a case via the AI_Gateway and map the
 * grounded output to `PhenotypeCandidate` records (Req 5.1-5.8).
 *
 * On success every candidate is `pending_review` (Req 5.6) — or `unresolved`
 * and flagged when its term cannot be mapped to a valid HPO id (Req 5.7). On
 * any gateway failure (unavailable, rejected, flagged for review, or
 * unparseable output) extraction is cancelled: an error indication is returned
 * and `existingCandidates` are preserved unchanged (Req 5.8). No candidate is
 * ever auto-confirmed.
 */
export async function extractPhenotypes(
  caseId: string,
  sourceDocuments: readonly SourceDocument[],
  gateway: PhenotypeExtractionGateway,
  options: ExtractPhenotypesOptions
): Promise<ExtractPhenotypesResult> {
  const existing = options.existingCandidates ?? [];
  const nowFn = options.now ?? (() => new Date().toISOString());

  const request: GenerativeRequest = {
    taskType: "phenotype_extraction",
    invokingUserId: options.invokingUserId,
    systemInstructions:
      options.systemInstructions ?? DEFAULT_PHENOTYPE_SYSTEM_INSTRUCTIONS,
    context: sourceDocuments.map((doc) => ({
      sourceObjectId: doc.sourceObjectId,
      content: doc.content
    })),
    ...(options.authorizedScope !== undefined
      ? { authorizedScope: options.authorizedScope }
      : {}),
    ...(options.promptTemplateVersion !== undefined
      ? { promptTemplateVersion: options.promptTemplateVersion }
      : {})
  };

  let result: GenerativeInvocationResult;
  try {
    result = await gateway.invoke(request);
  } catch (error) {
    // The gateway threw (e.g. unreachable). Cancel and preserve state (Req 5.8).
    return {
      outcome: "failed",
      reason: "gateway_unavailable",
      detail:
        "Phenotype extraction did not complete: the AI_Gateway was unavailable.",
      candidates: existing,
      cause: error
    };
  }

  if (result.outcome === "rejected") {
    return {
      outcome: "failed",
      reason: "gateway_rejected",
      detail: `Phenotype extraction did not complete: ${result.error.message}`,
      candidates: existing,
      cause: result.error
    };
  }

  if (result.outcome === "needs_review") {
    return {
      outcome: "failed",
      reason: "gateway_needs_review",
      detail:
        "Phenotype extraction did not complete: AI output was flagged for review " +
        `(${result.review.detail}).`,
      candidates: existing
    };
  }

  const parsed = parseAiResponse(result.response.outputText);
  if (!parsed.ok) {
    return {
      outcome: "failed",
      reason: "invalid_response",
      detail: `Phenotype extraction did not complete: ${parsed.detail}`,
      candidates: existing
    };
  }

  const candidates = parsed.value.statements.map((statement) =>
    toCandidate(statement, caseId, options, nowFn)
  );

  return { outcome: "extracted", candidates };
}
