// data/generator/src/artifacts.test.ts
//
// Unit tests for per-case artifact composition (task 7.3). These verify the
// Requirement 2 artifact guarantees: a >= 2-year FHIR R4 record (2.3), a
// Phenopacket with present + excluded features (2.4), a pedigree consistent
// with the family structure (2.6), the required genomic artifacts (2.7),
// conditional trio/family VCF + inheritance results (2.8), archetype-specific
// results (2.9), and deterministic reproducibility.

import { describe, it, expect } from "vitest";
import {
  composeCaseArtifacts,
  type CaseArtifacts
} from "./artifacts.js";
import {
  generateCaseArtifacts,
  generateCorpus,
  type GeneratedCase
} from "./generator.js";
import type { GroundTruth } from "./ground-truth.js";

const TWO_YEARS_DAYS = 730;
const ONE_DAY_MS = 86_400_000;

interface CaseFixture {
  generated: GeneratedCase;
  groundTruth: GroundTruth;
  artifacts: CaseArtifacts;
}

function buildFixtures(seed = 12345): CaseFixture[] {
  const { cases, groundTruth, artifacts } = generateCorpus({
    seed,
    withArtifacts: true
  });
  return cases.map((generated) => {
    const caseId = generated.case.caseId;
    return {
      generated,
      groundTruth: groundTruth[caseId]!,
      artifacts: artifacts![caseId]!
    };
  });
}

const fixtures = buildFixtures();

describe("composeCaseArtifacts — FHIR R4 record (Req 2.3)", () => {
  it("spans at least two years of clinical events for every case", () => {
    for (const { artifacts } of fixtures) {
      const { fhir } = artifacts;
      const start = Date.parse(fhir.periodStart);
      const end = Date.parse(fhir.periodEnd);
      const spanDays = (end - start) / ONE_DAY_MS;
      expect(spanDays).toBeGreaterThanOrEqual(TWO_YEARS_DAYS);
      expect(fhir.spanDays).toBeGreaterThanOrEqual(TWO_YEARS_DAYS);
    }
  });

  it("produces well-shaped Patient/Encounter/Observation resources", () => {
    for (const { artifacts } of fixtures) {
      const { fhir } = artifacts;
      expect(fhir.patient.resourceType).toBe("Patient");
      expect(fhir.encounters.length).toBeGreaterThanOrEqual(2);
      expect(fhir.observations.length).toBeGreaterThanOrEqual(1);
      for (const encounter of fhir.encounters) {
        expect(encounter.resourceType).toBe("Encounter");
        expect(encounter.subject.reference).toContain(fhir.patient.id);
      }
      for (const obs of fhir.observations) {
        expect(obs.resourceType).toBe("Observation");
        expect(obs.code.coding.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("orders encounters oldest to newest", () => {
    for (const { artifacts } of fixtures) {
      const dates = artifacts.fhir.encounters.map((e) =>
        Date.parse(e.period.start)
      );
      const sorted = [...dates].sort((a, b) => a - b);
      expect(dates).toEqual(sorted);
    }
  });
});

describe("composeCaseArtifacts — Phenopacket (Req 2.4)", () => {
  it("has both present and excluded phenotypic features", () => {
    for (const { artifacts } of fixtures) {
      const features = artifacts.phenopacket.phenotypicFeatures;
      const present = features.filter((f) => !f.excluded);
      const excluded = features.filter((f) => f.excluded);
      expect(present.length).toBeGreaterThanOrEqual(1);
      expect(excluded.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("draws present features from the case's expected phenotypes", () => {
    for (const { artifacts, groundTruth } of fixtures) {
      const presentIds = artifacts.phenopacket.phenotypicFeatures
        .filter((f) => !f.excluded)
        .map((f) => f.type.id);
      expect(presentIds).toEqual(groundTruth.expectedPhenotypes);
    }
  });

  it("keeps excluded features disjoint from present features", () => {
    for (const { artifacts } of fixtures) {
      const features = artifacts.phenopacket.phenotypicFeatures;
      const present = new Set(
        features.filter((f) => !f.excluded).map((f) => f.type.id)
      );
      for (const excluded of features.filter((f) => f.excluded)) {
        expect(present.has(excluded.type.id)).toBe(false);
      }
    }
  });

  it("embeds a pedigree for family cases and omits it for single patients", () => {
    for (const { artifacts, generated } of fixtures) {
      if (generated.spec.familyBased) {
        expect(artifacts.phenopacket.pedigree).toBeDefined();
        expect(
          artifacts.phenopacket.pedigree!.persons.length
        ).toBeGreaterThanOrEqual(3);
      } else {
        expect(artifacts.phenopacket.pedigree).toBeUndefined();
      }
    }
  });
});

describe("composeCaseArtifacts — pedigree (Req 2.6)", () => {
  it("has exactly one proband per case", () => {
    for (const { artifacts } of fixtures) {
      const probands = artifacts.pedigree.individuals.filter(
        (i) => i.isProband
      );
      expect(probands.length).toBe(1);
      expect(probands[0]!.id).toBe(artifacts.pedigree.probandId);
    }
  });

  it("keeps every relationship internally consistent", () => {
    for (const { artifacts } of fixtures) {
      const memberIds = new Set(
        artifacts.pedigree.individuals.map((i) => i.id)
      );
      for (const rel of artifacts.pedigree.relationships) {
        expect(memberIds.has(rel.parent)).toBe(true);
        expect(memberIds.has(rel.child)).toBe(true);
        expect(rel.parent).not.toBe(rel.child);
      }
    }
  });

  it("matches the family structure", () => {
    for (const { artifacts, generated } of fixtures) {
      const { familyStructure } = generated.spec;
      const count = artifacts.pedigree.individuals.length;
      const relCount = artifacts.pedigree.relationships.length;
      if (familyStructure === "single_patient") {
        expect(count).toBe(1);
        expect(relCount).toBe(0);
      } else if (familyStructure === "trio") {
        expect(count).toBe(3);
        expect(relCount).toBe(2);
      } else if (familyStructure === "quad") {
        expect(count).toBe(4);
        expect(relCount).toBe(4);
      } else {
        // extended_family: proband + parents + maternal grandparents
        expect(count).toBe(5);
        expect(relCount).toBe(4);
      }
    }
  });

  it("gives the proband both a mother and a father in family cases", () => {
    for (const { artifacts, generated } of fixtures) {
      if (!generated.spec.familyBased) {
        continue;
      }
      const parents = artifacts.pedigree.relationships.filter(
        (r) => r.child === artifacts.pedigree.probandId
      );
      expect(parents.length).toBe(2);
      const parentSexes = parents.map(
        (p) =>
          artifacts.pedigree.individuals.find((i) => i.id === p.parent)!.sex
      );
      expect(parentSexes).toContain("FEMALE");
      expect(parentSexes).toContain("MALE");
    }
  });
});

describe("composeCaseArtifacts — genomic artifacts (Req 2.7)", () => {
  it("always produces a VCF, annotation table, QC summary, and candidate list", () => {
    for (const { artifacts } of fixtures) {
      expect(artifacts.vcf.records.length).toBeGreaterThanOrEqual(1);
      expect(artifacts.vcf.text).toContain("##fileformat=VCF");
      expect(artifacts.annotation.rows.length).toBe(
        artifacts.vcf.records.length
      );
      expect(artifacts.qc.totalVariants).toBe(artifacts.vcf.records.length);
      expect(artifacts.candidates.candidates.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("orders the candidate list by descending priority score", () => {
    for (const { artifacts } of fixtures) {
      const scores = artifacts.candidates.candidates.map((c) => c.priorityScore);
      const sorted = [...scores].sort((a, b) => b - a);
      expect(scores).toEqual(sorted);
    }
  });

  it("includes each Ground_Truth causal variant in the VCF (internal consistency)", () => {
    for (const { artifacts, groundTruth } of fixtures) {
      const vcfIds = new Set(artifacts.vcf.records.map((r) => r.id));
      for (const finding of groundTruth.causalFindings) {
        expect(vcfIds.has(finding.variantId)).toBe(true);
      }
    }
  });
});

describe("composeCaseArtifacts — family artifacts (Req 2.8)", () => {
  it("gives family cases a multi-sample VCF and inheritance results", () => {
    for (const { artifacts, generated } of fixtures) {
      if (generated.spec.familyBased) {
        expect(artifacts.vcf.isFamilyVcf).toBe(true);
        expect(artifacts.vcf.samples.length).toBe(3);
        expect(artifacts.inheritanceResults).toBeDefined();
        expect(
          artifacts.inheritanceResults!.results.length
        ).toBeGreaterThanOrEqual(1);
      } else {
        expect(artifacts.vcf.isFamilyVcf).toBe(false);
        expect(artifacts.vcf.samples.length).toBe(1);
        expect(artifacts.inheritanceResults).toBeUndefined();
      }
    }
  });

  it("emits a genotype for every sample in a family VCF record", () => {
    for (const { artifacts, generated } of fixtures) {
      if (!generated.spec.familyBased) {
        continue;
      }
      for (const record of artifacts.vcf.records) {
        const sampleIds = record.genotypes.map((g) => g.sampleId);
        for (const sample of artifacts.vcf.samples) {
          expect(sampleIds).toContain(sample);
        }
      }
    }
  });
});

describe("composeCaseArtifacts — archetype-specific artifacts (Req 2.9)", () => {
  it("produces CNV/SV results for structural_variant cases only", () => {
    for (const { artifacts, generated } of fixtures) {
      if (generated.spec.archetype === "structural_variant") {
        expect(artifacts.cnvSvResults).toBeDefined();
        expect(artifacts.cnvSvResults!.calls.length).toBeGreaterThanOrEqual(1);
      } else {
        expect(artifacts.cnvSvResults).toBeUndefined();
      }
    }
  });

  it("produces repeat-expansion results for repeat_expansion cases only", () => {
    for (const { artifacts, generated } of fixtures) {
      if (generated.spec.archetype === "repeat_expansion") {
        expect(artifacts.repeatExpansionResults).toBeDefined();
        const call = artifacts.repeatExpansionResults!.calls[0]!;
        expect(call.repeatCount).toBeGreaterThan(call.pathogenicMin);
      } else {
        expect(artifacts.repeatExpansionResults).toBeUndefined();
      }
    }
  });

  it("produces mitochondrial results for mitochondrial cases only", () => {
    for (const { artifacts, generated } of fixtures) {
      if (generated.spec.archetype === "mitochondrial") {
        expect(artifacts.mitochondrialResults).toBeDefined();
        const call = artifacts.mitochondrialResults!.calls[0]!;
        expect(call.heteroplasmy).toBeGreaterThanOrEqual(0);
        expect(call.heteroplasmy).toBeLessThanOrEqual(1);
      } else {
        expect(artifacts.mitochondrialResults).toBeUndefined();
      }
    }
  });

  it("covers every required archetype at least once in the corpus", () => {
    const withCnv = fixtures.some((f) => f.artifacts.cnvSvResults);
    const withRepeat = fixtures.some((f) => f.artifacts.repeatExpansionResults);
    const withMito = fixtures.some((f) => f.artifacts.mitochondrialResults);
    expect(withCnv).toBe(true);
    expect(withRepeat).toBe(true);
    expect(withMito).toBe(true);
  });
});

describe("composeCaseArtifacts — determinism", () => {
  it("is a pure function of its inputs", () => {
    for (const { generated, groundTruth, artifacts } of fixtures) {
      const again = composeCaseArtifacts(generated, groundTruth);
      expect(again).toEqual(artifacts);
    }
  });

  it("generateCaseArtifacts is reproducible for the same seed", () => {
    const a = generateCaseArtifacts({ seed: 777 });
    const b = generateCaseArtifacts({ seed: 777 });
    expect(b).toEqual(a);
  });

  it("generateCaseArtifacts varies with the seed", () => {
    const a = generateCaseArtifacts({ seed: 1 });
    const b = generateCaseArtifacts({ seed: 2 });
    expect(b).not.toEqual(a);
  });
});
