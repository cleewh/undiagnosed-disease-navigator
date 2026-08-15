// services/prioritisation/src/scoring.test.ts
//
// Compile-sanity and behavioural unit tests for the deterministic scoring,
// tie-break, and explanations (task 20.1). Property tests (20.3–20.6) are
// implemented separately.

import { describe, it, expect } from "vitest";
import { PRIORITISATION_LOGIC_VERSION, FACTOR_NAMES } from "./factors.js";
import { InvalidPrioritisationInputError } from "./errors.js";
import { prioritise, type PrioritisationItemInput } from "./scoring.js";

function makeItem(overrides: Partial<PrioritisationItemInput> = {}): PrioritisationItemInput {
  return {
    id: "VAR-1",
    kind: "variant",
    consequence: "missense",
    alleleFrequency: 0.0005,
    clinvarClassification: "uncertain_significance",
    geneDiseaseAssociation: "moderate",
    inheritanceFit: 0.5,
    phenotypeSimilarity: 0.5,
    qualityPass: true,
    ...overrides
  };
}

describe("prioritise — scoring and explanations (Req 10.1, 10.5, 10.7)", () => {
  it("produces a bounded score, a rank, a full factor explanation, and the logic version", () => {
    const result = prioritise([makeItem()]);

    expect(result.logicVersion).toBe(PRIORITISATION_LOGIC_VERSION);
    expect(result.ranked).toHaveLength(1);

    const item = result.ranked[0]!;
    expect(item.rank).toBe(1);
    expect(item.score).toBeGreaterThanOrEqual(0);
    expect(item.score).toBeLessThanOrEqual(1);
    expect(item.prioritisationLogicVersion).toBe(PRIORITISATION_LOGIC_VERSION);

    // Every deterministic factor is enumerated, in the fixed order (Req 10.5).
    expect(item.explanation.map((e) => e.factor)).toEqual([...FACTOR_NAMES]);
    expect(item.factorContributions.map((c) => c.factor)).toEqual([...FACTOR_NAMES]);

    // Score is exactly the sum of the weighted contributions.
    const summed = item.explanation.reduce((s, e) => s + e.contribution, 0);
    expect(item.score).toBeCloseTo(summed, 12);
  });

  it("ranks a clearly pathogenic, rare variant above a benign, common one", () => {
    const strong = makeItem({
      id: "VAR-strong",
      consequence: "loss_of_function",
      alleleFrequency: 0,
      clinvarClassification: "pathogenic",
      geneDiseaseAssociation: "definitive",
      inheritanceFit: 1,
      phenotypeSimilarity: 1,
      qualityPass: true
    });
    const weak = makeItem({
      id: "VAR-weak",
      consequence: "synonymous",
      alleleFrequency: 0.4,
      clinvarClassification: "benign",
      geneDiseaseAssociation: "no_known",
      inheritanceFit: 0,
      phenotypeSimilarity: 0,
      qualityPass: false
    });

    const result = prioritise([weak, strong]);
    expect(result.ranked.map((r) => r.id)).toEqual(["VAR-strong", "VAR-weak"]);
  });
});

describe("prioritise — determinism and total order (Req 10.2, 10.3)", () => {
  it("is independent of input ordering (deterministic)", () => {
    const a = makeItem({ id: "A" });
    const b = makeItem({ id: "B" });
    const c = makeItem({ id: "C" });

    const order1 = prioritise([a, b, c]).ranked.map((r) => ({ id: r.id, score: r.score }));
    const order2 = prioritise([c, a, b]).ranked.map((r) => ({ id: r.id, score: r.score }));

    expect(order1).toEqual(order2);
  });

  it("breaks equal-score ties by the fixed sequence down to the identifier", () => {
    // Identical scoring inputs -> identical score/severity/AF/gene-disease;
    // the final tie-break is the lexicographically smaller identifier.
    const result = prioritise([makeItem({ id: "VAR-z" }), makeItem({ id: "VAR-a" })]);
    expect(result.ranked.map((r) => r.id)).toEqual(["VAR-a", "VAR-z"]);
    expect(result.ranked[0]!.rank).toBe(1);
    expect(result.ranked[1]!.rank).toBe(2);
  });
});

describe("prioritise — invalid-input rejection with no partial ranking (Req 10.4)", () => {
  it("rejects an out-of-range allele frequency naming the input", () => {
    expect(() => prioritise([makeItem(), makeItem({ id: "BAD", alleleFrequency: 2 })])).toThrow(
      InvalidPrioritisationInputError
    );
    try {
      prioritise([makeItem({ id: "BAD", alleleFrequency: 2 })]);
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPrioritisationInputError);
      expect((error as InvalidPrioritisationInputError).input).toBe("alleleFrequency");
      expect((error as InvalidPrioritisationInputError).itemId).toBe("BAD");
    }
  });

  it("rejects a duplicate identifier (ambiguous total order)", () => {
    expect(() => prioritise([makeItem({ id: "DUP" }), makeItem({ id: "DUP" })])).toThrow(
      InvalidPrioritisationInputError
    );
  });

  it("rejects an unknown molecular consequence", () => {
    const bad = { ...makeItem(), consequence: "frameshift" } as unknown as PrioritisationItemInput;
    expect(() => prioritise([bad])).toThrow(InvalidPrioritisationInputError);
  });
});
