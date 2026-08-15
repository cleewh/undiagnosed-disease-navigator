// services/disposition/src/disposition.ts
//
// Case disposition, classification, and draft-summary approval
// (Disposition_Service, task 24.1, Requirement 13).
//
// This module holds the DETERMINISTIC parts of the Disposition_Service. It
// never calls a generative model (only summary drafting goes through the
// AI_Gateway — see summary.ts). It:
//
//   * sets the case status from a recorded disposition (Req 13.1);
//   * classifies a case as an Unresolved_Case unless its disposition is a
//     confirmed diagnosis or a closed non-genetic explanation (Req 13.4);
//   * marks a draft case summary as final ONLY on an explicit, authorised human
//     approval action, keeping it in draft until then (Req 13.3, 13.5).
//
// Authorisation is passed IN as a decision (`isAuthorised`), mirroring the
// Review_Service convention (`approvePhenotype`): the RBAC matrix lives in one
// place (apps/api/src/auth) and the Disposition_Service consumes an
// authorisation decision rather than re-encoding role rules.
//
// Every function is pure and deterministic and never mutates its inputs — a new
// object is returned whenever state changes.

import {
  createEnvelope,
  touchEnvelope,
  type AccessClassification,
  type Case,
  type CaseDisposition,
  type CaseDispositionStatus,
  type DispositionState,
  type ProvenanceRef
} from "@udn/domain";

/** Origin recorded on records produced by the Disposition_Service. */
export const DISPOSITION_SOURCE = "Disposition_Service";

/**
 * A case's disposition-driven classification (Req 13.4).
 *
 * A case is an `Unresolved_Case` unless its disposition is a confirmed
 * diagnosis or a closed non-genetic explanation, in which case it is resolved.
 */
export type CaseClassification = "Unresolved_Case" | "Resolved_Case";

/**
 * The disposition states that resolve a case (Req 13.4). Any state NOT in this
 * set leaves the case classified as an `Unresolved_Case`.
 */
const RESOLVING_DISPOSITIONS: ReadonlySet<DispositionState> = new Set<DispositionState>([
  "confirmed_diagnosis",
  "closed_non_genetic"
]);

/**
 * Classify a case from its disposition state (Req 13.4).
 *
 * Returns `Resolved_Case` for a confirmed diagnosis or a closed non-genetic
 * explanation, and `Unresolved_Case` for every other disposition. This is the
 * single source of truth for the Unresolved_Case classification.
 */
export function classifyDisposition(state: DispositionState): CaseClassification {
  return RESOLVING_DISPOSITIONS.has(state) ? "Resolved_Case" : "Unresolved_Case";
}

/** Whether a disposition leaves the case as an Unresolved_Case (Req 13.4). */
export function isUnresolvedDisposition(state: DispositionState): boolean {
  return classifyDisposition(state) === "Unresolved_Case";
}

/**
 * Map a disposition state to the case status it sets (Req 13.1).
 *
 * The three disposition states are exactly the terminal case-status values, so
 * recording a disposition sets the case status to the recorded disposition
 * state.
 */
export function caseStatusForDisposition(state: DispositionState): CaseDispositionStatus {
  return state;
}

// ---------------------------------------------------------------------------
// Shared errors
// ---------------------------------------------------------------------------

/** Why a disposition action was rejected. */
export type DispositionErrorCode =
  /** The caller is not authorised for the action (Req 13, RBAC). */
  | "not_authorised"
  /** No explicit human approval action was supplied (Req 13.3, 13.5). */
  | "not_approved"
  /** There is no draft summary to approve (Req 13.5). */
  | "no_summary";

/** A structured disposition-action failure. */
export interface DispositionError {
  readonly code: DispositionErrorCode;
  readonly message: string;
  readonly actorId: string;
}

function notAuthorised(actorId: string, action: string, targetId: string): DispositionError {
  return {
    code: "not_authorised",
    actorId,
    message: `User "${actorId}" lacks authorisation to ${action} for "${targetId}".`
  };
}

// ---------------------------------------------------------------------------
// Record disposition (Req 13.1, 13.4)
// ---------------------------------------------------------------------------

/** Input for recording a case disposition. */
export interface RecordDispositionInput {
  /** The terminal disposition being recorded (Req 13.1, 13.4). */
  readonly dispositionState: DispositionState;
  /** Identity of the user recording the disposition. */
  readonly recordedById: string;
  /** Action timestamp, ISO-8601 UTC. */
  readonly at: string;
  /** Whether the caller is authorised to record a disposition (RBAC). */
  readonly isAuthorised: boolean;
  /** Origin for the disposition envelope; defaults to {@link DISPOSITION_SOURCE}. */
  readonly source?: string;
  /** Access classification for the disposition; defaults to the case's. */
  readonly accessClassification?: AccessClassification;
  /** Optional explicit id for the disposition record; generated when omitted. */
  readonly dispositionId?: string;
  /** Optional provenance; a deterministic default is derived from the case when omitted. */
  readonly provenance?: ProvenanceRef;
}

/** Successful disposition recording: the updated case and the disposition record. */
export interface RecordDispositionSuccess {
  readonly ok: true;
  /** The case with `dispositionStatus` set from the disposition (Req 13.1); new object. */
  readonly case: Case;
  /** The newly created disposition record (no summary yet — see generateDraftSummary). */
  readonly disposition: CaseDisposition;
  /** The disposition-driven classification (Req 13.4). */
  readonly classification: CaseClassification;
}

/** Failed disposition recording: the case is retained unchanged. */
export interface RecordDispositionFailure {
  readonly ok: false;
  readonly error: DispositionError;
  /** The case, unchanged. */
  readonly case: Case;
}

/** Result of {@link recordDisposition}. */
export type RecordDispositionResult = RecordDispositionSuccess | RecordDispositionFailure;

/**
 * Record a case disposition (Req 13.1, 13.4).
 *
 * An authorised recording sets the case status to the recorded disposition
 * state (Req 13.1), creates a `CaseDisposition` record, and reports the
 * disposition-driven classification (Req 13.4). No draft summary is generated
 * here — summary drafting is the sole gateway path (see
 * {@link generateDraftSummary}). An unauthorised attempt is rejected and leaves
 * the case unchanged. The input case is never mutated.
 */
export function recordDisposition(
  caseEntity: Case,
  input: RecordDispositionInput
): RecordDispositionResult {
  if (!input.isAuthorised) {
    return {
      ok: false,
      case: caseEntity,
      error: notAuthorised(input.recordedById, "record a disposition", caseEntity.id)
    };
  }

  const dispositionState = input.dispositionState;

  // Req 13.1: set the case status from the recorded disposition state.
  const updatedCase: Case = {
    ...touchEnvelope(caseEntity, input.at),
    dispositionStatus: caseStatusForDisposition(dispositionState)
  };

  const provenance: ProvenanceRef =
    input.provenance ?? {
      sourceId: caseEntity.id,
      versionId: String(caseEntity.version),
      createdById: input.recordedById,
      ingestedAt: input.at
    };

  const envelope = createEnvelope({
    ...(input.dispositionId !== undefined ? { id: input.dispositionId } : {}),
    entityType: "CaseDisposition",
    caseId: caseEntity.caseId,
    source: input.source ?? DISPOSITION_SOURCE,
    status: dispositionState,
    provenance,
    accessClassification: input.accessClassification ?? caseEntity.accessClassification,
    createdById: input.recordedById,
    now: input.at
  });

  const disposition: CaseDisposition = {
    ...envelope,
    entityType: "CaseDisposition",
    dispositionState
  };

  return {
    ok: true,
    case: updatedCase,
    disposition,
    classification: classifyDisposition(dispositionState)
  };
}

// ---------------------------------------------------------------------------
// Approve draft summary (Req 13.3, 13.5)
// ---------------------------------------------------------------------------

/** Input for an attempt to approve (finalise) a draft case summary. */
export interface ApproveDraftSummaryInput {
  /** Identity of the reviewer performing the approval (Req 13.5). */
  readonly reviewerId: string;
  /** Approval timestamp, ISO-8601 UTC (Req 13.5). */
  readonly at: string;
  /** Whether the reviewer holds approval authorisation (RBAC). */
  readonly isAuthorised: boolean;
  /** The explicit approval action; must be `true` to finalise (Req 13.3, 13.5). */
  readonly approve: boolean;
}

/** Successful approval: the disposition with its summary marked final (Req 13.5). */
export interface ApproveDraftSummarySuccess {
  readonly ok: true;
  /** The disposition, with `draftSummary.final === true` (input unchanged). */
  readonly disposition: CaseDisposition;
}

/** Failed approval: the disposition is retained unchanged, summary stays draft. */
export interface ApproveDraftSummaryFailure {
  readonly ok: false;
  readonly error: DispositionError;
  /** The disposition, unchanged. */
  readonly disposition: CaseDisposition;
}

/** Result of {@link approveDraftSummary}. */
export type ApproveDraftSummaryResult =
  | ApproveDraftSummarySuccess
  | ApproveDraftSummaryFailure;

/**
 * Approve (finalise) a draft case summary (Req 13.3, 13.5).
 *
 * A summary is marked final ONLY when the reviewer is authorised AND supplies
 * an explicit approval action (`approve: true`):
 *
 *   * **Unauthorised** — rejected with `not_authorised`; unchanged (stays draft).
 *   * **No draft summary present** — rejected with `no_summary`; unchanged.
 *   * **No explicit approval** (`approve !== true`) — rejected with
 *     `not_approved`; the summary is retained in draft status (Req 13.3).
 *   * **Authorised + approved** — the summary is marked final (Req 13.5).
 *
 * The input disposition is never mutated.
 */
export function approveDraftSummary(
  disposition: CaseDisposition,
  input: ApproveDraftSummaryInput
): ApproveDraftSummaryResult {
  if (!input.isAuthorised) {
    return {
      ok: false,
      disposition,
      error: notAuthorised(input.reviewerId, "approve a draft summary", disposition.id)
    };
  }

  if (disposition.draftSummary === undefined) {
    return {
      ok: false,
      disposition,
      error: {
        code: "no_summary",
        actorId: input.reviewerId,
        message: `Case disposition "${disposition.id}" has no draft summary to approve.`
      }
    };
  }

  // Never auto-finalise: an explicit approval action is mandatory (Req 13.3, 13.5).
  if (input.approve !== true) {
    return {
      ok: false,
      disposition,
      error: {
        code: "not_approved",
        actorId: input.reviewerId,
        message: `Draft summary for "${disposition.id}" was not finalised: no explicit approval action was supplied.`
      }
    };
  }

  const finalised: CaseDisposition = {
    ...touchEnvelope(disposition, input.at),
    draftSummary: {
      statements: disposition.draftSummary.statements.map((statement) => ({ ...statement })),
      final: true
    }
  };

  return { ok: true, disposition: finalised };
}
