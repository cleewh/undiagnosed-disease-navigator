// services/analysis/src/mode-integration.test.ts
//
// Example-based integration tests for the two genomic operation modes
// (Analysis_Service, task 19.5): Demo_Mode returns precomputed synthetic
// results WITHOUT initiating a genomic-compute run, and Workflow_Mode initiates
// an approved run and returns its results.
//
// Feature: undiagnosed-disease-navigator, 19.5 Demo/Workflow mode integration
//
// Requirements: 9.6, 9.7, 27.6, 32.1

import { describe, it, expect } from "vitest";
import type { AnalysisRequest, GenomicMode } from "@udn/domain";

import {
  submitAnalysisRequest,
  approveAnalysisRequest,
  startAnalysisRun,
  type SubmitAnalysisRequestInput
} from "./index.js";

const SUBMIT_NOW = "2024-01-01T00:00:00.000Z";
const APPROVE_AT = "2024-01-02T00:00:00.000Z";
const RUN_NOW = "2024-01-03T00:00:00.000Z";

function baseSubmitInput(genomicMode: GenomicMode): SubmitAnalysisRequestInput {
  return {
    caseId: "case-1",
    createdById: "bioinformatician-1",
    now: SUBMIT_NOW,
    workflowId: "wf-exome-v1",
    inputArtifactRefs: ["vcf/case-1/sample.vcf"],
    toolVersions: { aligner: "1.2.0", caller: "3.1.0" },
    referenceVersions: { genome: "GRCh38", clinvar: "2024-01" },
    estimatedCost: 12.5,
    requiredApproverRole: "Bioinformatician",
    genomicMode,
    knowledgeSnapshotVersion: "snap-1"
  };
}

/** Submit + approve, returning a request in the "approved" state. */
function approvedRequest(genomicMode: GenomicMode): AnalysisRequest {
  const submitted = submitAnalysisRequest(baseSubmitInput(genomicMode));
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

describe("19.5 Demo/Workflow mode integration (Req 9.6, 9.7, 27.6, 32.1)", () => {
  it("Demo_Mode returns precomputed synthetic results without initiating a run (Req 9.6, 27.6, 32.1)", () => {
    const request = approvedRequest("Demo_Mode");
    const precomputed = ["precomputed/case-1/result.json", "precomputed/case-1/report.pdf"];

    // A workflow executor that would fail the test if it were ever invoked:
    // Demo_Mode must NOT initiate a genomic-compute run.
    let executorCalls = 0;

    const result = startAnalysisRun(request, {
      now: RUN_NOW,
      createdById: "bio-1",
      demoResultRefs: precomputed,
      executeWorkflow: () => {
        executorCalls += 1;
        return ["should-not-run"];
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected Demo_Mode fulfilment to succeed");

    // No run was initiated (Req 9.6, 27.6, 32.1).
    expect(result.workflowInitiated).toBe(false);
    expect(executorCalls).toBe(0);

    // Precomputed synthetic results are returned as the completed outputs.
    expect(result.run.status).toBe("completed");
    expect(result.run.outputRefs).toEqual(precomputed);
    expect(result.request.status).toBe("approved");
  });

  it("Demo_Mode without precomputed results is an error and starts no run", () => {
    const result = startAnalysisRun(approvedRequest("Demo_Mode"), {
      now: RUN_NOW,
      createdById: "bio-1"
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an error");
    expect(result.error.code).toBe("precomputed_missing");
  });

  it("Workflow_Mode initiates an approved run and returns its results (Req 9.7, 32.1)", () => {
    const request = approvedRequest("Workflow_Mode");
    const produced = ["run/case-1/annotated.vcf", "run/case-1/qc.html"];

    let executorCalls = 0;
    const result = startAnalysisRun(request, {
      now: RUN_NOW,
      createdById: "bio-1",
      executeWorkflow: () => {
        executorCalls += 1;
        return produced;
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected Workflow_Mode fulfilment to succeed");

    // A run WAS initiated exactly once, and its results are returned (Req 9.7).
    expect(result.workflowInitiated).toBe(true);
    expect(executorCalls).toBe(1);
    expect(result.run.status).toBe("completed");
    expect(result.run.outputRefs).toEqual(produced);
  });

  it("Workflow_Mode is only initiated for an approved request (Req 9.7 gate)", () => {
    const submitted = submitAnalysisRequest(baseSubmitInput("Workflow_Mode"));
    if (!submitted.ok) throw new Error("expected submission to succeed");

    let executorCalls = 0;
    const result = startAnalysisRun(submitted.request, {
      now: RUN_NOW,
      createdById: "bio-1",
      executeWorkflow: () => {
        executorCalls += 1;
        return ["should-not-run"];
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an error");
    expect(result.error.code).toBe("not_approved");
    expect(executorCalls).toBe(0);
  });
});
