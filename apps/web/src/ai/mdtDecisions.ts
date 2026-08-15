import { useSyncExternalStore } from "react";
import type { AuditEventView } from "../components/AuditHistory.js";

// Session-local store for MDT decisions ratified in the board room. When the
// chair ratifies a motion, the decision is recorded here and surfaced in the
// MDT decisions log and the Case audit history. In-memory only (resets on
// reload); a production build would persist these to the immutable audit trail.

export interface RatifiedDecision {
  readonly id: string;
  /** Date (YYYY-MM-DD) for the decisions table. */
  readonly date: string;
  /** Full ISO-8601 UTC timestamp for the audit trail. */
  readonly at: string;
  readonly decision: string;
  readonly outcome: string;
  readonly rationale: string;
  readonly chairLabel: string;
  readonly actorId: string;
}

let decisions: readonly RatifiedDecision[] = [];
const listeners = new Set<() => void>();

export function recordRatification(input: Omit<RatifiedDecision, "id" | "date" | "at">): void {
  const now = new Date();
  const decision: RatifiedDecision = {
    ...input,
    id: `mdt-ratify-${now.getTime()}`,
    date: now.toISOString().slice(0, 10),
    at: now.toISOString()
  };
  decisions = [decision, ...decisions];
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useRatifiedDecisions(): readonly RatifiedDecision[] {
  return useSyncExternalStore(subscribe, () => decisions, () => decisions);
}

/** Map ratified decisions to immutable audit-event view models. */
export function ratifiedAsAuditEvents(caseId: string): readonly AuditEventView[] {
  return decisions.map((d) => ({
    id: d.id,
    actorId: d.actorId,
    action: "approve" as const,
    affectedObjectId: `mdt-decision-${caseId}`,
    at: d.at
  }));
}
