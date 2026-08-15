// services/prioritisation/src/total-order.property.test.ts
//
// Property-based test for design Correctness Property 26 (task 20.4).
//
// Feature: undiagnosed-disease-navigator, Property 26: Prioritisation ordering
// is total via the fixed tie-break
//
// *For any* set of variants or genes, including items with equal scores, the
// produced ranking is a strict total order consistent with the fixed documented
// tie-break sequence, leaving no ambiguous ties.
//
// Validates: Requirements 10.2

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  CLINVAR_CLASSIFICATIONS,
  GENE_DISEASE_STRENGTHS,
  MOLECULAR_CONSEQUENCES,
  geneDiseaseStrengthValue,
  molecularConsequenceSeverity
} from "./factors.js";
import { prioritise, type PrioritisationItemInput } from "./scoring.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789".split("");

const idArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ID_ALPHABET), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""));

// A deliberately SMALL space of scoring inputs so that equal scores (and thus
// tie-break exercises) occur frequently: few consequences, coarse frequencies,
// and coarse [0,1] factor values.
const itemArb: fc.Arbitrary<PrioritisationItemInput> = fc.record({
  id: idArb,
  kind: fc.constantFrom<PrioritisationItemInput["kind"]>("variant", "gene"),
  consequence: fc.constantFrom(...MOLECULAR_CONSEQUENCES.slice(0, 3)),
  alleleFrequency: fc.constantFrom(0, 0.0005, 0.02, 0.2),
  clinvarClassification: fc.constantFrom(...CLINVAR_CLASSIFICATIONS.slice(0, 3)),
  geneDiseaseAssociation: fc.constantFrom(...GENE_DISEASE_STRENGTHS.slice(0, 3)),
  inheritanceFit: fc.constantFrom(0, 0.5, 1),
  phenotypeSimilarity: fc.constantFrom(0, 0.5, 1),
  qualityPass: fc.boolean()
});

const itemsArb: fc.Arbitrary<PrioritisationItemInput[]> = fc.uniqueArray(itemArb, {
  minLength: 1,
  maxLength: 10,
  selector: (item) => item.id
});

// ---------------------------------------------------------------------------
// Independent re-derivation of the documented tie-break (Req 10.2)
// ---------------------------------------------------------------------------

interface Enriched {
  id: string;
  score: number;
  severity: number;
  alleleFrequency: number;
  geneDiseaseValue: number;
}

/**
 * The documented tie-break sequence: higher score, then higher consequence
 * severity, then lower allele frequency, then stronger gene-disease
 * association, then lexicographically smaller identifier. Because identifiers
 * are unique this returns 0 only when comparing an item to itself.
 */
function tieBreakCompare(a: Enriched, b: Enriched): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.severity !== b.severity) return b.severity - a.severity;
  if (a.alleleFrequency !== b.alleleFrequency) return a.alleleFrequency - b.alleleFrequency;
  if (a.geneDiseaseValue !== b.geneDiseaseValue) return b.geneDiseaseValue - a.geneDiseaseValue;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Property 26
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 26: Prioritisation ordering is total via the fixed tie-break", () => {
  // Feature: undiagnosed-disease-navigator, Property 26: Prioritisation ordering
  // is total via the fixed tie-break
  // Validates: Requirements 10.2
  it("orders every set into a strict total order matching the fixed tie-break, with no ambiguous ties", () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const result = prioritise(items);
        const ranked = result.ranked;

        // Ranks are exactly 1..n with no gaps or duplicates.
        expect(ranked.map((r) => r.rank)).toEqual(ranked.map((_, i) => i + 1));
        expect(new Set(ranked.map((r) => r.id)).size).toBe(items.length);

        // Enrich each ranked item with the values the tie-break depends on,
        // sourced from the original inputs by id.
        const byId = new Map(items.map((item) => [item.id, item]));
        const enriched: Enriched[] = ranked.map((r) => {
          const input = byId.get(r.id);
          expect(input).toBeDefined();
          const source = input as PrioritisationItemInput;
          return {
            id: source.id,
            score: r.score,
            severity: molecularConsequenceSeverity(source.consequence),
            alleleFrequency: source.alleleFrequency,
            geneDiseaseValue: geneDiseaseStrengthValue(source.geneDiseaseAssociation)
          };
        });

        // Adjacent pairs are STRICTLY ordered by the documented tie-break: the
        // earlier item must compare strictly before the later one (< 0), so no
        // ambiguous tie survives.
        for (let i = 0; i + 1 < enriched.length; i += 1) {
          const current = enriched[i] as Enriched;
          const next = enriched[i + 1] as Enriched;
          expect(tieBreakCompare(current, next)).toBeLessThan(0);
        }

        // Independently sorting by the tie-break reproduces the exact order.
        const expectedIds = [...enriched].sort(tieBreakCompare).map((e) => e.id);
        expect(enriched.map((e) => e.id)).toEqual(expectedIds);
      }),
      { numRuns: 200 }
    );
  });
});
