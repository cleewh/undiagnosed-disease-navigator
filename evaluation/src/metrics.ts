// evaluation/src/metrics.ts
//
// Shared metric helpers for the Evaluation_Framework.
//
// Every ratio-style metric defined by Requirement 30 is a value in the closed
// range [0.0, 1.0]. These helpers guarantee that invariant deterministically:
// divisions guard against a zero denominator, and results are clamped into
// range so a computed metric can never fall outside its defined bounds
// (Requirements 30.1, 30.2, 30.3, 30.4).

/** Inclusive lower bound of every ratio metric. */
export const METRIC_MIN = 0.0;
/** Inclusive upper bound of every ratio metric. */
export const METRIC_MAX = 1.0;

/** A rank is a 1-based positive integer, or the not-ranked sentinel (Req 30.2). */
export const NOT_RANKED = "not-ranked" as const;

/** A ranking result: a 1-based position, or the not-ranked indicator. */
export type Rank = number | typeof NOT_RANKED;

/** Is `value` a valid metric value within the closed range [0.0, 1.0]? */
export function isInMetricRange(value: number): boolean {
  return Number.isFinite(value) && value >= METRIC_MIN && value <= METRIC_MAX;
}

/** Clamp `value` into the closed metric range [0.0, 1.0]. */
export function clampMetric(value: number): number {
  if (!Number.isFinite(value)) {
    return METRIC_MIN;
  }
  if (value < METRIC_MIN) {
    return METRIC_MIN;
  }
  if (value > METRIC_MAX) {
    return METRIC_MAX;
  }
  return value;
}

/**
 * Deterministic ratio in [0.0, 1.0]. A zero (or negative) denominator yields
 * 0.0 rather than NaN/Infinity, keeping every metric in range by construction.
 */
export function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return METRIC_MIN;
  }
  return clampMetric(numerator / denominator);
}

/** Harmonic mean of precision and recall (F1), clamped into range. */
export function f1Score(precision: number, recall: number): number {
  const p = clampMetric(precision);
  const r = clampMetric(recall);
  if (p + r <= 0) {
    return METRIC_MIN;
  }
  return clampMetric((2 * p * r) / (p + r));
}

/** Is `value` a valid rank: a positive integer, or the not-ranked sentinel? */
export function isValidRank(value: Rank): boolean {
  if (value === NOT_RANKED) {
    return true;
  }
  return Number.isInteger(value) && value >= 1;
}

/**
 * Compute the 1-based rank of `target` within `ranked`, or {@link NOT_RANKED}
 * when it is absent. Comparison is by exact identifier equality.
 */
export function rankOf(ranked: readonly string[], target: string): Rank {
  const index = ranked.indexOf(target);
  return index < 0 ? NOT_RANKED : index + 1;
}

/**
 * Top-N recall for a single target: 1.0 when `target` appears within the first
 * `n` positions of `ranked`, otherwise 0.0.
 */
export function topNRecall(
  ranked: readonly string[],
  target: string,
  n: number
): number {
  const rank = rankOf(ranked, target);
  if (rank === NOT_RANKED) {
    return METRIC_MIN;
  }
  return rank <= n ? METRIC_MAX : METRIC_MIN;
}
