// services/analysis/src/analysis.test.ts
//
// Compile-sanity and core-behaviour unit tests for the Analysis_Service
// (task 19.1). The exhaustive property/integration coverage lives in the
// separate PBT tasks (19.2–19.5).

import { describe, expect, it } from "vitest";
import type { AnalysisRequest } from "@udn/domain";
import {
  approveAnalysisRequest,
  describeAnalysisRequest,
  encodeToolReferenceVersions,
  startAnalysisRun,
  submitAnalysisRequest,
  type SubmitAnalysisRequestInput
} from "./index.js";

const NOW = "2024-01-01T00:00:00.000Z";
const LATER = "2024-01-02T00:00:00.000Z";

function baseSubmitInput(
  overrides: Partial<SubmitAnalysisRequestInput> = {}
): SubmitAnalysisRequestInput {
  return {
    caseId: "case-1",
    createdById: "bioinformatician-1",
    now: NOW,
    workflowId: "wf-exome-v1",
    inputArtifactRefs: ["vcf/case-1/sample.vcf"],
    toolVersions: { aligner: "1.2.0", caller: "3.1.0" },
    referenceVersions: { genome: "GRCh38", clinvar: "2024-01" },
    estimatedCost: 12.5,
    requiredApproverRole: "Bioinformatician",
    genomicMode: "Demo_Mode",
    knowledgeSnapshotVersion: "snap-1",
    ...overrides
  };
}

/** Submit and unwrap a request for downstream assertions. */
function submittedRequest(overrides: Partial<SubmitAnalysisRequestInput> = {}): AnalysisRequest {
  const result = submitAnalysisRequest(baseSubmitInput(overrides));
  if (!result.ok) throw new Error(`expected submission to succeed: ${result.error.code}`);
  return result.request;
}

describe("submitAnalysisRequest (Req 9.1, 9.2)", () => {
  it("creates a pending request when a workflow is selected", () => {
    const result = submitAnalysisRequest(baseSubmitInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.status).toBe("pending_approval");
    expect(result.request.workflowId).toBe("wf-exome-v1");
    expect(result.request.version).toBe(1);
  });

  it("rejects a submission with no workflow and creates no request (Req 9.2)", () => {
    const result = submitAnalysisRequest(baseSubmitInput({ workflowId: undefined }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("workflow_required");
  });

  it("rejects a blank workflow selection", () => {
    const result = submitAnalysisRequest(baseSubmitInput({ workflowId: "   " }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("workflow_required");
  });
});

describe("describeAnalysisRequest (Req 9.3)", () => {
  it("surfaces artifacts, versions, cost, and required approver role", () => {
    const display = describeAnalysisRequest(submittedRequest());
    expect(display.inputArtifactRefs).toEqual(["vcf/case-1/sample.vcf"]);
    expect(display.toolVersions).toEqual({ aligner: "1.2.0", caller: "3.1.0" });
    expect(display.referenceVersions).toEqual({ genome: "GRCh38", clinvar: "2024-01" });
    expect(display.estimatedCost).toBe(12.5);
    expect(display.requiredApproverRole).toBe("Bioinformatician");
  });
});

describe("approveAnalysisRequest (Req 9.4, 9.5)", () => {
  it("approves when authorised and holding the required role", () => {
    const result = approveAnalysisRequest(submittedRequest(), {
      approverId: "bio-1",
      approverRole: "Bioinformatician",
      at: LATER,
      isAuthorised: true
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.status).toBe("approved");
    expect(result.request.approvedById).toBe("bio-1");
    expect(result.request.approvedAt).toBe(LATER);
    expect(result.request.version).toBe(2);
  });

  it("rejects an unauthorised approver and leaves the request unchanged", () => {
    const request = submittedRequest();
    const result = approveAnalysisRequest(request, {
      approverId: "bio-1",
      approverRole: "Bioinformatician",
      at: LATER,
      isAuthorised: false
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_authorised");
    expect(result.request).toBe(request);
  });

  it("rejects an approver holding the wrong role (Req 9.4)", () => {
    const result = approveAnalysisRequest(submittedRequest(), {
      approverId: "counsellor-1",
      approverRole: "GeneticCounsellor",
      at: LATER,
      isAuthorised: true
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("wrong_approver_role");
  });
});

/** Approve a fresh request and return the approved form. */
function approvedRequest(overrides: Partial<SubmitAnalysisRequestInput> = {}): AnalysisRequest {
  const result = approveAnalysisRequest(submittedRequest(overrides), {
    approverId: "bio-1",
    approverRole: "Bioinformatician",
    at: LATER,
    isAuthorised: true
  });
  if (!result.ok) throw new Error(`expected approval to succeed: ${result.error.code}`);
  return result.request;
}

describe("startAnalysisRun (Req 9.5–9.9, 27.6, 32.1, 32.5)", () => {
  it("does not start a run for an unapproved request (Req 9.5)", () => {
    const result = startAnalysisRun(submittedRequest(), {
      now: LATER,
      createdById: "bio-1",
      demoResultRefs: ["precomputed/case-1/result.json"]
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_approved");
    expect(result).not.toHaveProperty("failedRun");
  });

  it("fulfils Demo_Mode from precomputed results without initiating a run (Req 9.6, 27.6)", () => {
    const result = startAnalysisRun(approvedRequest({ genomicMode: "Demo_Mode" }), {
      now: LATER,
      createdById: "bio-1",
      demoResultRefs: ["precomputed/case-1/result.json"]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workflowInitiated).toBe(false);
    expect(result.run.status).toBe("completed");
    expect(result.run.outputRefs).toEqual(["precomputed/case-1/result.json"]);
    // Provenance embeds tool + reference versions (Req 9.8).
    expect(result.run.provenance.versionId).toBe(
      encodeToolReferenceVersions(
        { aligner: "1.2.0", caller: "3.1.0" },
        { genome: "GRCh38", clinvar: "2024-01" }
      )
    );
  });

  it("errors when Demo_Mode precomputed results are missing", () => {
    const result = startAnalysisRun(approvedRequest({ genomicMode: "Demo_Mode" }), {
      now: LATER,
      createdById: "bio-1"
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("precomputed_missing");
  });

  it("executes the workflow in Workflow_Mode and initiates a run (Req 9.7)", () => {
    const result = startAnalysisRun(approvedRequest({ genomicMode: "Workflow_Mode" }), {
      now: LATER,
      createdById: "bio-1",
      executeWorkflow: () => ["run/case-1/out.vcf"]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workflowInitiated).toBe(true);
    expect(result.run.status).toBe("completed");
    expect(result.run.outputRefs).toEqual(["run/case-1/out.vcf"]);
  });

  it("retains pre-run state and records the failure when the workflow fails (Req 9.9)", () => {
    const request = approvedRequest({ genomicMode: "Workflow_Mode" });
    const result = startAnalysisRun(request, {
      now: LATER,
      createdById: "bio-1",
      executeWorkflow: () => {
        throw new Error("compute node crashed");
      }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("run_failed");
    expect(result.request).toBe(request);
    expect(result.request.status).toBe("approved");
    expect(result.failedRun?.status).toBe("failed");
    expect(result.failedRun?.outputRefs).toEqual([]);
  });
});
