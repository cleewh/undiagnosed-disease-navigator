// evaluation/src/exclusion.ts
//
// Malformed-entry exclusion for the Evaluation_Framework (Requirement 30.7).
//
// If submitted output is missing, malformed, or cannot be matched to a
// Ground_Truth entry, the framework excludes it from the affected metric,
// records the exclusion with a reason, and continues scoring the remaining
// output. A malformed entry is NEVER scored and NEVER counted as a complete
// submission.

/** The metric family an exclusion applies to. */
export type MetricFamily =
  | "phenotype-extraction"
  | "variant-prioritisation"
  | "reanalysis-matching"
  | "ai-grounding";

/** Why a submitted entry was excluded from scoring. */
export type ExclusionReason =
  | "missing-output"
  | "malformed-output"
  | "missing-ground-truth"
  | "unmatched-ground-truth";

/** A single recorded exclusion (Req 30.7). */
export interface Exclusion {
  /** The metric family the excluded entry would have contributed to. */
  metricFamily: MetricFamily;
  /** The case identifier of the excluded entry, when known. */
  caseId: string | undefined;
  /** The machine-readable exclusion reason. */
  reason: ExclusionReason;
  /** A human-readable description of the exclusion. */
  detail: string;
}

/**
 * Accumulates exclusions during a scoring pass so the final report can list
 * every excluded entry with its reason (Req 30.7, 30.8).
 */
export class ExclusionLog {
  private readonly entries: Exclusion[] = [];

  /** Record an exclusion with its reason. */
  record(exclusion: Exclusion): void {
    this.entries.push(exclusion);
  }

  /** All recorded exclusions, in the order they occurred. */
  all(): readonly Exclusion[] {
    return this.entries;
  }

  /** Count of exclusions for a given metric family. */
  countFor(family: MetricFamily): number {
    return this.entries.filter((e) => e.metricFamily === family).length;
  }

  /** Total number of recorded exclusions. */
  get size(): number {
    return this.entries.length;
  }
}

/**
 * Partition submitted entries into `scored` (structurally sound) and excluded
 * (recorded on `log`). `validate` returns `undefined` when the entry is sound,
 * or an {@link ExclusionReason} describing why it must be excluded. This is the
 * single choke point ensuring malformed entries are skipped, never scored, and
 * never counted as complete (Req 30.7).
 */
export function partitionEntries<T>(
  entries: readonly T[],
  metricFamily: MetricFamily,
  log: ExclusionLog,
  validate: (entry: T) => {
    reason: ExclusionReason;
    caseId: string | undefined;
    detail: string;
  } | undefined
): T[] {
  const scored: T[] = [];
  for (const entry of entries) {
    const problem = validate(entry);
    if (problem === undefined) {
      scored.push(entry);
      continue;
    }
    log.record({
      metricFamily,
      caseId: problem.caseId,
      reason: problem.reason,
      detail: problem.detail
    });
  }
  return scored;
}
