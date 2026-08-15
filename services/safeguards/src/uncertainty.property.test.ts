// services/safeguards/src/uncertainty.property.test.ts
//
// Property-based test for the AI-output uncertainty indicator
// (Safeguards_Service, design "Uncertainty indicator").
//
// Feature: undiagnosed-disease-navigator, Property 65: AI output is accompanied
// by a multi-level uncertainty indicator
//
// Validates: Requirements 25.6

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  attachUncertaintyIndicator,
  levelFromConfidence,
  rankOfLevel,
  hasValidUncertaintyIndicator,
  UNCERTAINTY_LEVELS,
  UNCERTAINTY_SCALE_SIZE
} from "./uncertainty.js";

/** Confidence values within the inclusive [0, 1] range. */
const inRangeArb: fc.Arbitrary<number> = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true
});

/** Confidence values outside [0, 1], including non-finite ones (Req 25.6). */
const outOfRangeArb: fc.Arbitrary<number> = fc.oneof(
  // Strict upper bound safely below 0 so no value can equal the inclusive
  // lower boundary 0 (which is a valid confidence).
  fc.double({ min: -1e6, max: -1e-6, noNaN: true, noDefaultInfinity: true }),
  // Strict lower bound safely above 1 so no value can equal the inclusive
  // upper boundary 1 (which is a valid confidence). Using 1 + Number.MIN_VALUE
  // rounds back to exactly 1.0 at float precision near 1, so use 1 + 1e-6.
  fc.double({ min: 1 + 1e-6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)
);

describe("Property 65: AI output is accompanied by a multi-level uncertainty indicator", () => {
  // Feature: undiagnosed-disease-navigator, Property 65: AI output is
  // accompanied by a multi-level uncertainty indicator
  // Validates: Requirements 25.6
  it("maps any confidence in [0,1] to a level on the >=3-level ordered scale with a consistent rank", () => {
    // The defined scale has at least three ordered levels (Req 25.6).
    expect(UNCERTAINTY_SCALE_SIZE).toBeGreaterThanOrEqual(3);
    expect(UNCERTAINTY_LEVELS.length).toBe(UNCERTAINTY_SCALE_SIZE);

    fc.assert(
      fc.property(inRangeArb, (confidence) => {
        const result = attachUncertaintyIndicator({ id: "ai-output" }, confidence);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const { indicator } = result;
        // Level lies on the defined scale and the indicator is well-formed.
        expect(UNCERTAINTY_LEVELS as readonly string[]).toContain(indicator.level);
        expect(hasValidUncertaintyIndicator(indicator)).toBe(true);

        // The scale exposes at least three ordered levels.
        expect(indicator.scaleSize).toBeGreaterThanOrEqual(3);
        expect(indicator.scaleSize).toBe(UNCERTAINTY_SCALE_SIZE);

        // Rank is 1-based, within the scale, and consistent with the level.
        expect(indicator.rank).toBe(rankOfLevel(indicator.level));
        expect(indicator.rank).toBeGreaterThanOrEqual(1);
        expect(indicator.rank).toBeLessThanOrEqual(indicator.scaleSize);

        // The standalone mapping agrees with the attached indicator.
        expect(indicator.level).toBe(levelFromConfidence(confidence));
      }),
      { numRuns: 200 }
    );
  });

  it("orders the scale so that higher confidence never maps to a lower rank", () => {
    fc.assert(
      fc.property(inRangeArb, inRangeArb, (a, b) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        expect(rankOfLevel(levelFromConfidence(hi))).toBeGreaterThanOrEqual(
          rankOfLevel(levelFromConfidence(lo))
        );
      }),
      { numRuns: 200 }
    );
  });

  it("rejects out-of-range confidence with invalid_confidence", () => {
    fc.assert(
      fc.property(outOfRangeArb, (confidence) => {
        const result = attachUncertaintyIndicator({ id: "ai-output" }, confidence);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("invalid_confidence");

        // The throwing mapping variant also rejects out-of-range values.
        expect(() => levelFromConfidence(confidence)).toThrow();
      }),
      { numRuns: 200 }
    );
  });
});
