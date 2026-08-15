// services/reanalysis/src/orchestration.test.ts
//
// Compile-sanity + behavioural unit tests for the event-driven orchestration,
// approval gate, retry-bounded run, and before/after view (task 27.1).
// These are illustrative examples; the property/integration coverage lives in
// tasks 27.2–27.4.

import { describe, it, expect } from "vitest";
import { createEnvelope, type KnowledgeUpdate, type ReanalysisCandidate } from "@udn/domain";
import {
  approveReanalysisRun,
  isReanalysisApproved
} from "./approval.js";
import { buildBeforeAfterComparison, type CaseSnapshotState } from "./before-after.js";
import {
  handleKnowledgeUpdatePublished,
  knowledgeUpdatePublishedEvent,
  simulateKnowledgeUpdateEvents
} from "./orchestrator.js";
import { runReanalysis } from "./run.js";
import { reanalysisCandidateId, type CaseFeatureVector, type MatchOptions } from "./matcher.js";

const NOW = "2024-01-01T00:00:00.000Z";
const OPTIONS: MatchOptions = { createdById: "system", source: "Reanalysis_Service", now: NOW };

function makeUpdate(delta: KnowledgeUpdate["delta"], id = "KU-1"): KnowledgeUpdate {
  const base = createEnvelope({
    id,
    entityType: "KnowledgeUpdate",
    caseId: "GLOBAL",
    source: "Knowledge_Service",
    status: "pending",
    provenance: { sourceId: "clinvar", versionId: "1", createdById: "system", ingestedAt: NOW },
    accessClassification: "research",
    createdById: "system",
    now: NOW
  });
  return { ...base, entityType: "KnowledgeUpdate", syntheticIndicator: true, delta, status: "pending" };
}

const UPDATE = makeUpdate({
  variants: ["VAR-1"],
  genes: ["BRCA1"],
  phenotypes: ["HP:0001250"],
  diseases: ["D-1"]
});

const AFFECTED: CaseFeatureVector = {
  caseId: "case-a",
  variants: ["var-1"],
  genes: [],
  phenotypes: []
};
const UNAFFECTED: CaseFeatureVector = {
  caseId: "case-b",
  variants: ["other"],
  genes: ["nope"],
  phenotypes: []
};

describe("handleKnowledgeUpdatePublished (Req 15.1, 15.2, 15.3, 15.9)", () => {
  it("creates candidates and enqueues only affected cases", () => {
    const event = knowledgeUpdatePublishedEvent(UPDATE, NOW);
    const result = handleKnowledgeUpdatePublished(event, [AFFECTED, UNAFFECTED], OPTIONS);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.candidates.map((c) => c.caseId)).toEqual(["case-a"]);
    expect(result.reviewQueue.map((e) => e.caseId)).toEqual(["case-a"]);
    expect(result.attempts).toBe(1);
  });

  it("retains the update pending after retries are exhausted (Req 15.5)", () => {
    const event = knowledgeUpdatePublishedEvent(UPDATE, NOW);
    const result = handleKnowledgeUpdatePublished(event, [AFFECTED], {
      ...OPTIONS,
      identify: () => {
        throw new Error("transient");
      }
    });

    expect(result.status).toBe("pending");
    if (result.status !== "pending") return;
    expect(result.attempts).toBe(3);
    expect(result.error.knowledgeUpdateId).toBe("KU-1");
  });
});

describe("simulateKnowledgeUpdateEvents (Knowledge_Service integration)", () => {
  it("produces publish events for valid counts and rejects out-of-range", () => {
    const ok = simulateKnowledgeUpdateEvents({ count: 5, createdById: "u", at: NOW });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.events).toHaveLength(5);

    const bad = simulateKnowledgeUpdateEvents({ count: 1, createdById: "u", at: NOW });
    expect(bad.ok).toBe(false);
  });
});

function candidate(): ReanalysisCandidate {
  const base = createEnvelope({
    id: reanalysisCandidateId("case-a", "KU-1"),
    entityType: "ReanalysisCandidate",
    caseId: "case-a",
    source: "Reanalysis_Service",
    status: "pending",
    provenance: { sourceId: "KU-1", versionId: "1", createdById: "system", ingestedAt: NOW },
    accessClassification: "clinical",
    createdById: "system",
    now: NOW
  });
  return {
    ...base,
    entityType: "ReanalysisCandidate",
    knowledgeUpdateId: "KU-1",
    relevance: { matchedVariants: ["var-1"], matchedGenes: [], matchedPhenotypes: [] }
  };
}

describe("approveReanalysisRun (Req 15.4)", () => {
  it("records approval for an authorised explicit approval", () => {
    const result = approveReanalysisRun(candidate(), {
      approverId: "clin-1",
      at: NOW,
      isAuthorised: true,
      approve: true
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.approval).toEqual({ byId: "clin-1", at: NOW });
    expect(isReanalysisApproved(result.candidate)).toBe(true);
  });

  it("rejects unauthorised approval and leaves the candidate unchanged", () => {
    const c = candidate();
    const result = approveReanalysisRun(c, {
      approverId: "intruder",
      at: NOW,
      isAuthorised: false,
      approve: true
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_authorised");
    expect(result.candidate).toBe(c);
  });

  it("rejects when no explicit approval action is supplied", () => {
    const result = approveReanalysisRun(candidate(), {
      approverId: "clin-1",
      at: NOW,
      isAuthorised: true,
      approve: false
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_approved");
  });
});

const BEFORE: CaseSnapshotState = {
  caseId: "case-a",
  classification: "unresolved",
  evidenceRefs: ["ev-1"],
  outcome: "no diagnosis"
};

describe("runReanalysis (Req 15.4, 15.5, 15.6, 15.7)", () => {
  it("blocks an unapproved run and preserves prior state", () => {
    const result = runReanalysis({
      candidate: candidate(),
      before: BEFORE,
      execute: () => {
        throw new Error("should not run");
      }
    });
    expect(result.status).toBe("not_approved");
    expect(result.before).toBe(BEFORE);
  });

  it("produces a before/after comparison on success", () => {
    const approved = approveReanalysisRun(candidate(), {
      approverId: "clin-1",
      at: NOW,
      isAuthorised: true,
      approve: true
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const after: CaseSnapshotState = {
      caseId: "case-a",
      classification: "in_review",
      evidenceRefs: ["ev-1", "ev-2"],
      outcome: "candidate variant re-surfaced"
    };
    const result = runReanalysis({
      candidate: approved.candidate,
      before: BEFORE,
      execute: () => after
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.comparison.classification.changed).toBe(true);
    expect(result.comparison.evidence.added).toEqual(["ev-2"]);
    expect(result.comparison.candidateId).toBe(reanalysisCandidateId("case-a", "KU-1"));
    expect(result.comparison.reviewQueueEntry?.knowledgeUpdateId).toBe("KU-1");
  });

  it("preserves prior state and reports run_incomplete on retry exhaustion", () => {
    const approved = approveReanalysisRun(candidate(), {
      approverId: "clin-1",
      at: NOW,
      isAuthorised: true,
      approve: true
    });
    if (!approved.ok) throw new Error("expected approval");

    const result = runReanalysis({
      candidate: approved.candidate,
      before: BEFORE,
      execute: () => {
        throw new Error("transient");
      }
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.attempts).toBe(3);
    expect(result.before).toBe(BEFORE);
    expect(result.error.knowledgeUpdateId).toBe("KU-1");
  });
});

describe("buildBeforeAfterComparison (Req 15.6)", () => {
  it("reports no change when states are identical", () => {
    const cmp = buildBeforeAfterComparison(BEFORE, BEFORE);
    expect(cmp.changed).toBe(false);
    expect(cmp.candidateId).toBeNull();
  });
});
