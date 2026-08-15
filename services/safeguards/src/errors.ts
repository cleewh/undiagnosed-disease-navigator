// services/safeguards/src/errors.ts
//
// Shared error vocabulary and result shapes for the Safeguards package
// (Safeguards_Service, task 29.1, Requirements 25.2-25.6, 26.6).
//
// Every guard in this package is a pure, deterministic function that returns a
// structured {@link GuardResult} rather than throwing: for fixed inputs the
// result is byte-for-byte identical. This mirrors the Review_Service /
// Contradiction_Service convention where an authorisation or confirmation
// decision is passed IN as an explicit value, and the guard reports whether an
// action may proceed. A small number of `assert*` helpers additionally throw a
// typed error for callers that prefer exceptions (mirroring the apps/web
// classification helper), but the throwing helpers are layered on top of the
// result-returning guards.

/** The complete set of reasons a safeguard may block an action. */
export type SafeguardErrorCode =
  /** Patient-facing AI output has no recorded human review (Req 25.3). */
  | "human_review_required"
  /** A human review exists but did not approve the output (Req 25.2). */
  | "review_not_approved"
  /** An external share / family-contact action was initiated by automation (Req 25.4). */
  | "automation_not_permitted"
  /** An external share / family-contact action lacks manual confirmation (Req 25.4). */
  | "manual_confirmation_required"
  /** The confirming / acting user is not authorised (Req 25.4). */
  | "not_authorised"
  /** Research and clinical records were combined (Req 25.5). */
  | "mixed_classification"
  /** A classification value is outside the defined set (Req 25.5). */
  | "invalid_classification"
  /** A confidence value is outside the inclusive [0, 1] range (Req 25.6). */
  | "invalid_confidence"
  /** The transport channel is not encrypted (Req 26.6). */
  | "unencrypted_transport";

/** A structured, deterministic safeguard failure. */
export interface SafeguardError {
  readonly code: SafeguardErrorCode;
  readonly message: string;
}

/** A guard failure: the action is blocked and MUST NOT proceed. */
export interface GuardFailure {
  readonly ok: false;
  readonly error: SafeguardError;
}

/**
 * The result of a safeguard guard. On success `ok` is `true` and any
 * guard-specific fields (`TOk`) are present; on failure `ok` is `false` and a
 * structured {@link SafeguardError} explains why the action is blocked.
 */
export type GuardResult<TOk extends object = Record<never, never>> =
  | ({ readonly ok: true } & TOk)
  | GuardFailure;

/** Construct a {@link GuardFailure} with the given code and message. */
export function fail(code: SafeguardErrorCode, message: string): GuardFailure {
  return { ok: false, error: { code, message } };
}

/**
 * Base class for the throwing variants of the safeguards guards. Carries the
 * same structured {@link SafeguardErrorCode} as the result-returning guards so
 * that both styles share one error vocabulary.
 */
export class SafeguardViolationError extends Error {
  readonly code: SafeguardErrorCode;

  constructor(code: SafeguardErrorCode, message: string) {
    super(message);
    this.name = "SafeguardViolationError";
    this.code = code;
  }
}
