// services/safeguards/src/manual-confirmation.ts
//
// Manual-confirmation gating of external sharing / family contact (task 29.1,
// Requirement 25.4).
//
// Requirement 25.4: the system never initiates external case sharing or family
// contact through automation, and IF such an action is requested, THEN an
// authorised user must manually confirm it before it proceeds.
//
// The confirmation decision is passed IN as an explicit, recorded value
// (`ManualConfirmation`), mirroring the Review_Service `isAuthorised` /
// explicit-action convention. This module deterministically decides whether an
// external action may proceed given the recorded confirmation.

import { fail, SafeguardViolationError, type GuardResult } from "./errors.js";

/** The external actions that require manual confirmation (Req 25.4). */
export type ExternalActionType = "external_share" | "family_contact";

/** The complete set of gated external action types. */
export const EXTERNAL_ACTION_TYPES: readonly ExternalActionType[] = [
  "external_share",
  "family_contact"
];

/** A recorded manual confirmation of an external action by an authorised user. */
export interface ManualConfirmation {
  /** Identity of the confirming user. */
  readonly confirmedById: string;
  /** Confirmation timestamp, ISO-8601 UTC. */
  readonly confirmedAt: string;
  /**
   * Whether the confirming user holds authorisation for the action. Supplied by
   * the RBAC enforcement layer, following the Review_Service convention. A
   * confirmation from an unauthorised user does not permit the action.
   */
  readonly isAuthorised: boolean;
}

/** A request to perform an external share / family-contact action. */
export interface ExternalActionRequest {
  /** The kind of external action requested. */
  readonly actionType: ExternalActionType;
  /**
   * Whether the request originates from automation. Automated initiation is
   * never permitted for these actions (Req 25.4).
   */
  readonly initiatedByAutomation: boolean;
  /** The recorded manual confirmation, if any. */
  readonly confirmation?: ManualConfirmation;
}

/** The external action may proceed. */
export interface ExternalActionAllowed {
  readonly actionType: ExternalActionType;
  /** Identity of the authorised user whose manual confirmation cleared the gate. */
  readonly confirmedById: string;
}

/** Result of {@link authoriseExternalAction}. */
export type ExternalActionResult = GuardResult<ExternalActionAllowed>;

/**
 * Decide whether an external share / family-contact action may proceed
 * (Req 25.4).
 *
 *   * **Initiated by automation** — blocked with `automation_not_permitted`;
 *     these actions never proceed through automation.
 *   * **No manual confirmation** — blocked with `manual_confirmation_required`.
 *   * **Confirmation by an unauthorised user** — blocked with `not_authorised`.
 *   * **Confirmed by an authorised user** — proceeds.
 *
 * Pure and deterministic: the input is never mutated.
 */
export function authoriseExternalAction(
  request: ExternalActionRequest
): ExternalActionResult {
  if (request.initiatedByAutomation) {
    return fail(
      "automation_not_permitted",
      `A "${request.actionType}" action cannot be initiated through automation; an authorised user must manually confirm it.`
    );
  }

  if (request.confirmation === undefined) {
    return fail(
      "manual_confirmation_required",
      `A "${request.actionType}" action requires manual confirmation by an authorised user before it can proceed.`
    );
  }

  if (!request.confirmation.isAuthorised) {
    return fail(
      "not_authorised",
      `User "${request.confirmation.confirmedById}" is not authorised to confirm a "${request.actionType}" action.`
    );
  }

  return {
    ok: true,
    actionType: request.actionType,
    confirmedById: request.confirmation.confirmedById
  };
}

/**
 * Convenience predicate: `true` iff {@link authoriseExternalAction} would allow
 * the action to proceed.
 */
export function canProceedWithExternalAction(request: ExternalActionRequest): boolean {
  return authoriseExternalAction(request).ok;
}

/**
 * Throwing variant of {@link authoriseExternalAction}. Returns the request on
 * success; throws {@link SafeguardViolationError} when the action is blocked.
 */
export function assertExternalActionAllowed(
  request: ExternalActionRequest
): ExternalActionRequest {
  const result = authoriseExternalAction(request);
  if (!result.ok) {
    throw new SafeguardViolationError(result.error.code, result.error.message);
  }
  return request;
}
