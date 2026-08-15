// services/analysis/src/required-workflow.property.test.ts
//
// Property-based test for the mandatory genomic-analysis workflow selection on
// analysis-request submission (Analysis_Service, task 19.2).
//
// Feature: undiagnosed-disease-navigator, Property 22: Analysis workflow
// selection is required
//
// Validates: Requirements 9.1, 9.2

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { USER_ROLES, type UserRole, type GenomicMode } from "@udn/domain";

import {
  submitAnalysisRequest,
  type SubmitAnalysisRequestInput
} from "./index.js";

const userRoleArb: fc.Arbitrary<UserRole> = fc.constantFrom(...USER_ROLES);
const genomicModeArb: fc.Arbitrary<GenomicMode> = fc.constantFrom(
  "Demo_Mode",
  "Workflow_Mode"
);

/** An ISO-8601 UTC timestamp drawn from a bounded window. */
const timestampArb: fc.Arbitrary<string> = fc
  .date({ min: new Date("2020-01-01T00:00:00.000Z"), max: new Date("2030-01-01T00:00:00.000Z") })
  .map((d) => d.toISOString());

/**
 * A non-blank workflow selection: at least one non-whitespace character so it
 * survives the service's `trim() !== ""` gate.
 */
const nonBlankWorkflowArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringOf(fc.constantFrom(" ", "\t", "\n"), { maxLength: 3 }),
    fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() !== ""),
    fc.stringOf(fc.constantFrom(" ", "\t", "\n"), { maxLength: 3 })
  )
  .map(([lead, core, trail]) => `${lead}${core}${trail}`);

/**
 * A "missing or blank" workflow selection: either undefined, or a string that
 * is empty or entirely whitespace (Req 9.2).
 */
const blankOrMissingWorkflowArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 6 })
);

/** Common submission fields, parameterised by the workflow selection. */
function submitInput(
  workflowId: string | undefined,
  extras: {
    caseId: string;
    createdById: string;
    now: string;
    requiredApproverRole: UserRole;
    genomicMode: GenomicMode;
    estimatedCost: number;
  }
): SubmitAnalysisRequestInput {
  return {
    caseId: extras.caseId,
    createdById: extras.createdById,
    now: extras.now,
    ...(workflowId !== undefined ? { workflowId } : {}),
    inputArtifactRefs: ["vcf/sample.vcf"],
    toolVersions: { aligner: "1.2.0" },
    referenceVersions: { genome: "GRCh38" },
    estimatedCost: extras.estimatedCost,
    requiredApproverRole: extras.requiredApproverRole,
    genomicMode: extras.genomicMode,
    knowledgeSnapshotVersion: "snap-1"
  };
}

const extrasArb = fc.record({
  caseId: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() !== ""),
  createdById: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() !== ""),
  now: timestampArb,
  requiredApproverRole: userRoleArb,
  genomicMode: genomicModeArb,
  estimatedCost: fc.double({ min: 0, max: 1_000_000, noNaN: true })
});

describe("Feature: undiagnosed-disease-navigator, Property 22: Analysis workflow selection is required", () => {
  // Feature: undiagnosed-disease-navigator, Property 22: Analysis workflow
  // selection is required
  // Validates: Requirements 9.1, 9.2
  it("creates a request iff a non-blank workflow is selected; missing/blank is rejected with no request", () => {
    fc.assert(
      fc.property(
        fc.oneof(nonBlankWorkflowArb, blankOrMissingWorkflowArb),
        extrasArb,
        (workflowId, extras) => {
          const result = submitAnalysisRequest(submitInput(workflowId, extras));

          const workflowSelected =
            typeof workflowId === "string" && workflowId.trim() !== "";

          // Accepted iff a non-blank workflow is selected (Req 9.1).
          expect(result.ok).toBe(workflowSelected);

          if (workflowSelected) {
            if (!result.ok) throw new Error("expected acceptance");
            expect(result.request.entityType).toBe("AnalysisRequest");
            expect(result.request.status).toBe("pending_approval");
            expect(result.request.workflowId).toBe(workflowId);
          } else {
            // Rejected: no request created, workflow-required error (Req 9.2).
            if (result.ok) throw new Error("expected rejection");
            expect(result.error.code).toBe("workflow_required");
            expect(result).not.toHaveProperty("request");
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
