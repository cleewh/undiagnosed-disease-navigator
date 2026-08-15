// services/safeguards/src/uncertainty.ts
//
// Uncertainty indicator for AI-derived output (task 29.1, Requirement 25.6).
//
// Requirement 25.6: when the Navigator presents AI-generated output, it
// displays an uncertainty indicator conveying a confidence level on a defined
// scale of at least three ordered levels adjacent to that output.
//
// This module provides the deterministic scale (three ordered levels), a
// deterministic mapping from a confidence value in [0, 1] to a level, and a
// guard that verifies a presented AI output carries a valid indicator.

import { fail, SafeguardViolationError, type GuardResult } from "./errors.js";

/**
 * The defined uncertainty scale (Req 25.6): at least three ordered confidence
 * levels, ascending from lowest to highest confidence.
 */
export const UNCERTAINTY_LEVELS = ["low", "moderate", "high"] as const;

/** A single level on the {@link UNCERTAINTY_LEVELS} scale. */
export type UncertaintyLevel = (typeof UNCERTAINTY_LEVELS)[number];

/** The number of ordered levels on the scale (guaranteed >= 3 by Req 25.6). */
export const UNCERTAINTY_SCALE_SIZE = UNCERTAINTY_LEVELS.length;

/** An uncertainty indicator displayed adjacent to an AI-generated output. */
export interface UncertaintyIndicator {
  /** The confidence level on the defined scale. */
  readonly level: UncertaintyLevel;
  /** 1-based rank of the level within the scale (1 = lowest confidence). */
  readonly rank: number;
  /** Total number of ordered levels on the scale (always >= 3). */
  readonly scaleSize: number;
}

/** `true` iff `confidence` is a finite number within the inclusive range [0, 1]. */
export function isValidConfidence(confidence: number): boolean {
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}

/** The 1-based rank of a level within {@link UNCERTAINTY_LEVELS}. */
export function rankOfLevel(level: UncertaintyLevel): number {
  return UNCERTAINTY_LEVELS.indexOf(level) + 1;
}

/**
 * Map a confidence value in [0, 1] deterministically to an uncertainty level.
 *
 * The unit interval is split into three equal, ordered bands:
 *   * `[0, 1/3)`   -> "low"
 *   * `[1/3, 2/3)` -> "moderate"
 *   * `[2/3, 1]`   -> "high"
 *
 * Throws {@link SafeguardViolationError} (`invalid_confidence`) when the value is
 * outside the inclusive [0, 1] range.
 */
export function levelFromConfidence(confidence: number): UncertaintyLevel {
  if (!isValidConfidence(confidence)) {
    throw new SafeguardViolationError(
      "invalid_confidence",
      `Confidence "${String(confidence)}" is outside the inclusive range [0, 1].`
    );
  }
  if (confidence < 1 / 3) {
    return "low";
  }
  if (confidence < 2 / 3) {
    return "moderate";
  }
  return "high";
}

/** Build the {@link UncertaintyIndicator} for a given level. */
export function indicatorForLevel(level: UncertaintyLevel): UncertaintyIndicator {
  return {
    level,
    rank: rankOfLevel(level),
    scaleSize: UNCERTAINTY_SCALE_SIZE
  };
}

/** An AI-generated output paired with the uncertainty indicator to display beside it. */
export interface AnnotatedOutput<T> {
  readonly output: T;
  readonly indicator: UncertaintyIndicator;
}

/** Result of {@link attachUncertaintyIndicator}. */
export type AttachIndicatorResult<T> = GuardResult<AnnotatedOutput<T>>;

/**
 * Attach an uncertainty indicator to an AI-generated output, derived from its
 * confidence value (Req 25.6). Returns the output paired with the indicator on
 * success; blocks with `invalid_confidence` when the confidence is out of range.
 * The input output value is never mutated.
 */
export function attachUncertaintyIndicator<T>(
  output: T,
  confidence: number
): AttachIndicatorResult<T> {
  if (!isValidConfidence(confidence)) {
    return fail(
      "invalid_confidence",
      `Confidence "${String(confidence)}" is outside the inclusive range [0, 1].`
    );
  }
  return { ok: true, output, indicator: indicatorForLevel(levelFromConfidence(confidence)) };
}

/**
 * `true` iff `indicator` is a valid multi-level uncertainty indicator: its level
 * is on the defined scale, its scale has at least three ordered levels, and its
 * rank is consistent with that level (Req 25.6).
 */
export function hasValidUncertaintyIndicator(indicator: UncertaintyIndicator): boolean {
  return (
    (UNCERTAINTY_LEVELS as readonly string[]).includes(indicator.level) &&
    indicator.scaleSize >= 3 &&
    indicator.scaleSize === UNCERTAINTY_SCALE_SIZE &&
    indicator.rank === rankOfLevel(indicator.level)
  );
}
