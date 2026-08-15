// services/safeguards/src/review-gating.property.test.ts
//
// Property-based test for patient-facing AI output review gating
// (Safeguards_Service, design "Patient-facing review gating").
//
// Feature: undiagnosed-disease-navigator, Property 62: Patient-facing AI output
// requires recorded human review
//
// Validates: Requirements 25.2, 25.3

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  gatePatientFacingOutput,
  canPresentPatientFacingOutput,
  type HumanReviewRecord,
  type PatientFacingOutput
} from "./review-gating.js";

/** A recorded review with an explicit approved/rejected decision. */
const reviewArb: fc.Arbitrary<HumanReviewRecord> = fc.record({
  reviewerId: fc.string({ minLength: 1, maxLength: 12 }),
  reviewedAt: fc.constant("2024-01-01T00:00:00.000Z"),
  decision: fc.constantFrom<"approved" | "rejected">("approved", "rejected")
});

/** Any patient-facing output: patient-facing or not, with or without a review. */
const outputArb: fc.Arbitrary<PatientFacingOutput> = fc.record({
  outputId: fc.string({ minLength: 1, maxLength: 12 }),
  patientFacing: fc.boolean(),
  review: fc.option(reviewArb, { nil: undefined })
});

/**
 * Independent oracle: an output is presentable iff it is not patient-facing, or
 * it is patient-facing and carries a recorded review whose decision is
 * "approved" (Req 25.2, 25.3).
 */
function shouldPresent(output: PatientFacingOutput): boolean {
  if (!output.patientFacing) {
    return true;
  }
  return output.review !== undefined && output.review.decision === "approved";
}

describe("Property 62: Patient-facing AI output requires recorded human review", () => {
  // Feature: undiagnosed-disease-navigator, Property 62: Patient-facing AI
  // output requires recorded human review
  // Validates: Requirements 25.2, 25.3
  it("presents patient-facing output iff a recorded approved review exists; non-patient-facing bypasses the gate; missing/unapproved review blocks with the right code", () => {
    fc.assert(
      fc.property(outputArb, (output) => {
        const expected = shouldPresent(output);
        const result = gatePatientFacingOutput(output);

        // The predicate agrees with the full guard, and both agree with the oracle.
        expect(result.ok).toBe(expected);
        expect(canPresentPatientFacingOutput(output)).toBe(expected);

        if (result.ok) {
          // Presentation cleared: identity preserved, and requiredReview reflects
          // whether the review gate applied (only for patient-facing output).
          expect(result.outputId).toBe(output.outputId);
          expect(result.requiredReview).toBe(output.patientFacing);
        } else {
          // Only patient-facing output is ever blocked.
          expect(output.patientFacing).toBe(true);
          if (output.review === undefined) {
            // Missing review blocks with a human-review-required indication.
            expect(result.error.code).toBe("human_review_required");
          } else {
            // A recorded-but-unapproved review blocks with review-not-approved.
            expect(output.review.decision).not.toBe("approved");
            expect(result.error.code).toBe("review_not_approved");
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
