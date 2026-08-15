// data/generator/src/generator.test.ts
//
// Unit tests for the synthetic case dataset generator (task 7.1). These verify
// the Requirement 1 coverage guarantees, deterministic reproducibility from a
// fixed seed, and that every generated object carries a valid provenance
// envelope.

import { describe, it, expect } from "vitest";
import { validateEnvelope } from "@udn/domain";
import { generateCases, DEFAULT_SEED } from "./generator.js";
import {
  verifyCoverage,
  summariseCoverage,
  MINIMUM_CASE_COUNT
} from "./coverage.js";
import {
  CASE_ARCHETYPES,
  CLINICAL_AREAS,
  INHERITANCE_MODELS
} from "./taxonomy.js";

describe("generateCases", () => {
  it("produces at least 30 cases (Req 1.1)", () => {
    const cases = generateCases();
    expect(cases.length).toBeGreaterThanOrEqual(MINIMUM_CASE_COUNT);
  });

  it("is deterministic: same seed yields deeply-equal corpora (Req 1.1)", () => {
    const a = generateCases({ seed: 12345 });
    const b = generateCases({ seed: 12345 });
    expect(b).toEqual(a);
  });

  it("varies the corpus with the seed while preserving coverage", () => {
    const a = generateCases({ seed: 1 });
    const b = generateCases({ seed: 2 });
    // Different seeds should produce a different attribute arrangement...
    expect(b).not.toEqual(a);
    // ...but both must still satisfy every coverage guarantee.
    expect(verifyCoverage(a).ok).toBe(true);
    expect(verifyCoverage(b).ok).toBe(true);
  });

  it("meets all Requirement 1 coverage guarantees for the default seed", () => {
    const result = verifyCoverage(generateCases());
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("represents every clinical area at least once (Req 1.2)", () => {
    const { clinicalAreas } = summariseCoverage(generateCases());
    for (const area of CLINICAL_AREAS) {
      expect(clinicalAreas[area] ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("provides at least two distinct values per diversity attribute (Req 1.3)", () => {
    const { distinctValueCounts } = summariseCoverage(generateCases());
    for (const count of Object.values(distinctValueCounts)) {
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  it("represents every inheritance model at least once (Req 1.4)", () => {
    const { inheritanceModels } = summariseCoverage(generateCases());
    for (const model of INHERITANCE_MODELS) {
      expect(inheritanceModels[model] ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("includes at least one single-patient and one family-based case (Req 1.5)", () => {
    const { singlePatientCount, familyBasedCount } = summariseCoverage(
      generateCases()
    );
    expect(singlePatientCount).toBeGreaterThanOrEqual(1);
    expect(familyBasedCount).toBeGreaterThanOrEqual(1);
  });

  it("represents every case archetype at least once (Req 1.6)", () => {
    const { archetypes } = summariseCoverage(generateCases());
    for (const archetype of CASE_ARCHETYPES) {
      expect(archetypes[archetype] ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("emits Case and Patient objects with valid provenance envelopes", () => {
    for (const generated of generateCases()) {
      expect(validateEnvelope(generated.case).valid).toBe(true);
      expect(validateEnvelope(generated.patient).valid).toBe(true);
      expect(generated.case.syntheticIndicator).toBe(true);
      expect(generated.patient.syntheticIndicator).toBe(true);
      // The Case entity's id is its own case id (single-table grouping key).
      expect(generated.case.id).toBe(generated.case.caseId);
      // The Patient belongs to the same case.
      expect(generated.patient.caseId).toBe(generated.case.caseId);
    }
  });

  it("assigns globally unique ids across all generated objects", () => {
    const ids = new Set<string>();
    for (const generated of generateCases()) {
      ids.add(generated.case.id);
      ids.add(generated.patient.id);
    }
    // 2 ids per case, all distinct.
    const cases = generateCases();
    expect(ids.size).toBe(cases.length * 2);
  });

  it("keeps the family-based flag consistent with the family structure", () => {
    for (const { spec } of generateCases()) {
      expect(spec.familyBased).toBe(spec.familyStructure !== "single_patient");
    }
  });

  it("uses the default seed when none is supplied", () => {
    expect(generateCases()).toEqual(generateCases({ seed: DEFAULT_SEED }));
  });
});
