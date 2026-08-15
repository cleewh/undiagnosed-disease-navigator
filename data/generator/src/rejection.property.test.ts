// data/generator/src/rejection.property.test.ts
//
// Property-based test for design Correctness Property 2 (task 7.5).
//
// Feature: undiagnosed-disease-navigator, Property 2: Unlabeled or
// real-identifier records are rejected
//
// *For any* case record that is missing the synthetic-data indicator or that
// contains an identifier matching the real-identifier source, intake rejects
// the record, creates no Case, and retains a structured rejection/error
// indication naming the cause (Requirements 1.10, 2.2).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateCases, type GeneratedCase } from "./generator.js";
import { verifyLabelling, assertLabelledCorpus } from "./labelling.js";
import { screenIdentifier } from "./identifiers.js";

// A known-good corpus. Every case here verifies ok === true (positive control).
const GOOD_CASES = generateCases();

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A run of `n` decimal digits as a string. */
function digits(n: number): fc.Arbitrary<string> {
  return fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: n, maxLength: n })
    .map((ds) => ds.join(""));
}

const lowerWord = fc
  .array(fc.integer({ min: 97, max: 122 }), { minLength: 1, maxLength: 8 })
  .map((codes) => String.fromCharCode(...codes));

/**
 * Values whose shape matches at least one {@link REAL_IDENTIFIER_RULES} rule.
 * Each branch is constructed so `screenIdentifier(value).safe === false` always
 * holds (asserted in the property as a precondition sanity check).
 */
const realIdentifierArb: fc.Arbitrary<string> = fc.oneof(
  // us-ssn: NNN-NN-NNNN
  fc
    .tuple(digits(3), digits(2), digits(4))
    .map(([a, b, c]) => `${a}-${b}-${c}`),
  // nhs-number: NNN NNN NNNN
  fc
    .tuple(digits(3), digits(3), digits(4))
    .map(([a, b, c]) => `${a} ${b} ${c}`),
  // medical-record-number: MRN: NNNNN...
  digits(6).map((d) => `MRN: ${d}`),
  // email-address
  fc.tuple(lowerWord, lowerWord).map(([l, d]) => `${l}@${d}.com`),
  // long-numeric-run: 9+ unbroken digits
  fc.integer({ min: 9, max: 15 }).chain((n) => digits(n))
);

type IdField =
  | { target: "case"; field: "id" | "caseId" }
  | { target: "patient"; field: "id" };

const idFieldArb: fc.Arbitrary<IdField> = fc.oneof(
  fc.constant({ target: "case", field: "id" } as const),
  fc.constant({ target: "case", field: "caseId" } as const),
  fc.constant({ target: "patient", field: "id" } as const)
);

/** Any value that is not the required `true` synthetic indicator. */
const notTrueArb = fc.constantFrom<unknown>(false, undefined, 0, null, "true", 1);

type Mutation =
  // (a) removes/falsifies the synthetic indicator on case or patient
  | { kind: "unlabeled"; expectTarget: "case" | "patient"; falsify: unknown }
  // (a') falsifies the patient's identifiers-are-synthetic flag
  | { kind: "unlabeled-identifiers"; falsify: unknown }
  // (b) injects a real-identifier-shaped value into an id field
  | { kind: "real-identifier"; where: IdField; value: string };

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  fc
    .tuple(fc.constantFrom("case" as const, "patient" as const), notTrueArb)
    .map(([expectTarget, falsify]) => ({
      kind: "unlabeled" as const,
      expectTarget,
      falsify
    })),
  notTrueArb.map((falsify) => ({
    kind: "unlabeled-identifiers" as const,
    falsify
  })),
  fc
    .tuple(idFieldArb, realIdentifierArb)
    .map(([where, value]) => ({ kind: "real-identifier" as const, where, value }))
);

function applyMutation(
  generated: GeneratedCase,
  mutation: Mutation
): GeneratedCase {
  const clone = structuredClone(generated) as unknown as {
    case: Record<string, unknown>;
    patient: Record<string, unknown>;
  };
  switch (mutation.kind) {
    case "unlabeled":
      clone[mutation.expectTarget].syntheticIndicator = mutation.falsify;
      break;
    case "unlabeled-identifiers":
      clone.patient.identifiersSynthetic = mutation.falsify;
      break;
    case "real-identifier":
      clone[mutation.where.target][mutation.where.field] = mutation.value;
      break;
  }
  return clone as unknown as GeneratedCase;
}

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

describe("Property 2: Unlabeled or real-identifier records are rejected", () => {
  // Feature: undiagnosed-disease-navigator, Property 2: Unlabeled or
  // real-identifier records are rejected
  // Validates: Requirements 1.10, 2.2
  it("rejects a record that loses its synthetic label or carries a real identifier, naming the cause", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: GOOD_CASES.length - 1 }),
        mutationArb,
        (index, mutation) => {
          const original = GOOD_CASES[index]!;

          // Positive control: an unmutated case verifies ok === true.
          const positive = verifyLabelling(original);
          expect(positive.ok).toBe(true);
          expect(positive.problems).toEqual([]);

          const mutated = applyMutation(original, mutation);
          const result = verifyLabelling(mutated);

          // The mutated record is rejected...
          expect(result.ok).toBe(false);
          expect(result.problems.length).toBeGreaterThan(0);

          // ...with a problem of the kind corresponding to the mutation,
          // and a structured detail string naming the cause.
          if (mutation.kind === "real-identifier") {
            // Sanity: the injected value really does resemble a real id.
            expect(screenIdentifier(mutation.value).safe).toBe(false);
            const problem = result.problems.find(
              (p) =>
                p.kind === "real-identifier" &&
                p.target === mutation.where.target
            );
            expect(problem).toBeDefined();
            expect(problem!.detail).toContain(mutation.value);
          } else {
            expect(result.problems.some((p) => p.kind === "unlabeled")).toBe(
              true
            );
          }

          // A corpus containing the mutated record fails the corpus assertion.
          expect(() => assertLabelledCorpus([mutated])).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });
});
