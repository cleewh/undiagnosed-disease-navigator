// services/reanalysis/src/before-after.ts
//
// Pure before/after comparison view for the reanalysis inbox (Reanalysis_Service,
// task 27.1, Requirement 15.6).
//
// When a reanalysis run completes successfully the Reanalysis_Service presents a
// comparison view showing the case classification, evidence, and outcome both
// BEFORE and AFTER the reanalysis run (Req 15.6). This module is a pure,
// deterministic function producing that comparison for the inbox UI and other
// consumers; it performs no I/O and calls no generative model.
//
// Alongside the raw before/after states it surfaces what the reanalysis
// changed — the matched relevance that triggered it, the new Reanalysis_Candidate
// id, and the review-queue entry — so the inbox can explain WHY the case was
// re-surfaced (design "Case re-surfaced with explanation").

import type { ReanalysisCandidate } from "@udn/domain";
import { reviewQueueEntryOf, type MatchedRelevance, type ReviewQueueEntry } from "./matcher.js";

// ---------------------------------------------------------------------------
// Case snapshot state
// ---------------------------------------------------------------------------

/**
 * The comparable state of a case at a point in time, holding exactly the three
 * dimensions Req 15.6 requires in the comparison view: the case
 * `classification`, its `evidenceRefs` (references to the evidence in effect),
 * and its `outcome` (the human-readable disposition/result).
 */
export interface CaseSnapshotState {
  /** The case the snapshot describes. */
  readonly caseId: string;
  /** Case classification, e.g. "unresolved" / "confirmed_diagnosis" (Req 15.6). */
  readonly classification: string;
  /** References to the evidence in effect for the case (Req 15.6). */
  readonly evidenceRefs: readonly string[];
  /** Human-readable outcome/disposition of the case (Req 15.6). */
  readonly outcome: string;
}

// ---------------------------------------------------------------------------
// Field-level change descriptors
// ---------------------------------------------------------------------------

/** A before/after change of a single scalar field. */
export interface ScalarChange {
  readonly before: string;
  readonly after: string;
  /** True when `before` and `after` differ. */
  readonly changed: boolean;
}

/** A before/after change of an evidence-reference set. */
export interface EvidenceChange {
  /** Evidence references before the run, in stable sorted order. */
  readonly before: readonly string[];
  /** Evidence references after the run, in stable sorted order. */
  readonly after: readonly string[];
  /** References present after but not before, sorted (new evidence). */
  readonly added: readonly string[];
  /** References present before but not after, sorted (removed evidence). */
  readonly removed: readonly string[];
  /** True when `added` or `removed` is non-empty. */
  readonly changed: boolean;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * The full before/after comparison presented on a successful reanalysis run
 * (Req 15.6). Carries the per-dimension changes plus the reanalysis "why":
 * matched relevance, the new candidate id, and the review-queue entry.
 */
export interface BeforeAfterComparison {
  /** The compared case. */
  readonly caseId: string;
  /** Classification before vs after (Req 15.6). */
  readonly classification: ScalarChange;
  /** Evidence before vs after, with added/removed sets (Req 15.6). */
  readonly evidence: EvidenceChange;
  /** Outcome before vs after (Req 15.6). */
  readonly outcome: ScalarChange;
  /**
   * The relevance that triggered the reanalysis — which variants/genes/
   * phenotypes matched the Knowledge_Update (Req 15.2). Present when built from
   * a triggering candidate.
   */
  readonly matchedRelevance: MatchedRelevance | null;
  /** The Reanalysis_Candidate id that triggered the run (Req 15.8), when known. */
  readonly candidateId: string | null;
  /** The Knowledge_Update that triggered the run (Req 15.8), when known. */
  readonly knowledgeUpdateId: string | null;
  /** The review-queue entry for the affected case (Req 15.3), when known. */
  readonly reviewQueueEntry: ReviewQueueEntry | null;
  /** True when any of classification, evidence, or outcome changed. */
  readonly changed: boolean;
}

/** Locale-independent string comparison for stable, reproducible ordering. */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Sorted, de-duplicated copy of an identifier list. */
function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort(compareStrings);
}

/** Compute the before/after change of an evidence-reference set. */
function diffEvidence(
  before: readonly string[],
  after: readonly string[]
): EvidenceChange {
  const beforeSorted = sortedUnique(before);
  const afterSorted = sortedUnique(after);
  const beforeSet = new Set(beforeSorted);
  const afterSet = new Set(afterSorted);

  const added = afterSorted.filter((ref) => !beforeSet.has(ref));
  const removed = beforeSorted.filter((ref) => !afterSet.has(ref));

  return {
    before: beforeSorted,
    after: afterSorted,
    added,
    removed,
    changed: added.length > 0 || removed.length > 0
  };
}

/** Compute the before/after change of a scalar field. */
function diffScalar(before: string, after: string): ScalarChange {
  return { before, after, changed: before !== after };
}

/** Optional triggering context linking a comparison back to its candidate. */
export interface BeforeAfterContext {
  /** The Reanalysis_Candidate that triggered the run (Req 15.2, 15.8). */
  readonly candidate?: ReanalysisCandidate;
}

/**
 * Build the before/after comparison view for a completed reanalysis run
 * (Req 15.6). Pure and deterministic: for fixed before/after states and
 * triggering context the output is byte-for-byte identical, and neither input
 * state is mutated.
 *
 * The `before` and `after` states must describe the same case; a mismatch is a
 * programming error and throws so it surfaces immediately in tests and callers.
 * When a triggering `candidate` is supplied, its matched relevance, id, linked
 * Knowledge_Update, and derived review-queue entry are attached so the inbox can
 * explain why the case was re-surfaced.
 */
export function buildBeforeAfterComparison(
  before: CaseSnapshotState,
  after: CaseSnapshotState,
  context: BeforeAfterContext = {}
): BeforeAfterComparison {
  if (before.caseId !== after.caseId) {
    throw new Error(
      `Cannot compare states for different cases: "${before.caseId}" vs "${after.caseId}".`
    );
  }

  const classification = diffScalar(before.classification, after.classification);
  const evidence = diffEvidence(before.evidenceRefs, after.evidenceRefs);
  const outcome = diffScalar(before.outcome, after.outcome);

  const candidate = context.candidate ?? null;

  return {
    caseId: before.caseId,
    classification,
    evidence,
    outcome,
    matchedRelevance: candidate ? candidate.relevance : null,
    candidateId: candidate ? candidate.id : null,
    knowledgeUpdateId: candidate ? candidate.knowledgeUpdateId : null,
    reviewQueueEntry: candidate ? reviewQueueEntryOf(candidate) : null,
    changed: classification.changed || evidence.changed || outcome.changed
  };
}
