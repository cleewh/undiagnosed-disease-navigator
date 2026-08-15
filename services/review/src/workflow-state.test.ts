// services/review/src/workflow-state.test.ts
//
// Workflow-state tests for the Review_Service phenotype review flow (task 14.3,
// Requirement 31.4).
//
// Req 31.4 requires workflow-state tests that assert a specific expected
// outcome for both ALLOWED and DISALLOWED cases. The Review_Service defines the
// phenotype review workflow: a candidate starts in "pending_review" and may
// transition only via an authorised reviewer action —
//
//   * approve (with an explicit approval flag) -> "approved" + ConfirmedPhenotype
//   * reject                                   -> "rejected" + rejection record
//   * edit                                     -> stays "pending_review" (never confirms)
//
// These are ALLOWED transitions. The DISALLOWED cases are: any action from an
// unauthorised reviewer, and an approve attempt without the explicit approval
// flag. Every disallowed case must fail and leave the candidate state
// unchanged. These are ordinary example-based tests (not property tests).

import { describe, expect, it } from "vitest";
import { createEnvelope, type PhenotypeCandidate } from "@udn/domain";

import { approvePhenotype, editPhenotype, rejectPhenotype } from "./review.js";

const AT = "2024-01-01T00:00:00.000Z";
const LATER = "2024-01-02T00:00:00.000Z";

function makeCandidate(overrides: Partial<PhenotypeCandidate> = {}): PhenotypeCandidate {
  const envelope = createEnvelope({
    id: "PhenotypeCandidate-1",
    entityType: "PhenotypeCandidate",
    caseId: "case-1",
    source: "phenotype_extraction",
    status: "pending_review",
    provenance: {
      sourceId: "doc-1",
      versionId: "1",
      createdById: "ai",
      ingestedAt: AT
    },
    accessClassification: "clinical",
    createdById: "ai",
    now: AT
  });
  return {
    ...envelope,
    entityType: "PhenotypeCandidate",
    status: "pending_review",
    assertion: "present",
    confidence: 0.8,
    hpoMappings: [{ hpoId: "HP:0001250", confidence: 0.8 }],
    alternatives: [],
    sourceObjectRef: "doc-1",
    aiExtracted: true,
    ...overrides
  };
}

describe("workflow-state: allowed transitions from pending_review (Req 31.4)", () => {
  it("allows an authorised explicit approval: pending_review -> approved with a ConfirmedPhenotype", () => {
    const candidate = makeCandidate();
    expect(candidate.status).toBe("pending_review");

    const result = approvePhenotype(candidate, {
      reviewerId: "reviewer-1",
      at: LATER,
      isAuthorised: true,
      approve: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The candidate advanced to the "approved" state.
    expect(result.candidate.status).toBe("approved");
    // A ConfirmedPhenotype was produced and linked to the candidate.
    expect(result.confirmed.entityType).toBe("ConfirmedPhenotype");
    expect(result.confirmed.candidateId).toBe(candidate.id);
    expect(result.confirmed.approvedById).toBe("reviewer-1");
    expect(result.confirmed.approvedAt).toBe(LATER);
  });

  it("allows an authorised rejection: pending_review -> rejected with no ConfirmedPhenotype", () => {
    const candidate = makeCandidate();
    expect(candidate.status).toBe("pending_review");

    const result = rejectPhenotype(candidate, {
      reviewerId: "reviewer-1",
      at: LATER,
      isAuthorised: true,
      rationale: "insufficient support"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The candidate advanced to the "rejected" state.
    expect(result.candidate.status).toBe("rejected");
    expect(result.rejection.rejectedById).toBe("reviewer-1");
    expect(result.rejection.rejectedAt).toBe(LATER);
    // No ConfirmedPhenotype arises from a rejection.
    expect("confirmed" in result).toBe(false);
  });

  it("allows an authorised edit: pending_review -> pending_review (edit never confirms)", () => {
    const candidate = makeCandidate({ assertion: "uncertain", confidence: 0.5 });
    expect(candidate.status).toBe("pending_review");

    const result = editPhenotype(candidate, {
      reviewerId: "reviewer-1",
      at: LATER,
      isAuthorised: true,
      changes: { assertion: "present", confidence: 0.9 }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Editing applies the corrections but keeps the candidate under review.
    expect(result.candidate.assertion).toBe("present");
    expect(result.candidate.confidence).toBe(0.9);
    expect(result.candidate.status).toBe("pending_review");
    expect(result.candidate.entityType).toBe("PhenotypeCandidate");
    expect("confirmed" in result).toBe(false);
  });
});

describe("workflow-state: disallowed transitions leave the state unchanged (Req 31.4)", () => {
  it("disallows an unauthorised approval: candidate stays pending_review, no confirmation", () => {
    const candidate = makeCandidate();

    const result = approvePhenotype(candidate, {
      reviewerId: "intruder",
      at: LATER,
      isAuthorised: false,
      approve: true
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_authorised");
    // State unchanged: still the original pending_review candidate.
    expect(result.candidate).toEqual(candidate);
    expect(result.candidate.status).toBe("pending_review");
  });

  it("disallows an approve without the explicit approval flag: no confirmation, state unchanged", () => {
    const candidate = makeCandidate();

    const result = approvePhenotype(candidate, {
      reviewerId: "reviewer-1",
      at: LATER,
      isAuthorised: true,
      approve: false
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The approval gate refuses to auto-confirm without an explicit action.
    expect(result.error.code).toBe("not_approved");
    expect(result.candidate).toEqual(candidate);
    expect(result.candidate.status).toBe("pending_review");
  });

  it("disallows an unauthorised rejection: candidate stays pending_review", () => {
    const candidate = makeCandidate();

    const result = rejectPhenotype(candidate, {
      reviewerId: "intruder",
      at: LATER,
      isAuthorised: false
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_authorised");
    expect(result.candidate).toEqual(candidate);
    expect(result.candidate.status).toBe("pending_review");
  });

  it("disallows an unauthorised edit: candidate stays pending_review with no field changes", () => {
    const candidate = makeCandidate({ assertion: "uncertain" });

    const result = editPhenotype(candidate, {
      reviewerId: "intruder",
      at: LATER,
      isAuthorised: false,
      changes: { assertion: "absent" }
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_authorised");
    // State unchanged: the attempted "absent" correction was not applied.
    expect(result.candidate).toEqual(candidate);
    expect(result.candidate.assertion).toBe("uncertain");
    expect(result.candidate.status).toBe("pending_review");
  });
});
