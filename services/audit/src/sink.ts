// services/audit/src/sink.ts
//
// The Audit_Service persists audit events through a narrow, append-only sink
// interface. Abstracting the underlying writer (in production, the DynamoDB
// single-table repository) behind this interface keeps the recorder unit
// testable with an injected fake and avoids a hard build-time coupling to the
// concrete persistence client (Requirement 22, design: Audit_Service).
//
// The interface deliberately exposes only an append operation. Audit events
// are immutable with a 7-year retention (Req 22.3); there is intentionally no
// update or delete on the sink. The immutability guard that rejects
// modify/delete requests is implemented separately (task 6.2).

import type { AuditEvent } from "@udn/domain";

/**
 * Append-only destination for audit events.
 *
 * Implementations write a single, fully-formed {@link AuditEvent}. A write
 * that cannot be completed MUST reject (throw / return a rejected promise) so
 * that the recorder can apply its bounded-retry policy (Req 22.5). A resolved
 * promise indicates the event is durably recorded.
 */
export interface AuditSink {
  /**
   * Durably append a single audit event.
   *
   * @param event a complete, envelope-bearing audit event.
   * @throws when the event could not be recorded; the recorder treats any
   *   thrown error / rejected promise as a recording failure.
   */
  write(event: AuditEvent): Promise<void>;
}

/**
 * Convenience shape for callers that would rather supply a bare writer
 * function than an object implementing {@link AuditSink}. `sinkFromWriter`
 * adapts one into the other.
 */
export type AuditWriter = (event: AuditEvent) => Promise<void>;

/**
 * Adapt a plain writer function into an {@link AuditSink}.
 */
export function sinkFromWriter(write: AuditWriter): AuditSink {
  return { write };
}
