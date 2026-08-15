// services/prioritisation/src/reproducibility.property.test.ts
//
// Property-based test for design Correctness Property 25 (task 20.3).
//
// Feature: undiagnosed-disease-navigator, Property 25: Prioritisation is
// deterministic and reproducible
//
// *For any* genomic input, running prioritisation two or more times on
// byte-for-byte identical inputs produces identical rankings in both order and
// assigned score — independent of the order in which the items are supplied.
//
// Validates: Requirements 10.1, 10.3

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  CLINVAR_CLASSIFICATIONS,
  GENE_DISEASE_STRENGTHS,
  MOLECULAR_CONSEQUENCES
} from "./factors.js";
import { prioritise, type PrioritisationItemInput } from "./scoring.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789".split("");

/** A non-empty alphanumeric identifier (never whitespace-only). */
const idArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ID_ALPHABET), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""));

/** A fully-populated, valid scoring input for one variant or gene. */
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

/** A list of items with unique identifiers (a valid prioritisation request). */
const itemsArb: fc.Arbitrary<PrioritisationItemInput[]> = fc.uniqueArray(itemArb, {
  minLength: 1,
  maxLength: 8,
  selector: (item) => item.id
});

/**
 * A scenario: the same items in their original order plus a full permutation of
 * exactly the same item references (order-independence input).
 */
const scenarioArb = itemsArb.chain((items) =>
  fc.record({
    items: fc.constant(items),
    shuffled: fc.shuffledSubarray(items, {
      minLength: items.length,
      maxLength: items.length
    })
  })
);

// ---------------------------------------------------------------------------
// Property 25
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 25: Prioritisation is deterministic and reproducible", () => {
  // Feature: undiagnosed-disease-navigator, Property 25: Prioritisation is
  // deterministic and reproducible
  // Validates: Requirements 10.1, 10.3
  it("produces byte-for-byte identical rankings across repeated runs and any input ordering", () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, shuffled }) => {
        const first = prioritise(items);
        const second = prioritise(items);
        const reordered = prioritise(shuffled);

        // Re-running on identical inputs yields identical order and scores.
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));

        // The result is independent of the order items are supplied in.
        expect(JSON.stringify(reordered)).toBe(JSON.stringify(first));

        // The recorded logic version is stable too.
        expect(reordered.logicVersion).toBe(first.logicVersion);
      }),
      { numRuns: 200 }
    );
  });
});
