// services/disposition/src/classification.property.test.ts
//
// Property-based test for disposition-driven case classification
// (Disposition_Service, task 24.2, design "Property 35").
//
// Feature: undiagnosed-disease-navigator, Property 35: Case classification
// reflects disposition
//
// Validates: Requirements 13.1, 13.4

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { AccessClassification, Case, DispositionState, InheritanceModel } from "@udn/domain";

import {
  caseStatusForDisposition,
  classifyDisposition,
  isUnresolvedDisposition,
  recordDisposition
} from "./disposition.js";

/** The three terminal disposition states (domain `DispositionState`). */
const DISPOSITION_STATES: readonly DispositionState[] = [
  "confirmed_diagnosis",
  "closed_non_genetic",
  "unresolved"
];

/**
 * The disposition states that resolve a case. This oracle is defined
 * independently of the implementation set so the test genuinely pins the
 * Unresolved_Case rule (Req 13.4).
 */
const RESOLVING: ReadonlySet<DispositionState> = new Set<DispositionState>([
  "confirmed_diagnosis",
  "closed_non_genetic"
]);

const dispositionStateArb: fc.Arbitrary<DispositionState> =
  fc.constantFrom(...DISPOSITION_STATES);

const inheritanceModelArb: fc.Arbitrary<InheritanceModel> = fc.constantFrom(
  "sporadic",
  "autosomal_recessive",
  "autosomal_dominant",
  "x_linked",
  "mitochondrial",
  "uncertain"
);

const accessClassificationArb: fc.Arbitrary<AccessClassification> =
  fc.constantFrom("research", "clinical");

/**
 * Generate a valid, provenance-carrying `Case` in a NON-terminal starting
 * status so recording a disposition is an observable transition (Req 13.1).
 */
const caseArb: fc.Arbitrary<Case> = fc.record({
  caseId: fc.string({ minLength: 1, maxLength: 8 }).map((suffix) => `Case-${suffix}`),
  version: fc.integer({ min: 1, max: 20 }),
  startStatus: fc.constantFrom("intake" as const, "in_review" as const),
  accessClassification: accessClassificationArb,
  clinicalArea: fc.constantFrom("neuromuscular", "metabolic", "renal", "cardiac", "multisystem"),
  archetype: fc.constantFrom("unsolved_case", "dual_diagnosis", "phenocopy", "mosaic_variant"),
  inheritanceModel: inheritanceModelArb,
  familyBased: fc.boolean()
}).map((fields): Case => ({
  id: fields.caseId,
  entityType: "Case",
  caseId: fields.caseId,
  source: "Intake_Service",
  version: fields.version,
  status: fields.startStatus,
  provenance: {
    sourceId: "intake-0",
    versionId: "1",
    createdById: "coordinator-1",
    ingestedAt: "2023-12-01T00:00:00.000Z"
  },
  accessClassification: fields.accessClassification,
  createdAt: "2023-12-01T00:00:00.000Z",
  modifiedAt: "2023-12-15T00:00:00.000Z",
  createdById: "coordinator-1",
  syntheticIndicator: true,
  clinicalArea: fields.clinicalArea,
  archetype: fields.archetype,
  inheritanceModel: fields.inheritanceModel,
  familyBased: fields.familyBased,
  dispositionStatus: fields.startStatus
}));

const AT = "2024-01-01T00:00:00.000Z";

describe("Property 35: Case classification reflects disposition", () => {
  // Feature: undiagnosed-disease-navigator, Property 35: Case classification
  // reflects disposition
  // Validates: Requirements 13.1, 13.4
  it("sets case status from the disposition and classifies Unresolved_Case iff not resolved", () => {
    fc.assert(
      fc.property(caseArb, dispositionStateArb, (caseEntity, state) => {
        const resolved = RESOLVING.has(state);

        // Req 13.4: the classification is the biconditional of "not resolved".
        expect(isUnresolvedDisposition(state)).toBe(!resolved);
        expect(classifyDisposition(state)).toBe(
          resolved ? "Resolved_Case" : "Unresolved_Case"
        );

        const result = recordDisposition(caseEntity, {
          dispositionState: state,
          recordedById: "coordinator-1",
          at: AT,
          isAuthorised: true
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // Req 13.1: recording sets the case status to the disposition state,
        // matching the pure status-mapping function exactly.
        expect(result.case.dispositionStatus).toBe(state);
        expect(result.case.dispositionStatus).toBe(caseStatusForDisposition(state));

        // Req 13.4: the reported classification is the Unresolved_Case
        // biconditional and agrees with the classifier over the same input.
        expect(result.classification).toBe(
          resolved ? "Resolved_Case" : "Unresolved_Case"
        );
        expect(result.classification === "Unresolved_Case").toBe(!resolved);
        expect(result.classification).toBe(classifyDisposition(state));

        // The disposition record carries the recorded terminal state, and the
        // input case is never mutated (its status is unchanged).
        expect(result.disposition.dispositionState).toBe(state);
        expect(caseEntity.dispositionStatus).toBe(caseEntity.status);
      }),
      { numRuns: 200 }
    );
  });
});
