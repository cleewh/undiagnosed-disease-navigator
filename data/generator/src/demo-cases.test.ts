// data/generator/src/demo-cases.test.ts
//
// Compile-sanity + completeness unit tests for the three demonstration cases
// (task 33.1). These assert that each demo case generates to completion with
// its full artifact set, maps to the correct scenario, stays synthetic, keeps
// Ground_Truth isolated, and is deterministic. They do NOT cover the guided
// demo mode (33.2) or the end-to-end run (33.3).

import { describe, it, expect } from "vitest";
import { validateEnvelope } from "@udn/domain";
import {
  DEMO_SCENARIOS,
  generateDemoCases,
  getDemoCase,
  type DemoCase
} from "./demo-cases.js";
import { isSyntheticIdentifier } from "./identifiers.js";

const demoCases = generateDemoCases();

function byScenario(scenario: DemoCase["scenario"]): DemoCase {
  const found = demoCases.find((c) => c.scenario === scenario);
  expect(found).toBeDefined();
  return found!;
}

describe("generateDemoCases — coverage", () => {
  it("produces exactly the three declared demonstration scenarios", () => {
    expect(demoCases.map((c) => c.scenario)).toEqual([...DEMO_SCENARIOS]);
  });

  it("gives each case a unique, clearly-synthetic case id", () => {
    const ids = new Set(demoCases.map((c) => c.caseId));
    expect(ids.size).toBe(demoCases.length);
    for (const demo of demoCases) {
      expect(isSyntheticIdentifier(demo.caseId)).toBe(true);
    }
  });
});

describe("generateDemoCases — completeness (every case runs to a full set)", () => {
  it("emits a complete artifact bundle for every demo case", () => {
    for (const demo of demoCases) {
      const { artifacts } = demo;
      expect(artifacts.caseId).toBe(demo.caseId);
      // Every case carries the always-present artifacts (Req 2.3, 2.4, 2.6, 2.7).
      expect(artifacts.fhir.spanDays).toBeGreaterThanOrEqual(730);
      expect(artifacts.phenopacket.phenotypicFeatures.length).toBeGreaterThan(0);
      expect(artifacts.pedigree.individuals.length).toBeGreaterThanOrEqual(1);
      expect(artifacts.vcf.records.length).toBeGreaterThanOrEqual(1);
      expect(artifacts.annotation.rows.length).toBe(
        artifacts.vcf.records.length
      );
      expect(artifacts.qc.totalVariants).toBe(artifacts.vcf.records.length);
      expect(artifacts.candidates.candidates.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps every Case and Patient envelope valid and synthetic", () => {
    for (const demo of demoCases) {
      expect(validateEnvelope(demo.generated.case).valid).toBe(true);
      expect(validateEnvelope(demo.generated.patient).valid).toBe(true);
      expect(demo.generated.case.syntheticIndicator).toBe(true);
      expect(demo.generated.patient.syntheticIndicator).toBe(true);
    }
  });

  it("keeps Ground_Truth isolated and synthetic-labelled", () => {
    for (const demo of demoCases) {
      expect(demo.groundTruth.caseId).toBe(demo.caseId);
      expect(demo.groundTruth.syntheticIndicator).toBe(true);
      expect(demo.groundTruth.accessClassification).toBe("ground_truth");
      // Ground_Truth is never embedded in the case-facing entity.
      expect(
        (demo.generated.case as unknown as Record<string, unknown>)[
          "groundTruth"
        ]
      ).toBeUndefined();
    }
  });
});

describe("generateDemoCases — per-scenario shape", () => {
  it("missed_phenotype resolves to a confirmed diagnosis with a causal finding", () => {
    const demo = byScenario("missed_phenotype");
    expect(demo.generated.spec.archetype).toBe("previously_missed_diagnosis");
    expect(demo.groundTruth.expectedOutcome).toBe("confirmed_diagnosis");
    expect(demo.groundTruth.causalFindings.length).toBeGreaterThanOrEqual(1);
    expect(demo.groundTruth.expectedPhenotypes.length).toBeGreaterThanOrEqual(1);
  });

  it("structural_variant carries CNV/SV results in its bundle (Req 2.9)", () => {
    const demo = byScenario("structural_variant");
    expect(demo.generated.spec.archetype).toBe("structural_variant");
    expect(demo.artifacts.cnvSvResults).toBeDefined();
    expect(demo.artifacts.cnvSvResults!.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("knowledge_triggered_reanalysis is unsolved yet carries stored references", () => {
    const demo = byScenario("knowledge_triggered_reanalysis");
    expect(demo.generated.spec.archetype).toBe("unsolved_case");
    expect(demo.groundTruth.expectedOutcome).toBe("unsolved");
    expect(demo.groundTruth.causalFindings.length).toBe(0);
    // Even unsolved, it exposes stored variants, genes, and phenotypes a
    // simulated Knowledge_Update can intersect to trigger reanalysis.
    const genes = new Set(demo.artifacts.candidates.candidates.map((c) => c.gene));
    expect(demo.artifacts.candidates.candidates.length).toBeGreaterThanOrEqual(1);
    expect(genes.size).toBeGreaterThanOrEqual(1);
    expect(demo.groundTruth.expectedPhenotypes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("generateDemoCases — determinism", () => {
  it("returns deeply-equal results on repeated calls", () => {
    expect(generateDemoCases()).toEqual(generateDemoCases());
  });

  it("getDemoCase agrees with generateDemoCases for each scenario", () => {
    for (const demo of demoCases) {
      expect(getDemoCase(demo.scenario)).toEqual(demo);
    }
  });
});
