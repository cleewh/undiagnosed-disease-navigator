// services/review/src/review.ts
//
// Human review and approval of AI-extracted phenotypes (Review_Service,
// task 14.1, Requirement 6).
//
// This module turns a `PhenotypeCandidate` into a `ConfirmedPhenotype` ONLY on
// an explicit, authorised human approval action, and it never auto-confirms
// (Req 6.1, 6.2, 6.5). It also records reviewer-driven rejections (Req 6.3) and
// edits-before-approval (Req 6.4), and it rejects any action from a caller who
// is not an authorised reviewer while leaving the candidate state unchanged
// (Req 6.6).
//
// Authorisation is passed IN as a decision (`isAuthorised`), mirroring the
// established Contradiction_Service convention (`resolveContradiction`). This
// keeps the RBAC matrix in one place (apps/api/src/auth); the Review_Service
// consumes an authorisation decision rather than re-encoding role rules.
//
// Every function is pure and deterministic: for fixed inputs (candidate,
// reviewer identity, timestamp, envelope options) the output is byte-for-byte
// identical, and the input candidate is never mutated — a new candidate object
// is returned when its state changes.

import {
  createEnvelope,
  touchEnvelope,
  type AccessClassification,
  type ConfirmedPhenotype,
  type PhenotypeCandidate,
  type ProvenanceRef
} from "@udn/domain";

// ---------------------------------------------------------------------------
// Shared review inputs and errors
// ---------------------------------------------------------------------------

/** Origin recorded on records produced by the Review_Service. */
export const REVIEW_SOURCE = "Review_Service";

/** Status stamped on a produced `ConfirmedPhenotype` envelope. */
export const CONFIRMED_PHENOTYPE_STATUS = "confirmed";

/**
 * Fields common to every review action (approve/reject/edit).
 *
 * `isAuthorised` is the authorisation decision supplied by the caller (the
 * RBAC enforcement layer), following the Contradiction_Service convention. An
 * action from an unauthorised reviewer is rejected and leaves the candidate
 * unchanged (Req 6.6).
 */
export interface ReviewActionInput {
  /** Identity of the reviewer performing the action (Req 6.2, 6.3, 6.4). */
  readonly reviewerId: string;
  /** Action timestamp, ISO-8601 UTC (Req 6.2, 6.3, 6.4). */
  readonly at: string;
  /** Whether the reviewer holds review authorisation (Req 6.1, 6.6). */
  readonly isAuthorised: boolean;
}

/** Why a review action was rejected. */
export type ReviewErrorCode =
  /** The caller is not an authorised reviewer (Req 6.6). */
  | "not_authorised"
  /** No explicit human approval action was supplied (Req 6.1, 6.5). */
  | "not_approved";

/** A structured review-action failure. */
export interface ReviewError {
  readonly code: ReviewErrorCode;
  readonly message: string;
  readonly reviewerId: string;
}

/** Build the standard unauthorised-reviewer error (Req 6.6). */
function notAuthorised(reviewerId: string, action: string, candidateId: string): ReviewError {
  return {
    code: "not_authorised",
    reviewerId,
    message: `Reviewer "${reviewerId}" lacks review authorisation to ${action} phenotype candidate "${candidateId}".`
  };
}

// ---------------------------------------------------------------------------
// Approval (Req 6.1, 6.2, 6.5, 6.6)
// ---------------------------------------------------------------------------

/**
 * Input for an attempt to approve a phenotype candidate.
 *
 * `approve` is the explicit human approval action required by Req 6.1/6.5: it
 * MUST be `true` for a confirmation to occur. A falsy value yields a
 * `not_approved` error and no confirmation, guaranteeing nothing is confirmed
 * in the absence of an explicit approval.
 */
export interface ApprovePhenotypeInput extends ReviewActionInput {
  /** The explicit approval action; must be `true` to confirm (Req 6.1, 6.5). */
  readonly approve: boolean;
  /** Origin for the confirmed-phenotype envelope; defaults to {@link REVIEW_SOURCE}. */
  readonly source?: string;
  /** Access classification for the confirmed phenotype; defaults to the candidate's. */
  readonly accessClassification?: AccessClassification;
  /** Optional explicit id for the confirmed phenotype; generated when omitted. */
  readonly confirmedId?: string;
  /** Optional provenance; a deterministic default is derived from the candidate when omitted. */
  readonly provenance?: ProvenanceRef;
  /**
   * When the candidate was edited before approval, the original AI-extracted
   * value and the corrected value are carried onto the confirmed record for
   * traceability (Req 6.4, 25.7).
   */
  readonly originalValue?: unknown;
  readonly correctedValue?: unknown;
}

/** Successful approval: the confirmed phenotype and the candidate marked approved. */
export interface ApprovePhenotypeSuccess {
  readonly ok: true;
  /** The newly created confirmed phenotype, linked to the candidate (Req 6.2). */
  readonly confirmed: ConfirmedPhenotype;
  /** The candidate, transitioned to "approved" (input unchanged; new object). */
  readonly candidate: PhenotypeCandidate;
}

/** Failed approval: the candidate is retained unchanged (Req 6.5, 6.6). */
export interface ApprovePhenotypeFailure {
  readonly ok: false;
  readonly error: ReviewError;
  /** The candidate, unchanged. */
  readonly candidate: PhenotypeCandidate;
}

/** Result of {@link approvePhenotype}. */
export type ApprovePhenotypeResult = ApprovePhenotypeSuccess | ApprovePhenotypeFailure;

/**
 * Approve a phenotype candidate, creating a confirmed phenotype (Req 6.1, 6.2,
 * 6.5, 6.6).
 *
 * A confirmation happens ONLY when the reviewer is authorised AND supplies an
 * explicit approval action (`approve: true`):
 *
 *   * **Unauthorised** (`isAuthorised === false`) — rejected with a
 *     `not_authorised` error; the candidate is left unchanged (Req 6.6).
 *   * **No explicit approval** (`approve !== true`) — rejected with a
 *     `not_approved` error; nothing is confirmed (Req 6.1, 6.5).
 *   * **Authorised + approved** — a `ConfirmedPhenotype` is created, linked to
 *     the source candidate, recording the approving reviewer identity and
 *     approval timestamp (Req 6.2); the candidate transitions to "approved".
 *
 * The input candidate is never mutated.
 */
export function approvePhenotype(
  candidate: PhenotypeCandidate,
  input: ApprovePhenotypeInput
): ApprovePhenotypeResult {
  if (!input.isAuthorised) {
    return { ok: false, candidate, error: notAuthorised(input.reviewerId, "approve", candidate.id) };
  }

  // Never auto-confirm: an explicit approval action is mandatory (Req 6.1, 6.5).
  if (input.approve !== true) {
    return {
      ok: false,
      candidate,
      error: {
        code: "not_approved",
        reviewerId: input.reviewerId,
        message: `Phenotype candidate "${candidate.id}" was not confirmed: no explicit approval action was supplied.`
      }
    };
  }

  const provenance: ProvenanceRef =
    input.provenance ?? {
      sourceId: candidate.id,
      versionId: String(candidate.version),
      createdById: input.reviewerId,
      ingestedAt: input.at
    };

  const envelope = createEnvelope({
    ...(input.confirmedId !== undefined ? { id: input.confirmedId } : {}),
    entityType: "ConfirmedPhenotype",
    caseId: candidate.caseId,
    source: input.source ?? REVIEW_SOURCE,
    status: CONFIRMED_PHENOTYPE_STATUS,
    provenance,
    accessClassification: input.accessClassification ?? candidate.accessClassification,
    createdById: input.reviewerId,
    now: input.at
  });

  const confirmed: ConfirmedPhenotype = {
    ...envelope,
    entityType: "ConfirmedPhenotype",
    candidateId: candidate.id,
    approvedById: input.reviewerId,
    approvedAt: input.at,
    ...(input.originalValue !== undefined ? { originalValue: input.originalValue } : {}),
    ...(input.correctedValue !== undefined ? { correctedValue: input.correctedValue } : {})
  };

  const approvedCandidate: PhenotypeCandidate = {
    ...touchEnvelope(candidate, input.at),
    status: "approved"
  };

  return { ok: true, confirmed, candidate: approvedCandidate };
}

// ---------------------------------------------------------------------------
// Rejection (Req 6.3, 6.6)
// ---------------------------------------------------------------------------

/** Input for an attempt to reject a phenotype candidate. */
export interface RejectPhenotypeInput extends ReviewActionInput {
  /** Optional reviewer-supplied rationale for the rejection. */
  readonly rationale?: string;
}

/**
 * The recorded rejection (Req 6.3). No `ConfirmedPhenotype` is created; this
 * record captures the reviewer identity and rejection timestamp for audit.
 */
export interface PhenotypeRejectionRecord {
  /** The candidate that was rejected. */
  readonly candidateId: string;
  /** Identity of the rejecting reviewer (Req 6.3). */
  readonly rejectedById: string;
  /** Rejection timestamp, ISO-8601 UTC (Req 6.3). */
  readonly rejectedAt: string;
  /** Optional reviewer-supplied rationale. */
  readonly rationale?: string;
}

/** Successful rejection: the candidate marked rejected and the rejection record. */
export interface RejectPhenotypeSuccess {
  readonly ok: true;
  /** The candidate, transitioned to "rejected" (input unchanged; new object). */
  readonly candidate: PhenotypeCandidate;
  /** The recorded rejection (Req 6.3). */
  readonly rejection: PhenotypeRejectionRecord;
}

/** Failed rejection: the candidate is retained unchanged (Req 6.6). */
export interface RejectPhenotypeFailure {
  readonly ok: false;
  readonly error: ReviewError;
  readonly candidate: PhenotypeCandidate;
}

/** Result of {@link rejectPhenotype}. */
export type RejectPhenotypeResult = RejectPhenotypeSuccess | RejectPhenotypeFailure;

/**
 * Reject a phenotype candidate (Req 6.3, 6.6).
 *
 * An authorised reviewer's rejection records the reviewer identity and
 * rejection timestamp and transitions the candidate to "rejected"; NO confirmed
 * phenotype is created. An unauthorised reviewer's attempt is rejected with a
 * `not_authorised` error and leaves the candidate unchanged (Req 6.6). The
 * input candidate is never mutated.
 */
export function rejectPhenotype(
  candidate: PhenotypeCandidate,
  input: RejectPhenotypeInput
): RejectPhenotypeResult {
  if (!input.isAuthorised) {
    return { ok: false, candidate, error: notAuthorised(input.reviewerId, "reject", candidate.id) };
  }

  const rejection: PhenotypeRejectionRecord = {
    candidateId: candidate.id,
    rejectedById: input.reviewerId,
    rejectedAt: input.at,
    ...(input.rationale !== undefined ? { rationale: input.rationale } : {})
  };

  const rejectedCandidate: PhenotypeCandidate = {
    ...touchEnvelope(candidate, input.at),
    status: "rejected"
  };

  return { ok: true, candidate: rejectedCandidate, rejection };
}

// ---------------------------------------------------------------------------
// Edit before approval (Req 6.4, 6.6)
// ---------------------------------------------------------------------------

/** The candidate fields a reviewer may correct before approval. */
export type EditablePhenotypeFields = Partial<
  Pick<
    PhenotypeCandidate,
    "assertion" | "confidence" | "hpoMappings" | "alternatives" | "sourceObjectRef"
  >
>;

/** Input for an attempt to edit a phenotype candidate before approval. */
export interface EditPhenotypeInput extends ReviewActionInput {
  /**
   * The corrected field values to apply. Only the supplied fields are changed;
   * their prior AI-extracted values are captured in the produced edit record
   * (Req 6.4).
   */
  readonly changes: EditablePhenotypeFields;
}

/**
 * The recorded edit (Req 6.4): the original AI-extracted value, the corrected
 * value, the editing reviewer identity, and the edit timestamp.
 */
export interface PhenotypeEditRecord {
  /** The candidate that was edited. */
  readonly candidateId: string;
  /** The original AI-extracted values of the changed fields (Req 6.4). */
  readonly originalValue: EditablePhenotypeFields;
  /** The corrected values applied (Req 6.4). */
  readonly correctedValue: EditablePhenotypeFields;
  /** Identity of the editing reviewer (Req 6.4). */
  readonly editedById: string;
  /** Edit timestamp, ISO-8601 UTC (Req 6.4). */
  readonly editedAt: string;
}

/** Successful edit: the updated candidate (still awaiting approval) and the edit record. */
export interface EditPhenotypeSuccess {
  readonly ok: true;
  /** The candidate with corrections applied; still not confirmed (input unchanged). */
  readonly candidate: PhenotypeCandidate;
  /** The recorded edit capturing original and corrected values (Req 6.4). */
  readonly edit: PhenotypeEditRecord;
}

/** Failed edit: the candidate is retained unchanged (Req 6.6). */
export interface EditPhenotypeFailure {
  readonly ok: false;
  readonly error: ReviewError;
  readonly candidate: PhenotypeCandidate;
}

/** Result of {@link editPhenotype}. */
export type EditPhenotypeResult = EditPhenotypeSuccess | EditPhenotypeFailure;

/** Extract, from the candidate, the current values of exactly the fields being changed. */
function captureOriginal(
  candidate: PhenotypeCandidate,
  changes: EditablePhenotypeFields
): EditablePhenotypeFields {
  const original: EditablePhenotypeFields = {};
  if (changes.assertion !== undefined) original.assertion = candidate.assertion;
  if (changes.confidence !== undefined) original.confidence = candidate.confidence;
  if (changes.hpoMappings !== undefined) original.hpoMappings = candidate.hpoMappings;
  if (changes.alternatives !== undefined) original.alternatives = candidate.alternatives;
  if (changes.sourceObjectRef !== undefined) original.sourceObjectRef = candidate.sourceObjectRef;
  return original;
}

/**
 * Edit a phenotype candidate before approval (Req 6.4, 6.6).
 *
 * An authorised reviewer's edit applies the supplied corrections and records
 * the original AI-extracted values, the corrected values, the editing reviewer
 * identity, and the edit timestamp. Editing does NOT confirm the candidate: it
 * remains in review (its review status is left unchanged), preserving the
 * approval gate (Req 6.1, 6.5). An unauthorised reviewer's attempt is rejected
 * with a `not_authorised` error and leaves the candidate unchanged (Req 6.6).
 * The input candidate is never mutated.
 */
export function editPhenotype(
  candidate: PhenotypeCandidate,
  input: EditPhenotypeInput
): EditPhenotypeResult {
  if (!input.isAuthorised) {
    return { ok: false, candidate, error: notAuthorised(input.reviewerId, "edit", candidate.id) };
  }

  const originalValue = captureOriginal(candidate, input.changes);
  const correctedValue: EditablePhenotypeFields = { ...input.changes };

  const edit: PhenotypeEditRecord = {
    candidateId: candidate.id,
    originalValue,
    correctedValue,
    editedById: input.reviewerId,
    editedAt: input.at
  };

  // Apply corrections; the candidate stays in review — editing never confirms.
  const editedCandidate: PhenotypeCandidate = {
    ...touchEnvelope(candidate, input.at),
    ...input.changes
  };

  return { ok: true, candidate: editedCandidate, edit };
}
