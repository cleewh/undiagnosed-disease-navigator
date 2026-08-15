// services/analysis/src/approval-gated-runs.property.test.ts
//
// Property-based test for the required-role approval gate that guards analysis
// run start (Analysis_Service, task 19.3).
//
// Feature: undiagnosed-disease-navigator, Property 23: Analysis runs start only
// after required-role approval
//
// Validates: Requirements 9.3, 9.4, 9.5

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  USER_ROLES,
  type AnalysisRequest,
  type UserRole,
  type GenomicMode
} from "@udn/domain";

import {
  submitAnalysisRequest,
  approveAnalysisRequest,
  describeAnalysisRequest,
  startAnalysisRun,
  type SubmitAnalysisRequestInput
} from "./index.js";

const userRoleArb: fc.Arbitrary<UserRole> = fc.constantFrom(...USER_ROLES);
const genomicModeArb: fc.Arbitrary<GenomicMode> = fc.constantFrom(
  "Demo_Mode",
  "Workflow_Mode"
);

const SUBMIT_NOW = "2024-01-01T00:00:00.000Z";
const APPROVE_AT = "2024-01-02T00:00:00.000Z";
const RUN_NOW = "2024-01-03T00:00:00.000Z";

const toolVersions = { aligner: "1.2.0", caller: "3.1.0" } as const;
const referenceVersions = { genome: "GRCh38", clinvar: "2024-01" } as const;

function baseSubmitInput(
  requiredApproverRole: UserRole,
  genomicMode: GenomicMode
): SubmitAnalysisRequestInput {
  return {
    caseId: "case-1",
    createdById: "bioinformatician-1",
    now: SUBMIT_NOW,
    workflowId: "wf-exome-v1",
    inputArtifactRefs: ["vcf/case-1/sample.vcf"],
    toolVersions: { ...toolVersions },
    referenceVersions: { ...referenceVersions },
    estimatedCost: 12.5,
    requiredApproverRole,
    genomicMode,
    knowledgeSnapshotVersion: "snap-1"
  };
}

function submittedRequest(
  requiredApproverRole: UserRole,
  genomicMode: GenomicMode
): AnalysisRequest {
  const result = submitAnalysisRequest(baseSubmitInput(requiredApproverRole, genomicMode));
  if (!result.ok) throw new Error(`expected submission to succeed: ${result.error.code}`);
  return result.request;
}

/** Fulfilment inputs sufficient for whichever mode the request uses. */
function runInputFor(request: AnalysisRequest) {
  return request.genomicMode === "Demo_Mode"
    ? { now: RUN_NOW, createdById: "bio-1", demoResultRefs: ["precomputed/result.json"] }
    : { now: RUN_NOW, createdById: "bio-1", executeWorkflow: () => ["run/out.vcf"] };
}

describe("Feature: undiagnosed-disease-navigator, Property 23: Analysis runs start only after required-role approval", () => {
  // Feature: undiagnosed-disease-navigator, Property 23: Analysis runs start
  // only after required-role approval
  // Validates: Requirements 9.3, 9.4, 9.5
  it("starts a run only when approved by an authorised caller holding the required role; otherwise no run starts", () => {
    fc.assert(
      fc.property(
        userRoleArb,
        userRoleArb,
        fc.boolean(),
        genomicModeArb,
        (requiredApproverRole, approverRole, isAuthorised, genomicMode) => {
          const request = submittedRequest(requiredApproverRole, genomicMode);

          // Req 9.3: the displayed request always includes the required fields.
          const display = describeAnalysisRequest(request);
          expect(display.inputArtifactRefs).toEqual([...request.inputArtifactRefs]);
          expect(display.toolVersions).toEqual({ ...toolVersions });
          expect(display.referenceVersions).toEqual({ ...referenceVersions });
          expect(display.estimatedCost).toBe(request.estimatedCost);
          expect(display.requiredApproverRole).toBe(requiredApproverRole);

          const approvalGranted = isAuthorised && approverRole === requiredApproverRole;

          const approval = approveAnalysisRequest(request, {
            approverId: "actor-1",
            approverRole,
            at: APPROVE_AT,
            isAuthorised
          });

          // Req 9.4: approval succeeds iff authorised AND holding required role.
          expect(approval.ok).toBe(approvalGranted);

          // A run may only start once the request has status "approved" (Req 9.5).
          // Attempt a run directly against the (possibly unapproved) request.
          const runAgainstOriginal = startAnalysisRun(request, runInputFor(request));
          expect(runAgainstOriginal.ok).toBe(false);
          if (!runAgainstOriginal.ok) {
            expect(runAgainstOriginal.error.code).toBe("not_approved");
          }

          if (approvalGranted) {
            if (!approval.ok) throw new Error("expected approval to succeed");
            const approved = approval.request;
            expect(approved.status).toBe("approved");
            expect(approved.approvedById).toBe("actor-1");

            // Now a run starts against the approved request.
            const run = startAnalysisRun(approved, runInputFor(approved));
            expect(run.ok).toBe(true);
            if (run.ok) {
              expect(run.run.status).toBe("completed");
            }
          } else {
            if (approval.ok) throw new Error("expected approval to be rejected");
            // Rejected approvals leave the request unchanged (still gate-closed).
            expect(approval.request.status).toBe("pending_approval");
            expect(approval.request.approvedById).toBeUndefined();
            const expectedCode =
              !isAuthorised ? "not_authorised" : "wrong_approver_role";
            expect(approval.error.code).toBe(expectedCode);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
