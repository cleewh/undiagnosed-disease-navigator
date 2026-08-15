// services/reanalysis/src/retry-bounded.property.test.ts
//
// Property-based test for design Correctness Property 43 (task 27.3).
//
// Feature: undiagnosed-disease-navigator, Property 43: Retry-bounded failure
// handling with pending preservation
//
// *For any* induced failure in contradiction evaluation, reanalysis
// identification, AI invocation, or audit recording, the operation is retried
// at most 3 times, prior state is preserved, and on exhaustion an error
// indication is returned identifying the affected item. This test exercises the
// reanalysis identification and run paths.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createEnvelope, type KnowledgeUpdate, type ReanalysisCandidate } from "@udn/domain";
import { approveReanalysisRun } from "./approval.js";
import {
  handleKnowledgeUpdatePublished,
  knowledgeUpdatePublishedEvent
} from "./orchestrator.js";
import { attemptWithRetry, MAX_REANALYSIS_ATTEMPTS } from "./retry.js";
import { reanalysisCandidateId, type CaseFeatureVector, type MatchOptions } from "./matcher.js";
import { runReanalysis } from "./run.js";
import type { CaseSnapshotState } from "./before-after.js";

const NOW = "2024-01-01T00:00:00.000Z";
const OPTIONS: MatchOptions = { createdById: "system", source: "Reanalysis_Service", now: NOW };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeUpdate(id = "KU-retry"): KnowledgeUpdate {
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
  return {
    ...base,
    entityType: "KnowledgeUpdate",
    syntheticIndicator: true,
    status: "pending",
    delta: { variants: ["VAR-1"], genes: ["BRCA1"], phenotypes: ["HP:0001250"], diseases: ["D-1"] }
  };
}

const FEATURES: readonly CaseFeatureVector[] = [
  { caseId: "case-a", variants: ["var-1"], genes: [], phenotypes: [] }
];

function approvedCandidate(): ReanalysisCandidate {
  const base = createEnvelope({
    id: reanalysisCandidateId("case-a", "KU-retry"),
    entityType: "ReanalysisCandidate",
    caseId: "case-a",
    source: "Reanalysis_Service",
    status: "pending",
    provenance: { sourceId: "KU-retry", versionId: "1", createdById: "system", ingestedAt: NOW },
    accessClassification: "clinical",
    createdById: "system",
    now: NOW
  });
  const candidate: ReanalysisCandidate = {
    ...base,
    entityType: "ReanalysisCandidate",
    knowledgeUpdateId: "KU-retry",
    relevance: { matchedVariants: ["var-1"], matchedGenes: [], matchedPhenotypes: [] }
  };
  const approval = approveReanalysisRun(candidate, {
    approverId: "clin-1",
    at: NOW,
    isAuthorised: true,
    approve: true
  });
  if (!approval.ok) throw new Error("expected approval to succeed");
  return approval.candidate;
}

const BEFORE: CaseSnapshotState = {
  caseId: "case-a",
  classification: "unresolved",
  evidenceRefs: ["ev-1"],
  outcome: "no diagnosis"
};

const AFTER: CaseSnapshotState = {
  caseId: "case-a",
  classification: "in_review",
  evidenceRefs: ["ev-1", "ev-2"],
  outcome: "candidate re-surfaced"
};

// ---------------------------------------------------------------------------
// Property 43
// ---------------------------------------------------------------------------

describe("Property 43: Retry-bounded failure handling with pending preservation", () => {
  // Feature: undiagnosed-disease-navigator, Property 43: Retry-bounded failure
  // handling with pending preservation
  // Validates: Requirements 15.5

  it("retries up to the bound: fewer failures than the bound eventually succeed; always-failing exhausts exactly maxAttempts", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }), // maxAttempts bound
        fc.integer({ min: 0, max: 7 }), // number of leading failures
        (maxAttempts, failuresBeforeSuccess) => {
          // ---- attemptWithRetry primitive ----------------------------------
          let calls = 0;
          const outcome = attemptWithRetry(() => {
            calls += 1;
            if (calls <= failuresBeforeSuccess) throw new Error("transient");
            return "ok";
          }, maxAttempts);

          if (failuresBeforeSuccess < maxAttempts) {
            expect(outcome.ok).toBe(true);
            expect(outcome.attempts).toBe(failuresBeforeSuccess + 1);
            expect(calls).toBe(failuresBeforeSuccess + 1);
          } else {
            expect(outcome.ok).toBe(false);
            expect(outcome.attempts).toBe(maxAttempts);
            // The operation is attempted exactly maxAttempts times, never more.
            expect(calls).toBe(maxAttempts);
          }
          // The bound is never exceeded.
          expect(outcome.attempts).toBeLessThanOrEqual(maxAttempts);

          // ---- reanalysis run path -----------------------------------------
          let runCalls = 0;
          const runResult = runReanalysis({
            candidate: approvedCandidate(),
            before: BEFORE,
            maxAttempts,
            execute: () => {
              runCalls += 1;
              if (runCalls <= failuresBeforeSuccess) throw new Error("transient run");
              return AFTER;
            }
          });

          if (failuresBeforeSuccess < maxAttempts) {
            expect(runResult.status).toBe("completed");
            if (runResult.status !== "completed") return;
            expect(runResult.attempts).toBe(failuresBeforeSuccess + 1);
          } else {
            expect(runResult.status).toBe("failed");
            if (runResult.status !== "failed") return;
            expect(runResult.attempts).toBe(maxAttempts);
            expect(runCalls).toBe(maxAttempts);
            // Prior state preserved unchanged and the affected item is named.
            expect(runResult.before).toBe(BEFORE);
            expect(runResult.error.knowledgeUpdateId).toBe("KU-retry");
          }

          // ---- identification path -----------------------------------------
          let idCalls = 0;
          const event = knowledgeUpdatePublishedEvent(makeUpdate(), NOW);
          const idResult = handleKnowledgeUpdatePublished(event, FEATURES, {
            ...OPTIONS,
            maxAttempts,
            identify: () => {
              idCalls += 1;
              if (idCalls <= failuresBeforeSuccess) throw new Error("transient identify");
              return { candidates: [], reviewQueue: [] };
            }
          });

          if (failuresBeforeSuccess < maxAttempts) {
            expect(idResult.status).toBe("completed");
            if (idResult.status !== "completed") return;
            expect(idResult.attempts).toBe(failuresBeforeSuccess + 1);
          } else {
            expect(idResult.status).toBe("pending");
            if (idResult.status !== "pending") return;
            expect(idResult.attempts).toBe(maxAttempts);
            expect(idCalls).toBe(maxAttempts);
            // On exhaustion the failed Knowledge_Update is identified.
            expect(idResult.error.knowledgeUpdateId).toBe("KU-retry");
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("defaults the retry bound to 3 attempts (MAX_REANALYSIS_ATTEMPTS)", () => {
    expect(MAX_REANALYSIS_ATTEMPTS).toBe(3);
    fc.assert(
      fc.property(fc.constant(null), () => {
        let runCalls = 0;
        const runResult = runReanalysis({
          candidate: approvedCandidate(),
          before: BEFORE,
          execute: () => {
            runCalls += 1;
            throw new Error("always fails");
          }
        });
        expect(runResult.status).toBe("failed");
        if (runResult.status !== "failed") return;
        expect(runResult.attempts).toBe(MAX_REANALYSIS_ATTEMPTS);
        expect(runCalls).toBe(MAX_REANALYSIS_ATTEMPTS);
        expect(runResult.before).toBe(BEFORE);
      }),
      { numRuns: 100 }
    );
  });
});
