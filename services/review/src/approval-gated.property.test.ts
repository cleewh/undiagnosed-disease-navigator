// services/review/src/approval-gated.property.test.ts
//
// Property-based test for the Review_Service approval gate (task 14.2,
// Requirement 6).
//
// Feature: undiagnosed-disease-navigator, Property 14: No confirmation without
// an authorised human approval
//
// Validates: Requirements 6.1, 6.2, 6.5, 6.3
//
// Property 14 (design.md): a confirmed phenotype exists IF AND ONLY IF it was
// preceded by an explicit approval action from an authorised reviewer that
// recorded the reviewer identity and approval timestamp; no execution path
// auto-confirms a candidate. This test exhaustively varies authorisation, the
// explicit-approval flag, and the review action (approve/reject/edit) and
// asserts the biconditional gate holds while the input candidate is never
// mutated.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createEnvelope,
  ACCESS_CLASSIFICATIONS,
  type AccessClassification,
  type Assertion,
  type PhenotypeCandidate
} from "@udn/domain";

import {
  approvePhenotype,
  rejectPhenotype,
  editPhenotype,
  CONFIRMED_PHENOTYPE_STATUS
} from "./review.js";

const ASSERTIONS: readonly Assertion[] = ["present", "absent", "uncertain", "historical"];

const isoArb: fc.Arbitrary<string> = fc
  .date({ min: new Date("2000-01-01T00:00:00.000Z"), max: new Date("2100-01-01T00:00:00.000Z") })
  .map((d) => d.toISOString());

const accessArb: fc.Arbitrary<AccessClassification> = fc.constantFrom(...ACCESS_CLASSIFICATIONS);

/** Build a fresh pending-review candidate from generated fields. */
function makeCandidate(fields: {
  readonly id: string;
  readonly caseId: string;
  readonly access: AccessClassification;
  readonly assertion: Assertion;
  readonly confidence: number;
  readonly createdAt: string;
}): PhenotypeCandidate {
  const envelope = createEnvelope({
    id: fields.id,
    entityType: "PhenotypeCandidate",
    caseId: fields.caseId,
    source: "phenotype_extraction",
    status: "pending_review",
    provenance: {
      sourceId: "doc-1",
      versionId: "1",
      createdById: "ai",
      ingestedAt: fields.createdAt
    },
    accessClassification: fields.access,
    createdById: "ai",
    now: fields.createdAt
  });
  return {
    ...envelope,
    entityType: "PhenotypeCandidate",
    status: "pending_review",
    assertion: fields.assertion,
    confidence: fields.confidence,
    hpoMappings: [{ hpoId: "HP:0001250", confidence: fields.confidence }],
    alternatives: [],
    sourceObjectRef: "doc-1",
    aiExtracted: true
  };
}

/** The action the reviewer attempts against the candidate. */
type ReviewAction = "approve" | "reject" | "edit";

describe("Feature: undiagnosed-disease-navigator, Property 14: No confirmation without an authorised human approval", () => {
  // Feature: undiagnosed-disease-navigator, Property 14: No confirmation
  // without an authorised human approval
  // Validates: Requirements 6.1, 6.2, 6.5, 6.3
  it("produces a ConfirmedPhenotype iff the caller is authorised AND explicitly approves; otherwise nothing is confirmed and the candidate is unchanged", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ minLength: 1 }).map((s) => `PhenotypeCandidate-${s}`),
          caseId: fc.string({ minLength: 1 }).map((s) => `case-${s}`),
          access: accessArb,
          assertion: fc.constantFrom(...ASSERTIONS),
          confidence: fc.double({ min: 0, max: 1, noNaN: true }),
          createdAt: isoArb
        }),
        fc.record({
          reviewerId: fc.string({ minLength: 1 }),
          at: isoArb,
          isAuthorised: fc.boolean(),
          approve: fc.boolean(),
          action: fc.constantFrom<ReviewAction>("approve", "reject", "edit"),
          newAssertion: fc.constantFrom(...ASSERTIONS)
        }),
        (candidateFields, op) => {
          const candidate = makeCandidate(candidateFields);
          // A defensive frozen snapshot to prove the input is never mutated.
          const snapshot = JSON.parse(JSON.stringify(candidate)) as PhenotypeCandidate;

          // A ConfirmedPhenotype can ONLY arise from the approve path; reject
          // and edit never confirm regardless of authorisation/approval.
          const shouldConfirm =
            op.action === "approve" && op.isAuthorised === true && op.approve === true;

          let confirmedProduced = false;

          if (op.action === "approve") {
            const result = approvePhenotype(candidate, {
              reviewerId: op.reviewerId,
              at: op.at,
              isAuthorised: op.isAuthorised,
              approve: op.approve
            });

            if (result.ok) {
              confirmedProduced = true;
              // Confirmation only happens when authorised AND explicitly approved.
              expect(op.isAuthorised).toBe(true);
              expect(op.approve).toBe(true);
              // The confirmed record links the candidate and records the
              // reviewer identity + approval timestamp (Req 6.2).
              expect(result.confirmed.entityType).toBe("ConfirmedPhenotype");
              expect(result.confirmed.candidateId).toBe(candidate.id);
              expect(result.confirmed.approvedById).toBe(op.reviewerId);
              expect(result.confirmed.approvedAt).toBe(op.at);
              expect(result.confirmed.caseId).toBe(candidate.caseId);
              expect(result.confirmed.status).toBe(CONFIRMED_PHENOTYPE_STATUS);
            } else {
              // No confirmation: either unauthorised (Req 6.6) or no explicit
              // approval action supplied (Req 6.1/6.5). The failure returns the
              // candidate unchanged.
              expect(op.isAuthorised === false || op.approve !== true).toBe(true);
              expect(result.error.code).toBe(
                op.isAuthorised ? "not_approved" : "not_authorised"
              );
              expect(result.candidate).toEqual(snapshot);
            }
          } else if (op.action === "reject") {
            const result = rejectPhenotype(candidate, {
              reviewerId: op.reviewerId,
              at: op.at,
              isAuthorised: op.isAuthorised
            });
            // Rejection never yields a ConfirmedPhenotype (Req 6.3): the result
            // has no `confirmed` field on either branch.
            expect("confirmed" in result).toBe(false);
            if (!result.ok) {
              expect(result.candidate).toEqual(snapshot);
            }
          } else {
            const result = editPhenotype(candidate, {
              reviewerId: op.reviewerId,
              at: op.at,
              isAuthorised: op.isAuthorised,
              changes: { assertion: op.newAssertion }
            });
            // Editing never confirms; the candidate remains under review.
            expect("confirmed" in result).toBe(false);
            if (result.ok) {
              expect(result.candidate.status).toBe("pending_review");
              expect(result.candidate.entityType).toBe("PhenotypeCandidate");
            } else {
              expect(result.candidate).toEqual(snapshot);
            }
          }

          // The biconditional gate: a ConfirmedPhenotype was produced exactly
          // when the caller was authorised and explicitly approved.
          expect(confirmedProduced).toBe(shouldConfirm);

          // The input candidate object is never mutated by any path.
          expect(candidate).toEqual(snapshot);
        }
      ),
      { numRuns: 200 }
    );
  });
});
