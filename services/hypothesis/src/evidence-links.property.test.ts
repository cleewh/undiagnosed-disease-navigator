// services/hypothesis/src/evidence-links.property.test.ts
//
// Property-based test for task 21.3 — Correctness Property 29.
//
// Feature: undiagnosed-disease-navigator, Property 29: Hypothesis cards always
// retain at least one evidence link
//
// Validates: Requirements 11.1, 11.2, 11.7
//
// A Hypothesis_Card is created with AT LEAST ONE supporting evidence item, a
// zero-evidence creation is rejected with no card produced, and every
// subsequent update (state or text) retains the card's evidence links
// unchanged.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { HYPOTHESIS_STATES, type HypothesisState } from "@udn/domain";

import {
  createHypothesis,
  updateHypothesisState,
  updateHypothesisText,
  type CreateHypothesisInput,
  type EvidenceInput
} from "./index.js";

const nonEmpty = fc.string({ minLength: 1, maxLength: 24 });

/** A single supporting evidence descriptor. */
const evidenceArb: fc.Arbitrary<EvidenceInput> = fc.record({
  sourceObjectRef: nonEmpty,
  kind: nonEmpty
});

/** One or more evidence descriptors (creation requires at least one). */
const evidenceListArb: fc.Arbitrary<EvidenceInput[]> = fc.array(evidenceArb, {
  minLength: 1,
  maxLength: 6
});

const stateArb: fc.Arbitrary<HypothesisState> = fc.constantFrom(...HYPOTHESIS_STATES);

/** Non-diagnostic replacement text used for the text-update retention check. */
const cleanTextArb: fc.Arbitrary<string> = fc.constantFrom(
  "Findings are consistent with a candidate explanation.",
  "This may suggest a possible contributor under consideration.",
  "The evidence warrants further review of a potential mechanism.",
  "Observations could be associated with the hedged hypothesis."
);

const isoAtArb: fc.Arbitrary<string> = fc
  .date({ min: new Date("2020-01-01T00:00:00.000Z"), max: new Date("2035-01-01T00:00:00.000Z") })
  .map((d) => d.toISOString());

function makeCreateInput(evidence: EvidenceInput[], caseId: string, at: string): CreateHypothesisInput {
  return {
    caseId,
    text: "A candidate explanation consistent with the confirmed phenotypes.",
    evidence,
    knowledgeSnapshotVersion: "snap-1",
    createdById: "user-1",
    at,
    isAuthorised: true
  };
}

describe("Feature: undiagnosed-disease-navigator, Property 29: Hypothesis cards always retain at least one evidence link", () => {
  // Feature: undiagnosed-disease-navigator, Property 29: Hypothesis cards always
  // retain at least one evidence link
  // Validates: Requirements 11.1, 11.2, 11.7
  it("links >=1 evidence item on create, rejects zero-evidence, and retains links across every update", () => {
    fc.assert(
      fc.property(
        evidenceListArb,
        stateArb,
        cleanTextArb,
        nonEmpty,
        isoAtArb,
        (evidence, newState, newText, userId, updateAt) => {
          // (Req 11.2) A zero-evidence creation is rejected with NO card.
          const rejected = createHypothesis({
            caseId: "Case-Z",
            text: "A candidate explanation.",
            evidence: [],
            knowledgeSnapshotVersion: "snap-z",
            createdById: "user-z",
            at: "2024-01-01T00:00:00.000Z",
            isAuthorised: true
          });
          expect(rejected.ok).toBe(false);
          if (rejected.ok) return;
          expect(rejected.error.code).toBe("no_evidence");

          // (Req 11.1) A created card links to at least one evidence item, one
          // per evidence input.
          const result = createHypothesis(makeCreateInput(evidence, "Case-1", updateAt));
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const { hypothesis, evidenceItems } = result.card;
          expect(evidenceItems.length).toBe(evidence.length);
          expect(hypothesis.evidenceItemIds.length).toBeGreaterThanOrEqual(1);
          expect(hypothesis.evidenceItemIds).toEqual(evidenceItems.map((item) => item.id));

          const originalLinks = [...hypothesis.evidenceItemIds];

          // (Req 11.7) An authorised state update retains the evidence links.
          const afterState = updateHypothesisState(hypothesis, {
            newState,
            userId,
            at: updateAt,
            isAuthorised: true
          });
          expect(afterState.ok).toBe(true);
          if (!afterState.ok) return;
          expect(afterState.hypothesis.evidenceItemIds).toEqual(originalLinks);

          // (Req 11.7) An authorised text update retains the evidence links.
          const afterText = updateHypothesisText(afterState.hypothesis, {
            text: newText,
            userId,
            at: updateAt,
            isAuthorised: true
          });
          expect(afterText.ok).toBe(true);
          if (!afterText.ok) return;
          expect(afterText.hypothesis.evidenceItemIds).toEqual(originalLinks);
          expect(afterText.hypothesis.evidenceItemIds.length).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
