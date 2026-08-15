// services/contradiction/src/no-auto-resolution.property.test.ts
//
// Property-based test for the no-auto-resolution invariant (Contradiction_Service,
// task 15.3).
//
// Feature: undiagnosed-disease-navigator, Property 19: Contradictions are never
// auto-resolved
//
// Validates: Requirements 7.5, 7.6
//
// Property 19 (design): for any automated contradiction evaluation, no
// contradiction record transitions to resolved; a resolved status arises only
// from an authorised resolution recording outcome, rationale, reviewer
// identity, and timestamp.
//
// This drives the deterministic engine with randomly generated evidence and
// asserts two complementary things straight from the acceptance criteria:
//
//   1. Detection never auto-resolves (Req 7.5): whatever evidence is supplied,
//      `detectContradictions` only ever emits records with status "unresolved"
//      and no `resolution` payload. The system by itself never yields a
//      resolved record. The optional retry wrapper `evaluateWithRetry` is held
//      to the same standard, since it is the automated evaluation path.
//
//   2. A resolved status arises ONLY from an explicit authorised resolution
//      (Req 7.6): calling `resolveContradiction` with an authorised reviewer is
//      the sole transition to "resolved", and it records the outcome,
//      rationale, reviewer identity, and timestamp. An unauthorised attempt is
//      rejected and leaves the record unresolved (never auto-resolved).

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  detectContradictions,
  evaluateWithRetry,
  resolveContradiction,
  type ContradictionEvidenceItem,
  type EvidenceValue,
  type DetectContradictionsOptions,
  type ResolveContradictionInput
} from "./detection.js";

const OPTIONS: DetectContradictionsOptions = {
  caseId: "case-1",
  createdById: "system",
  source: "Contradiction_Service",
  now: "2024-01-01T00:00:00.000Z"
};

// ---------------------------------------------------------------------------
// Smart generators
// ---------------------------------------------------------------------------
//
// Draw entities, attributes, sources, and values from small pools so that
// genuine multi-source conflicts (the groups that actually yield records) arise
// frequently. This concentrates generated inputs on the interesting region
// where detection has something to potentially resolve, rather than scattering
// unique tuples that never produce a record.

const entityArb = fc.constantFrom("patient-1", "patient-2", "phenotype-1");
const attributeArb = fc.constantFrom(
  "phenotype:HP:0001250",
  "onsetAge",
  "sex",
  "familyHistory"
);
const sourceArb = fc.constantFrom(
  "Observation/obs-1",
  "ClinicalDocument/doc-9",
  "Observation/onset-a",
  "narrative",
  "lab"
);
const valueArb: fc.Arbitrary<EvidenceValue> = fc.oneof(
  fc.constantFrom<EvidenceValue>(
    "present",
    " present ",
    "absent",
    "female",
    "male",
    "5",
    3,
    5,
    7,
    true,
    false
  ),
  fc.integer({ min: 0, max: 4 }),
  fc.string({ maxLength: 4 })
);

const evidenceItemArb: fc.Arbitrary<ContradictionEvidenceItem> = fc.record({
  sourceRef: sourceArb,
  caseEntityId: entityArb,
  attribute: attributeArb,
  value: valueArb,
  status: fc.constantFrom<"confirmed" | "candidate">("confirmed", "candidate")
});

const evidenceItemsArb: fc.Arbitrary<ContradictionEvidenceItem[]> = fc.array(
  evidenceItemArb,
  { maxLength: 12 }
);

/** An authorised resolution attempt (Req 7.6). */
const authorisedResolutionArb: fc.Arbitrary<ResolveContradictionInput> = fc.record({
  outcome: fc.constantFrom("upheld", "dismissed", "merged", "corrected"),
  rationale: fc.string({ minLength: 1, maxLength: 24 }),
  reviewerId: fc.constantFrom("reviewer-a", "reviewer-b", "clinician-1"),
  at: fc.constantFrom(
    "2024-02-01T09:30:00.000Z",
    "2024-03-15T12:00:00.000Z",
    "2024-06-30T23:59:59.000Z"
  ),
  isAuthorised: fc.constant(true)
});

/** An unauthorised resolution attempt (Req 7.7 — must NOT resolve). */
const unauthorisedResolutionArb: fc.Arbitrary<ResolveContradictionInput> = fc.record({
  outcome: fc.constantFrom("upheld", "dismissed"),
  rationale: fc.string({ minLength: 1, maxLength: 24 }),
  reviewerId: fc.constantFrom("intruder", "guest"),
  at: fc.constantFrom("2024-02-01T09:30:00.000Z", "2024-03-15T12:00:00.000Z"),
  isAuthorised: fc.constant(false)
});

describe("Property 19: Contradictions are never auto-resolved", () => {
  // Feature: undiagnosed-disease-navigator, Property 19: Contradictions are
  // never auto-resolved
  // Validates: Requirements 7.5, 7.6

  it("Feature: undiagnosed-disease-navigator, Property 19: Contradictions are never auto-resolved — detection and automated evaluation only ever emit unresolved records", () => {
    fc.assert(
      fc.property(evidenceItemsArb, (items) => {
        // The automated system, run directly, never auto-resolves (Req 7.5).
        const detected = detectContradictions(items, OPTIONS);
        for (const record of detected) {
          expect(record.status).toBe("unresolved");
          expect(record.resolution).toBeUndefined();
        }

        // The automated retry-driven evaluation path is held to the same
        // standard: it never produces a resolved record on its own (Req 7.5).
        const evaluated = evaluateWithRetry(() => detectContradictions(items, OPTIONS));
        expect(evaluated.status).toBe("completed");
        for (const record of evaluated.contradictions) {
          expect(record.status).toBe("unresolved");
          expect(record.resolution).toBeUndefined();
        }
      }),
      { numRuns: 200 }
    );
  });

  it("Feature: undiagnosed-disease-navigator, Property 19: Contradictions are never auto-resolved — a resolved status arises only from an explicit authorised resolution", () => {
    fc.assert(
      fc.property(
        evidenceItemsArb,
        authorisedResolutionArb,
        unauthorisedResolutionArb,
        (items, authorised, unauthorised) => {
          const detected = detectContradictions(items, OPTIONS);

          for (const record of detected) {
            // Precondition: detection produced an unresolved record (Req 7.5).
            expect(record.status).toBe("unresolved");
            expect(record.resolution).toBeUndefined();

            // An unauthorised attempt does NOT resolve: the record is retained
            // unchanged in its unresolved status (Req 7.7), so no back-door
            // auto-resolution exists.
            const rejected = resolveContradiction(record, unauthorised);
            expect(rejected.ok).toBe(false);
            expect(rejected.record.status).toBe("unresolved");
            expect(rejected.record.resolution).toBeUndefined();
            // The original record is never mutated.
            expect(record.status).toBe("unresolved");
            expect(record.resolution).toBeUndefined();

            // The ONLY transition to "resolved" is an explicit authorised
            // resolution, which records outcome, rationale, reviewer identity,
            // and timestamp (Req 7.6).
            const accepted = resolveContradiction(record, authorised);
            expect(accepted.ok).toBe(true);
            if (!accepted.ok) return;
            expect(accepted.record.status).toBe("resolved");
            expect(accepted.record.resolution).toEqual({
              outcome: authorised.outcome,
              rationale: authorised.rationale,
              byId: authorised.reviewerId,
              at: authorised.at
            });

            // Resolving is non-mutating: the source record stays unresolved.
            expect(record.status).toBe("unresolved");
            expect(record.resolution).toBeUndefined();
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
