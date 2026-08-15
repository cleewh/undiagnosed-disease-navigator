// services/ai-gateway/src/failure-handling.ts
//
// Failure handling and review gating for the AI_Gateway (Task 12.4, Requirement
// 20.1-20.6).
//
// This module supplies the two ingredients the gateway wires in for Req 20:
//
//   1. Confidence gating (20.1, 20.2). A model response carries a per-statement
//      confidence (see response-schema.ts). The OVERALL confidence of a response
//      is derived as the MINIMUM statement confidence — a response is only as
//      trustworthy as its least-confident statement. `confidenceGateValidator`
//      is an {@link OutputValidator} that rejects a structurally valid response
//      whose overall confidence falls below a configured threshold, marking it
//      for review with the reason `below_threshold_confidence`. Because it is a
//      validator, it flows through the gateway's existing stage-7 machinery:
//      the output is NOT persisted, prior state is retained, the flagged output
//      is recorded for an authorised reviewer, and a `needs_review` result
//      (never `invoked`) is returned (20.1, 20.2, 20.6).
//
//   2. Bounded retry (20.3, 20.4). `DEFAULT_MAX_INVOCATION_ATTEMPTS` is the
//      configured maximum number of provider invocation attempts (3). The
//      gateway retries a failed invocation up to this many attempts and, on
//      exhaustion, returns an error indication (Req 20.4). The count lives here
//      so the ceiling is defined in one place.

import type { ModelResponse } from "./model-provider.js";
import type { OutputValidationResult, OutputValidator } from "./pipeline.js";
import { parseAiResponse } from "./response-schema.js";

/**
 * The configured maximum number of provider invocation attempts before the
 * gateway gives up and returns an error indication (Req 20.3, 20.4). A value of
 * 3 means: one initial attempt plus up to two retries.
 */
export const DEFAULT_MAX_INVOCATION_ATTEMPTS = 3;

/**
 * Derive the OVERALL confidence of a model response as the minimum confidence
 * across its statements (Req 20.1). A response is only as confident as its
 * least-confident statement.
 *
 * Returns `undefined` when confidence cannot be derived — i.e. the output does
 * not parse against the response schema, or it carries no statements. In that
 * case confidence gating does not apply (a malformed output is the schema
 * validator's concern, not the confidence gate's), so the gate treats an
 * underivable confidence as passing and lets the other validators decide.
 */
export function deriveOverallConfidence(response: ModelResponse): number | undefined {
  const parsed = parseAiResponse(response.outputText);
  if (!parsed.ok) {
    return undefined;
  }
  const statements = parsed.value.statements;
  if (statements.length === 0) {
    return undefined;
  }
  let minimum = Number.POSITIVE_INFINITY;
  for (const statement of statements) {
    if (statement.confidence < minimum) {
      minimum = statement.confidence;
    }
  }
  return minimum;
}

/**
 * Build an {@link OutputValidator} that gates on overall confidence (Req 20.1,
 * 20.2). It rejects a response whose derived overall confidence is strictly
 * below `threshold`, returning a `below_threshold_confidence` review indication;
 * otherwise it passes.
 *
 * `threshold` must be a finite number in the inclusive range [0, 1] (the same
 * range as statement confidence); an out-of-range threshold is a wiring error.
 */
export function confidenceGateValidator(threshold: number): OutputValidator {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError(
      `confidence threshold must be a finite number in [0, 1]; received ${threshold}.`
    );
  }
  return {
    validate(response: ModelResponse): OutputValidationResult {
      const overall = deriveOverallConfidence(response);
      if (overall === undefined) {
        // Confidence cannot be derived (unparseable/empty); not this gate's
        // concern. Other validators handle structural failures.
        return { status: "valid" };
      }
      if (overall < threshold) {
        return {
          status: "rejected",
          reason: "below_threshold_confidence",
          detail: `overall confidence ${overall} is below the configured threshold ${threshold}`
        };
      }
      return { status: "valid" };
    }
  };
}
