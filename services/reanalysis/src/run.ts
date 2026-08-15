// services/reanalysis/src/run.ts
//
// Reanalysis run execution with the approval gate, retry-bounded failure
// handling, and the before/after view (Reanalysis_Service, task 27.1,
// Requirements 15.4, 15.5, 15.6, 15.7).
//
// A reanalysis run proceeds ONLY after an explicit human approval has been
// recorded on the candidate (Req 15.4; the approval itself is captured by
// approval.ts). The run body is supplied by the caller as a thunk producing the
// AFTER state; it is executed under bounded retry (up to 3 attempts) to absorb
// transient failure (Req 15.5). On success the pre- and post-run states are
// compared into a before/after view (Req 15.6). If every attempt fails, the
// pre-reanalysis state is preserved unchanged and an error indication naming the
// case and its triggering Knowledge_Update is produced (Req 15.7).
//
// This module is pure with respect to its inputs (aside from invoking the
// caller-supplied run thunk): it performs no I/O and calls no generative model.

import type { ReanalysisCandidate } from "@udn/domain";
import { isReanalysisApproved } from "./approval.js";
import {
  buildBeforeAfterComparison,
  type BeforeAfterComparison,
  type CaseSnapshotState
} from "./before-after.js";
import { attemptWithRetry, MAX_REANALYSIS_ATTEMPTS } from "./retry.js";

/** Input for executing an approved reanalysis run for a candidate. */
export interface RunReanalysisInput {
  /** The triggering candidate; MUST carry a recorded approval (Req 15.4). */
  readonly candidate: ReanalysisCandidate;
  /** The pre-reanalysis case state, preserved on failure (Req 15.7). */
  readonly before: CaseSnapshotState;
  /**
   * The run body producing the post-reanalysis case state. May throw on a
   * transient failure; it is retried up to `maxAttempts` times (Req 15.5). It
   * MUST NOT mutate `before`.
   */
  readonly execute: () => CaseSnapshotState;
  /** Maximum run attempts before the run is abandoned (Req 15.5). Defaults to 3. */
  readonly maxAttempts?: number;
}

/** Successful run: the before/after comparison view (Req 15.6). */
export interface RunReanalysisSuccess {
  readonly status: "completed";
  /** How many run attempts were made (1..maxAttempts). */
  readonly attempts: number;
  /** The pre-reanalysis state. */
  readonly before: CaseSnapshotState;
  /** The post-reanalysis state. */
  readonly after: CaseSnapshotState;
  /** The before/after comparison presented on success (Req 15.6). */
  readonly comparison: BeforeAfterComparison;
}

/** The run was rejected because the approval gate was not satisfied (Req 15.4). */
export interface RunReanalysisNotApproved {
  readonly status: "not_approved";
  /** The pre-reanalysis state, unchanged. */
  readonly before: CaseSnapshotState;
  readonly error: {
    readonly code: "not_approved";
    readonly message: string;
    readonly caseId: string;
    readonly candidateId: string;
  };
}

/** The run failed after exhausting retries; prior state is preserved (Req 15.7). */
export interface RunReanalysisFailed {
  readonly status: "failed";
  /** How many run attempts were made (equals maxAttempts). */
  readonly attempts: number;
  /** The pre-reanalysis state, preserved unchanged (Req 15.7). */
  readonly before: CaseSnapshotState;
  readonly error: {
    readonly code: "run_incomplete";
    readonly message: string;
    readonly caseId: string;
    readonly candidateId: string;
    readonly knowledgeUpdateId: string;
  };
}

/** Result of {@link runReanalysis}. */
export type RunReanalysisResult =
  | RunReanalysisSuccess
  | RunReanalysisNotApproved
  | RunReanalysisFailed;

/**
 * Execute an approved reanalysis run for a candidate (Req 15.4, 15.5, 15.6,
 * 15.7).
 *
 *   * **Gate** — if the candidate carries no recorded approval, the run is
 *     rejected with a `not_approved` error and the pre-reanalysis state is
 *     returned unchanged (Req 15.4).
 *   * **Retry** — the `execute` thunk is invoked under bounded retry (up to
 *     `maxAttempts`, default 3) to absorb transient failure (Req 15.5).
 *   * **Success** — the pre- and post-run states are compared into a
 *     before/after view, attaching the triggering candidate's relevance, id,
 *     linked Knowledge_Update, and review-queue entry (Req 15.6).
 *   * **Failure** — if every attempt throws, the pre-reanalysis state is
 *     preserved unchanged and a `run_incomplete` error naming the case and its
 *     triggering Knowledge_Update is produced (Req 15.7).
 */
export function runReanalysis(input: RunReanalysisInput): RunReanalysisResult {
  const { candidate, before, execute } = input;
  const maxAttempts = input.maxAttempts ?? MAX_REANALYSIS_ATTEMPTS;

  if (!isReanalysisApproved(candidate)) {
    return {
      status: "not_approved",
      before,
      error: {
        code: "not_approved",
        caseId: before.caseId,
        candidateId: candidate.id,
        message: `Reanalysis run for candidate "${candidate.id}" cannot start: no recorded human approval (Req 15.4).`
      }
    };
  }

  const outcome = attemptWithRetry(execute, maxAttempts);

  if (!outcome.ok) {
    return {
      status: "failed",
      attempts: outcome.attempts,
      before,
      error: {
        code: "run_incomplete",
        caseId: before.caseId,
        candidateId: candidate.id,
        knowledgeUpdateId: candidate.knowledgeUpdateId,
        message: `Reanalysis run for case "${before.caseId}" (candidate "${candidate.id}", update "${candidate.knowledgeUpdateId}") did not complete after ${outcome.attempts} attempt(s); the pre-reanalysis state is preserved.`
      }
    };
  }

  const after = outcome.value;
  const comparison = buildBeforeAfterComparison(before, after, { candidate });

  return {
    status: "completed",
    attempts: outcome.attempts,
    before,
    after,
    comparison
  };
}
