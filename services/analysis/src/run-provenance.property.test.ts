// services/analysis/src/run-provenance.property.test.ts
//
// Property-based test that every completed analysis run records provenance
// carrying the tool and reference versions (Analysis_Service, task 19.4).
//
// Feature: undiagnosed-disease-navigator, Property 24: Completed analysis runs
// record provenance
//
// Validates: Requirements 9.8

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { type AnalysisRequest, type GenomicMode } from "@udn/domain";

import {
  submitAnalysisRequest,
  approveAnalysisRequest,
  startAnalysisRun,
  encodeToolReferenceVersions,
  type SubmitAnalysisRequestInput
} from "./index.js";

const SUBMIT_NOW = "2024-01-01T00:00:00.000Z";
const APPROVE_AT = "2024-01-02T00:00:00.000Z";
const RUN_NOW = "2024-01-03T00:00:00.000Z";

const genomicModeArb: fc.Arbitrary<GenomicMode> = fc.constantFrom(
  "Demo_Mode",
  "Workflow_Mode"
);

/** A version map: non-blank keys mapped to version-like strings. */
const versionMapArb: fc.Arbitrary<Record<string, string>> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim() !== ""),
  fc.string({ minLength: 1, maxLength: 8 }),
  { maxKeys: 5 }
);

/** One or more output artifact references. */
const outputRefsArb: fc.Arbitrary<string[]> = fc.array(
  fc.string({ minLength: 1, maxLength: 16 }).filter((s) => s.trim() !== ""),
  { minLength: 1, maxLength: 4 }
);

function baseSubmitInput(
  genomicMode: GenomicMode,
  toolVersions: Record<string, string>,
  referenceVersions: Record<string, string>
): SubmitAnalysisRequestInput {
  return {
    caseId: "case-1",
    createdById: "bioinformatician-1",
    now: SUBMIT_NOW,
    workflowId: "wf-exome-v1",
    inputArtifactRefs: ["vcf/case-1/sample.vcf"],
    toolVersions,
    referenceVersions,
    estimatedCost: 12.5,
    requiredApproverRole: "Bioinformatician",
    genomicMode,
    knowledgeSnapshotVersion: "snap-1"
  };
}

/** Submit + approve, returning a request in the "approved" state. */
function approvedRequest(
  genomicMode: GenomicMode,
  toolVersions: Record<string, string>,
  referenceVersions: Record<string, string>
): AnalysisRequest {
  const submitted = submitAnalysisRequest(
    baseSubmitInput(genomicMode, toolVersions, referenceVersions)
  );
  if (!submitted.ok) throw new Error(`expected submission to succeed: ${submitted.error.code}`);
  const approval = approveAnalysisRequest(submitted.request, {
    approverId: "bio-1",
    approverRole: "Bioinformatician",
    at: APPROVE_AT,
    isAuthorised: true
  });
  if (!approval.ok) throw new Error(`expected approval to succeed: ${approval.error.code}`);
  return approval.request;
}

describe("Feature: undiagnosed-disease-navigator, Property 24: Completed analysis runs record provenance", () => {
  // Feature: undiagnosed-disease-navigator, Property 24: Completed analysis
  // runs record provenance
  // Validates: Requirements 9.8
  it("records provenance including the tool and reference versions on every completed run", () => {
    fc.assert(
      fc.property(
        genomicModeArb,
        versionMapArb,
        versionMapArb,
        outputRefsArb,
        (genomicMode, toolVersions, referenceVersions, outputRefs) => {
          const request = approvedRequest(genomicMode, toolVersions, referenceVersions);

          const result =
            genomicMode === "Demo_Mode"
              ? startAnalysisRun(request, {
                  now: RUN_NOW,
                  createdById: "bio-1",
                  demoResultRefs: outputRefs
                })
              : startAnalysisRun(request, {
                  now: RUN_NOW,
                  createdById: "bio-1",
                  executeWorkflow: () => outputRefs
                });

          expect(result.ok).toBe(true);
          if (!result.ok) throw new Error("expected the run to complete");

          const { run } = result;
          expect(run.status).toBe("completed");

          // Outputs are recorded (Req 9.8).
          expect(run.outputRefs).toEqual(outputRefs);

          // Provenance is present with the required fields.
          expect(run.provenance).toBeDefined();
          expect(run.provenance.createdById).toBe("bio-1");
          expect(run.provenance.ingestedAt).toBe(RUN_NOW);

          // The recorded provenance carries the tool AND reference versions:
          // its versionId is the deterministic encoding of both maps (Req 9.8).
          const expectedVersionId = encodeToolReferenceVersions(
            request.toolVersions,
            request.referenceVersions
          );
          expect(run.provenance.versionId).toBe(expectedVersionId);

          // Every tool/reference entry is embedded in the encoded provenance.
          for (const [key, value] of Object.entries(request.toolVersions)) {
            expect(run.provenance.versionId).toContain(`${key}=${value}`);
          }
          for (const [key, value] of Object.entries(request.referenceVersions)) {
            expect(run.provenance.versionId).toContain(`${key}=${value}`);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
