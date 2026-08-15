// services/ai-gateway/src/pipeline.ts
//
// AI_Gateway request pipeline: the caller-facing request shape plus the
// extension seams that later tasks layer on (12.2-12.5).
//
// Task 12.1 implements only the CORE stages (task-type allowlist, model-config
// check, provider invocation, timeout/abort). Each remaining responsibility is
// expressed here as a small, injectable hook interface with a trivial,
// behaviour-preserving default, so the core wiring never changes as later tasks
// replace a default with a real implementation:
//
//   - ContextFilter     -> 12.2 context restriction to authorised data (Req 19.6, 19.7)
//   - PromptBuilder      -> 12.2 delimited-segment prompt construction (Req 19.1, 19.2)
//   - InvocationLogger   -> 12.2 invocation log entries (Req 19.5)
//   - OutputValidator[]  -> 12.3 grounding + schema/allowlist validation (Req 18, 19.3, 19.4)
//                           and 12.4 failure/confidence gating (Req 20)
//   - GroundedInputCache -> 12.5 grounded-input cache (Req 32.2, 32.3)

import type { AiGatewayError } from "./errors.js";
import type { ModelRequest, ModelResponse } from "./model-provider.js";
import type { GenerativeTaskType } from "./task-types.js";

/**
 * A single item of case context supplied to a generative request, carrying its
 * source-object reference so grounding (12.3) can link statements back to it
 * and the synthetic-data provenance is preserved.
 */
export interface GatewayContextItem {
  /** Identifier of the source object this content came from (grounding seam). */
  readonly sourceObjectId: string;
  /** The untrusted content of the source object, presented to the model as data. */
  readonly content: string;
}

/**
 * The invoking user's authorised access scope over case data (Req 19.6, 19.7).
 *
 * The gateway restricts the model context to only those source objects the
 * caller is authorised to access. Callers resolve authorisation upstream
 * (Auth_Service / RBAC) and pass the resulting allowlist of source-object
 * identifiers here; the {@link ContextFilter} excludes any context item whose
 * `sourceObjectId` is not in this set and records the exclusion (19.7).
 */
export interface AuthorizedScope {
  /** Source-object identifiers the invoking user is authorised to access. */
  readonly authorizedSourceObjectIds: readonly string[];
}

/**
 * A caller-facing generative request. This is what services (Phenotype_Service,
 * Disposition_Service, ...) submit to the gateway. Fields beyond the core are
 * seams the later tasks consume; the core only requires `taskType`,
 * `invokingUserId`, `systemInstructions`, and `context`.
 */
export interface GenerativeRequest {
  /** Requested task type; validated against the allowlist (Req 16.5). */
  readonly taskType: string;
  /** Identity of the invoking user (context restriction 19.6, logging 19.5 seam). */
  readonly invokingUserId: string;
  /** Trusted system instructions (never sourced from case documents). */
  readonly systemInstructions: string;
  /** Untrusted case context items (context-restriction 12.2 / grounding 12.3 seam). */
  readonly context: readonly GatewayContextItem[];
  /**
   * The invoking user's authorised access scope (Req 19.6, 19.7). When present,
   * the {@link ContextFilter} restricts the model context to the source objects
   * it names. When absent, no authorisation restriction is applied at this
   * layer (the context is passed through unchanged).
   */
  readonly authorizedScope?: AuthorizedScope;
  /** Prompt template version, used in the cache key by 12.5 (Req 32.2). */
  readonly promptTemplateVersion?: string;
}

/**
 * Result of a gateway generative invocation.
 *
 * - `invoked` — a model was contacted, returned a response, and that response
 *   passed every configured output validator (Req 16.1, 18.1).
 * - `needs_review` — a model was contacted but its output failed validation
 *   (schema, grounding, support, or allowlist). The entire output is rejected
 *   and NOT persisted; the prior state is retained; the flagged output and its
 *   review indication are carried on the result and recorded for an authorised
 *   reviewer to retrieve (Req 18.3, 18.4, 18.5, 18.6, 19.3, 19.4).
 * - `rejected` — the request was refused and — for config/task-type/direct-
 *   access/invocation-failure reasons — either no model was invoked or the
 *   invocation itself failed.
 */
export type GenerativeInvocationResult =
  | {
      readonly outcome: "invoked";
      readonly modelId: string;
      readonly taskType: GenerativeTaskType;
      readonly response: ModelResponse;
    }
  | {
      readonly outcome: "needs_review";
      readonly modelId: string;
      readonly taskType: GenerativeTaskType;
      /** The flagged model output, returned verbatim for reviewer inspection (Req 18.6). */
      readonly response: ModelResponse;
      /** Identifier under which the flagged output is retrievable (Req 18.6). */
      readonly reviewId: string;
      /** Why the output was flagged, identifying the offending statement where applicable. */
      readonly review: ReviewIndication;
    }
  | {
      readonly outcome: "rejected";
      readonly error: AiGatewayError;
    };

/**
 * Machine-readable reason an output validator rejected a model response
 * (Req 18.3, 18.4, 18.5, 19.4). Each maps to a distinct acceptance criterion so
 * callers and reviewers can tell schema, grounding, support, and allowlist
 * failures apart.
 */
export type ValidationFailureReason =
  /** Output did not conform to the defined response schema (Req 18.5). */
  | "schema_violation"
  /** A statement was not linked to any source object (Req 18.3). */
  | "ungrounded_statement"
  /** A statement cited a source not present in the provided case data (Req 18.4). */
  | "unsupported_statement"
  /** Output did not match an allowlisted response structure (Req 19.3, 19.4). */
  | "allowlist_violation"
  /** Overall confidence was below the configured confidence threshold (Req 20.1, 20.2). */
  | "below_threshold_confidence";

/**
 * A review indication attached to flagged output (Req 18.3, 18.4, 18.5, 18.6).
 * Records why the output was flagged and, where the failure is attributable to
 * a single statement, identifies that offending statement.
 */
export interface ReviewIndication {
  /** The category of validation failure. */
  readonly reason: ValidationFailureReason;
  /** Human-readable description of the failure. */
  readonly detail: string;
  /** The specific statement that caused rejection, when attributable (Req 18.3, 18.4). */
  readonly offendingStatement?: string;
}

/**
 * Result of running a single {@link OutputValidator}: either the output is
 * valid at that validator, or it is rejected with a review indication.
 */
export type OutputValidationResult =
  | { readonly status: "valid" }
  | ({ readonly status: "rejected" } & ReviewIndication);

/**
 * A record of a single context item excluded by the {@link ContextFilter}
 * because the invoking user is not authorised to access it (Req 19.7). Surfaced
 * so the {@link InvocationLogger} can record the exclusion.
 */
export interface ExcludedContextRef {
  /** Identifier of the source object that was withheld from the model. */
  readonly sourceObjectId: string;
  /** Machine-readable reason the item was excluded. */
  readonly reason: "not-authorised";
}

/**
 * Result of context restriction (Req 19.6, 19.7): the items retained for the
 * model plus a record of every item excluded because it fell outside the
 * invoking user's authorised scope.
 */
export interface ContextFilterResult {
  /** Context items the invoking user is authorised to see (passed to the model). */
  readonly included: readonly GatewayContextItem[];
  /** Context items withheld because they were outside the authorised scope. */
  readonly excluded: readonly ExcludedContextRef[];
}

/**
 * Seam (12.2, Req 19.6/19.7): restrict the request context to only the case
 * data the invoking user is authorised to access, surfacing any exclusions so
 * they can be recorded in the invocation log.
 *
 * The trivial default returns the context unchanged with no exclusions; task
 * 12.2 supplies {@link scopeAwareContextFilter}, an authorisation-aware filter.
 */
export interface ContextFilter {
  filter(request: GenerativeRequest): ContextFilterResult;
}

/** Trivial context filter: identity (no restriction, no exclusions). */
export const passthroughContextFilter: ContextFilter = {
  filter(request: GenerativeRequest): ContextFilterResult {
    return { included: request.context, excluded: [] };
  }
};

/**
 * Seam (12.2, Req 19.1/19.2): build the provider-ready {@link ModelRequest},
 * placing system instructions and untrusted content in separate segments.
 *
 * The 12.1 default performs a minimal, safe construction (system instructions
 * verbatim; context concatenated into a clearly delimited data-only segment).
 * Task 12.2 replaces it with the full prompt-injection defence.
 */
export interface PromptBuilder {
  build(
    request: GenerativeRequest,
    context: readonly GatewayContextItem[],
    modelId: string,
    taskType: GenerativeTaskType
  ): ModelRequest;
}

/** Delimiter marking the untrusted, data-only segment in the default prompt. */
const UNTRUSTED_DATA_DELIMITER = "<<<CASE_DATA>>>";

/** 12.1 default prompt builder: minimal delimited-segment construction. */
export const defaultPromptBuilder: PromptBuilder = {
  build(
    request: GenerativeRequest,
    context: readonly GatewayContextItem[],
    modelId: string,
    taskType: GenerativeTaskType
  ): ModelRequest {
    const dataSegment = context
      .map((item) => `[source:${item.sourceObjectId}] ${item.content}`)
      .join("\n");
    return {
      modelId,
      taskType,
      systemInstructions: request.systemInstructions,
      userContent: `${UNTRUSTED_DATA_DELIMITER}\n${dataSegment}\n${UNTRUSTED_DATA_DELIMITER}`
    };
  }
};

/**
 * Outcome of output validation for an invocation (Req 19.5). Task 12.2 records
 * `not_validated` (no validators configured) or `not_applicable` (the request
 * was rejected before a model was contacted, so there was nothing to validate);
 * tasks 12.3/12.4 add the `passed`/`failed` outcomes of real validators.
 */
export type ValidationOutcome = "passed" | "failed" | "not_validated" | "not_applicable";

/**
 * An invocation log entry (Req 19.5, 19.7). Every model invocation the gateway
 * attempts produces exactly one entry carrying the model identifier, the
 * invoking user identifier, the invocation timestamp, and the validation
 * outcome, plus any context that was excluded for authorisation reasons.
 */
export interface InvocationLogEntry {
  /** The invoked (or would-be) model identifier (Req 19.5). */
  readonly modelId: string | undefined;
  /** The invoking user identifier (Req 19.5). */
  readonly invokingUserId: string;
  /** The requested task type. */
  readonly taskType: string;
  /** UTC ISO-8601 timestamp of the invocation attempt (Req 19.5). */
  readonly at: string;
  /** Coarse outcome of the attempt. */
  readonly outcome: "invoked" | "rejected";
  /** Validation outcome of the model output (Req 19.5). */
  readonly validationOutcome: ValidationOutcome;
  /**
   * Machine-readable reason a model invocation failed, present only on failed
   * invocation attempts (Req 20.5). The `at` timestamp records when the failure
   * was detected, so a failed attempt is logged with both a reason and a
   * timestamp.
   */
  readonly failureReason?: string;
  /** Context withheld because it was outside the authorised scope (Req 19.7). */
  readonly excludedContext: readonly ExcludedContextRef[];
}

/**
 * Seam (12.2, Req 19.5): record an invocation log entry. The 12.1 default is a
 * no-op; task 12.2 provides a durable logger with the full required fields.
 */
export interface InvocationLogger {
  record(entry: InvocationLogEntry): void;
}

/** 12.1 default invocation logger: no-op. */
export const noopInvocationLogger: InvocationLogger = {
  record(): void {
    // Intentionally empty; task 12.2 (Req 19.5) supplies the real logger.
  }
};

/**
 * Seam (12.3/12.4): validate a model response before the gateway returns it
 * (schema conformance, grounding, support, confidence gating). The 12.1 core
 * runs zero validators, so output is returned as-is; task 12.3 appends the
 * schema, allowlist, grounding, and support validators, and task 12.4 will add
 * confidence gating.
 *
 * A validator receives the raw {@link ModelResponse}, the originating
 * {@link GenerativeRequest}, and the authorised context items that were
 * actually supplied to the model (post context-restriction), so grounding and
 * support can be checked against the case data the model genuinely saw. It
 * returns an {@link OutputValidationResult}: `valid` to allow the next
 * validator to run, or `rejected` to flag the output for review. The gateway
 * stops at the first rejection and does not persist rejected output.
 */
export interface OutputValidator {
  validate(
    response: ModelResponse,
    request: GenerativeRequest,
    context: readonly GatewayContextItem[]
  ): OutputValidationResult | Promise<OutputValidationResult>;
}

/**
 * A flagged model output retained for review (Req 18.6). Records the verbatim
 * output, its review indication, and the invocation metadata needed to route it
 * to an authorised reviewer.
 */
export interface FlaggedOutput {
  /** Identifier assigned when the output was recorded. */
  readonly id: string;
  /** The verbatim model output that was flagged. */
  readonly response: ModelResponse;
  /** Why the output was flagged. */
  readonly review: ReviewIndication;
  /** The user whose invocation produced the flagged output. */
  readonly invokingUserId: string;
  /** The task type that produced the flagged output. */
  readonly taskType: GenerativeTaskType;
  /** UTC ISO-8601 timestamp the output was flagged. */
  readonly at: string;
}

/**
 * The authorisation context of a principal attempting to read flagged output
 * (Req 18.6). Flagged output is retrievable only by an authorised reviewer.
 */
export interface ReviewerContext {
  /** Identity of the principal requesting the flagged output. */
  readonly reviewerId: string;
  /** Whether the principal is authorised to review flagged AI output. */
  readonly isAuthorisedReviewer: boolean;
}

/**
 * Seam (12.3, Req 18.6): retain flagged output and make it available to an
 * authorised reviewer. The gateway records every flagged output here; retrieval
 * is gated on {@link ReviewerContext.isAuthorisedReviewer} so unauthorised
 * principals cannot read it.
 */
export interface FlaggedOutputStore {
  /** Record a flagged output and return the identifier it can be retrieved by. */
  record(flagged: Omit<FlaggedOutput, "id">): string;
  /** Retrieve a flagged output by id, only for an authorised reviewer (Req 18.6). */
  retrieve(id: string, reviewer: ReviewerContext): FlaggedOutput | undefined;
  /** List all flagged outputs, only for an authorised reviewer (Req 18.6). */
  list(reviewer: ReviewerContext): readonly FlaggedOutput[];
}

/**
 * Seam (12.5, Req 32.2/32.3): grounded-input cache keyed by a canonical hash of
 * (task type, model id, authorised context, prompt template version). The 12.1
 * default never hits (always computes), so behaviour is unchanged until task
 * 12.5 supplies a real cache.
 */
export interface GroundedInputCache {
  /** Return a cached response for `key`, or `undefined` on a miss. */
  get(key: string): ModelResponse | undefined;
  /** Store `value` under `key` for later hits. */
  set(key: string, value: ModelResponse): void;
}

/** 12.1 default cache: always misses and stores nothing. */
export const noGroundedInputCache: GroundedInputCache = {
  get(): ModelResponse | undefined {
    return undefined;
  },
  set(): void {
    // Intentionally empty; task 12.5 (Req 32.2, 32.3) supplies the real cache.
  }
};
