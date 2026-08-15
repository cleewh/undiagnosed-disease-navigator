// services/reanalysis/src/matcher.test.ts
//
// Compile-sanity and behavioural unit tests for the deterministic reanalysis
// matcher (task 17.1). Property tests (17.3/17.4) are implemented separately.

import { describe, it, expect } from "vitest";
import { createEnvelope, type KnowledgeUpdate } from "@udn/domain";
import {
  computeRelevance,
  matchCase,
  matchUnresolvedCases,
  normaliseIdentifier,
  reanalysisCandidateId,
  type CaseFeatureVector,
  type MatchOptions
} from "./matcher.js";

const NOW = "2024-01-01T00:00:00.000Z";

const OPTIONS: MatchOptions = {
  createdById: "system",
  source: "Reanalysis_Service",
  now: NOW
};

function makeUpdate(delta: KnowledgeUpdate["delta"], id = "KU-1"): KnowledgeUpdate {
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

function makeFeature(overrides: Partial<CaseFeatureVector> = {}): CaseFeatureVector {
  return {
    caseId: "case-1",
    variants: [],
    genes: [],
    phenotypes: [],
    ...overrides
  };
}

describe("normaliseIdentifier", () => {
  it("trims and case-folds", () => {
    expect(normaliseIdentifier("  BRCA1 ")).toBe("brca1");
    expect(normaliseIdentifier("HP:0001250")).toBe("hp:0001250");
  });
});

describe("matchCase", () => {
  it("creates a candidate linked to the update when the intersection is non-empty (Req 15.1, 15.2, 15.8)", () => {
    const update = makeUpdate({
      variants: ["VAR-9"],
      genes: ["BRCA1"],
      phenotypes: [],
      diseases: []
    });
    const feature = makeFeature({ genes: ["  brca1 "], variants: ["var-1"] });

    const result = matchCase(feature, update, OPTIONS);

    expect(result.matched).toBe(true);
    expect(result.candidate).not.toBeNull();
    expect(result.candidate?.knowledgeUpdateId).toBe("KU-1");
    expect(result.candidate?.relevance.matchedGenes).toEqual(["brca1"]);
    expect(result.candidate?.relevance.matchedVariants).toEqual([]);
    expect(result.candidate?.id).toBe(reanalysisCandidateId("case-1", "KU-1"));
    expect(result.candidate?.entityType).toBe("ReanalysisCandidate");
  });

  it("creates NO candidate when the intersection is empty (Req 15.9)", () => {
    const update = makeUpdate({
      variants: ["VAR-9"],
      genes: ["TP53"],
      phenotypes: ["HP:0000010"],
      diseases: []
    });
    const feature = makeFeature({ genes: ["BRCA1"], phenotypes: ["HP:0001250"] });

    const result = matchCase(feature, update, OPTIONS);

    expect(result.matched).toBe(false);
    expect(result.candidate).toBeNull();
  });

  it("is deterministic and independent of input ordering", () => {
    const update = makeUpdate({
      variants: [],
      genes: ["GENE-B", "GENE-A"],
      phenotypes: [],
      diseases: []
    });
    const a = matchCase(makeFeature({ genes: ["gene-a", "gene-b"] }), update, OPTIONS);
    const b = matchCase(makeFeature({ genes: ["gene-b", "gene-a"] }), update, OPTIONS);

    expect(a.candidate).toEqual(b.candidate);
    expect(a.relevance.matchedGenes).toEqual(["gene-a", "gene-b"]);
  });
});

describe("computeRelevance", () => {
  it("deduplicates and sorts matched identifiers", () => {
    const update = makeUpdate({
      variants: ["V1", "v1", "V2"],
      genes: [],
      phenotypes: [],
      diseases: []
    });
    const relevance = computeRelevance(makeFeature({ variants: ["v2", "V1", "v1"] }), update);
    expect(relevance.matchedVariants).toEqual(["v1", "v2"]);
  });
});

describe("matchUnresolvedCases", () => {
  it("returns one candidate and one queue entry per affected case, oldest-first", () => {
    const update = makeUpdate({
      variants: [],
      genes: ["SHARED"],
      phenotypes: [],
      diseases: []
    });
    const features = [
      makeFeature({ caseId: "case-b", genes: ["shared"] }),
      makeFeature({ caseId: "case-a", genes: ["shared"] }),
      makeFeature({ caseId: "case-c", genes: ["other"] })
    ];

    const batch = matchUnresolvedCases(features, update, OPTIONS);

    expect(batch.candidates.map((c) => c.caseId)).toEqual(["case-a", "case-b"]);
    expect(batch.reviewQueue).toHaveLength(2);
    expect(batch.reviewQueue.every((entry) => entry.knowledgeUpdateId === "KU-1")).toBe(true);
  });
});
