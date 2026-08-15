// services/vertical-slice/src/slice.test.ts
//
// Compile-sanity and behavioural unit tests for the seven-stage vertical-slice
// orchestration (task 17.2). The exhaustive property test for halt behaviour is
// task 17.5 and the full E2E test is task 17.6; these are implemented
// separately.

import { describe, it, expect } from "vitest";
import type { Envelope } from "@udn/domain";
import type { GenerativeInvocationResult, GenerativeRequest } from "@udn/ai-gateway";
import { createLexiconHpoResolver, type PhenotypeExtractionGateway } from "@udn/phenotype";
import type { CaseClinicalData } from "@udn/timeline";
import type { CaseFeatureVector, MatchOptions } from "@udn/reanalysis";
import type { IngestArtifact, IngestCaseInput } from "@udn/intake";

import { runVerticalSlice, SLICE_STAGES, type VerticalSliceInput } from "./slice.js";

const NOW = "2024-01-01T00:00:00.000Z";
const CASE_ID = "case-001";

/** A fake AI_Gateway that returns one grounded phenotype statement. No AWS. */
function fakeGateway(outputText: string): PhenotypeExtractionGateway {
  return {
    async invoke(_request: GenerativeRequest): Promise<GenerativeInvocationResult> {
      return {
        outcome: "invoked",
        modelId: "fake-model",
        taskType: "phenotype_extraction",
        response: { outputText, modelId: "fake-model" }
      };
    }
  };
}

/** A gateway that always rejects, simulating an unavailable model path. */
function rejectingGateway(): PhenotypeExtractionGateway {
  return {
    async invoke(_request: GenerativeRequest): Promise<GenerativeInvocationResult> {
      return {
        outcome: "rejected",
        error: { name: "AiGatewayError", message: "configuration missing" } as never
      };
    }
  };
}

const GROUNDED_OUTPUT = JSON.stringify({
  statements: [
    {
      statement: "seizures",
      sourceRefs: ["Doc-1"],
      confidence: 0.9,
      basis: "observed"
    }
  ]
});

/** Resolver that maps "seizures" to a valid, known HPO id. */
const resolver = createLexiconHpoResolver({
  lexicon: {
    seizures: { mappings: [{ hpoId: "HP:0001250", confidence: 0.95 }] }
  },
  knownHpoIds: ["HP:0001250"]
});

function requiredArtifacts(): IngestArtifact[] {
  const provenance = { sourceId: "src", versionId: "1", createdById: "coord" };
  const phenopacket = {
    id: "pp-1",
    subject: { id: "subject-1", sex: "FEMALE" },
    phenotypicFeatures: [{ type: { id: "HP:0001250", label: "Seizure" } }],
    metaData: { created: NOW, createdBy: "generator", resources: [] }
  };
  const fhir = {
    resourceType: "Bundle",
    type: "collection",
    entry: [{ resource: { resourceType: "Patient", id: "subject-1" } }]
  };
  const kinds: { name: string; kind: IngestArtifact["kind"]; content: unknown }[] = [
    { name: "fhir", kind: "fhir", content: fhir },
    { name: "phenopacket", kind: "phenopacket", content: phenopacket },
    { name: "pedigree", kind: "pedigree", content: { individuals: [] } },
    { name: "vcf", kind: "vcf", content: "##fileformat=VCFv4.2" },
    { name: "annotation", kind: "annotation", content: [{ variant: "v1" }] },
    { name: "qc", kind: "qc", content: { pass: true } },
    { name: "candidates", kind: "candidates", content: [{ variant: "v1" }] }
  ];
  return kinds.map((entry) => ({
    ...entry,
    ...provenance
  }));
}

function intakeInput(): IngestCaseInput {
  return {
    caseId: CASE_ID,
    caseMetadata: {
      clinicalArea: "neurodevelopmental",
      archetype: "unsolved case",
      inheritanceModel: "uncertain",
      familyBased: false
    },
    artifacts: requiredArtifacts(),
    createdById: "coord",
    now: NOW
  };
}

const clinicalData: CaseClinicalData = {
  observations: [
    {
      resourceType: "Observation",
      id: "obs-1",
      effectiveDateTime: "2022-05-01T00:00:00.000Z",
      code: { text: "Seizure episode" }
    }
  ]
};

const featureVector: CaseFeatureVector = {
  caseId: CASE_ID,
  variants: ["VAR-1"],
  genes: ["SCN1A"],
  phenotypes: ["HP:0001250"]
};

const matchOptions: MatchOptions = {
  createdById: "system",
  source: "Reanalysis_Service",
  now: NOW
};

function baseInput(overrides: Partial<VerticalSliceInput> = {}): VerticalSliceInput {
  const collected: Envelope[] = [];
  return {
    repository: {
      async put(entity: Envelope): Promise<void> {
        collected.push(entity);
      }
    },
    intake: intakeInput(),
    clinicalData,
    gateway: fakeGateway(GROUNDED_OUTPUT),
    sourceDocuments: [{ sourceObjectId: "Doc-1", content: "Patient had seizures." }],
    extractionOptions: { resolver, invokingUserId: "geneticist", now: () => NOW },
    confirmation: { reviewerId: "geneticist", at: NOW, isAuthorised: true },
    hypothesis: {
      text: "Findings are consistent with a channelopathy pattern.",
      knowledgeSnapshotVersion: "snap-1",
      createdById: "geneticist"
    },
    knowledgeUpdate: {
      delta: { variants: ["VAR-1"], genes: [], phenotypes: [], diseases: [] },
      createdById: "researcher",
      id: "KU-1"
    },
    reanalysis: { featureVector, matchOptions },
    ...overrides
  };
}

describe("runVerticalSlice", () => {
  it("runs all seven stages and returns the unresolved case to the review queue (Req 33.1, 33.2)", async () => {
    const result = await runVerticalSlice(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.completedStages).toEqual(SLICE_STAGES);
    expect(result.state.case?.id).toBe(CASE_ID);
    expect(result.state.timeline?.entries).toHaveLength(1);
    expect(result.state.candidates?.length).toBeGreaterThan(0);
    expect(result.state.confirmedPhenotypes?.length).toBeGreaterThan(0);
    expect(result.state.hypothesis?.evidenceItemIds.length).toBeGreaterThan(0);
    expect(result.state.knowledgeUpdate?.syntheticIndicator).toBe(true);
    // The update references VAR-1, which the case stores -> queued (Req 33.2).
    expect(result.state.reviewQueue).toHaveLength(1);
    expect(result.state.reviewQueue?.[0]?.caseId).toBe(CASE_ID);
  });

  it("halts on an unauthorised confirmation and preserves pre-stage state (Req 33.3)", async () => {
    const result = await runVerticalSlice(
      baseInput({ confirmation: { reviewerId: "intruder", at: NOW, isAuthorised: false } })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failedStage).toBe("clinician_confirmation");
    // Stages up to and including phenotype extraction completed and are intact.
    expect(result.completedStages).toEqual([
      "intake",
      "timeline",
      "phenotype_extraction"
    ]);
    expect(result.stateBefore.candidates?.length).toBeGreaterThan(0);
    // No later stage advanced: no hypothesis, no update, no queue entry.
    expect(result.stateBefore.hypothesis).toBeUndefined();
    expect(result.stateBefore.knowledgeUpdate).toBeUndefined();
    expect(result.stateBefore.reviewQueue).toBeUndefined();
  });

  it("halts on a phenotype-extraction gateway failure with no partial advance (Req 33.3, 5.8)", async () => {
    const result = await runVerticalSlice(baseInput({ gateway: rejectingGateway() }));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failedStage).toBe("phenotype_extraction");
    expect(result.completedStages).toEqual(["intake", "timeline"]);
    expect(result.stateBefore.candidates).toBeUndefined();
    expect(result.stateBefore.timeline?.entries).toHaveLength(1);
  });
});
