// services/hypothesis/src/state-transitions.property.test.ts
//
// Property-based test for task 21.5 — Correctness Property 31.
//
// Feature: undiagnosed-disease-navigator, Property 31: Hypothesis state stays in
// the defined set and records transitions
//
// Validates: Requirements 11.4, 11.5
//
// An authorised state update always yields a state within HYPOTHESIS_STATES and
// appends a transition history entry recording (from, to, byId, at); a state
// outside the defined set is rejected and the card is left unchanged.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { HYPOTHESIS_STATES, type Hypothesis, type HypothesisState } from "@udn/domain";

import { createHypothesis, updateHypothesisState } from "./index.js";

const AT = "2024-01-01T00:00:00.000Z";

const definedStates: readonly HypothesisState[] = HYPOTHESIS_STATES;

/** One authorised state transition step: a target state, actor, and timestamp. */
const stepArb = fc.record({
  newState: fc.constantFrom(...definedStates),
  userId: fc.string({ minLength: 1, maxLength: 16 }),
  at: fc
    .date({ min: new Date("2020-01-01T00:00:00.000Z"), max: new Date("2035-01-01T00:00:00.000Z") })
    .map((d) => d.toISOString())
});

const stepsArb = fc.array(stepArb, { minLength: 1, maxLength: 10 });

/** Labels that are NOT members of the defined hypothesis-state set. */
const invalidStateArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((value) => !(definedStates as readonly string[]).includes(value));

function freshCard(): Hypothesis {
  const result = createHypothesis({
    caseId: "Case-1",
    text: "A candidate explanation consistent with the observed findings.",
    evidence: [{ sourceObjectRef: "ConfirmedPhenotype-1", kind: "confirmed_phenotype" }],
    knowledgeSnapshotVersion: "snap-1",
    createdById: "user-1",
    at: AT,
    isAuthorised: true
  });
  if (!result.ok) throw new Error(`expected creation to succeed, got ${result.error.code}`);
  return result.card.hypothesis;
}

describe("Feature: undiagnosed-disease-navigator, Property 31: Hypothesis state stays in the defined set and records transitions", () => {
  // Feature: undiagnosed-disease-navigator, Property 31: Hypothesis state stays
  // in the defined set and records transitions
  // Validates: Requirements 11.4, 11.5
  it("keeps the state within the defined set and appends a (from,to,byId,at) transition on every authorised update", () => {
    fc.assert(
      fc.property(stepsArb, (steps) => {
        let card = freshCard();
        expect(definedStates).toContain(card.state);

        for (const step of steps) {
          const previousState = card.state;
          const previousHistoryLength = card.stateHistory.length;

          const result = updateHypothesisState(card, {
            newState: step.newState,
            userId: step.userId,
            at: step.at,
            isAuthorised: true
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          // (Req 11.4) The resulting state is always a member of the set.
          expect(definedStates).toContain(result.hypothesis.state);
          expect(result.hypothesis.state).toBe(step.newState);

          // (Req 11.5) Exactly one transition entry is appended, recording the
          // previous state, the new state, the actor, and the timestamp.
          expect(result.hypothesis.stateHistory).toHaveLength(previousHistoryLength + 1);
          const entry = result.hypothesis.stateHistory[previousHistoryLength];
          expect(entry).toBeDefined();
          if (entry === undefined) return;
          expect(entry).toEqual({
            from: previousState,
            to: step.newState,
            byId: step.userId,
            at: step.at
          });

          // The input card is never mutated.
          expect(card.stateHistory).toHaveLength(previousHistoryLength);

          card = result.hypothesis;
        }
      }),
      { numRuns: 100 }
    );
  });

  it("rejects a state outside the defined set and leaves the card unchanged (Req 11.4)", () => {
    fc.assert(
      fc.property(invalidStateArb, fc.string({ minLength: 1, maxLength: 16 }), (invalid, userId) => {
        const card = freshCard();
        const result = updateHypothesisState(card, {
          newState: invalid as HypothesisState,
          userId,
          at: AT,
          isAuthorised: true
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("invalid_state");
        // The state is retained and no transition is recorded.
        expect(result.hypothesis.state).toBe(card.state);
        expect(result.hypothesis.stateHistory).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });
});
