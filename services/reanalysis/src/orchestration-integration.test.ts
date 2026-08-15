// services/reanalysis/src/orchestration-integration.test.ts
//
// Example-based integration tests for the end-to-end, event-driven reanalysis
// flow (task 27.4). These exercise the full slice:
//
//   simulateKnowledgeUpdateEvents
//     -> handleKnowledgeUpdatePublished (deterministic matcher over feature vectors)
//     -> approveReanalysisRun (approval gate)
//     -> runReanalysis (retry-bounded execution)
//     -> buildBeforeAfterComparison (inbox before/after view)
//
// asserting that affected cases are enqueued, the before/after view reflects the
// change, and a non-intersecting update enqueues nothing.

import { describe, it, expect } from "vitest";
import {
  handleKnowledgeUpdatePublished,
  simulateKnowledgeUpdateEvents,
  type KnowledgeUpdatePublishedEvent
} from "./orchestrator.js";
import { approveReanalysisRun } from "./approval.js";
import { runReanalysis } from "./run.js";
import { buildBeforeAfterComparison, type CaseSnapshotState } from "./before-after.js";
import type { CaseFeatureVector, MatchOptions } from "./matcher.js";

const NOW = "2024-01-01T00:00:00.000Z";
const OPTIONS: MatchOptions = { createdById: "system", source: "Reanalysis_Service", now: NOW };

// The Knowledge_Service derives deltas deterministically per index: the update
// at index i references SYN-VAR-{i+1}, SYN-GENE-{i+1}, HP:<zero-padded i+1>,
// SYN-DISEASE-{i+1}. The first event therefore references SYN-VAR-1/SYN-GENE-1.

function firstEvent(count = 5): KnowledgeUpdatePublishedEvent {
  const result = simulateKnowledgeUpdateEvents({ count, createdById: "system", at: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected simulation to succeed");
  expect(result.events).toHaveLength(count);
  const event = result.events[0];
  expect(event).toBeDefined();
  return event!;
}

describe("reanalysis end-to-end event-driven flow (Req 15.1-15.8)", () => {
  it("enqueues affected cases, gates the run, and surfaces a before/after view of the change", () => {
    const event = firstEvent();
    expect(event.update.delta.variants).toContain("SYN-VAR-1");

    // An intersecting case (exact match) and a case matching only by
    // case-folded normalisation, plus a non-intersecting case.
    const affected: CaseFeatureVector = {
      caseId: "case-affected",
      variants: ["SYN-VAR-1"],
      genes: [],
      phenotypes: []
    };
    const normalised: CaseFeatureVector = {
      caseId: "case-normalised",
      variants: [],
      genes: ["syn-gene-1"], // normalises to match SYN-GENE-1
      phenotypes: []
    };
    const unaffected: CaseFeatureVector = {
      caseId: "case-unaffected",
      variants: ["ZZZ-VAR"],
      genes: ["ZZZ-GENE"],
      phenotypes: ["HP:9999999"]
    };

    const handled = handleKnowledgeUpdatePublished(
      event,
      [affected, normalised, unaffected],
      OPTIONS
    );

    expect(handled.status).toBe("completed");
    if (handled.status !== "completed") return;

    // Only the intersecting cases are enqueued; the non-intersecting case is not.
    const enqueuedCaseIds = handled.reviewQueue.map((e) => e.caseId).sort();
    expect(enqueuedCaseIds).toEqual(["case-affected", "case-normalised"]);
    expect(handled.candidates.map((c) => c.caseId).sort()).toEqual([
      "case-affected",
      "case-normalised"
    ]);

    // Take the affected candidate and drive it through approval + run.
    const candidate = handled.candidates.find((c) => c.caseId === "case-affected");
    expect(candidate).toBeDefined();
    if (!candidate) return;
    expect(candidate.knowledgeUpdateId).toBe(event.update.id);
    expect(candidate.relevance.matchedVariants).toContain("syn-var-1");

    const approval = approveReanalysisRun(candidate, {
      approverId: "clin-1",
      at: NOW,
      isAuthorised: true,
      approve: true
    });
    expect(approval.ok).toBe(true);
    if (!approval.ok) return;

    const before: CaseSnapshotState = {
      caseId: "case-affected",
      classification: "unresolved",
      evidenceRefs: ["ev-baseline"],
      outcome: "no diagnosis"
    };
    const after: CaseSnapshotState = {
      caseId: "case-affected",
      classification: "in_review",
      evidenceRefs: ["ev-baseline", "ev-knowledge-update"],
      outcome: "candidate variant re-surfaced by knowledge update"
    };

    const run = runReanalysis({
      candidate: approval.candidate,
      before,
      execute: () => after
    });

    expect(run.status).toBe("completed");
    if (run.status !== "completed") return;

    // The before/after view reflects the change and explains why the case was
    // re-surfaced (candidate + triggering Knowledge_Update).
    const cmp = run.comparison;
    expect(cmp.changed).toBe(true);
    expect(cmp.classification.before).toBe("unresolved");
    expect(cmp.classification.after).toBe("in_review");
    expect(cmp.evidence.added).toEqual(["ev-knowledge-update"]);
    expect(cmp.outcome.changed).toBe(true);
    expect(cmp.candidateId).toBe(candidate.id);
    expect(cmp.knowledgeUpdateId).toBe(event.update.id);
    expect(cmp.reviewQueueEntry?.caseId).toBe("case-affected");

    // The standalone comparison builder agrees with the run's comparison.
    const direct = buildBeforeAfterComparison(before, after, { candidate: approval.candidate });
    expect(direct).toEqual(cmp);
  });

  it("enqueues nothing when the published update does not intersect any case", () => {
    const event = firstEvent();

    const nonIntersecting: readonly CaseFeatureVector[] = [
      { caseId: "case-x", variants: ["OTHER-VAR"], genes: ["OTHER-GENE"], phenotypes: ["HP:1111111"] },
      { caseId: "case-y", variants: [], genes: ["UNRELATED"], phenotypes: [] }
    ];

    const handled = handleKnowledgeUpdatePublished(event, nonIntersecting, OPTIONS);

    expect(handled.status).toBe("completed");
    if (handled.status !== "completed") return;
    expect(handled.candidates).toEqual([]);
    expect(handled.reviewQueue).toEqual([]);
  });
});
