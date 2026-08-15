// services/audit/src/pending.ts
//
// Pending-event preservation for the Audit_Service (Requirement 22.5).
//
// When recording an audit event fails after exhausting all retries, the event
// is preserved so that a caller (or a background worker) can reprocess it
// later. The store is abstracted behind an interface so callers can back it
// with a durable queue (e.g. SQS / a DynamoDB dead-letter partition) in
// production while tests use the in-memory implementation below.

import type { AuditEvent } from "@udn/domain";

/**
 * A store of audit events that could not be recorded and are awaiting
 * reprocessing (Req 22.5).
 *
 * All operations may be synchronous or asynchronous; the recorder awaits them.
 */
export interface PendingAuditEventStore {
  /** Preserve an event that failed to record for later reprocessing. */
  preserve(event: AuditEvent): void | Promise<void>;
  /** Return the events currently awaiting reprocessing. */
  pending(): readonly AuditEvent[] | Promise<readonly AuditEvent[]>;
  /** Remove a preserved event once it has been successfully reprocessed. */
  remove(id: string): void | Promise<void>;
}

/**
 * Simple in-memory {@link PendingAuditEventStore}. Preserves insertion order
 * and deduplicates by envelope id (re-preserving the same id replaces the
 * earlier copy). Suitable for tests and single-process use; production
 * deployments should supply a durable implementation.
 */
export class InMemoryPendingStore implements PendingAuditEventStore {
  readonly #events = new Map<string, AuditEvent>();

  preserve(event: AuditEvent): void {
    this.#events.set(event.id, event);
  }

  pending(): readonly AuditEvent[] {
    return [...this.#events.values()];
  }

  remove(id: string): void {
    this.#events.delete(id);
  }

  /** Number of events currently awaiting reprocessing. */
  get size(): number {
    return this.#events.size;
  }
}
