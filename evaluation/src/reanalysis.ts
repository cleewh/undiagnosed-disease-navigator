// evaluation/src/reanalysis.ts
//
// Reanalysis-matching scoring (Requirement 30.3).
//
// Computes retrieval correctness, false-positive rate, explanation
// completeness, evidence linkage, and ranking-change accuracy, each in
// [0.0, 1.0], by comparing submitted reanalysis matches to Ground_Truth
// expectations. Malformed submissions are excluded (Req 30.7).

import type { GroundTruthReader } from "./ground-truth.js";
import { ExclusionLog, partitionEntries } from "./exclusion.js";
import { ratio } from "./metrics.js";

/** A submitted reanalysis-candidate decision for one (case, update) pair. */
export interface ReanalysisSubmission {
  caseId: string;
  /** The Knowledge_Update that triggered the evaluation. */
  updateId: string;
  /** Whether the system produced a Reanalysis_Candidate for this pair. */
  matched: boolean;
  /**
   * Whether the candidate records the specific matched relevance (which
   * variant/gene/phenotype), for explanation completeness (Req 15.2, 30.3).
   */
  explanationComplete: boolean;
  /**
   * Whether the candidate is linked back to the triggering Knowledge_Update,
   * for evidence linkage (Req 15.8, 30.3).
   */
  linkedToTrigger: boolean;
  /**
   * Whether the reported ranking change (before/after) is correct relative to
   * the expected change, for ranking-change accuracy (Req 15.6, 30.3).
   */
  rankingChangeCorrect: boolean;
}

/** Reanalysis-matching metrics, each in [0.0, 1.0] (Req 30.3). */
export interface ReanalysisMetrics {
  /** Recall of the expected matches (true positives / expected positives). */
  retrievalCorrectness: number;
  /** False positives / total predicted negatives-or-positives that are wrong. */
  falsePositiveRate: number;
  explanationCompleteness: number;
  evidenceLinkage: number;
  rankingChangeAccuracy: number;
}

function isSubmission(value: ReanalysisSubmission): boolean {
  return (
    typeof value.caseId === "string" &&
    value.caseId.length > 0 &&
    typeof value.updateId === "string" &&
    value.updateId.length > 0 &&
    typeof value.matched === "boolean"
  );
}

/** Look up the expected match decision for a (case, update) pair. */
function expectedMatch(
  groundTruth: GroundTruthReader,
  caseId: string,
  updateId: string
): boolean | undefined {
  const truth = groundTruth.read(caseId);
  if (truth === undefined) {
    return undefined;
  }
  const expectations = truth.expectedReanalysisMatches;
  if (expectations === undefined) {
    return undefined;
  }
  return expectations[updateId];
}

/**
 * Score reanalysis-matching submissions against Ground_Truth. Submissions that
 * are malformed, lack Ground_Truth, or have no expected match decision for the
 * given update are excluded and recorded (Req 30.7); the rest are scored
 * (Req 30.3).
 */
export function scoreReanalysisMatching(
  submissions: readonly ReanalysisSubmission[],
  groundTruth: GroundTruthReader,
  log: ExclusionLog
): ReanalysisMetrics {
  const scored = partitionEntries(
    submissions,
    "reanalysis-matching",
    log,
    (submission) => {
      if (!isSubmission(submission)) {
        return {
          reason: "malformed-output",
          caseId:
            typeof submission?.caseId === "string"
              ? submission.caseId
              : undefined,
          detail: "reanalysis submission is missing required fields"
        };
      }
      const truth = groundTruth.read(submission.caseId);
      if (truth === undefined) {
        return {
          reason: "missing-ground-truth",
          caseId: submission.caseId,
          detail: `no Ground_Truth for case ${submission.caseId}`
        };
      }
      if (
        expectedMatch(groundTruth, submission.caseId, submission.updateId) ===
        undefined
      ) {
        return {
          reason: "unmatched-ground-truth",
          caseId: submission.caseId,
          detail: `no expected match for case ${submission.caseId} and update ${submission.updateId}`
        };
      }
      return undefined;
    }
  );

  let truePositives = 0;
  let falseNegatives = 0;
  let falsePositives = 0;
  let expectedPositives = 0;
  let predictedPositives = 0;
  let explanationComplete = 0;
  let linked = 0;
  let rankingCorrect = 0;

  for (const submission of scored) {
    const expected = expectedMatch(
      groundTruth,
      submission.caseId,
      submission.updateId
    );
    if (expected === undefined) {
      continue;
    }

    if (expected) {
      expectedPositives += 1;
      if (submission.matched) {
        truePositives += 1;
      } else {
        falseNegatives += 1;
      }
    } else if (submission.matched) {
      falsePositives += 1;
    }

    if (submission.matched) {
      predictedPositives += 1;
      if (submission.explanationComplete) {
        explanationComplete += 1;
      }
      if (submission.linkedToTrigger) {
        linked += 1;
      }
      if (submission.rankingChangeCorrect) {
        rankingCorrect += 1;
      }
    }
  }

  return {
    retrievalCorrectness: ratio(truePositives, expectedPositives),
    falsePositiveRate: ratio(
      falsePositives,
      falsePositives + truePositives + falseNegatives
    ),
    explanationCompleteness: ratio(explanationComplete, predictedPositives),
    evidenceLinkage: ratio(linked, predictedPositives),
    rankingChangeAccuracy: ratio(rankingCorrect, predictedPositives)
  };
}
