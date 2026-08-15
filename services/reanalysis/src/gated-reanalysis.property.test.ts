// services/reanalysis/src/gated-reanalysis.property.test.ts
//
// Property-based test for design Correctness Property 42 (task 27.2).
//
// Feature: undiagnosed-disease-navigator, Property 42: Reanalysis runs are
// gated and preserve state on failure
//
// *For any* reanalysis run, it starts only after an explicit human approval
// recording approver identity and timestamp; a successful run yields a
// before/after comparison of classification, evidence, and outcome; and a
// failed run preserves the pre-reanalysis case state unchanged.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createEnvelope, type ReanalysisCandidate } from "@udn/domain";
import { approveReanalysisRun, isReanalysisApproved } from "./approval.js";
import { reanalysisCandidateId } from "./matcher.js";
import { runReanalysis } from "./run.js";
import type { CaseSnapshotState } from "./before-after.js";

const NOW = "2024-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A short, non-empty identifier token. */
const tokenArb = fc
  .array(fc.integer({ min: 97, max: 122 }), { minLength: 1, maxLength: 6 })
  .map((codes) => String.fromCharCode(...codes));

/** A relevance record with at least one matched identifier. */
const relevanceArb = fc
  .record({
    matchedVariants: fc.array(tokenArb, { maxLength: 3 }),
    matchedGenes: fc.array(tokenArb, { maxLength: 3 }),
    matchedPhenotypes: fc.array(tokenArb, { maxLength: 3 })
  })
  .filter(
    (r) =>
      r.matchedVariants.length + r.matchedGenes.length + r.matchedPhenotypes.length > 0
  );

interface CandidateSpec {
  readonly caseId: string;
  readonly knowledgeUpdateId: string;
  readonly relevance: ReanalysisCandidate["relevance"];
}

const candidateSpecArb: fc.Arbitrary<CandidateSpec> = fc.record({
  caseId: tokenArb.map((t) => `case-${t}`),
  knowledgeUpdateId: tokenArb.map((t) => `KU-${t}`),
  relevance: relevanceArb
});

function buildCandidate(spec: CandidateSpec): ReanalysisCandidate {
  const base = createEnvelope({
    id: reanalysisCandidateId(spec.caseId, spec.knowledgeUpdateId),
    entityType: "ReanalysisCandidate",
    caseId: spec.caseId,
    source: "Reanalysis_Service",
    status: "pending",
    provenance: {
      sourceId: spec.knowledgeUpdateId,
      versionId: "1",
      createdById: "system",
      ingestedAt: NOW
    },
    accessClassification: "clinical",
    createdById: "system",
    now: NOW
  });
  return {
    ...base,
    entityType: "ReanalysisCandidate",
    knowledgeUpdateId: spec.knowledgeUpdateId,
    relevance: spec.relevance
  };
}

/** A case snapshot state generator pinned to a given case id. */
function snapshotArb(
  caseId: string,
  classifications: readonly [string, ...string[]],
  outcomes: readonly [string, ...string[]]
): fc.Arbitrary<CaseSnapshotState> {
  return fc.record({
    caseId: fc.constant(caseId),
    classification: fc.constantFrom(...classifications),
    evidenceRefs: fc.array(tokenArb.map((t) => `ev-${t}`), { maxLength: 4 }),
    outcome: fc.constantFrom(...outcomes)
  });
}

/** Deep structural equality of two snapshots (order-insensitive on evidence). */
function sameSnapshot(a: CaseSnapshotState, b: CaseSnapshotState): boolean {
  return (
    a.caseId === b.caseId &&
    a.classification === b.classification &&
    a.outcome === b.outcome &&
    [...a.evidenceRefs].join("|") === [...b.evidenceRefs].join("|")
  );
}

// ---------------------------------------------------------------------------
// Property 42
// ---------------------------------------------------------------------------

describe("Property 42: Reanalysis runs are gated and preserve state on failure", () => {
  // Feature: undiagnosed-disease-navigator, Property 42: Reanalysis runs are
  // gated and preserve state on failure
  // Validates: Requirements 15.4, 15.7

  it("runs only when a human approval is recorded; unapproved/unauthorised runs are rejected and prior state is preserved", () => {
    fc.assert(
      fc.property(
        candidateSpecArb,
        fc.boolean(),
        fc.boolean(),
        (spec, isAuthorised, approve) => {
          const candidate = buildCandidate(spec);
          const before = fc.sample(
            snapshotArb(spec.caseId, ["unresolved", "in_review"], ["no diagnosis", "inconclusive"]),
            1
          )[0]!;

          const approval = approveReanalysisRun(candidate, {
            approverId: "clin-1",
            at: NOW,
            isAuthorised,
            approve
          });

          const grandApproved = isAuthorised && approve;

          if (!grandApproved) {
            // The approval is rejected with the correct code and the candidate
            // is returned unchanged (same reference — no mutation).
            expect(approval.ok).toBe(false);
            if (approval.ok) return;
            expect(approval.error.code).toBe(isAuthorised ? "not_approved" : "not_authorised");
            expect(approval.candidate).toBe(candidate);
            expect(isReanalysisApproved(candidate)).toBe(false);

            // A run against the unapproved candidate never starts: it is
            // rejected as not_approved, the executor is never invoked, and the
            // pre-reanalysis state is preserved unchanged.
            let executed = false;
            const result = runReanalysis({
              candidate,
              before,
              execute: () => {
                executed = true;
                throw new Error("execute must not run for an unapproved candidate");
              }
            });
            expect(result.status).toBe("not_approved");
            expect(executed).toBe(false);
            expect(result.before).toBe(before);
            expect(sameSnapshot(result.before, before)).toBe(true);
            return;
          }

          // Authorised + explicit approval: approval is recorded with approver
          // identity and timestamp.
          expect(approval.ok).toBe(true);
          if (!approval.ok) return;
          expect(isReanalysisApproved(approval.candidate)).toBe(true);
          expect(approval.candidate.approval).toEqual({ byId: "clin-1", at: NOW });

          // A successful run yields a before/after comparison over
          // classification, evidence, and outcome.
          const after = fc.sample(
            snapshotArb(
              spec.caseId,
              ["confirmed_diagnosis", "in_review"],
              ["candidate re-surfaced", "resolved"]
            ),
            1
          )[0]!;
          const success = runReanalysis({
            candidate: approval.candidate,
            before,
            execute: () => after
          });
          expect(success.status).toBe("completed");
          if (success.status !== "completed") return;
          expect(success.comparison.caseId).toBe(spec.caseId);
          expect(success.comparison.classification.after).toBe(after.classification);
          expect(success.comparison.outcome.after).toBe(after.outcome);
          expect(success.comparison.candidateId).toBe(candidate.id);
          expect(success.comparison.knowledgeUpdateId).toBe(spec.knowledgeUpdateId);

          // A failed run (every attempt throws) preserves the pre-reanalysis
          // state unchanged and reports the triggering Knowledge_Update.
          const failure = runReanalysis({
            candidate: approval.candidate,
            before,
            execute: () => {
              throw new Error("transient failure");
            }
          });
          expect(failure.status).toBe("failed");
          if (failure.status !== "failed") return;
          expect(failure.before).toBe(before);
          expect(sameSnapshot(failure.before, before)).toBe(true);
          expect(failure.error.knowledgeUpdateId).toBe(spec.knowledgeUpdateId);
        }
      ),
      { numRuns: 200 }
    );
  });
});
