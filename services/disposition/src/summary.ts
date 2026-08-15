// services/disposition/src/summary.ts
//
// Grounded draft case-summary generation (Disposition_Service, task 24.1,
// Requirement 13.2, 13.3, 13.6, 13.7).
//
// `generateDraftSummary` requests a case summary through the AI_Gateway (the
// SOLE Bedrock path; task type "summarisation") and maps the grounded AI output
// onto the `CaseDisposition.draftSummary`. Every produced statement links to
// exactly one source object (Req 13.2); a statement that cannot be linked to a
// source object is flagged as `unsourced` (Req 13.7). The produced summary is
// always in DRAFT (`final: false`) — it is finalised only by an explicit,
// authorised human approval (see approveDraftSummary, Req 13.3, 13.5).
//
// The 30-second bound (Req 13.2) is enforced by the gateway's own invocation
// timeout; a timeout surfaces here as a gateway failure and is reported as a
// non-completing generation that retains the case without a final summary
// (Req 13.6). No generative call other than this one is made by the
// Disposition_Service.

import {
  touchEnvelope,
  type CaseDisposition
} from "@udn/domain";
import {
  parseAiResponse,
  type AuthorizedScope,
  type GenerativeInvocationResult,
  type GenerativeRequest,
  type GroundedStatement
} from "@udn/ai-gateway";

/** The generative task type used for draft case summaries (Req 13.2, 16.5). */
export const SUMMARY_TASK_TYPE = "summarisation";

/** Default trusted system instruction for the summary-drafting task. */
export const DEFAULT_SUMMARY_SYSTEM_INSTRUCTIONS =
  "Draft a concise case summary from the provided synthetic case documents. " +
  "Return grounded statements only; link each statement to exactly one source " +
  "object it is drawn from. Do not infer a diagnosis or add unsupported claims.";

/** A single statement of a draft case summary (mirrors CaseDisposition.draftSummary). */
export interface DraftSummaryStatement {
  /** The natural-language summary statement. */
  readonly text: string;
  /** The single source object the statement is linked to (Req 13.2); absent when unsourced. */
  readonly sourceObjectRef?: string;
  /** Whether the statement could not be linked to a source object (Req 13.7). */
  readonly unsourced: boolean;
}

/**
 * A source document presented to the model as untrusted case data. Each
 * document carries the id of the source object it represents so produced
 * statements can link back to their supporting source (Req 13.2).
 */
export interface SummarySourceDocument {
  /** Identifier of the supporting source object (Req 13.2). */
  readonly sourceObjectId: string;
  /** The untrusted document content. */
  readonly content: string;
}

/**
 * The narrow gateway seam `generateDraftSummary` depends on. The concrete
 * `AiGateway` from @udn/ai-gateway satisfies this, and tests can inject a fake
 * implementing only `invoke` — no AWS required.
 */
export interface DraftSummaryGateway {
  invoke(request: GenerativeRequest): Promise<GenerativeInvocationResult>;
}

/** Options controlling a draft-summary generation request. */
export interface GenerateDraftSummaryOptions {
  /** Identity of the invoking user (passed to the gateway). */
  readonly invokingUserId: string;
  /** Trusted system instructions; defaults to {@link DEFAULT_SUMMARY_SYSTEM_INSTRUCTIONS}. */
  readonly systemInstructions?: string;
  /** The invoking user's authorised access scope, forwarded to the gateway (Req 19.6). */
  readonly authorizedScope?: AuthorizedScope;
  /** Prompt template version, forwarded to the gateway for caching (Req 32.2). */
  readonly promptTemplateVersion?: string;
  /**
   * Ids of the source objects available to this case. When provided, a
   * statement's linked source must be one of these ids to count as sourced;
   * any other statement is flagged `unsourced` (Req 13.7). When omitted, any
   * non-empty source reference counts as a valid link.
   */
  readonly knownSourceObjectIds?: readonly string[];
  /** Clock for the disposition envelope timestamp; defaults to `new Date().toISOString()`. */
  readonly now?: () => string;
}

/** Why a draft-summary generation did not complete (Req 13.6). */
export type DraftSummaryFailureReason =
  /** The gateway threw or was otherwise unreachable. */
  | "gateway_unavailable"
  /** The gateway rejected the request (config, task-type, timeout, or invocation failure). */
  | "gateway_rejected"
  /** The gateway flagged its output for review; no draft summary results. */
  | "gateway_needs_review"
  /** The gateway returned output that did not conform to the response schema. */
  | "invalid_response";

/** Successful generation: the disposition with a DRAFT summary attached (Req 13.2). */
export interface GenerateDraftSummarySuccess {
  readonly outcome: "drafted";
  /** The disposition, carrying a non-final `draftSummary` (input unchanged). */
  readonly disposition: CaseDisposition;
}

/** Failed generation: the case is retained without a final summary (Req 13.6). */
export interface GenerateDraftSummaryFailure {
  readonly outcome: "failed";
  /** Machine-readable failure classification. */
  readonly reason: DraftSummaryFailureReason;
  /** Human-readable description reporting that generation did not complete. */
  readonly detail: string;
  /** The disposition, returned unchanged so no prior state is lost (Req 13.6). */
  readonly disposition: CaseDisposition;
  /** Underlying cause, when available (e.g. a gateway error). */
  readonly cause?: unknown;
}

/** Result of {@link generateDraftSummary}. */
export type GenerateDraftSummaryResult =
  | GenerateDraftSummarySuccess
  | GenerateDraftSummaryFailure;

/**
 * Choose the single source link for a statement (Req 13.2, 13.7).
 *
 * Returns the first source reference that is a valid link — when
 * `knownSourceObjectIds` is provided, the ref must be one of those ids;
 * otherwise any non-empty ref counts. Returns `undefined` when no valid link
 * exists, in which case the statement is flagged `unsourced`.
 */
function chooseSourceRef(
  statement: GroundedStatement,
  known: ReadonlySet<string> | undefined
): string | undefined {
  for (const ref of statement.sourceRefs) {
    if (known === undefined) {
      if (ref.length > 0) return ref;
    } else if (known.has(ref)) {
      return ref;
    }
  }
  return undefined;
}

/** Map one grounded statement onto a draft-summary statement (Req 13.2, 13.7). */
function toSummaryStatement(
  statement: GroundedStatement,
  known: ReadonlySet<string> | undefined
): DraftSummaryStatement {
  const sourceObjectRef = chooseSourceRef(statement, known);
  if (sourceObjectRef === undefined) {
    // Req 13.7: the statement cannot be linked to a source object.
    return { text: statement.statement, unsourced: true };
  }
  // Req 13.2: linked to exactly one source object.
  return { text: statement.statement, sourceObjectRef, unsourced: false };
}

/**
 * Generate a grounded draft case summary via the AI_Gateway and attach it to
 * the disposition (Req 13.2, 13.3, 13.6, 13.7).
 *
 * On success the disposition carries a `draftSummary` in DRAFT status
 * (`final: false`, Req 13.3): each statement links to exactly one source
 * object (Req 13.2), and any statement that cannot be linked is flagged
 * `unsourced` (Req 13.7). On any gateway failure (unavailable, rejected/timed
 * out, flagged for review, or unparseable output) generation is cancelled: an
 * error indication is returned and the disposition is retained without a final
 * summary (Req 13.6). The input disposition is never mutated.
 */
export async function generateDraftSummary(
  disposition: CaseDisposition,
  sourceDocuments: readonly SummarySourceDocument[],
  gateway: DraftSummaryGateway,
  options: GenerateDraftSummaryOptions
): Promise<GenerateDraftSummaryResult> {
  const nowFn = options.now ?? (() => new Date().toISOString());

  const request: GenerativeRequest = {
    taskType: SUMMARY_TASK_TYPE,
    invokingUserId: options.invokingUserId,
    systemInstructions:
      options.systemInstructions ?? DEFAULT_SUMMARY_SYSTEM_INSTRUCTIONS,
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
    // The gateway threw (e.g. unreachable). Retain without a final summary (Req 13.6).
    return {
      outcome: "failed",
      reason: "gateway_unavailable",
      detail: "Draft summary generation did not complete: the AI_Gateway was unavailable.",
      disposition,
      cause: error
    };
  }

  if (result.outcome === "rejected") {
    // Includes the 30-second timeout surfaced as a gateway rejection (Req 13.6).
    return {
      outcome: "failed",
      reason: "gateway_rejected",
      detail: `Draft summary generation did not complete: ${result.error.message}`,
      disposition,
      cause: result.error
    };
  }

  if (result.outcome === "needs_review") {
    return {
      outcome: "failed",
      reason: "gateway_needs_review",
      detail:
        "Draft summary generation did not complete: AI output was flagged for review " +
        `(${result.review.detail}).`,
      disposition
    };
  }

  const parsed = parseAiResponse(result.response.outputText);
  if (!parsed.ok) {
    return {
      outcome: "failed",
      reason: "invalid_response",
      detail: `Draft summary generation did not complete: ${parsed.detail}`,
      disposition
    };
  }

  const known =
    options.knownSourceObjectIds !== undefined
      ? new Set<string>(options.knownSourceObjectIds)
      : undefined;

  const statements = parsed.value.statements.map((statement) =>
    toSummaryStatement(statement, known)
  );

  // The summary is always produced in DRAFT status (Req 13.3): human approval
  // (approveDraftSummary, Req 13.5) is the only path to `final: true`.
  const drafted: CaseDisposition = {
    ...touchEnvelope(disposition, nowFn()),
    draftSummary: { statements, final: false }
  };

  return { outcome: "drafted", disposition: drafted };
}
