// services/disposition/src/disposition.test.ts
//
// Unit tests for the Disposition_Service (Req 13.1-13.7). A fake AiGateway is
// injected throughout — no AWS, no Bedrock.

import { describe, expect, it } from "vitest";
import { ModelInvocationFailedError } from "@udn/ai-gateway";
import type { GenerativeInvocationResult } from "@udn/ai-gateway";
import type { Case, CaseDisposition } from "@udn/domain";

import {
  approveDraftSummary,
  caseStatusForDisposition,
  classifyDisposition,
  isUnresolvedDisposition,
  recordDisposition
} from "./disposition.js";
import { generateDraftSummary, type DraftSummaryGateway } from "./summary.js";

const MODEL_ID = "anthropic.test-model";
const AT = "2024-01-01T00:00:00.000Z";

function baseCase(): Case {
  return {
    id: "Case-1",
    entityType: "Case",
    caseId: "Case-1",
    source: "Intake_Service",
    version: 3,
    status: "in_review",
    provenance: {
      sourceId: "intake-0",
      versionId: "1",
      createdById: "coordinator-1",
      ingestedAt: "2023-12-01T00:00:00.000Z"
    },
    accessClassification: "clinical",
    createdAt: "2023-12-01T00:00:00.000Z",
    modifiedAt: "2023-12-15T00:00:00.000Z",
    createdById: "coordinator-1",
    syntheticIndicator: true,
    clinicalArea: "neuromuscular",
    archetype: "unsolved_case",
    inheritanceModel: "uncertain",
    familyBased: false,
    dispositionStatus: "in_review"
  };
}

/** Build a fake gateway returning a fixed `invoked` response document. */
function invokedGateway(document: unknown): DraftSummaryGateway {
  return {
    invoke(): Promise<GenerativeInvocationResult> {
      return Promise.resolve({
        outcome: "invoked",
        modelId: MODEL_ID,
        taskType: "summarisation",
        response: { outputText: JSON.stringify(document), modelId: MODEL_ID }
      });
    }
  };
}

describe("classification (Req 13.4)", () => {
  it("classifies confirmed diagnosis and closed non-genetic as resolved", () => {
    expect(classifyDisposition("confirmed_diagnosis")).toBe("Resolved_Case");
    expect(classifyDisposition("closed_non_genetic")).toBe("Resolved_Case");
    expect(isUnresolvedDisposition("confirmed_diagnosis")).toBe(false);
  });

  it("classifies every other disposition as an Unresolved_Case", () => {
    expect(classifyDisposition("unresolved")).toBe("Unresolved_Case");
    expect(isUnresolvedDisposition("unresolved")).toBe(true);
  });

  it("maps a disposition state to the matching case status (Req 13.1)", () => {
    expect(caseStatusForDisposition("confirmed_diagnosis")).toBe("confirmed_diagnosis");
    expect(caseStatusForDisposition("closed_non_genetic")).toBe("closed_non_genetic");
    expect(caseStatusForDisposition("unresolved")).toBe("unresolved");
  });
});

describe("recordDisposition (Req 13.1, 13.4)", () => {
  it("sets the case status from the disposition and reports classification", () => {
    const original = baseCase();
    const result = recordDisposition(original, {
      dispositionState: "unresolved",
      recordedById: "coordinator-1",
      at: AT,
      isAuthorised: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.case.dispositionStatus).toBe("unresolved"); // Req 13.1
    expect(result.classification).toBe("Unresolved_Case"); // Req 13.4
    expect(result.disposition.entityType).toBe("CaseDisposition");
    expect(result.disposition.dispositionState).toBe("unresolved");
    expect(result.disposition.draftSummary).toBeUndefined();
    // input not mutated
    expect(original.dispositionStatus).toBe("in_review");
    expect(result.case.version).toBe(original.version + 1);
  });

  it("rejects an unauthorised recording and leaves the case unchanged", () => {
    const original = baseCase();
    const result = recordDisposition(original, {
      dispositionState: "confirmed_diagnosis",
      recordedById: "intruder",
      at: AT,
      isAuthorised: false
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_authorised");
    expect(result.case).toEqual(original);
  });
});

function dispositionOf(result: ReturnType<typeof recordDisposition>): CaseDisposition {
  if (!result.ok) throw new Error("expected disposition recording to succeed");
  return result.disposition;
}

describe("generateDraftSummary (Req 13.2, 13.3, 13.7)", () => {
  const docs = [
    { sourceObjectId: "doc-1", content: "clinic note" },
    { sourceObjectId: "doc-2", content: "lab report" }
  ];

  it("produces a DRAFT summary with each statement linked to one source (Req 13.2, 13.3)", async () => {
    const disposition = dispositionOf(
      recordDisposition(baseCase(), {
        dispositionState: "unresolved",
        recordedById: "coordinator-1",
        at: AT,
        isAuthorised: true
      })
    );

    const gateway = invokedGateway({
      statements: [
        { statement: "Onset in infancy.", sourceRefs: ["doc-1"], confidence: 0.9, basis: "observed" },
        { statement: "Elevated CK.", sourceRefs: ["doc-2"], confidence: 0.8, basis: "observed" }
      ]
    });

    const result = await generateDraftSummary(disposition, docs, gateway, {
      invokingUserId: "coordinator-1",
      knownSourceObjectIds: ["doc-1", "doc-2"],
      now: () => AT
    });

    expect(result.outcome).toBe("drafted");
    if (result.outcome !== "drafted") return;
    const summary = result.disposition.draftSummary;
    expect(summary?.final).toBe(false); // Req 13.3 — stays draft
    expect(summary?.statements).toHaveLength(2);
    for (const statement of summary?.statements ?? []) {
      expect(statement.unsourced).toBe(false);
      expect(typeof statement.sourceObjectRef).toBe("string"); // Req 13.2 — one source
    }
    expect(summary?.statements[0]?.sourceObjectRef).toBe("doc-1");
  });

  it("flags statements that cannot be linked to a source as unsourced (Req 13.7)", async () => {
    const disposition = dispositionOf(
      recordDisposition(baseCase(), {
        dispositionState: "unresolved",
        recordedById: "coordinator-1",
        at: AT,
        isAuthorised: true
      })
    );

    const gateway = invokedGateway({
      statements: [
        { statement: "Grounded claim.", sourceRefs: ["doc-1"], confidence: 0.9, basis: "observed" },
        { statement: "Floating claim.", sourceRefs: [], confidence: 0.5, basis: "inferred" },
        { statement: "Unknown-source claim.", sourceRefs: ["doc-999"], confidence: 0.6, basis: "inferred" }
      ]
    });

    const result = await generateDraftSummary(disposition, docs, gateway, {
      invokingUserId: "coordinator-1",
      knownSourceObjectIds: ["doc-1", "doc-2"],
      now: () => AT
    });

    expect(result.outcome).toBe("drafted");
    if (result.outcome !== "drafted") return;
    const statements = result.disposition.draftSummary?.statements ?? [];
    expect(statements[0]?.unsourced).toBe(false);
    expect(statements[1]?.unsourced).toBe(true); // no source ref (Req 13.7)
    expect(statements[1]?.sourceObjectRef).toBeUndefined();
    expect(statements[2]?.unsourced).toBe(true); // ref not among known sources (Req 13.7)
    expect(result.disposition.draftSummary?.final).toBe(false); // retained in draft
  });

  it("retains the disposition without a final summary when the gateway fails (Req 13.6)", async () => {
    const disposition = dispositionOf(
      recordDisposition(baseCase(), {
        dispositionState: "unresolved",
        recordedById: "coordinator-1",
        at: AT,
        isAuthorised: true
      })
    );

    const gateway: DraftSummaryGateway = {
      invoke(): Promise<GenerativeInvocationResult> {
        return Promise.resolve({
          outcome: "rejected",
          error: new ModelInvocationFailedError({ timedOut: true })
        });
      }
    };

    const result = await generateDraftSummary(disposition, docs, gateway, {
      invokingUserId: "coordinator-1"
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") return;
    expect(result.reason).toBe("gateway_rejected");
    expect(result.detail).toMatch(/did not complete/i);
    expect(result.disposition).toEqual(disposition); // unchanged, no final summary
  });
});

describe("approveDraftSummary (Req 13.3, 13.5)", () => {
  function draftedDisposition(): CaseDisposition {
    const disposition = dispositionOf(
      recordDisposition(baseCase(), {
        dispositionState: "unresolved",
        recordedById: "coordinator-1",
        at: AT,
        isAuthorised: true
      })
    );
    return {
      ...disposition,
      draftSummary: {
        statements: [{ text: "Onset in infancy.", sourceObjectRef: "doc-1", unsourced: false }],
        final: false
      }
    };
  }

  it("marks the summary final on an authorised, explicit approval (Req 13.5)", () => {
    const disposition = draftedDisposition();
    const result = approveDraftSummary(disposition, {
      reviewerId: "specialist-1",
      at: "2024-01-02T00:00:00.000Z",
      isAuthorised: true,
      approve: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.disposition.draftSummary?.final).toBe(true);
    expect(disposition.draftSummary?.final).toBe(false); // input not mutated
    expect(result.disposition.version).toBe(disposition.version + 1);
  });

  it("keeps the summary in draft without an explicit approval (Req 13.3)", () => {
    const disposition = draftedDisposition();
    const result = approveDraftSummary(disposition, {
      reviewerId: "specialist-1",
      at: AT,
      isAuthorised: true,
      approve: false
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_approved");
    expect(result.disposition.draftSummary?.final).toBe(false);
  });

  it("rejects an unauthorised approval and leaves the summary in draft (Req 13.3)", () => {
    const disposition = draftedDisposition();
    const result = approveDraftSummary(disposition, {
      reviewerId: "intruder",
      at: AT,
      isAuthorised: false,
      approve: true
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_authorised");
    expect(result.disposition.draftSummary?.final).toBe(false);
  });

  it("reports when there is no draft summary to approve", () => {
    const disposition = dispositionOf(
      recordDisposition(baseCase(), {
        dispositionState: "unresolved",
        recordedById: "coordinator-1",
        at: AT,
        isAuthorised: true
      })
    );
    const result = approveDraftSummary(disposition, {
      reviewerId: "specialist-1",
      at: AT,
      isAuthorised: true,
      approve: true
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_summary");
  });
});
