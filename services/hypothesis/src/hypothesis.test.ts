// services/hypothesis/src/hypothesis.test.ts
//
// Unit tests for the full Hypothesis_Service (task 21.1, Requirement 11).
// These cover the core behaviours with concrete examples and edge cases; the
// numbered property tests are tasks 21.3–21.5.

import { describe, expect, it } from "vitest";

import {
  HYPOTHESIS_STATES,
  type Hypothesis,
  type HypothesisState
} from "@udn/domain";

import {
  INITIAL_HYPOTHESIS_STATE,
  createHypothesis,
  findProhibitedTerm,
  isNonDiagnostic,
  updateHypothesisState,
  updateHypothesisText,
  type CreateHypothesisInput
} from "./index.js";

const AT = "2024-01-01T00:00:00.000Z";
const LATER = "2024-01-02T00:00:00.000Z";

function baseInput(overrides: Partial<CreateHypothesisInput> = {}): CreateHypothesisInput {
  return {
    caseId: "Case-1",
    text: "This candidate explanation is consistent with the confirmed phenotypes.",
    evidence: [{ sourceObjectRef: "ConfirmedPhenotype-1", kind: "confirmed_phenotype" }],
    knowledgeSnapshotVersion: "snap-1",
    createdById: "user-1",
    at: AT,
    isAuthorised: true,
    ...overrides
  };
}

function createOk(overrides: Partial<CreateHypothesisInput> = {}): Hypothesis {
  const result = createHypothesis(baseInput(overrides));
  if (!result.ok) throw new Error(`expected creation to succeed, got ${result.error.code}`);
  return result.card.hypothesis;
}

describe("createHypothesis (Req 11.1, 11.2, 11.3, 11.4)", () => {
  it("links to at least one evidence item and starts in Proposed (Req 11.1, 11.4)", () => {
    const result = createHypothesis(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.card.evidenceItems).toHaveLength(1);
    expect(result.card.hypothesis.evidenceItemIds).toEqual([
      result.card.evidenceItems[0]!.id
    ]);
    expect(result.card.hypothesis.state).toBe(INITIAL_HYPOTHESIS_STATE);
    expect(result.card.hypothesis.stateHistory).toEqual([]);
    expect(result.card.hypothesis.knowledgeSnapshotVersion).toBe("snap-1");
  });

  it("rejects zero-evidence creation with no card (Req 11.2)", () => {
    const result = createHypothesis(baseInput({ evidence: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_evidence");
  });

  it("rejects prohibited diagnostic vocabulary (Req 11.3)", () => {
    const result = createHypothesis(
      baseInput({ text: "The patient has a confirmed diagnosis of the disorder." })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("prohibited_term");
  });

  it("rejects an unauthorised creator", () => {
    const result = createHypothesis(baseInput({ isAuthorised: false }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_authorised");
  });

  it("is deterministic for identical inputs (explicit ids)", () => {
    const overrides: Partial<CreateHypothesisInput> = {
      hypothesisId: "Hypothesis-fixed",
      evidence: [{ id: "EvidenceItem-fixed", sourceObjectRef: "src-1", kind: "variant" }]
    };
    const a = createHypothesis(baseInput(overrides));
    const b = createHypothesis(baseInput(overrides));
    expect(a).toEqual(b);
  });
});

describe("updateHypothesisState (Req 11.4, 11.5, 11.6, 11.7)", () => {
  it("records a transition and retains evidence links (Req 11.5, 11.7)", () => {
    const hypothesis = createOk();
    const result = updateHypothesisState(hypothesis, {
      newState: "Under Review",
      userId: "user-2",
      at: LATER,
      isAuthorised: true
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hypothesis.state).toBe("Under Review");
    expect(result.hypothesis.status).toBe("Under Review");
    expect(result.hypothesis.stateHistory).toEqual([
      { from: "Proposed", to: "Under Review", byId: "user-2", at: LATER }
    ]);
    expect(result.hypothesis.evidenceItemIds).toEqual(hypothesis.evidenceItemIds);
    // The input card is never mutated.
    expect(hypothesis.state).toBe("Proposed");
    expect(hypothesis.stateHistory).toEqual([]);
  });

  it("rejects an unauthorised state change and retains state (Req 11.6)", () => {
    const hypothesis = createOk();
    const result = updateHypothesisState(hypothesis, {
      newState: "Supported",
      userId: "intruder",
      at: LATER,
      isAuthorised: false
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_authorised");
    expect(result.hypothesis).toBe(hypothesis);
    expect(result.hypothesis.state).toBe("Proposed");
  });

  it("only ever produces states in the defined set (Req 11.4)", () => {
    let hypothesis = createOk();
    for (const state of HYPOTHESIS_STATES) {
      const result = updateHypothesisState(hypothesis, {
        newState: state,
        userId: "user-2",
        at: LATER,
        isAuthorised: true
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(HYPOTHESIS_STATES).toContain(result.hypothesis.state);
      hypothesis = result.hypothesis;
    }
    expect(hypothesis.stateHistory).toHaveLength(HYPOTHESIS_STATES.length);
  });

  it("rejects a state outside the defined set (Req 11.4)", () => {
    const hypothesis = createOk();
    const result = updateHypothesisState(hypothesis, {
      newState: "Cured" as HypothesisState,
      userId: "user-2",
      at: LATER,
      isAuthorised: true
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_state");
    expect(result.hypothesis.state).toBe("Proposed");
  });
});

describe("updateHypothesisText (Req 11.3, 11.6, 11.7)", () => {
  it("retains evidence links on a text update (Req 11.7)", () => {
    const hypothesis = createOk();
    const result = updateHypothesisText(hypothesis, {
      text: "Revised: findings may suggest a candidate contributor.",
      userId: "user-2",
      at: LATER,
      isAuthorised: true
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hypothesis.evidenceItemIds).toEqual(hypothesis.evidenceItemIds);
  });

  it("rejects prohibited text and leaves the card unchanged (Req 11.3)", () => {
    const hypothesis = createOk();
    const result = updateHypothesisText(hypothesis, {
      text: "This proves the prognosis.",
      userId: "user-2",
      at: LATER,
      isAuthorised: true
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("prohibited_term");
    expect(result.hypothesis).toBe(hypothesis);
  });
});

describe("vocabulary guard (Req 11.3)", () => {
  it("accepts hedged non-diagnostic wording", () => {
    expect(isNonDiagnostic("Findings are consistent with a candidate explanation.")).toBe(true);
    expect(findProhibitedTerm("Findings are consistent with a candidate explanation.")).toBeUndefined();
  });

  it("flags whole-word diagnostic terms case-insensitively", () => {
    expect(findProhibitedTerm("DIAGNOSED with the condition")).toBe("diagnosed");
    expect(findProhibitedTerm("a definitive diagnosis")).toBeDefined();
  });

  it("does not flag benign words containing a term as a substring", () => {
    expect(isNonDiagnostic("The diagnostics laboratory processed the sample.")).toBe(true);
  });
});
