// apps/api/src/auth/enforcement.ts
//
// RBAC enforcement wrapper for the Undiagnosed Disease Navigator
// (Auth_Service, design "Auth_Service, Cognito, and the RBAC Matrix").
//
// Task 5.3 (Req 21.4, 21.5): wrap the pure permission engine from rbac.ts with
// the *enforcement* behaviour the design mandates:
//
//   * Every create/read/update/delete on case data is checked against the RBAC
//     matrix. When the caller's role(s) do not permit the operation, the
//     wrapper DENIES it: it does not perform the mutation (the target data is
//     left unchanged), it returns a structured not-authorised result, and it
//     records an audit event capturing the actor identity, the attempted
//     operation, and the timestamp (Req 21.4).
//   * On a read, the wrapper filters a collection down to only the records the
//     caller's role(s) are authorised to access, excluding all others
//     (Req 21.5).
//
// The module is deterministic and free of I/O and generative-model calls. The
// permission decision comes entirely from {@link authorize}. The audit sink is
// injected (a narrow function or an {@link AuditRecorder}), so the wrapper is
// fully unit-testable without AWS.

import {
  utcNow,
  type AuditAction,
  type AccessClassification,
  type UserRole,
} from "@udn/domain";
import { AuditRecorder } from "@udn/audit";

import {
  authorize,
  isCapability,
  isOperation,
  type ActionInput,
  type AuthorizationAction,
  type Capability,
  type Operation,
  type ResourceContext,
} from "./rbac.js";
import type { AuthContext } from "./authorizer.js";

// ---------------------------------------------------------------------------
// Denial audit event
// ---------------------------------------------------------------------------

/**
 * The audit event emitted when the enforcement wrapper denies an operation
 * (Req 21.4). It captures the three fields the requirement mandates — the
 * actor identity, the attempted operation, and the timestamp — plus the
 * affected object and denial reason for traceability.
 */
export interface AuthorisationDenialEvent {
  /** Stable identity of the actor whose operation was denied (Req 21.4). */
  readonly actorId: string;
  /** Human-readable username of the actor, when known. */
  readonly actorUsername: string;
  /** The capability the actor attempted to act on. */
  readonly attemptedCapability: Capability;
  /** The operation the actor attempted (create/read/update/delete). */
  readonly attemptedOperation: Operation;
  /** The attempted operation as a `"capability:operation"` string (Req 21.4). */
  readonly attemptedAction: `${Capability}:${Operation}`;
  /** Identifier of the object the operation targeted. */
  readonly affectedObjectId: string;
  /** Owning case identifier for the targeted object. */
  readonly caseId: string;
  /** ISO-8601 UTC timestamp of the denied attempt (Req 21.4). */
  readonly at: string;
  /** The permission engine's reason for the denial. */
  readonly reason: string;
  /** Always `"denied"`; the enforcement wrapper only audits denials here. */
  readonly outcome: "denied";
}

/**
 * A narrow, injectable sink for {@link AuthorisationDenialEvent}s. Either a
 * plain function (ideal for unit tests — no AWS required) or a full
 * {@link AuditRecorder} from `@udn/audit`. When an {@link AuditRecorder} is
 * supplied, the denial is mapped onto a domain audit event via
 * {@link operationToAuditAction}.
 */
export type DenialAuditSink =
  | AuditRecorder
  | ((event: AuthorisationDenialEvent) => void | Promise<void>);

/**
 * Map an RBAC {@link Operation} to the closest domain {@link AuditAction}
 * (the audit vocabulary has no distinct "read"/"update" actions). A denied
 * mutation is recorded as its natural action; a denied read or update is
 * recorded as `"modify"`, the generic change action. The precise attempted
 * operation is always preserved verbatim on {@link AuthorisationDenialEvent},
 * so no information is lost when a narrow function sink is used.
 */
export function operationToAuditAction(operation: Operation): AuditAction {
  const mapping: Record<Operation, AuditAction> = {
    create: "create",
    read: "modify",
    update: "modify",
    delete: "delete",
  };
  return mapping[operation];
}

// ---------------------------------------------------------------------------
// Enforcement result
// ---------------------------------------------------------------------------

/** Outcome of an authorised operation: the mutation ran and produced `T`. */
export interface AuthorisedOutcome<T> {
  readonly authorised: true;
  readonly result: T;
}

/**
 * Outcome of a denied operation (Req 21.4): the mutation did NOT run, the
 * target data is unchanged, and a not-authorised indication is returned.
 */
export interface NotAuthorisedOutcome {
  readonly authorised: false;
  /** Human-readable reason for the denial. */
  readonly reason: string;
  /** The denial audit event that was recorded, echoed for the caller. */
  readonly auditEvent: AuthorisationDenialEvent;
}

/** The result of {@link enforce}: either the operation ran, or it was denied. */
export type EnforcementOutcome<T> = AuthorisedOutcome<T> | NotAuthorisedOutcome;

/** Arguments to {@link enforce}. */
export interface EnforceArgs<T> {
  /** The caller's authenticated identity and roles. */
  readonly actor: AuthContext;
  /** The role-gated action to authorise (capability + operation). */
  readonly action: ActionInput;
  /** Identifier of the object the operation targets (for the audit event). */
  readonly affectedObjectId: string;
  /** Owning case identifier for the targeted object (for the audit event). */
  readonly caseId: string;
  /**
   * The mutation to run ONLY if the operation is authorised. It is never
   * invoked on a denial, guaranteeing the target data is left unchanged
   * (Req 21.4).
   */
  readonly perform: () => T | Promise<T>;
  /** Sink that records the denial audit event (Req 21.4). */
  readonly audit: DenialAuditSink;
  /** Optional finer-grained authorisation context (see {@link ResourceContext}). */
  readonly resourceContext?: ResourceContext;
  /** Clock for the audit timestamp; injectable for tests. Defaults to {@link utcNow}. */
  readonly now?: () => string;
}

/** Resolve an {@link ActionInput} to a validated capability + operation. */
function resolveAction(action: ActionInput): AuthorizationAction | undefined {
  if (typeof action !== "string") {
    return isCapability(action.capability) && isOperation(action.operation)
      ? { capability: action.capability, operation: action.operation }
      : undefined;
  }
  const separator = action.indexOf(":");
  if (separator <= 0) return undefined;
  const capability = action.slice(0, separator);
  const operation = action.slice(separator + 1);
  if (!isCapability(capability) || !isOperation(operation)) return undefined;
  return { capability, operation };
}

/** Push a denial event through whichever sink form was supplied. */
async function recordDenial(
  sink: DenialAuditSink,
  event: AuthorisationDenialEvent,
): Promise<void> {
  if (typeof sink === "function") {
    await sink(event);
    return;
  }
  await sink.record({
    caseId: event.caseId,
    actorId: event.actorId,
    action: operationToAuditAction(event.attemptedOperation),
    affectedObjectId: event.affectedObjectId,
    at: event.at,
  });
}

/**
 * Enforce the RBAC matrix around a single case-data operation (Req 21.4).
 *
 * The caller's role(s) are checked against the requested action via the pure
 * {@link authorize} engine:
 *
 *   * **Allowed** — {@link EnforceArgs.perform} is invoked and its value is
 *     returned in an {@link AuthorisedOutcome}.
 *   * **Denied** — {@link EnforceArgs.perform} is NOT invoked (the target data
 *     is left unchanged), a {@link AuthorisationDenialEvent} capturing the
 *     actor, attempted operation, and timestamp is recorded through the
 *     injected audit sink, and a {@link NotAuthorisedOutcome} is returned.
 *
 * The function never throws for an unauthorised caller; denial is a normal,
 * structured result. An unknown/malformed action is treated as a denial.
 */
export async function enforce<T>(
  args: EnforceArgs<T>,
): Promise<EnforcementOutcome<T>> {
  const now = args.now ?? utcNow;
  const decision = authorize(args.actor.roles, args.action, args.resourceContext);

  if (decision.allow) {
    const result = await args.perform();
    return { authorised: true, result };
  }

  const resolved = resolveAction(args.action);
  const capability: Capability = resolved?.capability ?? "viewCase";
  const operation: Operation = resolved?.operation ?? "read";
  const reason =
    decision.reason ??
    `Role(s) [${args.actor.roles.join(", ")}] are not permitted to ${operation} on ${capability}`;

  const auditEvent: AuthorisationDenialEvent = {
    actorId: args.actor.userId,
    actorUsername: args.actor.username,
    attemptedCapability: capability,
    attemptedOperation: operation,
    attemptedAction: `${capability}:${operation}`,
    affectedObjectId: args.affectedObjectId,
    caseId: args.caseId,
    at: now(),
    reason,
    outcome: "denied",
  };

  await recordDenial(args.audit, auditEvent);

  return { authorised: false, reason, auditEvent };
}

// ---------------------------------------------------------------------------
// Read filtering (Req 21.5)
// ---------------------------------------------------------------------------

/**
 * The access requirements a record carries for read authorisation. A record
 * may declare an {@link accessClassification}, a {@link requiredCapability},
 * or both:
 *
 *   * `accessClassification: "ground_truth"` is readable by NO interactive
 *     role (it maps to the `accessGroundTruth` capability, denied to every
 *     role in the matrix). `"research"`/`"clinical"` place no restriction on
 *     their own.
 *   * `requiredCapability` gates the record behind read permission for that
 *     capability, evaluated through {@link authorize}.
 *
 * A record with neither field is unrestricted and always readable.
 */
export interface ReadAccessRequirement {
  readonly accessClassification?: AccessClassification;
  readonly requiredCapability?: Capability;
}

/**
 * Decide whether any of `roles` may read a record with the given access
 * requirement (Req 21.5). Pure and deterministic.
 */
export function isReadAuthorised(
  roles: readonly UserRole[],
  requirement: ReadAccessRequirement,
): boolean {
  if (requirement.accessClassification === "ground_truth") {
    return authorize(roles, "accessGroundTruth:read").allow;
  }
  if (requirement.requiredCapability !== undefined) {
    return authorize(roles, `${requirement.requiredCapability}:read`).allow;
  }
  return true;
}

/**
 * Filter a collection to only the records the caller's role(s) are authorised
 * to read, excluding all others (Req 21.5).
 *
 * When the records themselves carry {@link ReadAccessRequirement} fields the
 * two-argument form suffices. Otherwise supply a `select` accessor mapping each
 * record to its access requirement. The relative order of the retained records
 * is preserved, and no unauthorised record is ever included.
 */
export function filterAuthorisedReads<T extends ReadAccessRequirement>(
  roles: readonly UserRole[],
  records: readonly T[],
): T[];
export function filterAuthorisedReads<T>(
  roles: readonly UserRole[],
  records: readonly T[],
  select: (record: T) => ReadAccessRequirement,
): T[];
export function filterAuthorisedReads<T>(
  roles: readonly UserRole[],
  records: readonly T[],
  select?: (record: T) => ReadAccessRequirement,
): T[] {
  const toRequirement =
    select ?? ((record: T) => record as unknown as ReadAccessRequirement);
  return records.filter((record) =>
    isReadAuthorised(roles, toRequirement(record)),
  );
}
