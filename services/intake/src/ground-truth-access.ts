// services/intake/src/ground-truth-access.ts
//
// Application-level Ground_Truth access-restriction guard (task 8.2,
// Requirements 3.6, 2.10, 30.6).
//
// Ground_Truth is the hidden per-case "intended answer". The design isolates it
// in a separate S3 bucket whose IAM/bucket policy grants ONLY the offline
// Evaluation_Framework identity and denies everyone else with an authorization
// error (design: "S3 Object Layout" / "Evaluation_Framework and Athena";
// Requirements 2.10, 3.6, 30.6). This module mirrors that boundary at the
// APPLICATION layer so that a defence-in-depth guard exists regardless of where
// the code runs: read/write access to a Ground_Truth artifact is granted if and
// only if the requesting principal is the Evaluation_Framework; every other
// principal receives an authorization error and no data.
//
// The guard is PURE and DETERMINISTIC: it performs no I/O and the same
// (principal, mode) always yields the same decision. It is the sole sanctioned
// path to a sealed Ground_Truth payload — the payload is held in a module-level
// WeakMap keyed by the opaque sealed handle, so a non-Evaluation_Framework
// caller cannot reach the data by inspecting the handle's own properties.

import type { UserRole } from "@udn/domain";

/**
 * The sole identity permitted to read or write Ground_Truth: the offline
 * Evaluation_Framework (design "Evaluation_Framework and Athena"; Req 30.6).
 * No interactive role is ever granted access (design RBAC matrix row
 * "Access Ground_Truth" = denied for all seven roles; Req 2.10, 3.6).
 */
export const EVALUATION_FRAMEWORK_IDENTITY = "Evaluation_Framework" as const;

/**
 * The kind of a requesting principal. Only {@link EVALUATION_FRAMEWORK_IDENTITY}
 * is authorised for Ground_Truth; every other kind is denied. Interactive users
 * (any of the seven roles), other services, and anonymous callers are all
 * non-evaluation principals.
 */
export type PrincipalKind =
  | typeof EVALUATION_FRAMEWORK_IDENTITY
  | "InteractiveUser"
  | "Service"
  | "Anonymous";

/**
 * A requesting principal. `kind` alone determines Ground_Truth authorisation;
 * `roles` is carried for interactive users so callers can construct realistic
 * principals, but holding any interactive role NEVER grants Ground_Truth access
 * (Req 2.10, 3.6).
 */
export interface Principal {
  /** Stable identifier of the requester (user id, service name, etc.). */
  readonly id: string;
  /** The principal's kind; only the Evaluation_Framework is authorised. */
  readonly kind: PrincipalKind;
  /** Interactive roles held, if any. Never grants Ground_Truth access. */
  readonly roles?: readonly UserRole[];
}

/** Whether access is being requested to read or to write Ground_Truth. */
export type GroundTruthAccessMode = "read" | "write";

/** Machine-readable code carried by every Ground_Truth authorization error. */
export const GROUND_TRUTH_ACCESS_DENIED = "ground_truth_access_denied" as const;

/**
 * Construct the canonical Evaluation_Framework principal — the one identity
 * permitted to access Ground_Truth. Provided as a convenience so callers (and
 * the offline evaluation harness) do not hand-roll the literal.
 */
export function evaluationFrameworkPrincipal(
  id: string = EVALUATION_FRAMEWORK_IDENTITY
): Principal {
  return { id, kind: EVALUATION_FRAMEWORK_IDENTITY };
}

/**
 * The single capability check the guard turns on: is this principal the
 * Evaluation_Framework? Pure and deterministic (Req 2.10, 3.6, 30.6).
 */
export function isEvaluationFramework(principal: Principal): boolean {
  return principal.kind === EVALUATION_FRAMEWORK_IDENTITY;
}

/**
 * The authorization error returned/thrown when a non-Evaluation_Framework
 * principal attempts to read or write Ground_Truth (Req 3.6, 2.10, 30.6). It
 * names the offending principal, the attempted access mode, and the resource,
 * and carries a stable {@link GROUND_TRUTH_ACCESS_DENIED} `code`.
 */
export class GroundTruthAccessError extends Error {
  /** Stable machine-readable classification. */
  readonly code = GROUND_TRUTH_ACCESS_DENIED;
  /** Id of the denied principal. */
  readonly principalId: string;
  /** Kind of the denied principal. */
  readonly principalKind: PrincipalKind;
  /** The access mode that was denied. */
  readonly mode: GroundTruthAccessMode;
  /** The Ground_Truth resource whose access was denied. */
  readonly resource: string;

  constructor(
    principal: Principal,
    mode: GroundTruthAccessMode,
    resource: string
  ) {
    super(
      `Ground_Truth access denied: principal "${principal.id}" (${principal.kind}) ` +
        `may not ${mode} Ground_Truth resource "${resource}". Only the ` +
        `${EVALUATION_FRAMEWORK_IDENTITY} may access Ground_Truth.`
    );
    this.name = "GroundTruthAccessError";
    this.principalId = principal.id;
    this.principalKind = principal.kind;
    this.mode = mode;
    this.resource = resource;
    // Preserve the prototype chain when compiled to older targets.
    Object.setPrototypeOf(this, GroundTruthAccessError.prototype);
  }
}

/** Non-throwing authorization decision for Ground_Truth access. */
export type GroundTruthAccessDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly error: GroundTruthAccessError };

/**
 * Decide, without throwing, whether `principal` may access `resource` in `mode`.
 * Granted if and only if the principal is the Evaluation_Framework (Req 2.10,
 * 3.6, 30.6). Pure and deterministic.
 */
export function authorizeGroundTruthAccess(
  principal: Principal,
  mode: GroundTruthAccessMode,
  resource: string
): GroundTruthAccessDecision {
  if (isEvaluationFramework(principal)) {
    return { allow: true };
  }
  return {
    allow: false,
    error: new GroundTruthAccessError(principal, mode, resource)
  };
}

/**
 * An opaque, sealed Ground_Truth handle. Its own properties reveal only the
 * access classification and the resource identifier — never the protected
 * payload. The payload is reachable ONLY by passing this handle and an
 * Evaluation_Framework principal to {@link accessGroundTruth}.
 */
export interface SealedGroundTruth<T> {
  /** Always `"ground_truth"`: marks this as evaluation-only material. */
  readonly accessClassification: "ground_truth";
  /** Human-readable identifier of the Ground_Truth resource (e.g. its ref). */
  readonly resource: string;
  /** Phantom marker so the generic parameter is retained by the type system. */
  readonly __groundTruth: true;
}

/**
 * Payload store keyed by the opaque handle. A WeakMap keeps the protected data
 * off the handle object itself, so inspecting a {@link SealedGroundTruth} — by
 * a non-Evaluation_Framework caller or otherwise — never exposes the payload.
 */
const SEALED_PAYLOADS = new WeakMap<SealedGroundTruth<unknown>, unknown>();

/**
 * Seal a Ground_Truth payload behind the access guard. The returned handle can
 * be passed around freely; the payload is only retrievable via
 * {@link accessGroundTruth} with an Evaluation_Framework principal.
 */
export function sealGroundTruth<T>(
  resource: string,
  payload: T
): SealedGroundTruth<T> {
  const sealed: SealedGroundTruth<T> = Object.freeze({
    accessClassification: "ground_truth" as const,
    resource,
    __groundTruth: true as const
  });
  SEALED_PAYLOADS.set(sealed, payload);
  return sealed;
}

/**
 * Read a sealed Ground_Truth payload. Returns the payload ONLY when `principal`
 * is the Evaluation_Framework; otherwise throws a {@link GroundTruthAccessError}
 * and yields no data (Req 3.6, 2.10, 30.6).
 *
 * `mode` defaults to `"read"`; pass `"write"` when the access represents a
 * mutation, so the resulting authorization error records the correct mode. The
 * guard treats read and write identically for the allow/deny decision: both are
 * granted only to the Evaluation_Framework.
 *
 * @throws GroundTruthAccessError when `principal` is not the Evaluation_Framework.
 */
export function accessGroundTruth<T>(
  principal: Principal,
  sealed: SealedGroundTruth<T>,
  mode: GroundTruthAccessMode = "read"
): T {
  if (!isEvaluationFramework(principal)) {
    throw new GroundTruthAccessError(principal, mode, sealed.resource);
  }
  if (!SEALED_PAYLOADS.has(sealed)) {
    throw new Error(
      `Ground_Truth handle for "${sealed.resource}" was not produced by sealGroundTruth.`
    );
  }
  return SEALED_PAYLOADS.get(sealed) as T;
}
