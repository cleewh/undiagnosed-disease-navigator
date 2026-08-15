// services/vertical-slice/src/slice-e2e.test.ts
//
// End-to-end vertical-slice test (task 17.6; Requirements 33.1, 33.2).
//
// This is an EXAMPLE-BASED test (not a property test): it drives
// `runVerticalSlice` through all seven stages with a fake AI_Gateway — no
// AWS/Bedrock — and checks the headline slice outcome: a simulated
// Knowledge_Update whose delta intersects the unresolved case's feature vector
// returns that case to the review queue (Req 33.2). It also covers the negative
// example where the update delta does NOT intersect, so no case is queued.

import { describe, it, expect } from "vitest";
import type { Envelope } from "@udn/domain";
import type { GenerativeInvocationResult, GenerativeRequest } from "@udn/ai-gateway";
import {
  createLexiconHpoResolver,
  type PhenotypeExtractionGateway
} from "@udn/phenotype";
import type { CaseClinicalData } from "@udn/timeline";
import type { CaseFeatureVector, MatchOptions } from "@udn/reanalysis";
import type { IngestArtifact, IngestCaseInput } from "@udn/intake";

import { runVerticalSlice, SLICE_STAGES, type VerticalSliceInput } from "./slice.js";
import type { KnowledgeUpdateDelta } from "./knowledge-update.js";

const NOW = "2024-01-01T00:00:00.000Z";
const CASE_ID = "case-001";

// ---------------------------------------------------------------------------
// Fake AI_Gateway + input builders (no AWS/Bedrock)
// ---------------------------------------------------------------------------

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
  return kinds.map((entry) => ({ ...entry, ...provenance }));
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

/** The unresolved case's feature vector — its stored references (Req 15.1). */
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

/** A fully-succeeding slice input, with the update delta supplied per case. */
function baseInput(delta: KnowledgeUpdateDelta): VerticalSliceInput {
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
    knowledgeUpdate: { delta, createdById: "researcher", id: "KU-1" },
    reanalysis: { featureVector, matchOptions }
  };
}

// ---------------------------------------------------------------------------
// End-to-end slice (Req 33.1, 33.2)
// ---------------------------------------------------------------------------

describe("vertical slice end-to-end", () => {
  it("runs all seven stages and returns the unresolved case to the review queue when the Knowledge_Update intersects the case (Req 33.1, 33.2)", async () => {
    // The update touches VAR-1, which the case stores -> the case is affected.
    const intersecting: KnowledgeUpdateDelta = {
      variants: ["VAR-1"],
      genes: [],
      phenotypes: [],
      diseases: []
    };

    const result = await runVerticalSlice(baseInput(intersecting));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // All seven stages ran, in order (Req 33.1).
    expect(result.completedStages).toEqual(SLICE_STAGES);

    // Each stage populated its output.
    expect(result.state.case?.id).toBe(CASE_ID);
    expect(result.state.timeline?.entries).toHaveLength(1);
    expect(result.state.candidates?.length).toBeGreaterThan(0);
    expect(result.state.confirmedPhenotypes?.length).toBeGreaterThan(0);
    expect(result.state.hypothesis?.evidenceItemIds.length).toBeGreaterThan(0);
    expect(result.state.knowledgeUpdate?.syntheticIndicator).toBe(true);

    // Headline check: the simulated Knowledge_Update returns the unresolved
    // case to the review queue (Req 33.2).
    expect(result.state.reanalysisCandidate).not.toBeNull();
    expect(result.state.reviewQueue).toHaveLength(1);
    expect(result.state.reviewQueue?.[0]?.caseId).toBe(CASE_ID);
    expect(result.state.reviewQueue?.[0]?.knowledgeUpdateId).toBe("KU-1");
  });

  it("runs all seven stages but queues no case when the Knowledge_Update does not intersect (Req 33.1, 33.2)", async () => {
    // The update touches an unrelated variant the case does not store.
    const nonIntersecting: KnowledgeUpdateDelta = {
      variants: ["VAR-999"],
      genes: [],
      phenotypes: [],
      diseases: []
    };

    const result = await runVerticalSlice(baseInput(nonIntersecting));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The slice still completes all seven stages...
    expect(result.completedStages).toEqual(SLICE_STAGES);
    expect(result.state.knowledgeUpdate?.syntheticIndicator).toBe(true);

    // ...but no case is affected, so nothing is returned to the queue (Req 33.2).
    expect(result.state.reanalysisCandidate).toBeNull();
    expect(result.state.reviewQueue).toHaveLength(0);
  });
});
