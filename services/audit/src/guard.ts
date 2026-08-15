// services/audit/src/guard.ts
//
// Immutability guard for the Audit_Service (Requirement 22.3).
//
// Retained audit events are immutable records with a minimum 7-year retention;
// any request to modify or delete a retained event MUST be rejected and the
// original event preserved unchanged. The append-only AuditSink interface
// already omits update/delete operations by design, but that guarantee is
// implicit. This module makes it explicit and testable by:
//
//   1. `guardImmutability(...)` — a guard that rejects any attempt to modify or
//      delete a retained event with a structured error, so higher layers can
//      wrap mutation code paths and fail loudly.
//   2. `InMemoryImmutableAuditStore` — a create-only append store/adapter that
//      records events once, refuses to overwrite an existing event id, and
//      rejects modify/delete requests. It implements `AuditSink` so it can be
//      handed directly to an `AuditRecorder`.

import type { AuditEvent } from "@udn/domain";

import type { AuditSink } from "./sink.js";

/** A mutating operation that is forbidden on a retained audit event (Req 22.3). */
export type ForbiddenAuditOperation = "modify" | "delete";

/**
 * Error raised when a caller attempts to modify or delete a retained audit
 * event (Req 22.3). Carries the affected event id and the attempted operation
 * so the initiating action can surface a precise reason.
 */
export class AuditImmutabilityError extends Error {
  /** Stable, machine-readable error code. */
  readonly code = "AUDIT_EVENT_IMMUTABLE";
  /** The id of the retained event that was targeted. */
  readonly eventId: string;
  /** The forbidden operation that was attempted. */
  readonly operation: ForbiddenAuditOperation;

  constructor(eventId: string, operation: ForbiddenAuditOperation) {
    super(
      `Audit event ${eventId} is immutable (Req 22.3); the ${operation} request was rejected and the event preserved unchanged.`
    );
    this.name = "AuditImmutabilityError";
    this.eventId = eventId;
    this.operation = operation;
  }
}

/**
 * Reject an attempt to modify or delete a retained audit event (Req 22.3).
 *
 * This never returns normally; it always throws an {@link AuditImmutabilityError}.
 * It exists so that any code path that might otherwise mutate or remove a
 * retained event routes through a single, explicit rejection point, leaving the
 * event unchanged.
 *
 * @throws {AuditImmutabilityError} always.
 */
export function guardImmutability(
  event: Pick<AuditEvent, "id">,
  operation: ForbiddenAuditOperation
): never {
  throw new AuditImmutabilityError(event.id, operation);
}

/**
 * Append-only, create-only audit event store that enforces immutability
 * (Req 22.3). It:
 *
 * - records an event exactly once (`append`),
 * - refuses to overwrite an event whose id is already recorded (append is
 *   create-only, never an update),
 * - rejects every `modify` and `delete` request with an
 *   {@link AuditImmutabilityError}, preserving the retained event.
 *
 * It implements {@link AuditSink}, so it can be passed straight to an
 * `AuditRecorder`. Suitable for tests and single-process use; production
 * deployments back the sink with the append-only DynamoDB repository, which
 * enforces the same guarantee via conditional writes.
 */
export class InMemoryImmutableAuditStore implements AuditSink {
  readonly #events = new Map<string, AuditEvent>();

  /**
   * Durably append a single audit event (create-only).
   *
   * @throws {AuditImmutabilityError} if an event with the same id is already
   *   retained — overwriting a retained event is a forbidden modification.
   */
  async write(event: AuditEvent): Promise<void> {
    if (this.#events.has(event.id)) {
      // Re-writing an existing id would overwrite a retained event.
      throw new AuditImmutabilityError(event.id, "modify");
    }
    // Store a shallow copy so external mutation of the caller's object cannot
    // alter the retained record.
    this.#events.set(event.id, { ...event });
  }

  /** Return the retained event with the given id, or `undefined` if absent. */
  get(id: string): AuditEvent | undefined {
    const stored = this.#events.get(id);
    return stored ? { ...stored } : undefined;
  }

  /** Return all retained events in insertion order. */
  all(): readonly AuditEvent[] {
    return [...this.#events.values()].map((event) => ({ ...event }));
  }

  /** Number of retained events. */
  get size(): number {
    return this.#events.size;
  }

  /**
   * Reject a request to modify a retained event (Req 22.3). The retained event
   * is preserved unchanged.
   *
   * @throws {AuditImmutabilityError} always.
   */
  modify(id: string): never {
    return guardImmutability({ id }, "modify");
  }

  /**
   * Reject a request to delete a retained event (Req 22.3). The retained event
   * is preserved unchanged.
   *
   * @throws {AuditImmutabilityError} always.
   */
  delete(id: string): never {
    return guardImmutability({ id }, "delete");
  }
}
