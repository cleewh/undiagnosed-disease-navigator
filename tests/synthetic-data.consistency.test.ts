// tests/synthetic-data.consistency.test.ts
//
// Task 32.2 — synthetic-data consistency and safety-critical tests
// (Requirements 31.5, 31.7).
//
// These tests assert the internal consistency guarantees of the generated
// synthetic corpus and the curated demonstration cases, and they encode the
// two SAFETY-CRITICAL invariants (Req 31.7). Per the harness convention
// established in task 32.1 (see scripts/test-report.mjs), this file uses the
// `.consistency.test.` infix so the report categorises it as `consistency`,
// and every safety-critical test embeds the `[safety-critical]` marker in its
// title so the harness surfaces it prominently if it ever fails.
//
// Requirement 31.5 coverage (synthetic-data consistency):
//   - pedigrees match declared family relationships;
//   - variant inheritance matches family structure;
//   - phenotypes match the case;
//   - each evidence/source link resolves to an existing target;
//   - a Knowledge_Update modifies only cases within its declared scope and
//     leaves all others unchanged;
//   - Ground_Truth is inaccessible to the (non-Evaluation) user.
//
// Requirement 31.7 coverage (safety-critical): a test that detects Ground_Truth
// exposure to a non-Evaluation reader, and a test that detects an out-of-scope
// Knowledge_Update effect. Both are written to PASS on correct code (they
// assert Ground_Truth is NOT exposed and out-of-scope cases are untouched).
//
// The tests are deterministic and hermetic: the corpus and demo cases are
// generated from fixed seeds, and no AWS/Bedrock or network access is involved.

import { describe, it, expect } from "vitest";
import {
  generateCorpus,
  generateDemoCases,
  type CaseArtifacts,
  type GeneratedCase,
  type GroundTruth,
  type PedigreeArtifact
} from "@udn/data-generator";
import {
  buildTimeline,
  resolveSourceObject,
  type CaseClinicalData
} from "@udn/timeline";
import {
  matchCase,
  matchUnresolvedCases,
  type CaseFeatureVector,
  type MatchOptions
} from "@udn/reanalysis";
import { publishKnowledgeUpdate } from "@udn/vertical-slice";
import {
  accessGroundTruth,
  sealGroundTruth,
  evaluationFrameworkPrincipal,
  GroundTruthAccessError,
  type Principal
} from "@udn/intake";

// ---------------------------------------------------------------------------
// Deterministic fixtures: the corpus (with artifacts) and the demo cases.
// ---------------------------------------------------------------------------

const corpus = generateCorpus({ withArtifacts: true });
const artifactsByCase: Record<string, CaseArtifacts> = corpus.artifacts ?? {};
const demoCases = generateDemoCases();

/** The expected member count for each declared family structure. */
const EXPECTED_MEMBER_COUNT: Record<string, number> = {
  single_patient: 1,
  trio: 3,
  quad: 4,
  extended_family: 5
};

/** A generated case paired with its hidden Ground_Truth and artifact bundle. */
interface CaseUnderTest {
  readonly generated: GeneratedCase;
  readonly groundTruth: GroundTruth;
  readonly artifacts: CaseArtifacts;
}

/** Collect every corpus case with its Ground_Truth and artifacts. */
function corpusCasesUnderTest(): CaseUnderTest[] {
  const out: CaseUnderTest[] = [];
  for (const generated of corpus.cases) {
    const caseId = generated.case.caseId;
    const groundTruth = corpus.groundTruth[caseId];
    const artifacts = artifactsByCase[caseId];
    if (groundTruth !== undefined && artifacts !== undefined) {
      out.push({ generated, groundTruth, artifacts });
    }
  }
  return out;
}

const casesUnderTest = corpusCasesUnderTest();

// ---------------------------------------------------------------------------
// Pedigrees match declared family relationships (Req 31.5).
// ---------------------------------------------------------------------------

describe("synthetic-data consistency: pedigrees match declared relationships (Req 31.5)", () => {
  it("has at least one case to check", () => {
    expect(casesUnderTest.length).toBeGreaterThan(0);
  });

  it("each pedigree matches its declared family structure and is well-formed", () => {
    for (const { generated, artifacts } of casesUnderTest) {
      const pedigree: PedigreeArtifact = artifacts.pedigree;
      const { familyStructure } = generated.spec;

      // The pedigree's declared structure equals the case's family structure.
      expect(pedigree.familyStructure).toBe(familyStructure);

      // Member count matches the declared family structure.
      const expectedMembers = EXPECTED_MEMBER_COUNT[familyStructure];
      expect(expectedMembers).toBeDefined();
      expect(pedigree.individuals.length).toBe(expectedMembers);

      // Exactly one proband, and the proband is affected and defined.
      const probands = pedigree.individuals.filter((p) => p.isProband);
      expect(probands.length).toBe(1);
      const proband = probands[0]!;
      expect(proband.id).toBe(pedigree.probandId);
      expect(proband.affected).toBe(true);

      // Every relationship references DEFINED members (no dangling edges).
      const definedIds = new Set(pedigree.individuals.map((p) => p.id));
      for (const rel of pedigree.relationships) {
        expect(definedIds.has(rel.parent)).toBe(true);
        expect(definedIds.has(rel.child)).toBe(true);
      }

      if (familyStructure === "single_patient") {
        // A single-patient case has no parental relationships.
        expect(pedigree.relationships.length).toBe(0);
      } else {
        // Family-based cases declare the proband's parentage.
        const probandParents = pedigree.relationships.filter(
          (rel) => rel.child === pedigree.probandId
        );
        expect(probandParents.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("the Phenopacket pedigree is present only for family-based cases and mirrors the pedigree", () => {
    for (const { generated, artifacts } of casesUnderTest) {
      const { familyBased } = generated.spec;
      const embedded = artifacts.phenopacket.pedigree;
      if (familyBased) {
        expect(embedded).toBeDefined();
        expect(embedded!.persons.length).toBe(artifacts.pedigree.individuals.length);
      } else {
        expect(embedded).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Variant inheritance matches family structure (Req 31.5).
// ---------------------------------------------------------------------------

describe("synthetic-data consistency: variant inheritance matches family structure (Req 31.5)", () => {
  it("causal findings carry the case's declared inheritance model", () => {
    for (const { generated, groundTruth } of casesUnderTest) {
      for (const finding of groundTruth.causalFindings) {
        expect(finding.inheritanceModel).toBe(generated.spec.inheritanceModel);
      }
    }
  });

  it("the VCF sample columns and inheritance results follow the family structure", () => {
    for (const { generated, groundTruth, artifacts } of casesUnderTest) {
      const { familyBased } = generated.spec;

      // A family-based case emits a family VCF (proband + parents); a
      // single-patient case emits a single-sample VCF.
      expect(artifacts.vcf.isFamilyVcf).toBe(familyBased);
      expect(artifacts.vcf.samples.length).toBe(familyBased ? 3 : 1);

      if (familyBased) {
        // Inheritance/segregation results exist only for family-based cases.
        expect(artifacts.inheritanceResults).toBeDefined();

        // For solved family cases, every causal variant segregates consistently.
        const results = artifacts.inheritanceResults!.results;
        for (const finding of groundTruth.causalFindings) {
          const result = results.find((r) => r.variantId === finding.variantId);
          expect(result).toBeDefined();
          expect(result!.consistentWithModel).toBe(true);
        }

        // Each causal VCF record carries genotype calls for all family samples.
        for (const finding of groundTruth.causalFindings) {
          const record = artifacts.vcf.records.find((r) => r.id === finding.variantId);
          expect(record).toBeDefined();
          expect(record!.genotypes.length).toBe(artifacts.vcf.samples.length);
        }
      } else {
        expect(artifacts.inheritanceResults).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Phenotypes match the case (Req 31.5).
// ---------------------------------------------------------------------------

describe("synthetic-data consistency: phenotypes match the case (Req 31.5)", () => {
  it("present Phenopacket features equal the case's expected phenotypes, and excluded features are disjoint", () => {
    for (const { groundTruth, artifacts } of casesUnderTest) {
      const features = artifacts.phenopacket.phenotypicFeatures;
      const present = features.filter((f) => !f.excluded).map((f) => f.type.id);
      const excluded = features.filter((f) => f.excluded).map((f) => f.type.id);

      // Present features are exactly the case's expected phenotypes.
      expect([...present].sort()).toEqual([...groundTruth.expectedPhenotypes].sort());
      expect(present.length).toBeGreaterThanOrEqual(2);

      // Excluded (asserted-absent) features do not overlap the present set.
      const presentSet = new Set(present);
      for (const id of excluded) {
        expect(presentSet.has(id)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Each evidence/source link resolves to an existing target (Req 31.5).
// ---------------------------------------------------------------------------

describe("synthetic-data consistency: every evidence/source link resolves (Req 31.5)", () => {
  it("annotation rows, candidate variants, and causal findings all resolve to VCF records", () => {
    for (const { groundTruth, artifacts } of casesUnderTest) {
      const vcfVariantIds = new Set(artifacts.vcf.records.map((r) => r.id));
      const annotationVariantIds = new Set(artifacts.annotation.rows.map((r) => r.variantId));

      // Every annotation row links to a real VCF record.
      for (const row of artifacts.annotation.rows) {
        expect(vcfVariantIds.has(row.variantId)).toBe(true);
      }
      // Every VCF record is annotated (bidirectional coverage).
      for (const record of artifacts.vcf.records) {
        expect(annotationVariantIds.has(record.id)).toBe(true);
      }
      // Every candidate variant links to a real VCF record.
      for (const candidate of artifacts.candidates.candidates) {
        expect(vcfVariantIds.has(candidate.variantId)).toBe(true);
      }
      // Every causal finding is present in the VCF and the annotation table.
      for (const finding of groundTruth.causalFindings) {
        expect(vcfVariantIds.has(finding.variantId)).toBe(true);
        expect(annotationVariantIds.has(finding.variantId)).toBe(true);
      }
    }
  });

  it("every reconstructed timeline entry resolves back to its source clinical object", () => {
    for (const { artifacts } of casesUnderTest) {
      const clinical: CaseClinicalData = {
        encounters: artifacts.fhir.encounters,
        observations: artifacts.fhir.observations,
        conditions: artifacts.fhir.conditions
      };
      const timeline = buildTimeline(clinical);
      expect(timeline.isEmpty).toBe(false);
      for (const entry of timeline.entries) {
        expect(resolveSourceObject(clinical, entry.sourceObjectRef)).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// A Knowledge_Update modifies only cases within its declared scope (Req 31.5).
// ---------------------------------------------------------------------------

/** Build a deterministic reanalysis feature vector for a corpus case. */
function featureVectorFor(item: CaseUnderTest): CaseFeatureVector {
  return {
    caseId: item.generated.case.caseId,
    variants: item.groundTruth.causalFindings.map((f) => f.variantId),
    genes: item.groundTruth.causalFindings.map((f) => f.gene),
    phenotypes: [...item.groundTruth.expectedPhenotypes]
  };
}

/** Fixed match options keep the reanalysis output byte-for-byte reproducible. */
const MATCH_OPTIONS: MatchOptions = {
  createdById: "consistency-test",
  source: "Reanalysis_Service",
  now: "2020-06-01T00:00:00.000Z"
};

/** The first solved case (has at least one causal finding) is the in-scope target. */
const scopedTarget = casesUnderTest.find(
  (item) => item.groundTruth.causalFindings.length > 0
);

describe("synthetic-data consistency: Knowledge_Update scope isolation (Req 31.5)", () => {
  it("has a solved case available to scope an update against", () => {
    expect(scopedTarget).toBeDefined();
  });

  it("a scoped Knowledge_Update produces a candidate ONLY for the in-scope case", () => {
    const target = scopedTarget!;
    const targetVariant = target.groundTruth.causalFindings[0]!.variantId;

    const published = publishKnowledgeUpdate({
      delta: { variants: [targetVariant], genes: [], phenotypes: [], diseases: [] },
      createdById: "consistency-test",
      now: MATCH_OPTIONS.now
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    const features = casesUnderTest.map(featureVectorFor);
    const batch = matchUnresolvedCases(features, published.update, MATCH_OPTIONS);

    // Exactly the in-scope case is affected; every other case is untouched.
    expect(batch.candidates.length).toBe(1);
    expect(batch.candidates[0]!.caseId).toBe(target.generated.case.caseId);
    expect(batch.reviewQueue.length).toBe(1);
    expect(batch.reviewQueue[0]!.caseId).toBe(target.generated.case.caseId);
  });
});

// ---------------------------------------------------------------------------
// SAFETY-CRITICAL (Req 31.7): out-of-scope Knowledge_Update effect.
// ---------------------------------------------------------------------------

describe("SAFETY-CRITICAL synthetic-data invariants (Req 31.7)", () => {
  it("a Knowledge_Update leaves every out-of-scope case unchanged [safety-critical]", () => {
    const target = scopedTarget!;
    expect(target).toBeDefined();
    const targetVariant = target.groundTruth.causalFindings[0]!.variantId;

    const published = publishKnowledgeUpdate({
      delta: { variants: [targetVariant], genes: [], phenotypes: [], diseases: [] },
      createdById: "consistency-test",
      now: MATCH_OPTIONS.now
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    // Every case OTHER than the in-scope target must remain unaffected: no
    // candidate, empty relevance. Any match here is an out-of-scope effect.
    for (const item of casesUnderTest) {
      if (item.generated.case.caseId === target.generated.case.caseId) continue;
      const result = matchCase(featureVectorFor(item), published.update, MATCH_OPTIONS);
      expect(result.matched).toBe(false);
      expect(result.candidate).toBeNull();
    }
  });

  it("Ground_Truth is NOT exposed to a non-Evaluation reader [safety-critical]", () => {
    const target = scopedTarget!;
    expect(target).toBeDefined();

    // Seal the case's real Ground_Truth behind the access guard, mirroring the
    // isolated Ground_Truth store the Evaluation_Framework alone may read.
    const sealed = sealGroundTruth(
      `ground-truth/${target.generated.case.caseId}`,
      target.groundTruth
    );

    // A non-Evaluation reader (an interactive user) is DENIED and gets no data.
    const interactiveUser: Principal = {
      id: "clinician-1",
      kind: "InteractiveUser"
    };
    expect(() => accessGroundTruth(interactiveUser, sealed)).toThrow(
      GroundTruthAccessError
    );

    // Only the Evaluation_Framework may read the sealed payload.
    const payload = accessGroundTruth(evaluationFrameworkPrincipal(), sealed);
    expect(payload).toBe(target.groundTruth);

    // Defence in depth: the application-facing Case/Patient never carry the
    // intended answer, so serialising them cannot leak Ground_Truth.
    const caseJson = JSON.stringify(target.generated.case);
    const patientJson = JSON.stringify(target.generated.patient);
    for (const finding of target.groundTruth.causalFindings) {
      expect(caseJson).not.toContain(finding.gene);
      expect(caseJson).not.toContain(finding.variantId);
      expect(patientJson).not.toContain(finding.gene);
      expect(patientJson).not.toContain(finding.variantId);
    }
  });
});

// ---------------------------------------------------------------------------
// The curated demonstration cases satisfy the same consistency invariants.
// ---------------------------------------------------------------------------

describe("synthetic-data consistency: demonstration cases (Req 31.5)", () => {
  it("provides at least three demonstration cases", () => {
    expect(demoCases.length).toBeGreaterThanOrEqual(3);
  });

  it("each demo case has a consistent pedigree, phenotypes, and resolvable evidence links", () => {
    for (const demo of demoCases) {
      const { generated, groundTruth, artifacts } = demo;

      // Pedigree matches declared family structure.
      expect(artifacts.pedigree.familyStructure).toBe(generated.spec.familyStructure);
      expect(artifacts.pedigree.individuals.length).toBe(
        EXPECTED_MEMBER_COUNT[generated.spec.familyStructure]
      );

      // Phenotypes match the case.
      const present = artifacts.phenopacket.phenotypicFeatures
        .filter((f) => !f.excluded)
        .map((f) => f.type.id);
      expect([...present].sort()).toEqual([...groundTruth.expectedPhenotypes].sort());

      // Evidence links resolve: candidates and causal findings map to VCF records.
      const vcfVariantIds = new Set(artifacts.vcf.records.map((r) => r.id));
      for (const candidate of artifacts.candidates.candidates) {
        expect(vcfVariantIds.has(candidate.variantId)).toBe(true);
      }
      for (const finding of groundTruth.causalFindings) {
        expect(vcfVariantIds.has(finding.variantId)).toBe(true);
      }

      // Ground_Truth is kept separate from the application-facing case.
      expect("groundTruth" in generated).toBe(false);
      expect(generated.case.accessClassification).toBe("research");
    }
  });
});
