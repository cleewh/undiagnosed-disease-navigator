import { useSyncExternalStore } from "react";

// Session-local AI oversight log. Tracks how many AI outputs were generated,
// clinician decisions (accept/flag/dismiss), and guardrail interventions — the
// human-in-the-loop governance signal for the board. In-memory only (resets on
// reload); a production build would persist these to the immutable audit trail.

export interface OversightState {
  readonly generated: number;
  readonly accepted: number;
  readonly flagged: number;
  readonly dismissed: number;
  readonly guardrailPassed: number;
  readonly guardrailIntervened: number;
}

let state: OversightState = {
  generated: 0,
  accepted: 0,
  flagged: 0,
  dismissed: 0,
  guardrailPassed: 0,
  guardrailIntervened: 0
};

const listeners = new Set<() => void>();

function set(next: OversightState): void {
  state = next;
  listeners.forEach((l) => l());
}

export function recordGenerated(guardrail?: string): void {
  set({
    ...state,
    generated: state.generated + 1,
    guardrailPassed: state.guardrailPassed + (guardrail === "passed" ? 1 : 0),
    guardrailIntervened: state.guardrailIntervened + (guardrail === "intervened" ? 1 : 0)
  });
}

export function recordDecision(kind: "accepted" | "flagged" | "dismissed"): void {
  set({ ...state, [kind]: state[kind] + 1 });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useOversight(): OversightState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
