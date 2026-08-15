// services/reanalysis/src/relevance-linkage.property.test.ts
//
// Property-based test for design Correctness Property 41 (task 17.4).
//
// Feature: undiagnosed-disease-navigator, Property 41: Reanalysis candidates
// record relevance, link to trigger, and enter the queue
//
// *For any* created Reanalysis_Candidate, it records which variant, gene, or
// phenotype association is affected (the intersecting references — Req 15.2),
// links to the triggering Knowledge_Update via knowledgeUpdateId (Req 15.8),
// and results in the affected case being present in the review queue (Req 15.3).
//
// Matched relevance is checked against an INDEPENDENT oracle (a plain
// normalise-and-intersect over sets) rather than reusing the matcher helpers.

import { describe, it, expect } from "vitest";
import { createEnvelope, type KnowledgeUpdate } from "@udn/domain";
import { matchUnresolvedCases, type CaseFeatureVector, type MatchOptions } from "./matcher.js";
import fc from "fast-check";

const NOW = "2024-01-01T00:00:00.000Z";

const OPTIONS: MatchOptions = {
  createdById: "system",
  source: "Reanalysis_Service",
  now: NOW
};

// ---------------------------------------------------------------------------
// Independent oracle
// ---------------------------------------------------------------------------

function normOracle(id: string): string {
  return id.trim().toLowerCase();
}

/** Independent, deduped, ascending-sorted normalised intersection of two lists. */
function intersectSorted(a: readonly string[], b: readonly string[]): string[] {
  const bs = new Set<string>();
  for (const raw of b) {
    const n = normOracle(raw);
    if (n.length > 0) {
      bs.add(n);
    }
  }
  const out = new Set<string>();
  for (const raw of a) {
    const n = normOracle(raw);
    if (n.length > 0 && bs.has(n)) {
      out.add(n);
    }
  }
  return [...out].sort((x, y) => (x === y ? 0 : x < y ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Generators — shared token pool guarantees frequent intersections so that
// candidates are actually created and the property is meaningfully exercised.
// ---------------------------------------------------------------------------

const TOKENS = ["brca1", "tp53", "var-1", "var-9", "hp:0001250", "gene-a", "gene-b", "abc", "xyz"];

const decoratedToken: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...TOKENS),
    fc.constantFrom("", " ", "  ", "\t"),
    fc.constantFrom("", " ", "  "),
    fc.boolean()
  )
  .map(([token, pre, post, upper]) => `${pre}${upper ? token.toUpperCase() : token}${post}`);

const rawId: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: decoratedToken },
  { weight: 1, arbitrary: fc.constantFrom("", " ", "   ", "\t") }
);

const idList: fc.Arbitrary<string[]> = fc.array(rawId, { maxLength: 6 });

/** Feature bodies without caseId; caseIds are assigned by index for uniqueness. */
const featureBodyArb = fc.record({
  variants: idList,
  genes: idList,
  phenotypes: idList
});

const featuresArb: fc.Arbitrary<CaseFeatureVector[]> = fc
  .array(featureBodyArb, { minLength: 1, maxLength: 6 })
  .map((bodies) => bodies.map((body, index) => ({ caseId: `case-${index}`, ...body })));

function makeUpdate(delta: KnowledgeUpdate["delta"], id: string): KnowledgeUpdate {
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
// Property 41
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 41: Reanalysis candidates record relevance, link to trigger, and enter the queue", () => {
  // Validates: Requirements 15.2, 15.8, 15.3
  it("records matched relevance, links to the triggering update, and enqueues the affected case", () => {
    fc.assert(
      fc.property(featuresArb, updateArb, (features, update) => {
        const byCaseId = new Map(features.map((f) => [f.caseId, f]));

        const batch = matchUnresolvedCases(features, update, OPTIONS);

        // Exactly one review-queue entry per created candidate (Req 15.3).
        expect(batch.reviewQueue).toHaveLength(batch.candidates.length);

        const queueByCandidate = new Map(batch.reviewQueue.map((e) => [e.candidateId, e]));

        for (const candidate of batch.candidates) {
          const feature = byCaseId.get(candidate.caseId);
          expect(feature).toBeDefined();
          if (feature === undefined) {
            continue;
          }

          // (Req 15.2) Records the matched relevance: the specific intersecting
          // variants, genes, and phenotype associations, per the oracle.
          expect(candidate.relevance.matchedVariants).toEqual(
            intersectSorted(feature.variants, update.delta.variants)
          );
          expect(candidate.relevance.matchedGenes).toEqual(
            intersectSorted(feature.genes, update.delta.genes)
          );
          expect(candidate.relevance.matchedPhenotypes).toEqual(
            intersectSorted(feature.phenotypes, update.delta.phenotypes)
          );

          // A created candidate always records at least one affected reference.
          const matchedCount =
            candidate.relevance.matchedVariants.length +
            candidate.relevance.matchedGenes.length +
            candidate.relevance.matchedPhenotypes.length;
          expect(matchedCount).toBeGreaterThan(0);

          // (Req 15.8) Links to the triggering Knowledge_Update.
          expect(candidate.knowledgeUpdateId).toBe(update.id);

          // (Req 15.3) The affected case is present in the review queue via a
          // queue entry that references this candidate and case.
          const entry = queueByCandidate.get(candidate.id);
          expect(entry).toBeDefined();
          expect(entry?.caseId).toBe(candidate.caseId);
          expect(entry?.knowledgeUpdateId).toBe(update.id);
          expect(entry?.enqueuedAt).toBe(candidate.createdAt);
        }

        // Every case the oracle deems affected has a candidate AND appears in
        // the review queue; unaffected cases do not (Req 15.3, 15.9 boundary).
        const candidateCaseIds = new Set(batch.candidates.map((c) => c.caseId));
        const queueCaseIds = new Set(batch.reviewQueue.map((e) => e.caseId));
        for (const feature of features) {
          const affected =
            intersectSorted(feature.variants, update.delta.variants).length > 0 ||
            intersectSorted(feature.genes, update.delta.genes).length > 0 ||
            intersectSorted(feature.phenotypes, update.delta.phenotypes).length > 0;
          expect(candidateCaseIds.has(feature.caseId)).toBe(affected);
          expect(queueCaseIds.has(feature.caseId)).toBe(affected);
        }
      }),
      { numRuns: 200 }
    );
  });
});
