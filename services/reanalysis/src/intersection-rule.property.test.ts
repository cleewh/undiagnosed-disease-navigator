// services/reanalysis/src/intersection-rule.property.test.ts
//
// Property-based test for design Correctness Property 40 (task 17.3).
//
// Feature: undiagnosed-disease-navigator, Property 40: Reanalysis candidate
// created exactly when references intersect
//
// *For any* Unresolved_Case feature vector and any Knowledge_Update, a
// Reanalysis_Candidate is created IF AND ONLY IF the normalised intersection of
// the case's stored variants, genes, and phenotype associations with the
// update's referenced variants, genes, and phenotypes is non-empty.
// Non-empty intersection => a candidate is created (Req 15.1); empty
// intersection => no candidate is created (Req 15.9).
//
// The biconditional is checked against an INDEPENDENT oracle (re-implemented
// here as a plain normalise-and-intersect over sets) rather than reusing the
// matcher's own intersection helpers.

import { describe, it, expect } from "vitest";
import { createEnvelope, type KnowledgeUpdate } from "@udn/domain";
import { matchCase, matchUnresolvedCases, type CaseFeatureVector, type MatchOptions } from "./matcher.js";
import fc from "fast-check";

const NOW = "2024-01-01T00:00:00.000Z";

const OPTIONS: MatchOptions = {
  createdById: "system",
  source: "Reanalysis_Service",
  now: NOW
};

// ---------------------------------------------------------------------------
// Independent oracle (does NOT call matcher internals)
// ---------------------------------------------------------------------------

/** Independent normalisation: trim + lower-case (mirrors the documented rule). */
function normOracle(id: string): string {
  return id.trim().toLowerCase();
}

/** Set of non-empty normalised identifiers. */
function normSet(ids: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of ids) {
    const n = normOracle(raw);
    if (n.length > 0) {
      out.add(n);
    }
  }
  return out;
}

/** True when two identifier lists share at least one non-empty normalised id. */
function intersects(a: readonly string[], b: readonly string[]): boolean {
  const bs = normSet(b);
  for (const x of normSet(a)) {
    if (bs.has(x)) {
      return true;
    }
  }
  return false;
}

/** Overall oracle: the case is affected exactly when any dimension intersects. */
function oracleAffected(feature: CaseFeatureVector, update: KnowledgeUpdate): boolean {
  return (
    intersects(feature.variants, update.delta.variants) ||
    intersects(feature.genes, update.delta.genes) ||
    intersects(feature.phenotypes, update.delta.phenotypes)
  );
}

// ---------------------------------------------------------------------------
// Generators — a small shared token pool guarantees both empty and non-empty
// intersections occur, and decoration exercises the normalisation.
// ---------------------------------------------------------------------------

const TOKENS = ["brca1", "tp53", "var-1", "var-9", "hp:0001250", "gene-a", "gene-b", "abc", "xyz"];

/** Decorate a base token with random casing and surrounding whitespace. */
const decoratedToken: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...TOKENS),
    fc.constantFrom("", " ", "  ", "\t"),
    fc.constantFrom("", " ", "  "),
    fc.boolean()
  )
  .map(([token, pre, post, upper]) => `${pre}${upper ? token.toUpperCase() : token}${post}`);

/** A raw identifier: usually a decorated token, occasionally a blank string. */
const rawId: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: decoratedToken },
  { weight: 1, arbitrary: fc.constantFrom("", " ", "   ", "\t") }
);

const idList: fc.Arbitrary<string[]> = fc.array(rawId, { maxLength: 6 });

const featureArb: fc.Arbitrary<CaseFeatureVector> = fc.record({
  caseId: fc.string({ minLength: 1, maxLength: 8 }).map((s) => `case-${s}`),
  variants: idList,
  genes: idList,
  phenotypes: idList
});

function makeUpdate(
  delta: KnowledgeUpdate["delta"],
  id: string
): KnowledgeUpdate {
  const base = createEnvelope({
    id,
    entityType: "KnowledgeUpdate",
    caseId: "GLOBAL",
    source: "Knowledge_Service",
    status: "pending",
    provenance: {
      sourceId: "clinvar",
      versionId: "1",
      createdById: "system",
      ingestedAt: NOW
    },
    accessClassification: "research",
    createdById: "system",
    now: NOW
  });
  return {
    ...base,
    entityType: "KnowledgeUpdate",
    syntheticIndicator: true,
    delta,
    status: "pending"
  };
}

const updateArb: fc.Arbitrary<KnowledgeUpdate> = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 8 }),
    fc.record({
      variants: idList,
      genes: idList,
      phenotypes: idList,
      diseases: idList
    })
  )
  .map(([id, delta]) => makeUpdate(delta, `KU-${id}`));

// ---------------------------------------------------------------------------
// Property 40
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 40: Reanalysis candidate created exactly when references intersect", () => {
  // Validates: Requirements 15.1, 15.9
  it("creates a candidate if and only if the normalised reference intersection is non-empty", () => {
    fc.assert(
      fc.property(featureArb, updateArb, (feature, update) => {
        const expected = oracleAffected(feature, update);

        const result = matchCase(feature, update, OPTIONS);

        // Biconditional: matched flag and candidate presence track the oracle.
        expect(result.matched).toBe(expected);
        expect(result.candidate !== null).toBe(expected);

        if (expected) {
          // Non-empty intersection => a candidate IS created (Req 15.1).
          expect(result.candidate).not.toBeNull();
        } else {
          // Empty intersection => NO candidate is created (Req 15.9).
          expect(result.candidate).toBeNull();
        }

        // The batch matcher agrees: the case appears among candidates exactly
        // when the oracle says it is affected.
        const batch = matchUnresolvedCases([feature], update, OPTIONS);
        const present = batch.candidates.some((c) => c.caseId === feature.caseId);
        expect(present).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });
});
