// services/evidence-gap/src/traceable-gaps.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 20: Evidence gaps are traceable review items
//
// Validates: Requirements 8.2, 8.4, 8.3
//
// Property 20 (design.md): *For any* case evaluation that produces gaps, each
// gap is a distinct review item that links to an existing case data element
// that triggered its rule and is framed as a review item rather than a
// statement of medical necessity.
//
// This test drives the deterministic rules engine with randomly-shaped case
// projections (varying which sub-elements are present/absent, family structure,
// and element references) and asserts that every produced gap:
//   - is presented as a distinct review item — one gap per rule, framed as a
//     review item, never as a statement of medical necessity (Req 8.2, 8.3),
//   - links to an *existing* case data element that triggered the rule: either
//     a reference carried by a sub-element actually present on the case, or the
//     case aspect itself (a `Case/{caseId}#...` reference) when the trigger is
//     the *absence* of a sub-element (Req 8.4), and
//   - carries that same triggering reference through to its provenance so the
//     link is auditable (Req 8.4).
//
// A fixed evaluation timestamp keeps each evaluation byte-for-byte deterministic
// across the >= 100 iterations.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { evaluateGaps } from "./engine.js";
import { DEFAULT_GAP_RULE_CONFIG } from "./rules.js";
import { PROHIBITED_NECESSITY_TERMS } from "./config.js";
import type {
  GapAnalysis,
  GapBiosample,
  GapCaseData,
  GapConsent,
  GapAgeOfOnset,
  GapInheritance,
  GapPedigree,
  GenomicAnalysisType
} from "./case-data.js";

// A fixed timestamp so envelope stamping and time-relative rules are
// byte-for-byte deterministic.
const AT = "2024-01-01T00:00:00.000Z";
const OPTS = { evaluatedAt: AT, evaluatorId: "prop-tester" } as const;

const ANALYSIS_TYPES: readonly GenomicAnalysisType[] = [
  "genome",
  "exome",
  "sv",
  "repeat",
  "mitochondrial"
];

// Identifier-shaped strings keep caseIds free of the "#" used by case-aspect
// references, so the aspect-reference check below is unambiguous.
const identifierArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((s) => s.replace(/[^A-Za-z0-9]/g, "x"))
  .filter((s) => s.length > 0);

// A stable element reference carried by a present sub-element (Req 8.4). We tag
// it so it is a non-empty, recognisable string; its exact content is irrelevant
// to the engine, which threads whatever ref it is given.
const refArb = identifierArb.map((s) => `Element/${s}`);

const relationshipArb = fc.constantFrom(
  "proband",
  "mother",
  "father",
  "sibling",
  "grandmother",
  "affected-cousin"
);

const biosampleArb: fc.Arbitrary<GapBiosample> = fc.record({
  ref: refArb,
  relationship: relationshipArb
});

const pedigreeMemberArb = fc.record(
  {
    id: identifierArb,
    sex: fc.option(fc.constantFrom("female", "male", "unknown", ""), {
      nil: undefined
    }),
    parents: fc.option(fc.array(identifierArb, { maxLength: 2 }), {
      nil: undefined
    })
  },
  { requiredKeys: ["id"] }
);

const pedigreeArb: fc.Arbitrary<GapPedigree> = fc.record({
  ref: refArb,
  members: fc.array(pedigreeMemberArb, { maxLength: 4 })
});

const ageOfOnsetArb: fc.Arbitrary<GapAgeOfOnset> = fc.record(
  {
    ref: refArb,
    value: fc.option(fc.constantFrom("3 years", "neonatal", "", "adult"), {
      nil: null
    })
  },
  { requiredKeys: ["ref"] }
);

const analysisArb: fc.Arbitrary<GapAnalysis> = fc.record(
  {
    ref: refArb,
    type: fc.constantFrom(...ANALYSIS_TYPES),
    completedAt: fc.option(fc.constant("2023-06-01T00:00:00.000Z"), {
      nil: undefined
    })
  },
  { requiredKeys: ["ref", "type"] }
);

const inheritanceArb: fc.Arbitrary<GapInheritance> = fc.record(
  {
    ref: refArb,
    evaluable: fc.option(fc.boolean(), { nil: undefined }),
    model: fc.option(
      fc.constantFrom("autosomal_recessive", "de_novo", "uncertain", "unknown"),
      { nil: undefined }
    )
  },
  { requiredKeys: ["ref"] }
);

const consentArb: fc.Arbitrary<GapConsent> = fc.record(
  {
    ref: refArb,
    permitsExternalMatching: fc.option(fc.boolean(), { nil: undefined })
  },
  { requiredKeys: ["ref"] }
);

// A randomly-shaped case projection: any combination of present/absent
// sub-elements, exercising both element-level and absence (case-aspect)
// trigger references.
const caseDataArb: fc.Arbitrary<GapCaseData> = fc.record(
  {
    caseId: identifierArb,
    isFamilyBased: fc.boolean(),
    biosamples: fc.option(fc.array(biosampleArb, { maxLength: 4 }), {
      nil: undefined
    }),
    pedigree: fc.option(pedigreeArb, { nil: undefined }),
    ageOfOnset: fc.option(ageOfOnsetArb, { nil: undefined }),
    analyses: fc.option(fc.array(analysisArb, { maxLength: 5 }), {
      nil: undefined
    }),
    lastReanalysisAt: fc.option(
      fc.constantFrom("2023-12-01T00:00:00.000Z", "1990-01-01T00:00:00.000Z"),
      { nil: null }
    ),
    inheritance: fc.option(inheritanceArb, { nil: undefined }),
    consent: fc.option(consentArb, { nil: undefined })
  },
  { requiredKeys: ["caseId"] }
);

/** Collect every element reference actually present in the case projection. */
function presentRefs(caseData: GapCaseData): Set<string> {
  const refs = new Set<string>();
  for (const b of caseData.biosamples ?? []) refs.add(b.ref);
  if (caseData.pedigree) refs.add(caseData.pedigree.ref);
  if (caseData.ageOfOnset) refs.add(caseData.ageOfOnset.ref);
  for (const a of caseData.analyses ?? []) refs.add(a.ref);
  if (caseData.inheritance) refs.add(caseData.inheritance.ref);
  if (caseData.consent) refs.add(caseData.consent.ref);
  return refs;
}

/**
 * A triggering reference is "an existing case data element" (Req 8.4) when it
 * is either the ref of a sub-element present on the case, or the case aspect
 * itself (`Case/{caseId}#...`) — used when the trigger is the *absence* of a
 * sub-element and so there is no finer element to point at.
 */
function linksToExistingElement(
  ref: string,
  caseData: GapCaseData,
  present: Set<string>
): boolean {
  if (present.has(ref)) return true;
  return ref.startsWith(`Case/${caseData.caseId}#`);
}

function containsNecessityWording(text: string): boolean {
  const haystack = text.toLowerCase();
  return PROHIBITED_NECESSITY_TERMS.some((term) => haystack.includes(term));
}

describe("Feature: undiagnosed-disease-navigator, Property 20: Evidence gaps are traceable review items", () => {
  it("every produced gap is a distinct review item linked to an existing triggering case data element and never framed as medical necessity", () => {
    fc.assert(
      fc.property(caseDataArb, (caseData) => {
        const result = evaluateGaps(caseData, DEFAULT_GAP_RULE_CONFIG, OPTS);

        // Well-formed projections evaluate to completion (no predicate throws),
        // so any produced gaps are complete, non-partial results.
        expect(result.completed).toBe(true);

        const present = presentRefs(caseData);
        const seenRuleIds = new Set<string>();

        for (const gap of result.gaps) {
          // Req 8.2: presented as a distinct review item (one gap per rule).
          expect(gap.entityType).toBe("EvidenceGap");
          expect(gap.caseId).toBe(caseData.caseId);
          expect(gap.ruleId.length).toBeGreaterThan(0);
          expect(seenRuleIds.has(gap.ruleId)).toBe(false);
          seenRuleIds.add(gap.ruleId);

          // Req 8.3: framed as a review item, never as medical necessity.
          expect(gap.framedAsReviewItem).toBe(true);
          expect(containsNecessityWording(gap.whyItMatters)).toBe(false);
          expect(containsNecessityWording(gap.suggestedNextStep)).toBe(false);

          // Req 8.4: links to the specific existing case data element that
          // triggered the rule, and threads that link through to provenance.
          expect(gap.triggeringElementRef.length).toBeGreaterThan(0);
          expect(
            linksToExistingElement(gap.triggeringElementRef, caseData, present)
          ).toBe(true);
          expect(gap.provenance.sourceId).toBe(gap.triggeringElementRef);
        }

        // When gaps were found, the result reflects distinct review items;
        // otherwise the no-gaps indication holds (nothing to trace).
        expect(result.noGapsFound).toBe(result.gaps.length === 0);
      }),
      { numRuns: 200 }
    );
  });
});
