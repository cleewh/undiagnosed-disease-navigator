// services/reanalysis/src/approval.ts
//
// Approval gate for reanalysis runs (Reanalysis_Service, task 27.1,
// Requirement 15.4).
//
// A reanalysis run SHALL NOT start until an explicit human approval, recorded
// with the approver identity and timestamp, is captured (Req 15.4). This module
// records that approval onto a Reanalysis_Candidate and rejects any attempt from
// an unauthorised caller while leaving the candidate unchanged.
//
// Authorisation is passed IN as a decision (`isAuthorised`), mirroring the
// Review_Service / Contradiction_Service / MDT_Service convention: the RBAC
// matrix lives in apps/api/src/auth, and this service consumes an authorisation
// decision rather than re-encoding role rules. Approval also requires an
// explicit approval ACTION (`approve: true`) so a candidate is never
// auto-approved, exactly as the phenotype review gate requires explicit
// approval before confirmation.
//
// Every function is pure: for fixed inputs the output is byte-for-byte
// identical, and the input candidate is never mutated — a new candidate object
// carrying the recorded approval is returned when approval succeeds.

import { touchEnvelope, type ReanalysisCandidate } from "@udn/domain";

/** Source recorded for approval actions performed by the Reanalysis_Service. */
export const REANALYSIS_SOURCE = "Reanalysis_Service";

/** Input for an attempt to approve a reanalysis run for a candidate (Req 15.4). */
export interface ApproveReanalysisInput {
  /** Identity of the approving reviewer, recorded on the approval (Req 15.4). */
  readonly approverId: string;
  /** Approval timestamp, ISO-8601 UTC, recorded on the approval (Req 15.4). */
  readonly at: string;
  /** Whether the caller holds reanalysis-approval authorisation (Req 15.4). */
  readonly isAuthorised: boolean;
  /** The explicit approval action; must be `true` to approve (never auto-approve). */
  readonly approve: boolean;
}

/** Why a reanalysis-approval attempt was rejected. */
export type ReanalysisApprovalErrorCode =
  /** The caller is not an authorised approver (Req 15.4). */
  | "not_authorised"
  /** No explicit approval action was supplied (Req 15.4). */
  | "not_approved";

/** A structured reanalysis-approval failure. */
export interface ReanalysisApprovalError {
  readonly code: ReanalysisApprovalErrorCode;
  readonly message: string;
  readonly approverId: string;
  readonly candidateId: string;
}

/** Successful approval: the candidate carrying the recorded approval (input unchanged). */
export interface ApproveReanalysisSuccess {
  readonly ok: true;
  /** The candidate with `approval = { byId, at }` recorded (Req 15.4). */
  readonly candidate: ReanalysisCandidate;
}

/** Failed approval: the candidate is retained unchanged (Req 15.4). */
export interface ApproveReanalysisFailure {
  readonly ok: false;
  readonly error: ReanalysisApprovalError;
  /** The candidate, unchanged. */
  readonly candidate: ReanalysisCandidate;
}

/** Result of {@link approveReanalysisRun}. */
export type ApproveReanalysisResult = ApproveReanalysisSuccess | ApproveReanalysisFailure;

/**
 * Record explicit human approval for a candidate's reanalysis run (Req 15.4).
 *
 * Approval is recorded ONLY when the caller is authorised AND supplies an
 * explicit approval action (`approve: true`):
 *
 *   * **Unauthorised** (`isAuthorised === false`) — rejected with a
 *     `not_authorised` error; the candidate is left unchanged.
 *   * **No explicit approval** (`approve !== true`) — rejected with a
 *     `not_approved` error; the candidate is left unchanged (never auto-approved).
 *   * **Authorised + approved** — the candidate gains `approval = { byId, at }`
 *     recording the approver identity and timestamp, and its envelope version is
 *     bumped via {@link touchEnvelope}.
 *
 * The input candidate is never mutated.
 */
export function approveReanalysisRun(
  candidate: ReanalysisCandidate,
  input: ApproveReanalysisInput
): ApproveReanalysisResult {
  if (!input.isAuthorised) {
    return {
      ok: false,
      candidate,
      error: {
        code: "not_authorised",
        approverId: input.approverId,
        candidateId: candidate.id,
        message: `Approver "${input.approverId}" is not authorised to approve reanalysis for candidate "${candidate.id}".`
      }
    };
  }

  if (input.approve !== true) {
    return {
      ok: false,
      candidate,
      error: {
        code: "not_approved",
        approverId: input.approverId,
        candidateId: candidate.id,
        message: `Reanalysis for candidate "${candidate.id}" was not approved: no explicit approval action was supplied.`
      }
    };
  }

  const approved: ReanalysisCandidate = {
    ...touchEnvelope(candidate, input.at),
    approval: { byId: input.approverId, at: input.at }
  };

  return { ok: true, candidate: approved };
}

/**
 * Whether a candidate carries a recorded human approval (Req 15.4). Used by the
 * run executor to enforce the approval gate before a reanalysis run starts.
 */
export function isReanalysisApproved(candidate: ReanalysisCandidate): boolean {
  return candidate.approval !== undefined;
}
