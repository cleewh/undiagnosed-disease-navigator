// evaluation/src/grounding.ts
//
// AI-grounding scoring (Requirement 30.4).
//
// Computes the percentage of claims with valid source references, the
// unsupported-claim rate, the incorrect-source-link rate, the
// missing-uncertainty rate, and the output-validation failure rate, each in
// [0.0, 1.0]. Malformed submissions are excluded (Req 30.7).

import { ExclusionLog, partitionEntries } from "./exclusion.js";
import { ratio } from "./metrics.js";

/** One AI-generated claim inspected for grounding (Req 18, 30.4). */
export interface SubmittedClaim {
  /** Whether the claim links to at least one source object (Req 18.2). */
  hasSourceReference: boolean;
  /** Whether the claim is supported by the provided case data (Req 18.4). */
  supported: boolean;
  /** Whether the claim's source link resolves to the correct source object. */
  sourceLinkCorrect: boolean;
  /** Whether an uncertainty indicator accompanies the claim (Req 25.6). */
  hasUncertaintyIndicator: boolean;
}

/** A submitted AI-output grounding sample for one invocation/case (Req 30.4). */
export interface GroundingSubmission {
  caseId: string;
  claims: SubmittedClaim[];
  /** Whether the AI output passed schema/allowlist validation (Req 18.1, 18.5). */
  outputValidationPassed: boolean;
}

/** AI-grounding metrics, each in [0.0, 1.0] (Req 30.4). */
export interface GroundingMetrics {
  /** Fraction (0.0–1.0) of claims carrying a valid source reference. */
  validSourceReferenceRate: number;
  unsupportedClaimRate: number;
  incorrectSourceLinkRate: number;
  missingUncertaintyRate: number;
  outputValidationFailureRate: number;
}

function isSubmission(value: GroundingSubmission): boolean {
  return (
    typeof value.caseId === "string" &&
    value.caseId.length > 0 &&
    Array.isArray(value.claims) &&
    typeof value.outputValidationPassed === "boolean"
  );
}

/**
 * Score AI-grounding submissions. Malformed submissions are excluded and
 * recorded (Req 30.7); the remaining submissions contribute to the grounding
 * metrics (Req 30.4). Grounding scoring compares AI output against the provided
 * case data captured in each submission and does not require Ground_Truth.
 */
export function scoreAiGrounding(
  submissions: readonly GroundingSubmission[],
  log: ExclusionLog
): GroundingMetrics {
  const scored = partitionEntries(
    submissions,
    "ai-grounding",
    log,
    (submission) => {
      if (!isSubmission(submission)) {
        return {
          reason: "malformed-output",
          caseId:
            typeof submission?.caseId === "string"
              ? submission.caseId
              : undefined,
          detail: "grounding submission is missing claims or validation flag"
        };
      }
      return undefined;
    }
  );

  let totalClaims = 0;
  let validSourceRefs = 0;
  let unsupported = 0;
  let incorrectLinks = 0;
  let missingUncertainty = 0;
  let submissionCount = 0;
  let validationFailures = 0;

  for (const submission of scored) {
    submissionCount += 1;
    if (!submission.outputValidationPassed) {
      validationFailures += 1;
    }
    for (const claim of submission.claims) {
      totalClaims += 1;
      if (claim.hasSourceReference) {
        validSourceRefs += 1;
      }
      if (!claim.supported) {
        unsupported += 1;
      }
      // An incorrect source link is only meaningful where a link is present.
      if (claim.hasSourceReference && !claim.sourceLinkCorrect) {
        incorrectLinks += 1;
      }
      if (!claim.hasUncertaintyIndicator) {
        missingUncertainty += 1;
      }
    }
  }

  return {
    validSourceReferenceRate: ratio(validSourceRefs, totalClaims),
    unsupportedClaimRate: ratio(unsupported, totalClaims),
    incorrectSourceLinkRate: ratio(incorrectLinks, totalClaims),
    missingUncertaintyRate: ratio(missingUncertainty, totalClaims),
    outputValidationFailureRate: ratio(validationFailures, submissionCount)
  };
}
