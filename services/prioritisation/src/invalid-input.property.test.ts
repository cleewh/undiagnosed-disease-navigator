// services/prioritisation/src/invalid-input.property.test.ts
//
// Property-based test for design Correctness Property 27 (task 20.5).
//
// Feature: undiagnosed-disease-navigator, Property 27: Prioritisation rejects
// missing or invalid inputs with no partial ranking
//
// *For any* genomic input missing a required scoring input or failing input
// validation, prioritisation is rejected with an error naming the missing or
// invalid input and produces no partial ranking.
//
// Validates: Requirements 10.4

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  CLINVAR_CLASSIFICATIONS,
  GENE_DISEASE_STRENGTHS,
  MOLECULAR_CONSEQUENCES
} from "./factors.js";
import { InvalidPrioritisationInputError } from "./errors.js";
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
  maxLength: 6,
  selector: (item) => item.id
});

// A mutation corrupts exactly one field of one item, either by supplying an
// invalid value or by deleting a required field. `input` is the scoring-input
// name we expect the rejection to name (Req 10.4).
interface Mutation {
  input: string;
  apply: (item: Record<string, unknown>) => void;
}

const invalidUnit = fc.constantFrom<unknown>(2, -1, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null);

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  fc.constantFrom<unknown>("", "   ", 123, null).map((bad) => ({
    input: "id",
    apply: (item: Record<string, unknown>) => {
      item["id"] = bad;
    }
  })),
  fc.constantFrom<unknown>("protein", "", 7, null).map((bad) => ({
    input: "kind",
    apply: (item: Record<string, unknown>) => {
      item["kind"] = bad;
    }
  })),
  fc.constantFrom<unknown>("frameshift", "unknown", 1).map((bad) => ({
    input: "consequence",
    apply: (item: Record<string, unknown>) => {
      item["consequence"] = bad;
    }
  })),
  invalidUnit.map((bad) => ({
    input: "alleleFrequency",
    apply: (item: Record<string, unknown>) => {
      item["alleleFrequency"] = bad;
    }
  })),
  fc.constantFrom<unknown>("VUS", "", 0).map((bad) => ({
    input: "clinvarClassification",
    apply: (item: Record<string, unknown>) => {
      item["clinvarClassification"] = bad;
    }
  })),
  fc.constantFrom<unknown>("weak", "", 5).map((bad) => ({
    input: "geneDiseaseAssociation",
    apply: (item: Record<string, unknown>) => {
      item["geneDiseaseAssociation"] = bad;
    }
  })),
  invalidUnit.map((bad) => ({
    input: "inheritanceFit",
    apply: (item: Record<string, unknown>) => {
      item["inheritanceFit"] = bad;
    }
  })),
  invalidUnit.map((bad) => ({
    input: "phenotypeSimilarity",
    apply: (item: Record<string, unknown>) => {
      item["phenotypeSimilarity"] = bad;
    }
  })),
  fc.constantFrom<unknown>("yes", 1, 0, null).map((bad) => ({
    input: "qualityPass",
    apply: (item: Record<string, unknown>) => {
      item["qualityPass"] = bad;
    }
  })),
  // Delete a required field entirely (missing input).
  fc
    .constantFrom(
      "consequence",
      "alleleFrequency",
      "clinvarClassification",
      "geneDiseaseAssociation",
      "inheritanceFit",
      "phenotypeSimilarity",
      "qualityPass"
    )
    .map((field) => ({
      input: field,
      apply: (item: Record<string, unknown>) => {
        delete item[field];
      }
    }))
);

// ---------------------------------------------------------------------------
// Property 27
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 27: Prioritisation rejects missing or invalid inputs with no partial ranking", () => {
  // Feature: undiagnosed-disease-navigator, Property 27: Prioritisation rejects
  // missing or invalid inputs with no partial ranking
  // Validates: Requirements 10.4
  it("rejects any request with a missing/invalid input, naming it, and never returns a partial ranking", () => {
    fc.assert(
      fc.property(
        itemsArb,
        fc.nat(),
        mutationArb,
        (items, rawIndex, mutation) => {
          // Positive control: the untouched, valid request ranks all items.
          const control = prioritise(items);
          expect(control.ranked).toHaveLength(items.length);

          // Corrupt exactly one item's single field.
          const targetIndex = rawIndex % items.length;
          const corrupted = items.map((item) => ({ ...item }) as Record<string, unknown>);
          const target = corrupted[targetIndex] as Record<string, unknown>;
          mutation.apply(target);

          const request = corrupted as unknown as PrioritisationItemInput[];

          // The whole request is rejected: no value (and thus no partial
          // ranking) is ever returned.
          let returned: unknown;
          let thrown: unknown;
          try {
            returned = prioritise(request);
          } catch (error) {
            thrown = error;
          }

          expect(returned).toBeUndefined();
          expect(thrown).toBeInstanceOf(InvalidPrioritisationInputError);
          const err = thrown as InvalidPrioritisationInputError;
          expect(err.code).toBe("INVALID_PRIORITISATION_INPUT");
          // The error names the offending scoring input (Req 10.4).
          expect(err.input).toBe(mutation.input);
        }
      ),
      { numRuns: 200 }
    );
  });
});
