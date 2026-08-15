// services/safeguards/src/review-gating.ts
//
// Patient-facing AI output review gating (task 29.1, Requirements 25.2, 25.3).
//
// Requirement 25.3: IF AI-generated output is designated as patient-facing and
// has not received recorded human review, THEN the output is blocked from being
// presented and a human-review-required indication is shown.
//
// Requirement 25.2: the system never finalises an autonomous diagnosis or
// treatment recommendation without an authorised human reviewer explicitly
// confirming the output.
//
// The human-review decision is passed IN as an explicit, recorded value
// (`HumanReviewRecord`), mirroring the Review_Service `isAuthorised` /
// explicit-action convention. This module does not perform the review; it
// deterministically decides whether an already-recorded review permits the
// output to be presented.

import { fail, SafeguardViolationError, type GuardResult } from "./errors.js";

/** A recorded human-review decision on an AI-generated output (Req 25.2, 25.3). */
export interface HumanReviewRecord {
  /** Identity of the reviewer who recorded the decision. */
  readonly reviewerId: string;
  /** Review timestamp, ISO-8601 UTC. */
  readonly reviewedAt: string;
  /** The explicit reviewer decision. Only "approved" permits presentation. */
  readonly decision: "approved" | "rejected";
}

/** An AI-generated output whose presentation is gated by review status. */
export interface PatientFacingOutput {
  /** Stable identifier of the output being gated. */
  readonly outputId: string;
  /**
   * Whether the output is designated patient-facing. Non-patient-facing output
   * is not subject to the review gate (Req 25.3 applies only to patient-facing
   * output).
   */
  readonly patientFacing: boolean;
  /** The recorded human review, if any has been performed. */
  readonly review?: HumanReviewRecord;
}

/** The output may be presented. */
export interface ReviewGateAllowed {
  readonly outputId: string;
  /** True when presentation required (and cleared) the review gate. */
  readonly requiredReview: boolean;
}

/** Result of {@link gatePatientFacingOutput}. */
export type ReviewGateResult = GuardResult<ReviewGateAllowed>;

/**
 * Decide whether an AI-generated output may be presented (Req 25.2, 25.3).
 *
 *   * **Not patient-facing** — presented; the review gate does not apply.
 *   * **Patient-facing, no recorded review** — blocked with a
 *     `human_review_required` indication (Req 25.3).
 *   * **Patient-facing, review recorded but not approved** — blocked with a
 *     `review_not_approved` indication; a rejected output is never finalised
 *     (Req 25.2).
 *   * **Patient-facing, review recorded and approved** — presented.
 *
 * Pure and deterministic: the input is never mutated.
 */
export function gatePatientFacingOutput(output: PatientFacingOutput): ReviewGateResult {
  if (!output.patientFacing) {
    return { ok: true, outputId: output.outputId, requiredReview: false };
  }

  if (output.review === undefined) {
    return fail(
      "human_review_required",
      `Patient-facing output "${output.outputId}" cannot be presented until a human review is recorded.`
    );
  }

  if (output.review.decision !== "approved") {
    return fail(
      "review_not_approved",
      `Patient-facing output "${output.outputId}" was reviewed by "${output.review.reviewerId}" but not approved, so it cannot be presented.`
    );
  }

  return { ok: true, outputId: output.outputId, requiredReview: true };
}

/**
 * Convenience predicate: `true` iff {@link gatePatientFacingOutput} would allow
 * the output to be presented.
 */
export function canPresentPatientFacingOutput(output: PatientFacingOutput): boolean {
  return gatePatientFacingOutput(output).ok;
}

/**
 * Throwing variant of {@link gatePatientFacingOutput}. Returns the cleared
 * output on success; throws {@link SafeguardViolationError} when the review gate
 * blocks presentation.
 */
export function assertPatientFacingOutputPresentable(
  output: PatientFacingOutput
): PatientFacingOutput {
  const result = gatePatientFacingOutput(output);
  if (!result.ok) {
    throw new SafeguardViolationError(result.error.code, result.error.message);
  }
  return output;
}
