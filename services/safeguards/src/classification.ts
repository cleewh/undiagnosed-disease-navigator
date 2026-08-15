// services/safeguards/src/classification.ts
//
// Research vs clinical classification separation (task 29.1, Requirement 25.5).
//
// Requirement 25.5: every case record and interface view carries exactly one of
// a research or a clinical classification, and records classified as research
// are never combined with records classified as clinical.
//
// This mirrors the pattern in apps/web/src/classification.ts but is implemented
// independently here (no import from apps/web). The classification values are
// derived from the shared domain `AccessClassification` set, excluding
// `ground_truth` — Ground_Truth is never an interactive case/view classification
// (it is accessible only to the Evaluation_Framework), so the case-facing set is
// exactly {research, clinical}.

import type { AccessClassification } from "@udn/domain";
import { fail, SafeguardViolationError, type GuardResult } from "./errors.js";

/**
 * The case-facing classification set (Req 25.5): the shared domain
 * {@link AccessClassification} values minus `ground_truth`.
 */
export type CaseClassification = Exclude<AccessClassification, "ground_truth">;

/** The complete, ordered set of case-facing classification values. */
export const CASE_CLASSIFICATIONS: readonly CaseClassification[] = ["research", "clinical"];

/** Type guard: `true` iff `value` is a defined case classification. */
export function isValidClassification(value: string): value is CaseClassification {
  return (CASE_CLASSIFICATIONS as readonly string[]).includes(value);
}

/**
 * `true` iff every classification in the collection is identical (an empty
 * collection is trivially consistent). A mixed research/clinical collection is
 * inconsistent (Req 25.5).
 */
export function isConsistentClassification(
  values: readonly CaseClassification[]
): boolean {
  if (values.length === 0) {
    return true;
  }
  const first = values[0];
  return values.every((value) => value === first);
}

/** A combination of records shares a single classification. */
export interface ClassificationAllowed {
  /** The single classification shared by all records, or `undefined` when empty. */
  readonly classification: CaseClassification | undefined;
}

/** Result of {@link guardClassificationCombination}. */
export type ClassificationResult = GuardResult<ClassificationAllowed>;

/**
 * Guard against combining research and clinical records (Req 25.5).
 *
 *   * All values invalid-free and identical (or empty) — allowed; the shared
 *     classification is returned.
 *   * Any value outside the defined set — blocked with `invalid_classification`.
 *   * A mix of research and clinical — blocked with `mixed_classification`.
 *
 * Pure and deterministic: the input is never mutated.
 */
export function guardClassificationCombination(
  values: readonly CaseClassification[]
): ClassificationResult {
  for (const value of values) {
    if (!isValidClassification(value)) {
      return fail(
        "invalid_classification",
        `Classification "${String(value)}" is not one of the defined values: ${CASE_CLASSIFICATIONS.join(", ")}.`
      );
    }
  }

  if (!isConsistentClassification(values)) {
    return fail(
      "mixed_classification",
      "Records classified as research cannot be combined with records classified as clinical."
    );
  }

  return { ok: true, classification: values.length === 0 ? undefined : values[0] };
}

/** Thrown by {@link assertSingleClassification} when classifications are mixed. */
export class MixedClassificationError extends SafeguardViolationError {
  constructor() {
    super(
      "mixed_classification",
      "Records classified as research cannot be combined with records classified as clinical."
    );
    this.name = "MixedClassificationError";
  }
}

/**
 * Throwing variant that guards against combining research and clinical records
 * (Req 25.5), mirroring apps/web. Returns the single shared classification
 * (`undefined` for an empty collection); throws {@link MixedClassificationError}
 * when both classifications are present.
 */
export function assertSingleClassification(
  values: readonly CaseClassification[]
): CaseClassification | undefined {
  if (!isConsistentClassification(values)) {
    throw new MixedClassificationError();
  }
  return values.length === 0 ? undefined : values[0];
}
