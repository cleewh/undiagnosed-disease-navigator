// services/hypothesis/src/non-diagnostic-vocabulary.property.test.ts
//
// Property-based test for task 21.4 — Correctness Property 30.
//
// Feature: undiagnosed-disease-navigator, Property 30: Hypothesis card text
// uses only non-diagnostic vocabulary
//
// Validates: Requirements 11.3
//
// Card text is accepted IF AND ONLY IF it contains no prohibited diagnostic
// term. An independent whole-word/phrase oracle over PROHIBITED_DIAGNOSTIC_TERMS
// predicts acceptance, and text containing a prohibited term is rejected on both
// create and text-update.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  PROHIBITED_DIAGNOSTIC_TERMS,
  createHypothesis,
  isNonDiagnostic,
  updateHypothesisText,
  type CreateHypothesisInput
} from "./index.js";

const AT = "2024-01-01T00:00:00.000Z";
const LATER = "2024-01-02T00:00:00.000Z";

/**
 * Benign filler words. None is a prohibited diagnostic term and none is a
 * component word of any multi-word prohibited phrase, so a whitespace-joined
 * sequence of these words can never accidentally form a prohibited term.
 */
const BENIGN_WORDS: readonly string[] = [
  "patient",
  "findings",
  "appear",
  "linked",
  "review",
  "hedged",
  "notes",
  "team",
  "considered",
  "signal",
  "pattern",
  "observed",
  "candidate",
  "possible",
  "context"
];

/**
 * Independent oracle: does the whitespace-tokenised text contain a prohibited
 * term as a whole word (single-token terms) or as a consecutive run of tokens
 * (multi-word phrase terms)? This is a genuinely separate implementation —
 * token equality rather than the production regex — that agrees with the
 * production matcher on letters-and-single-spaces input.
 */
function oracleContainsProhibited(tokens: readonly string[]): boolean {
  const lower = tokens.map((token) => token.toLowerCase());
  return PROHIBITED_DIAGNOSTIC_TERMS.some((term) => {
    const parts = term.toLowerCase().split(/\s+/);
    const last = lower.length - parts.length;
    for (let start = 0; start <= last; start += 1) {
      let matched = true;
      for (let offset = 0; offset < parts.length; offset += 1) {
        if (lower[start + offset] !== parts[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) return true;
    }
    return false;
  });
}

const benignWordArb: fc.Arbitrary<string> = fc.constantFrom(...BENIGN_WORDS);
const prohibitedTermArb: fc.Arbitrary<string> = fc.constantFrom(...PROHIBITED_DIAGNOSTIC_TERMS);

/**
 * A text segment is usually a benign word and occasionally a (possibly
 * multi-word) prohibited term, so generated texts span both accepted and
 * rejected cases.
 */
const segmentArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: benignWordArb },
  { weight: 1, arbitrary: prohibitedTermArb }
);

const segmentsArb: fc.Arbitrary<string[]> = fc.array(segmentArb, {
  minLength: 1,
  maxLength: 12
});

function baseCreate(text: string): CreateHypothesisInput {
  return {
    caseId: "Case-1",
    text,
    evidence: [{ sourceObjectRef: "ConfirmedPhenotype-1", kind: "confirmed_phenotype" }],
    knowledgeSnapshotVersion: "snap-1",
    createdById: "user-1",
    at: AT,
    isAuthorised: true
  };
}

describe("Feature: undiagnosed-disease-navigator, Property 30: Hypothesis card text uses only non-diagnostic vocabulary", () => {
  // Feature: undiagnosed-disease-navigator, Property 30: Hypothesis card text
  // uses only non-diagnostic vocabulary
  // Validates: Requirements 11.3
  it("accepts card text iff it contains no prohibited diagnostic term, on both create and text-update", () => {
    fc.assert(
      fc.property(segmentsArb, (segments) => {
        const text = segments.join(" ");
        const tokens = text.split(/\s+/);
        const expectedClean = !oracleContainsProhibited(tokens);

        // The vocabulary guard agrees with the independent oracle.
        expect(isNonDiagnostic(text)).toBe(expectedClean);

        // Creation is accepted iff the text is clean; a prohibited term is
        // rejected with a prohibited_term error and no card produced (Req 11.3).
        const created = createHypothesis(baseCreate(text));
        expect(created.ok).toBe(expectedClean);
        if (!created.ok) {
          expect(created.error.code).toBe("prohibited_term");
          return;
        }

        // A text-update is accepted iff the new text is clean; a prohibited
        // term is rejected and leaves the card unchanged (Req 11.3).
        const updated = updateHypothesisText(created.card.hypothesis, {
          text,
          userId: "user-2",
          at: LATER,
          isAuthorised: true
        });
        expect(updated.ok).toBe(expectedClean);
        if (!updated.ok) {
          expect(updated.error.code).toBe("prohibited_term");
          expect(updated.hypothesis).toBe(created.card.hypothesis);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("always rejects text that injects a prohibited term, on create and text-update", () => {
    // A seed card built from clean text; used to exercise text-update rejection.
    const seed = createHypothesis(
      baseCreate("A candidate explanation consistent with the observed findings.")
    );
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const seedCard = seed.card.hypothesis;

    fc.assert(
      fc.property(
        fc.array(benignWordArb, { minLength: 0, maxLength: 6 }),
        prohibitedTermArb,
        fc.array(benignWordArb, { minLength: 0, maxLength: 6 }),
        (before, term, after) => {
          const text = [...before, term, ...after].join(" ");

          expect(isNonDiagnostic(text)).toBe(false);

          const created = createHypothesis(baseCreate(text));
          expect(created.ok).toBe(false);
          if (created.ok) return;
          expect(created.error.code).toBe("prohibited_term");

          const updated = updateHypothesisText(seedCard, {
            text,
            userId: "user-2",
            at: LATER,
            isAuthorised: true
          });
          expect(updated.ok).toBe(false);
          if (updated.ok) return;
          expect(updated.error.code).toBe("prohibited_term");
          // Rejection leaves the card unchanged.
          expect(updated.hypothesis).toBe(seedCard);
        }
      ),
      { numRuns: 100 }
    );
  });
});
