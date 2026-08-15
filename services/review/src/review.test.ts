// services/review/src/review.test.ts
//
// Unit tests for the Review_Service phenotype approval/rejection/edit flow
// (task 14.1, Requirement 6). These are example-based compile-sanity tests;
// the property test for approval-gated confirmation is task 14.2.

import { describe, expect, it } from "vitest";
import { createEnvelope, type PhenotypeCandidate } from "@udn/domain";

import {
  approvePhenotype,
  editPhenotype,
  rejectPhenotype
} from "./review.js";

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

describe("approvePhenotype", () => {
  it("confirms only on an explicit authorised approval, linking the candidate and recording reviewer + timestamp (Req 6.1, 6.2)", () => {
    const candidate = makeCandidate();
    const result = approvePhenotype(candidate, {
      reviewerId: "reviewer-1",
      at: LATER,
      isAuthorised: true,
      approve: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confirmed.entityType).toBe("ConfirmedPhenotype");
    expect(result.confirmed.candidateId).toBe(candidate.id);
    expect(result.confirmed.approvedById).toBe("reviewer-1");
    expect(result.confirmed.approvedAt).toBe(LATER);
    expect(result.confirmed.caseId).toBe(candidate.caseId);
    expect(result.candidate.status).toBe("approved");
    // Input candidate is not mutated.
    expect(candidate.status).toBe("pending_review");
  });

  it("never auto-confirms without an explicit approval action (Req 6.5)", () => {
    const candidate = makeCandidate();
    const result = approvePhenotype(candidate, {
      reviewerId: "reviewer-1",
      at: LATER,
      isAuthorised: true,
      approve: false
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_approved");
    expect(result.candidate).toEqual(candidate);
  });

  it("rejects an unauthorised approver and leaves the candidate unchanged (Req 6.6)", () => {
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
    expect(result.candidate).toEqual(candidate);
  });

  it("carries edit-before-approval original/corrected values onto the confirmed record (Req 6.4)", () => {
    const candidate = makeCandidate();
    const result = approvePhenotype(candidate, {
      reviewerId: "reviewer-1",
      at: LATER,
      isAuthorised: true,
      approve: true,
      originalValue: { assertion: "uncertain" },
      correctedValue: { assertion: "present" }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confirmed.originalValue).toEqual({ assertion: "uncertain" });
    expect(result.confirmed.correctedValue).toEqual({ assertion: "present" });
  });
});

describe("rejectPhenotype", () => {
  it("records rejection with reviewer + timestamp and creates no confirmed phenotype (Req 6.3)", () => {
    const candidate = makeCandidate();
    const result = rejectPhenotype(candidate, {
      reviewerId: "reviewer-1",
      at: LATER,
      isAuthorised: true,
      rationale: "insufficient support"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.status).toBe("rejected");
    expect(result.rejection.rejectedById).toBe("reviewer-1");
    expect(result.rejection.rejectedAt).toBe(LATER);
    expect(result.rejection.rationale).toBe("insufficient support");
    expect(candidate.status).toBe("pending_review");
  });

  it("rejects an unauthorised reviewer and leaves the candidate unchanged (Req 6.6)", () => {
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
  });
});

describe("editPhenotype", () => {
  it("records original and corrected values and applies changes without confirming (Req 6.4)", () => {
    const candidate = makeCandidate({ assertion: "uncertain", confidence: 0.5 });
    const result = editPhenotype(candidate, {
      reviewerId: "reviewer-1",
      at: LATER,
      isAuthorised: true,
      changes: { assertion: "present", confidence: 0.9 }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edit.originalValue).toEqual({ assertion: "uncertain", confidence: 0.5 });
    expect(result.edit.correctedValue).toEqual({ assertion: "present", confidence: 0.9 });
    expect(result.candidate.assertion).toBe("present");
    expect(result.candidate.confidence).toBe(0.9);
    // Editing never confirms; the candidate stays under review.
    expect(result.candidate.status).toBe("pending_review");
    expect(result.candidate.entityType).toBe("PhenotypeCandidate");
  });

  it("rejects an unauthorised editor and leaves the candidate unchanged (Req 6.6)", () => {
    const candidate = makeCandidate();
    const result = editPhenotype(candidate, {
      reviewerId: "intruder",
      at: LATER,
      isAuthorised: false,
      changes: { assertion: "absent" }
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_authorised");
    expect(result.candidate).toEqual(candidate);
  });
});
