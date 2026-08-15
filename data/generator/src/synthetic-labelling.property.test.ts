// data/generator/src/synthetic-labelling.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 1: Synthetic labelling and no real identifiers
//
// Validates: Requirements 1.7, 1.9, 2.1
//
// Property 1 (design.md): *For any* case record admitted to the case library,
// its synthetic-data indicator is set and none of its identifier fields match
// any entry in the real-identifier source.
//
// The corpus is generated deterministically from a seed. For any seed we
// generate the whole corpus and assert, for every generated case AND its
// patient, that:
//   - the synthetic-data indicator is set (isSyntheticallyLabelled === true,
//     Req 1.7), and verifyLabelling reports no problems, and
//   - none of the identifier fields (case.id, case.caseId, patient.id) match
//     any real-identifier rule (isSafeSyntheticIdentifier === true and
//     screenIdentifier(...).safe === true, Req 1.9, 2.1).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateCases } from "./generator.js";
import { isSyntheticallyLabelled, verifyLabelling } from "./labelling.js";
import {
  isSafeSyntheticIdentifier,
  screenIdentifier
} from "./identifiers.js";

describe("Feature: undiagnosed-disease-navigator, Property 1: Synthetic labelling and no real identifiers", () => {
  it("every admitted case and patient is synthetic-labelled and carries no real identifiers", () => {
    fc.assert(
      // Any seed, mapped to the uint32 space the generator normalises to.
      fc.property(fc.integer().map((n) => n >>> 0), (seed) => {
        const cases = generateCases({ seed });
        expect(cases.length).toBeGreaterThan(0);

        for (const generated of cases) {
          // Req 1.7: synthetic-data indicator set on both case and patient.
          expect(isSyntheticallyLabelled(generated.case)).toBe(true);
          expect(isSyntheticallyLabelled(generated.patient)).toBe(true);

          // Consolidated labelling + identifier-safety verification is clean.
          expect(verifyLabelling(generated).ok).toBe(true);

          // Req 1.9, 2.1: no identifier field matches a real-identifier rule.
          for (const id of [
            generated.case.id,
            generated.case.caseId,
            generated.patient.id
          ]) {
            expect(isSafeSyntheticIdentifier(id)).toBe(true);
            expect(screenIdentifier(id).safe).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
