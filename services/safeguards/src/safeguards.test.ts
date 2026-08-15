// services/safeguards/src/safeguards.test.ts
//
// Compile-sanity unit tests for the Safeguards package (task 29.1,
// Requirements 25.2-25.6, 26.6). These are example-based tests that exercise
// each guard's allow/block paths; the dedicated property and integration tests
// are tasks 29.2-29.6.

import { describe, expect, it } from "vitest";

import {
  gatePatientFacingOutput,
  canPresentPatientFacingOutput,
  authoriseExternalAction,
  guardClassificationCombination,
  assertSingleClassification,
  MixedClassificationError,
  attachUncertaintyIndicator,
  levelFromConfidence,
  hasValidUncertaintyIndicator,
  UNCERTAINTY_LEVELS,
  guardTransport,
  guardTransportUrl
} from "./index.js";

const AT = "2024-01-01T00:00:00.000Z";

describe("patient-facing review gating (Req 25.2, 25.3)", () => {
  it("presents non-patient-facing output without requiring review", () => {
    const result = gatePatientFacingOutput({ outputId: "o1", patientFacing: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.requiredReview).toBe(false);
  });

  it("blocks patient-facing output with no recorded review", () => {
    const result = gatePatientFacingOutput({ outputId: "o2", patientFacing: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("human_review_required");
  });

  it("blocks patient-facing output whose review was not approved", () => {
    const result = gatePatientFacingOutput({
      outputId: "o3",
      patientFacing: true,
      review: { reviewerId: "r1", reviewedAt: AT, decision: "rejected" }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("review_not_approved");
  });

  it("presents patient-facing output with a recorded approved review", () => {
    const output = {
      outputId: "o4",
      patientFacing: true,
      review: { reviewerId: "r1", reviewedAt: AT, decision: "approved" as const }
    };
    expect(canPresentPatientFacingOutput(output)).toBe(true);
  });
});

describe("external sharing / family contact confirmation (Req 25.4)", () => {
  it("blocks automation-initiated actions", () => {
    const result = authoriseExternalAction({
      actionType: "external_share",
      initiatedByAutomation: true
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("automation_not_permitted");
  });

  it("blocks actions lacking manual confirmation", () => {
    const result = authoriseExternalAction({
      actionType: "family_contact",
      initiatedByAutomation: false
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("manual_confirmation_required");
  });

  it("blocks confirmation by an unauthorised user", () => {
    const result = authoriseExternalAction({
      actionType: "family_contact",
      initiatedByAutomation: false,
      confirmation: { confirmedById: "u1", confirmedAt: AT, isAuthorised: false }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_authorised");
  });

  it("proceeds when an authorised user manually confirms", () => {
    const result = authoriseExternalAction({
      actionType: "external_share",
      initiatedByAutomation: false,
      confirmation: { confirmedById: "u1", confirmedAt: AT, isAuthorised: true }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confirmedById).toBe("u1");
  });
});

describe("research/clinical separation (Req 25.5)", () => {
  it("allows a uniform set and returns its shared classification", () => {
    const result = guardClassificationCombination(["clinical", "clinical"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.classification).toBe("clinical");
  });

  it("allows an empty set with an undefined classification", () => {
    const result = guardClassificationCombination([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.classification).toBeUndefined();
  });

  it("blocks a mixed research/clinical set", () => {
    const result = guardClassificationCombination(["research", "clinical"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("mixed_classification");
  });

  it("throws MixedClassificationError from the assert variant on a mix", () => {
    expect(() => assertSingleClassification(["research", "clinical"])).toThrow(
      MixedClassificationError
    );
    expect(assertSingleClassification(["research", "research"])).toBe("research");
  });
});

describe("uncertainty indicator (Req 25.6)", () => {
  it("exposes a scale of at least three ordered levels", () => {
    expect(UNCERTAINTY_LEVELS.length).toBeGreaterThanOrEqual(3);
  });

  it("maps confidence deterministically to ordered levels", () => {
    expect(levelFromConfidence(0)).toBe("low");
    expect(levelFromConfidence(0.5)).toBe("moderate");
    expect(levelFromConfidence(1)).toBe("high");
  });

  it("attaches a valid indicator to an AI output", () => {
    const result = attachUncertaintyIndicator({ text: "candidate" }, 0.9);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.indicator.level).toBe("high");
    expect(result.indicator.rank).toBe(3);
    expect(result.indicator.scaleSize).toBeGreaterThanOrEqual(3);
    expect(hasValidUncertaintyIndicator(result.indicator)).toBe(true);
  });

  it("blocks an out-of-range confidence", () => {
    const result = attachUncertaintyIndicator({ text: "x" }, 1.5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_confidence");
  });
});

describe("encrypted transport (Req 26.6)", () => {
  it("allows encrypted schemes", () => {
    expect(guardTransport({ scheme: "https" }).ok).toBe(true);
    expect(guardTransport({ scheme: "WSS" }).ok).toBe(true);
    expect(guardTransportUrl("https://api.example.com/case").ok).toBe(true);
  });

  it("rejects unencrypted schemes and explicit unencrypted flags", () => {
    const http = guardTransport({ scheme: "http" });
    expect(http.ok).toBe(false);
    if (http.ok) return;
    expect(http.error.code).toBe("unencrypted_transport");

    expect(guardTransport({ scheme: "https", encrypted: false }).ok).toBe(false);
    expect(guardTransportUrl("http://api.example.com").ok).toBe(false);
    expect(guardTransportUrl("no-scheme").ok).toBe(false);
  });
});
