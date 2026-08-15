// services/vertical-slice/src/halt-behaviour.property.test.ts
//
// Property-based test for design Correctness Property 71 (task 17.5).
//
// Feature: undiagnosed-disease-navigator, Property 71: Vertical-slice stage
// failure halts and preserves prior state
//
// *For any* stage of the vertical slice that fails, the slice halts, presents a
// failure indication, and preserves the state prior to the failed stage
// (Requirements 33.3).
//
// The slice threads an immutable SliceState that is extended ONLY on stage
// success. This property parameterises WHICH stage fails (via a rejecting
// gateway, an unauthorised confirmation, a prohibited hypothesis term, an empty
// knowledge-update delta, or a rejected intake) and asserts, for every such
// injected failure and over varied inputs, that:
//
//   * the slice halts at exactly that stage (`failedStage`),
//   * `completedStages` is exactly the stages before it, in order,
//   * `stateBefore` carries every prior stage's output intact and leaves the
//     failed stage's fields (and every later stage's fields) undefined, and
//   * a non-empty failure indication naming the failed stage is returned.
//
// Every scenario runs against a fake AI_Gateway — no AWS/Bedrock is required.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Envelope } from "@udn/domain";
import type { GenerativeInvocationResult, GenerativeRequest } from "@udn/ai-gateway";
import {
  createLexiconHpoResolver,
  type PhenotypeExtractionGateway
} from "@udn/phenotype";
import type { CaseClinicalData } from "@udn/timeline";
import type { CaseFeatureVector, MatchOptions } from "@udn/reanalysis";
import type { IngestArtifact, IngestCaseInput } from "@udn/intake";

import {
  runVerticalSlice,
  SLICE_STAGES,
  type SliceStageName,
  type SliceState,
  type VerticalSliceInput
} from "./slice.js";

const NOW = "2024-01-01T00:00:00.000Z";
const CASE_ID = "case-001";

// ---------------------------------------------------------------------------
// Known-good slice inputs (mirrors slice.test.ts; no AWS/Bedrock)
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

/** A known-good, fully-succeeding input, with optional overrides. */
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

// ---------------------------------------------------------------------------
// State-field ownership per stage
// ---------------------------------------------------------------------------

/**
 * The SliceState fields each stage populates on success. A `SliceFailure`
 * preserves the fields owned by completed stages and leaves the failed stage's
 * fields (and every later stage's fields) undefined (Req 33.3).
 */
const STAGE_STATE_FIELDS: Record<SliceStageName, readonly (keyof SliceState)[]> = {
  intake: ["case", "retainedArtifacts"],
  timeline: ["timeline"],
  phenotype_extraction: ["candidates"],
  clinician_confirmation: ["confirmedPhenotypes", "approvedCandidates"],
  hypothesis_card: ["hypothesis", "evidenceItems"],
  knowledge_update_publish: ["knowledgeUpdate"],
  reanalysis_notification: ["reanalysisCandidate", "reviewQueue"]
};

// ---------------------------------------------------------------------------
// Failure injection
// ---------------------------------------------------------------------------

/** The stages the slice can be driven to fail at (timeline and reanalysis
 * notification have no failure path under normal ordering). */
type FailableStage = Extract<
  SliceStageName,
  | "intake"
  | "phenotype_extraction"
  | "clinician_confirmation"
  | "hypothesis_card"
  | "knowledge_update_publish"
>;

/** Innocuous variation applied to the otherwise-good inputs. */
interface InputVariation {
  readonly reviewerId: string;
  readonly hypothesisCreatedById: string;
  readonly updateCreatedById: string;
  readonly safeHypothesisText: string;
}

/**
 * Build a slice input that is known-good everywhere EXCEPT the chosen stage,
 * where a stage-specific failure is injected. Innocuous `variation` values are
 * threaded through the non-failing stages so the property runs over many
 * inputs without changing which stage fails.
 */
function inputForFailure(
  failStage: FailableStage,
  variation: InputVariation
): VerticalSliceInput {
  const input = baseInput({
    confirmation: {
      reviewerId: variation.reviewerId,
      at: NOW,
      isAuthorised: true
    },
    hypothesis: {
      text: variation.safeHypothesisText,
      knowledgeSnapshotVersion: "snap-1",
      createdById: variation.hypothesisCreatedById
    },
    knowledgeUpdate: {
      delta: { variants: ["VAR-1"], genes: [], phenotypes: [], diseases: [] },
      createdById: variation.updateCreatedById,
      id: "KU-1"
    }
  });

  switch (failStage) {
    case "intake": {
      // Drop a required artifact ("phenopacket") -> intake rejects the case.
      const artifacts = input.intake.artifacts.filter(
        (artifact) => artifact.kind !== "phenopacket"
      );
      return { ...input, intake: { ...input.intake, artifacts } };
    }
    case "phenotype_extraction":
      // The AI_Gateway rejects -> extraction fails (no AWS involved).
      return { ...input, gateway: rejectingGateway() };
    case "clinician_confirmation":
      // The confirming reviewer is not authorised -> approval is refused.
      return {
        ...input,
        confirmation: { reviewerId: "intruder", at: NOW, isAuthorised: false }
      };
    case "hypothesis_card":
      // Card text contains a prohibited diagnostic term -> card rejected.
      return {
        ...input,
        hypothesis: { ...input.hypothesis, text: "This is a definitive cause of disease." }
      };
    case "knowledge_update_publish":
      // An entirely empty delta cannot be published.
      return {
        ...input,
        knowledgeUpdate: {
          ...input.knowledgeUpdate,
          delta: { variants: [], genes: [], phenotypes: [], diseases: [] }
        }
      };
    default: {
      const _exhaustive: never = failStage;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const failStageArb = fc.constantFrom<FailableStage>(
  "intake",
  "phenotype_extraction",
  "clinician_confirmation",
  "hypothesis_card",
  "knowledge_update_publish"
);

/** A non-empty lower-case identifier (never contains a prohibited term). */
const identifierArb = fc
  .array(fc.integer({ min: 97, max: 122 }), { minLength: 3, maxLength: 10 })
  .map((codes) => String.fromCharCode(...codes));

/** Safe, non-diagnostic hypothesis text (no prohibited diagnostic terms). */
const safeHypothesisTextArb = fc.constantFrom(
  "Findings are consistent with a channelopathy pattern.",
  "The phenotypic profile suggests further gene-panel review.",
  "Observed features align with a possible neurodevelopmental mechanism.",
  "This pattern warrants additional segregation analysis."
);

const variationArb: fc.Arbitrary<InputVariation> = fc.record({
  reviewerId: identifierArb,
  hypothesisCreatedById: identifierArb,
  updateCreatedById: identifierArb,
  safeHypothesisText: safeHypothesisTextArb
});

// ---------------------------------------------------------------------------
// Property 71
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 71: Vertical-slice stage failure halts and preserves prior state", () => {
  // Validates: Requirements 33.3
  it("halts at the failed stage, keeps prior outputs intact, and names the failure — for a failure injected at any stage", async () => {
    await fc.assert(
      fc.asyncProperty(failStageArb, variationArb, async (failStage, variation) => {
        const result = await runVerticalSlice(inputForFailure(failStage, variation));

        // The slice halts with a failure indication (Req 33.3).
        expect(result.ok).toBe(false);
        if (result.ok) return;

        // ...at exactly the injected stage, with a non-empty indication.
        expect(result.failedStage).toBe(failStage);
        expect(typeof result.detail).toBe("string");
        expect(result.detail.length).toBeGreaterThan(0);

        // `completedStages` is exactly the stages before the failed one, in order.
        const failIndex = SLICE_STAGES.indexOf(failStage);
        const expectedCompleted = SLICE_STAGES.slice(0, failIndex);
        expect(result.completedStages).toEqual(expectedCompleted);

        // Prior stages' outputs are preserved intact in `stateBefore`...
        const stateBefore = result.stateBefore;
        for (const stage of expectedCompleted) {
          for (const field of STAGE_STATE_FIELDS[stage]) {
            expect(stateBefore[field]).toBeDefined();
          }
        }

        // ...and no later stage advanced: the failed stage's fields, and every
        // subsequent stage's fields, are undefined (no partial advance).
        const notRun = SLICE_STAGES.slice(failIndex);
        for (const stage of notRun) {
          for (const field of STAGE_STATE_FIELDS[stage]) {
            expect(stateBefore[field]).toBeUndefined();
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
