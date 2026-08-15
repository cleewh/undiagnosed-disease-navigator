// evaluation/src/prioritisation.ts
//
// Variant-prioritisation scoring (Requirement 30.2).
//
// For each submitted ranking, computes the causal-variant rank and causal-gene
// rank (a 1-based positive integer or the not-ranked indicator), and aggregates
// top-5 recall, top-10 recall, and inheritance-filter accuracy (each in
// [0.0, 1.0]) across the scored corpus. Malformed submissions are excluded
// (Req 30.7).

import type { InheritanceModel } from "@udn/domain";
import type { GroundTruthReader } from "./ground-truth.js";
import { ExclusionLog, partitionEntries } from "./exclusion.js";
import { type Rank, ratio, rankOf, topNRecall } from "./metrics.js";

/** A submitted variant/gene ranking for one case (Req 30.2). */
export interface PrioritisationSubmission {
  caseId: string;
  /** Ranked variant identifiers, best first. */
  rankedVariantIds: string[];
  /** Ranked gene symbols, best first. */
  rankedGenes: string[];
  /**
   * The inheritance model the prioritisation applied when filtering. Compared
   * against the Ground_Truth causal finding's inheritance model.
   */
  appliedInheritanceModel?: InheritanceModel;
}

/** Per-case ranking result (Req 30.2). */
export interface CaseRankResult {
  caseId: string;
  causalVariantRank: Rank;
  causalGeneRank: Rank;
}

/** Variant-prioritisation metrics (Req 30.2). */
export interface PrioritisationMetrics {
  /** Per-case causal-variant and causal-gene ranks. */
  perCase: CaseRankResult[];
  top5Recall: number;
  top10Recall: number;
  inheritanceFilterAccuracy: number;
}

function isSubmission(value: PrioritisationSubmission): boolean {
  return (
    typeof value.caseId === "string" &&
    value.caseId.length > 0 &&
    Array.isArray(value.rankedVariantIds) &&
    Array.isArray(value.rankedGenes)
  );
}

/**
 * Score variant-prioritisation submissions against Ground_Truth. Submissions
 * whose Ground_Truth carries no causal finding (unsolved/non-genetic) cannot be
 * matched and are excluded from ranking metrics with a recorded reason
 * (Req 30.7); the rest are scored (Req 30.2).
 */
export function scoreVariantPrioritisation(
  submissions: readonly PrioritisationSubmission[],
  groundTruth: GroundTruthReader,
  log: ExclusionLog
): PrioritisationMetrics {
  const scored = partitionEntries(
    submissions,
    "variant-prioritisation",
    log,
    (submission) => {
      if (!isSubmission(submission)) {
        return {
          reason: "malformed-output",
          caseId:
            typeof submission?.caseId === "string"
              ? submission.caseId
              : undefined,
          detail: "prioritisation submission is missing required ranking arrays"
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
      if (truth.causalFindings.length === 0) {
        return {
          reason: "unmatched-ground-truth",
          caseId: submission.caseId,
          detail: `case ${submission.caseId} has no causal finding to rank against`
        };
      }
      return undefined;
    }
  );

  const perCase: CaseRankResult[] = [];
  let top5Sum = 0;
  let top10Sum = 0;
  let variantTargets = 0;
  let inheritanceMatches = 0;
  let inheritanceComparable = 0;

  for (const submission of scored) {
    const truth = groundTruth.read(submission.caseId);
    if (truth === undefined) {
      continue;
    }
    const primary = truth.causalFindings[0];
    if (primary === undefined) {
      continue;
    }

    const causalVariantRank = rankOf(
      submission.rankedVariantIds,
      primary.variantId
    );
    const causalGeneRank = rankOf(submission.rankedGenes, primary.gene);
    perCase.push({
      caseId: submission.caseId,
      causalVariantRank,
      causalGeneRank
    });

    variantTargets += 1;
    top5Sum += topNRecall(submission.rankedVariantIds, primary.variantId, 5);
    top10Sum += topNRecall(submission.rankedVariantIds, primary.variantId, 10);

    if (submission.appliedInheritanceModel !== undefined) {
      inheritanceComparable += 1;
      if (submission.appliedInheritanceModel === primary.inheritanceModel) {
        inheritanceMatches += 1;
      }
    }
  }

  return {
    perCase,
    top5Recall: ratio(top5Sum, variantTargets),
    top10Recall: ratio(top10Sum, variantTargets),
    inheritanceFilterAccuracy: ratio(inheritanceMatches, inheritanceComparable)
  };
}
