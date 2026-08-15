// Presentational Audit-history screen (Task 30.1, Requirements 24.1, 24.2).
//
// Renders the immutable audit events recorded by the Audit_Service (Req 22):
// each event shows the actor identity, the action performed, the affected
// object identifier, and the UTC timestamp with at least second-level
// precision (Req 22.2). Corrections of AI output additionally show both the
// original and corrected values (Req 22.4). This component is purely
// presentational and props-driven — it records nothing itself and performs no
// interpretation; the audit records are immutable (Req 22.3).

/** The recordable actions on case data (Req 22.1). */
export type AuditAction = "create" | "modify" | "approve" | "reject" | "delete";

/** The original and corrected values captured when an AI output is corrected (Req 22.4). */
export interface AuditCorrection {
  /** The value before the user correction. */
  readonly originalValue: string;
  /** The value after the user correction. */
  readonly correctedValue: string;
}

/** View model for a single immutable audit event (Req 22.2, 22.3, 22.4). */
export interface AuditEventView {
  /** Stable audit-event identifier. */
  readonly id: string;
  /** Identity of the actor that performed the action (Req 22.2). */
  readonly actorId: string;
  /** The action performed (Req 22.1). */
  readonly action: AuditAction;
  /** Identifier of the object the action affected (Req 22.2). */
  readonly affectedObjectId: string;
  /**
   * UTC timestamp with at least second precision, as an ISO-8601 string
   * ending in "Z" (Req 22.2).
   */
  readonly at: string;
  /** Present only for AI-output corrections; carries both values (Req 22.4). */
  readonly correction?: AuditCorrection;
}

export interface AuditHistoryProps {
  /** Audit events in presentation order (most recent first is conventional). */
  readonly events: readonly AuditEventView[];
  /** Accessible caption/summary for the audit table. */
  readonly caption?: string;
  /** Message shown when there are no audit events to display. */
  readonly emptyMessage?: string;
}

const ACTION_LABELS: Readonly<Record<AuditAction, string>> = {
  create: "Create",
  modify: "Modify",
  approve: "Approve",
  reject: "Reject",
  delete: "Delete"
};

function actionLabel(action: AuditAction): string {
  return ACTION_LABELS[action] ?? action;
}

/**
 * Formats a UTC ISO timestamp for display, preserving at least second-level
 * precision and making the UTC zone explicit. Invalid input is shown verbatim
 * so nothing is silently dropped from the immutable record.
 */
function formatUtcTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  // e.g. "2025-02-14 09:31:07 UTC" — second precision, explicit zone.
  const date = parsed.toISOString().slice(0, 19).replace("T", " ");
  return `${date} UTC`;
}

/**
 * Renders the immutable audit history as a semantic, accessible table: a
 * caption names the region, column headers use `scope="col"`, and correction
 * rows expose the original and corrected values. All content is derived from
 * props; the component performs no recording or interpretation.
 */
export function AuditHistory({
  events,
  caption = "Immutable audit history",
  emptyMessage = "No audit events have been recorded."
}: AuditHistoryProps) {
  if (events.length === 0) {
    return (
      <p data-testid="audit-history-empty" className="audit-history__empty">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="audit-history" data-testid="audit-history">
      <table className="audit-history__table" data-testid="audit-history-table">
        <caption className="audit-history__caption">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Affected object</th>
            <th scope="col">Timestamp (UTC)</th>
            <th scope="col">Correction (original &rarr; corrected)</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} data-testid={`audit-event-${event.id}`}>
              <td className="audit-history__actor" data-testid={`audit-event-actor-${event.id}`}>
                {event.actorId}
              </td>
              <td data-testid={`audit-event-action-${event.id}`}>
                <span
                  className={`audit-history__action audit-history__action--${event.action}`}
                >
                  {actionLabel(event.action)}
                </span>
              </td>
              <td
                className="audit-history__object"
                data-testid={`audit-event-object-${event.id}`}
              >
                <code>{event.affectedObjectId}</code>
              </td>
              <td data-testid={`audit-event-timestamp-${event.id}`}>
                <time dateTime={event.at}>{formatUtcTimestamp(event.at)}</time>
              </td>
              <td data-testid={`audit-event-correction-${event.id}`}>
                {event.correction === undefined ? (
                  <span className="audit-history__no-correction" aria-label="No correction">
                    &mdash;
                  </span>
                ) : (
                  <span className="audit-history__correction">
                    <span className="audit-history__correction-original">
                      {event.correction.originalValue}
                    </span>
                    <span className="audit-history__correction-arrow" aria-hidden="true">
                      {" "}
                      &rarr;{" "}
                    </span>
                    <span className="audit-history__correction-corrected">
                      {event.correction.correctedValue}
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
