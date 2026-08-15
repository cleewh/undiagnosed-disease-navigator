// services/evidence-gap/src/config.ts
//
// Validation of submitted gap-rule configurations (Gap_Service, task 16.1).
//
// A valid configuration is applied to subsequent evaluations (Req 8.6); an
// invalid configuration is rejected and its validation failures are identified
// so the caller can retain the previously active rule set (Req 8.7). Validation
// is pure and deterministic: the same submitted configuration always yields the
// same result.

import {
  GAP_CATEGORIES,
  type GapRule,
  type GapRuleConfig
} from "./rules.js";

/**
 * Terms that would frame a gap as a statement of medical necessity rather than
 * a review item. Rule wording containing any of these is rejected at
 * configuration time, reinforcing Req 8.3 (never framed as medical necessity).
 * Matched case-insensitively as whole phrases.
 */
export const PROHIBITED_NECESSITY_TERMS: readonly string[] = [
  "medically necessary",
  "medical necessity",
  "must be performed",
  "must be ordered",
  "is required",
  "clinically mandated",
  "you should diagnose",
  "diagnose the patient"
];

/** The outcome of validating a submitted gap-rule configuration. */
export interface ConfigValidationResult {
  /** Whether the submitted configuration is valid. */
  valid: boolean;
  /**
   * Identified validation failures (Req 8.7). Empty when `valid` is true.
   * Each entry names the offending rule (by index/id) and the problem.
   */
  failures: string[];
  /** Human-readable indication of the validation outcome. */
  indication: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Return the prohibited term found in `text`, or `undefined` if none. */
function findProhibitedTerm(text: string): string | undefined {
  const haystack = text.toLowerCase();
  return PROHIBITED_NECESSITY_TERMS.find((term) => haystack.includes(term));
}

/** Validate a single rule, appending any failures for it to `failures`. */
function validateRule(
  rule: GapRule | undefined,
  index: number,
  seenIds: Set<string>,
  failures: string[]
): void {
  const label = `rule[${index}]`;
  if (rule === null || typeof rule !== "object") {
    failures.push(`${label}: rule is missing or not an object`);
    return;
  }

  if (!isNonEmptyString(rule.id)) {
    failures.push(`${label}: rule id is missing or empty`);
  } else {
    if (seenIds.has(rule.id)) {
      failures.push(`${label} (${rule.id}): duplicate rule id`);
    }
    seenIds.add(rule.id);
  }

  const idLabel = isNonEmptyString(rule.id) ? `${label} (${rule.id})` : label;

  if (typeof rule.predicate !== "function") {
    failures.push(`${idLabel}: predicate is missing or not a function`);
  }

  if (!GAP_CATEGORIES.includes(rule.category)) {
    failures.push(
      `${idLabel}: category "${String(rule.category)}" is not one of ${GAP_CATEGORIES.join(", ")}`
    );
  }

  const meta = rule.metadata;
  if (meta === null || typeof meta !== "object") {
    failures.push(`${idLabel}: metadata is missing`);
    return;
  }

  if (!isNonEmptyString(meta.whyItMatters)) {
    failures.push(`${idLabel}: metadata.whyItMatters is missing or empty`);
  }
  if (!isNonEmptyString(meta.suggestedNextStep)) {
    failures.push(`${idLabel}: metadata.suggestedNextStep is missing or empty`);
  }
  if (!GAP_CATEGORIES.includes(meta.category)) {
    failures.push(
      `${idLabel}: metadata.category "${String(meta.category)}" is not a valid category`
    );
  }
  if (!isNonEmptyString(meta.requiredApprover)) {
    failures.push(`${idLabel}: metadata.requiredApprover is missing or empty`);
  }
  if (typeof meta.priority !== "number" || !Number.isFinite(meta.priority)) {
    failures.push(`${idLabel}: metadata.priority must be a finite number`);
  }

  // Framing safety (Req 8.3): reject medical-necessity wording.
  for (const [field, text] of [
    ["whyItMatters", meta.whyItMatters],
    ["suggestedNextStep", meta.suggestedNextStep]
  ] as const) {
    if (isNonEmptyString(text)) {
      const term = findProhibitedTerm(text);
      if (term !== undefined) {
        failures.push(
          `${idLabel}: metadata.${field} uses prohibited medical-necessity wording "${term}"`
        );
      }
    }
  }
}

/**
 * Validate a submitted gap-rule configuration (Req 8.6, 8.7).
 *
 * Pure and deterministic. A configuration is valid when it contains a non-empty
 * array of rules where every rule has a unique non-empty id, a predicate
 * function, a valid category, complete metadata, and no medical-necessity
 * wording. On failure the returned `failures` identify every problem found so
 * the caller can retain the previously active rule set.
 */
export function validateRuleConfig(
  config: GapRuleConfig | undefined | null
): ConfigValidationResult {
  const failures: string[] = [];

  if (config === null || config === undefined || typeof config !== "object") {
    failures.push("configuration is missing or not an object");
    return {
      valid: false,
      failures,
      indication: "Gap-rule configuration rejected: it is missing or malformed."
    };
  }

  if (!Array.isArray(config.rules)) {
    failures.push("configuration.rules must be an array");
  } else if (config.rules.length === 0) {
    failures.push("configuration.rules must contain at least one rule");
  } else {
    const seenIds = new Set<string>();
    config.rules.forEach((rule, index) =>
      validateRule(rule, index, seenIds, failures)
    );
  }

  if (failures.length > 0) {
    return {
      valid: false,
      failures,
      indication: `Gap-rule configuration rejected: ${failures.length} validation ${
        failures.length === 1 ? "failure" : "failures"
      } found; previously active rule set retained.`
    };
  }

  return {
    valid: true,
    failures,
    indication: "Gap-rule configuration accepted and applied to subsequent evaluations."
  };
}
