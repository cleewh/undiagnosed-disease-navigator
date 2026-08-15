// evaluation/src/phenotype.ts
//
// Phenotype-extraction scoring (Requirement 30.1).
//
// Computes precision, recall, F1, assertion accuracy, onset accuracy,
// HPO-mapping accuracy, and unsupported-term rate, each in [0.0, 1.0], by
// comparing submitted phenotype-extraction output to Ground_Truth. Malformed
// submissions are excluded and recorded (Req 30.7).

import type { GroundTruthReader, GroundTruthPhenotype } from "./ground-truth.js";
import { ExclusionLog, partitionEntries } from "./exclusion.js";
import { clampMetric, f1Score, ratio } from "./metrics.js";

/** One extracted phenotype term in a submission. */
export interface SubmittedPhenotype {
  /** The HPO (or synthetic HPO-like) identifier the system produced. */
  hpoId: string;
  /** The assertion polarity the system assigned. */
  assertion: "present" | "absent" | "uncertain" | "historical";
  /** The onset descriptor the system assigned, if any. */
  onset?: string;
  /**
   * Whether the system marked this term as a resolvable/valid HPO mapping.
   * An unresolved term counts against HPO-mapping accuracy (Req 5.7, 30.1).
   */
  resolved: boolean;
}

/** A submitted phenotype-extraction result for one case (Req 30.1). */
export interface PhenotypeSubmission {
  caseId: string;
  phenotypes: SubmittedPhenotype[];
}

/** Phenotype-extraction metrics, each in [0.0, 1.0] (Req 30.1). */
export interface PhenotypeMetrics {
  precision: number;
  recall: number;
  f1: number;
  assertionAccuracy: number;
  onsetAccuracy: number;
  hpoMappingAccuracy: number;
  unsupportedTermRate: number;
}

/** Aggregated counters used to derive the per-corpus metrics. */
interface PhenotypeCounters {
  predicted: number;
  expected: number;
  truePositives: number;
  assertionMatches: number;
  onsetComparable: number;
  onsetMatches: number;
  resolvedPredicted: number;
  unsupportedPredicted: number;
}

function emptyCounters(): PhenotypeCounters {
  return {
    predicted: 0,
    expected: 0,
    truePositives: 0,
    assertionMatches: 0,
    onsetComparable: 0,
    onsetMatches: 0,
    resolvedPredicted: 0,
    unsupportedPredicted: 0
  };
}

function isSubmission(value: PhenotypeSubmission): boolean {
  return (
    typeof value.caseId === "string" &&
    value.caseId.length > 0 &&
    Array.isArray(value.phenotypes)
  );
}

function indexExpected(
  expected: readonly GroundTruthPhenotype[]
): Map<string, GroundTruthPhenotype> {
  const byId = new Map<string, GroundTruthPhenotype>();
  for (const term of expected) {
    byId.set(term.hpoId, term);
  }
  return byId;
}

function accumulate(
  counters: PhenotypeCounters,
  submission: PhenotypeSubmission,
  expected: readonly GroundTruthPhenotype[]
): void {
  const expectedById = indexExpected(expected);
  counters.expected += expectedById.size;

  const seen = new Set<string>();
  for (const predicted of submission.phenotypes) {
    counters.predicted += 1;
    if (predicted.resolved) {
      counters.resolvedPredicted += 1;
    }

    const match = expectedById.get(predicted.hpoId);
    if (match === undefined) {
      counters.unsupportedPredicted += 1;
      continue;
    }

    // Count each expected term at most once as a true positive.
    if (!seen.has(predicted.hpoId)) {
      seen.add(predicted.hpoId);
      counters.truePositives += 1;
      if (predicted.assertion === match.assertion) {
        counters.assertionMatches += 1;
      }
      if (match.onset !== undefined) {
        counters.onsetComparable += 1;
        if (predicted.onset === match.onset) {
          counters.onsetMatches += 1;
        }
      }
    }
  }
}

function deriveMetrics(counters: PhenotypeCounters): PhenotypeMetrics {
  const precision = ratio(counters.truePositives, counters.predicted);
  const recall = ratio(counters.truePositives, counters.expected);
  return {
    precision,
    recall,
    f1: f1Score(precision, recall),
    assertionAccuracy: ratio(counters.assertionMatches, counters.truePositives),
    onsetAccuracy: ratio(counters.onsetMatches, counters.onsetComparable),
    hpoMappingAccuracy: ratio(counters.resolvedPredicted, counters.predicted),
    unsupportedTermRate: clampMetric(
      ratio(counters.unsupportedPredicted, counters.predicted)
    )
  };
}

/**
 * Score phenotype-extraction submissions against Ground_Truth. Submissions that
 * are malformed, or that have no matching Ground_Truth entry, are excluded and
 * recorded on `log` (Req 30.7); the remaining submissions are scored (Req 30.1).
 */
export function scorePhenotypeExtraction(
  submissions: readonly PhenotypeSubmission[],
  groundTruth: GroundTruthReader,
  log: ExclusionLog
): PhenotypeMetrics {
  const scored = partitionEntries(
    submissions,
    "phenotype-extraction",
    log,
    (submission) => {
      if (!isSubmission(submission)) {
        return {
          reason: "malformed-output",
          caseId:
            typeof submission?.caseId === "string"
              ? submission.caseId
              : undefined,
          detail: "phenotype submission is missing a caseId or phenotype list"
        };
      }
      if (groundTruth.read(submission.caseId) === undefined) {
        return {
          reason: "missing-ground-truth",
          caseId: submission.caseId,
          detail: `no Ground_Truth for case ${submission.caseId}`
        };
      }
      return undefined;
    }
  );

  const counters = emptyCounters();
  for (const submission of scored) {
    const truth = groundTruth.read(submission.caseId);
    if (truth === undefined) {
      continue;
    }
    accumulate(counters, submission, truth.expectedPhenotypes);
  }
  return deriveMetrics(counters);
}
