// services/prioritisation/src/factor-explanations.property.test.ts
//
// Property-based test for design Correctness Property 28 (task 20.6).
//
// Feature: undiagnosed-disease-navigator, Property 28: Each ranked item has a
// complete factor explanation and recorded logic version
//
// *For any* ranked variant or gene, its explanation enumerates every
// deterministic scoring factor and its contribution such that the contributions
// account for the assigned score, contains no AI-generated interpretation, and
// the completed ranking records the prioritisation logic version used.
//
// Validates: Requirements 10.5, 10.6, 10.7

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  CLINVAR_CLASSIFICATIONS,
  FACTOR_NAMES,
  FACTOR_WEIGHTS,
  GENE_DISEASE_STRENGTHS,
  MOLECULAR_CONSEQUENCES,
  PRIORITISATION_LOGIC_VERSION
} from "./factors.js";
import { prioritise, type PrioritisationItemInput } from "./scoring.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789".split("");

const idArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ID_ALPHABET), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""));

const itemArb: fc.Arbitrary<PrioritisationItemInput> = fc.record({
  id: idArb,
  kind: fc.constantFrom<PrioritisationItemInput["kind"]>("variant", "gene"),
  consequence: fc.constantFrom(...MOLECULAR_CONSEQUENCES),
  alleleFrequency: fc.double({ min: 0, max: 1, noNaN: true }),
  clinvarClassification: fc.constantFrom(...CLINVAR_CLASSIFICATIONS),
  geneDiseaseAssociation: fc.constantFrom(...GENE_DISEASE_STRENGTHS),
  inheritanceFit: fc.double({ min: 0, max: 1, noNaN: true }),
  phenotypeSimilarity: fc.double({ min: 0, max: 1, noNaN: true }),
  qualityPass: fc.boolean()
});

const itemsArb: fc.Arbitrary<PrioritisationItemInput[]> = fc.uniqueArray(itemArb, {
  minLength: 1,
  maxLength: 8,
  selector: (item) => item.id
});

// The only fields a deterministic factor explanation may carry — no free-text
// or interpretive field is permitted (Req 10.6).
const ALLOWED_EXPLANATION_KEYS = ["contribution", "factor", "rawValue", "weight"];

// ---------------------------------------------------------------------------
// Property 28
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 28: Each ranked item has a complete factor explanation and recorded logic version", () => {
  // Feature: undiagnosed-disease-navigator, Property 28: Each ranked item has a
  // complete factor explanation and recorded logic version
  // Validates: Requirements 10.5, 10.6, 10.7
  it("gives every ranked item a complete, purely-quantitative factor explanation and records the logic version", () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const result = prioritise(items);

        // The completed ranking records the logic version used (Req 10.7).
        expect(result.logicVersion).toBe(PRIORITISATION_LOGIC_VERSION);

        for (const ranked of result.ranked) {
          // Enumerates EVERY deterministic factor, in the fixed order (Req 10.5).
          expect(ranked.explanation.map((e) => e.factor)).toEqual([...FACTOR_NAMES]);
          expect(ranked.factorContributions.map((c) => c.factor)).toEqual([...FACTOR_NAMES]);

          // Each entry is purely quantitative: exactly the four numeric/string
          // fields, no AI-generated interpretation (Req 10.6).
          for (const entry of ranked.explanation) {
            expect(Object.keys(entry).sort()).toEqual(ALLOWED_EXPLANATION_KEYS);
            expect(entry.weight).toBe(FACTOR_WEIGHTS[entry.factor as keyof typeof FACTOR_WEIGHTS]);
            expect(Number.isFinite(entry.rawValue)).toBe(true);
            // Contribution is exactly weight × rawValue.
            expect(entry.contribution).toBeCloseTo(entry.weight * entry.rawValue, 12);
          }

          // The contributions account for the assigned score (Req 10.5).
          const summed = ranked.explanation.reduce((sum, e) => sum + e.contribution, 0);
          expect(ranked.score).toBeCloseTo(summed, 12);

          // The mirrored domain contributions match the explanation.
          expect(ranked.factorContributions.map((c) => c.contribution)).toEqual(
            ranked.explanation.map((e) => e.contribution)
          );

          // Every ranked item records the logic version (Req 10.7).
          expect(ranked.prioritisationLogicVersion).toBe(PRIORITISATION_LOGIC_VERSION);
        }
      }),
      { numRuns: 200 }
    );
  });
});
