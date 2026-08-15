// services/safeguards/src/classification-separation.property.test.ts
//
// Property-based test for research vs clinical classification separation
// (Safeguards_Service, design "Classification separation").
//
// Feature: undiagnosed-disease-navigator, Property 64: Research and clinical
// records are never combined
//
// Validates: Requirements 25.5

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  guardClassificationCombination,
  CASE_CLASSIFICATIONS,
  type CaseClassification
} from "./classification.js";

/** Values outside the defined case-classification set (Req 25.5). */
const INVALID_VALUES = ["ground_truth", "", "RESEARCH", "unknown", "mixed"] as const;

/**
 * A value that may be a valid case classification or an out-of-set value. The
 * guard accepts `readonly CaseClassification[]`, so out-of-set values are cast
 * to exercise the runtime `invalid_classification` path.
 */
const valueArb: fc.Arbitrary<CaseClassification> = fc.oneof(
  fc.constantFrom(...CASE_CLASSIFICATIONS),
  fc.constantFrom(...INVALID_VALUES) as unknown as fc.Arbitrary<CaseClassification>
);

const valuesArb: fc.Arbitrary<readonly CaseClassification[]> = fc.array(valueArb, {
  maxLength: 6
});

const VALID_SET: ReadonlySet<string> = new Set(CASE_CLASSIFICATIONS);

/**
 * Independent oracle over the raw values, encoding the guard's precedence: an
 * out-of-set value yields `invalid_classification`; otherwise a mix of distinct
 * valid values yields `mixed_classification`; otherwise the set is allowed.
 */
function oracle(
  values: readonly string[]
): { readonly ok: true } | { readonly ok: false; readonly code: string } {
  const hasInvalid = values.some((value) => !VALID_SET.has(value));
  if (hasInvalid) {
    return { ok: false, code: "invalid_classification" };
  }
  const distinct = new Set(values);
  if (distinct.size > 1) {
    return { ok: false, code: "mixed_classification" };
  }
  return { ok: true };
}

describe("Property 64: Research and clinical records are never combined", () => {
  // Feature: undiagnosed-disease-navigator, Property 64: Research and clinical
  // records are never combined
  // Validates: Requirements 25.5
  it("allows a set iff all values are valid and identical; a research+clinical mix is mixed_classification; an invalid value is invalid_classification", () => {
    fc.assert(
      fc.property(valuesArb, (values) => {
        const expected = oracle(values);
        const result = guardClassificationCombination(values);

        expect(result.ok).toBe(expected.ok);

        if (result.ok) {
          if (expected.ok) {
            // A uniform (or empty) valid set returns its single shared value.
            const shared = values.length === 0 ? undefined : values[0];
            expect(result.classification).toBe(shared);
          }
        } else if (!expected.ok) {
          expect(result.error.code).toBe(expected.code);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("blocks any research+clinical mix with mixed_classification", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<CaseClassification>("research", "clinical"), {
          minLength: 2,
          maxLength: 8
        }),
        (values) => {
          const hasResearch = values.includes("research");
          const hasClinical = values.includes("clinical");
          fc.pre(hasResearch && hasClinical);

          const result = guardClassificationCombination(values);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("mixed_classification");
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
