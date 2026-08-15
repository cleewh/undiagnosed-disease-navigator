// services/evidence-gap/src/engine.ts
//
// The deterministic, configurable evidence-gap rules engine (Gap_Service,
// task 16.1).
//
// `evaluateGaps` applies a resolved rule set to a case and returns the
// triggered gaps, each linked to its triggering case-data element (Req 8.4) and
// framed as a review item (Req 8.2, 8.3) — never as a statement of medical
// necessity. When no rule fires it returns a clear no-gaps indication (Req 8.5).
// If any rule predicate throws, the evaluation is reported as not completed and
// no partial results are returned (Req 8.8).
//
// `GapRulesEngine` layers the stateful configuration lifecycle on top: a valid
// submitted configuration is applied to subsequent evaluations (Req 8.6); an
// invalid one is rejected and the previously active rule set is retained
// (Req 8.7).
//
// Performance bound (Req 8.1): evaluation is O(rules x per-rule scan). The
// default rule set performs only small linear scans over the case projection,
// so a case with up to 10,000 data elements is evaluated far within the
// 30-second bound. Determinism: given identical inputs (case data, rule set,
// and evaluation options) the produced gaps are byte-for-byte identical,
// including their deterministic ids and (priority, ruleId) ordering.

import { createEnvelope, utcNow } from "@udn/domain";
import type { AccessClassification, EvidenceGap } from "@udn/domain";

import { validateRuleConfig, type ConfigValidationResult } from "./config.js";
import {
  DEFAULT_GAP_RULE_CONFIG,
  type GapCategory,
  type GapRule,
  type GapRuleConfig,
  type RuleEvaluationContext
} from "./rules.js";
import type { GapCaseData } from "./case-data.js";

/**
 * A triggered evidence gap: a domain `EvidenceGap` (framed as a review item)
 * enriched with the reviewer-facing metadata carried by the rule that fired.
 * Assignable anywhere an `EvidenceGap` is expected.
 */
export interface EvidenceGapReviewItem extends EvidenceGap {
  /** Discipline the gap belongs to. */
  category: GapCategory;
  /** Why closing this gap matters, framed as review guidance. */
  whyItMatters: string;
  /** Suggested next investigative step, framed as a suggestion. */
  suggestedNextStep: string;
  /** Role suggested to review/approve the next step. */
  requiredApprover: string;
  /** Lower value = higher review priority. */
  priority: number;
  /** Optional detail describing the specific trigger. */
  detail?: string;
}

/** Options controlling how gap envelopes are stamped during evaluation. */
export interface GapEvaluationOptions {
  /** Actor id recorded as creator/provenance author. Default "Gap_Service". */
  evaluatorId?: string;
  /**
   * Reference timestamp (ISO-8601) used both as the envelope timestamps and as
   * the `referenceDate` for time-relative rules. Supplying a fixed value makes
   * the whole result byte-for-byte deterministic. Defaults to the current time.
   */
  evaluatedAt?: string;
  /** Envelope `source`. Default "Gap_Service". */
  source?: string;
  /** Access classification for produced gaps. Default "clinical". */
  accessClassification?: AccessClassification;
}

/** The result of evaluating a case against the configured rule set. */
export interface GapEvaluationResult {
  /** False only when the engine could not complete the evaluation (Req 8.8). */
  completed: boolean;
  /**
   * The triggered gaps, deterministically ordered by (priority, ruleId). Empty
   * when no gaps were found (Req 8.5) or when evaluation did not complete
   * (Req 8.8) — in the latter case no partial results are ever returned.
   */
  gaps: EvidenceGapReviewItem[];
  /** True when the evaluation completed and found no gaps (Req 8.5). */
  noGapsFound: boolean;
  /** Human-readable indication of the outcome. */
  indication: string;
  /** Number of rules applied in this evaluation. */
  ruleCount: number;
  /** Present only when `completed` is false: what prevented completion. */
  error?: string;
}

/**
 * The documented maximum case size the engine is designed to evaluate within
 * the 30-second bound (Req 8.1). Exposed for callers/tests; not enforced here,
 * as enforcement is a runtime/orchestration concern.
 */
export const MAX_SUPPORTED_ELEMENTS = 10_000;

/** The documented evaluation time bound in milliseconds (Req 8.1). */
export const EVALUATION_TIME_BOUND_MS = 30_000;

/** Indication returned when a completed evaluation finds no gaps (Req 8.5). */
export const NO_GAPS_INDICATION =
  "No evidence gaps were found for this case.";

/** Deterministic (priority asc, ruleId asc) comparison for stable ordering. */
function compareGaps(
  a: EvidenceGapReviewItem,
  b: EvidenceGapReviewItem
): number {
  if (a.priority !== b.priority) return a.priority < b.priority ? -1 : 1;
  if (a.ruleId === b.ruleId) return 0;
  return a.ruleId < b.ruleId ? -1 : 1;
}

/** Build a single review-item gap from a fired rule and its trigger. */
function buildGap(
  caseData: GapCaseData,
  rule: GapRule,
  triggeringElementRef: string,
  detail: string | undefined,
  stamp: { evaluatorId: string; evaluatedAt: string; source: string; accessClassification: AccessClassification }
): EvidenceGapReviewItem {
  const envelope = createEnvelope({
    entityType: "EvidenceGap",
    caseId: caseData.caseId,
    source: stamp.source,
    status: "open",
    accessClassification: stamp.accessClassification,
    createdById: stamp.evaluatorId,
    // Deterministic id: unique per (case, rule) and stable across runs.
    id: `EvidenceGap-${caseData.caseId}-${rule.id}`,
    now: stamp.evaluatedAt,
    provenance: {
      sourceId: triggeringElementRef,
      versionId: "1",
      createdById: stamp.evaluatorId,
      ingestedAt: stamp.evaluatedAt
    }
  });

  return {
    ...envelope,
    entityType: "EvidenceGap",
    triggeringElementRef,
    ruleId: rule.id,
    framedAsReviewItem: true,
    category: rule.metadata.category,
    whyItMatters: rule.metadata.whyItMatters,
    suggestedNextStep: rule.metadata.suggestedNextStep,
    requiredApprover: rule.metadata.requiredApprover,
    priority: rule.metadata.priority,
    ...(detail !== undefined ? { detail } : {})
  };
}

/**
 * Apply a resolved rule set to a case and return the triggered evidence gaps
 * (Req 8.2–8.5, 8.8).
 *
 * Pure and deterministic given identical `caseData`, `config`, and `options`.
 * If any predicate throws, the evaluation is reported as not completed with an
 * empty `gaps` list — partial results are never presented as complete (Req 8.8).
 */
export function evaluateGaps(
  caseData: GapCaseData,
  config: GapRuleConfig = DEFAULT_GAP_RULE_CONFIG,
  options: GapEvaluationOptions = {}
): GapEvaluationResult {
  const evaluatedAt = options.evaluatedAt ?? utcNow();
  const stamp = {
    evaluatorId: options.evaluatorId ?? "Gap_Service",
    evaluatedAt,
    source: options.source ?? "Gap_Service",
    accessClassification: options.accessClassification ?? "clinical"
  } as const;
  const ctx: RuleEvaluationContext = { referenceDate: evaluatedAt };
  const ruleCount = config.rules.length;

  const gaps: EvidenceGapReviewItem[] = [];
  try {
    for (const rule of config.rules) {
      const trigger = rule.predicate(caseData, ctx);
      if (trigger === null) continue;
      gaps.push(
        buildGap(caseData, rule, trigger.triggeringElementRef, trigger.detail, stamp)
      );
    }
  } catch (err) {
    // Req 8.8: evaluation did not complete -> return no partial results.
    return {
      completed: false,
      gaps: [],
      noGapsFound: false,
      ruleCount,
      indication:
        "Evidence-gap evaluation did not complete; no gap results are available for this case.",
      error: err instanceof Error ? err.message : String(err)
    };
  }

  gaps.sort(compareGaps);

  if (gaps.length === 0) {
    return {
      completed: true,
      gaps,
      noGapsFound: true,
      ruleCount,
      indication: NO_GAPS_INDICATION
    };
  }

  return {
    completed: true,
    gaps,
    noGapsFound: false,
    ruleCount,
    indication: `${gaps.length} evidence ${
      gaps.length === 1 ? "gap" : "gaps"
    } identified for professional review.`
  };
}

/**
 * The stateful evidence-gap rules engine.
 *
 * Holds the currently active rule set and mediates configuration changes:
 * a valid submitted configuration replaces the active set for subsequent
 * evaluations (Req 8.6); an invalid one is rejected and the previously active
 * set is retained (Req 8.7).
 */
export class GapRulesEngine {
  private activeConfig: GapRuleConfig;

  /**
   * Create an engine with an initial configuration (defaults to the built-in
   * rule set). Throws if the supplied initial configuration is invalid.
   */
  constructor(initialConfig: GapRuleConfig = DEFAULT_GAP_RULE_CONFIG) {
    const result = validateRuleConfig(initialConfig);
    if (!result.valid) {
      throw new Error(
        `Invalid initial gap-rule configuration: ${result.failures.join("; ")}`
      );
    }
    this.activeConfig = initialConfig;
  }

  /** The rule set currently applied to evaluations. */
  getActiveConfig(): GapRuleConfig {
    return this.activeConfig;
  }

  /**
   * Submit a new configuration (Req 8.6, 8.7). On success the configuration
   * becomes active for subsequent evaluations; on failure it is rejected and
   * the previously active configuration is retained. The validation result
   * (including any identified failures) is returned either way.
   */
  configureRules(submitted: GapRuleConfig): ConfigValidationResult {
    const result = validateRuleConfig(submitted);
    if (result.valid) {
      this.activeConfig = submitted;
    }
    return result;
  }

  /** Evaluate a case against the currently active rule set. */
  evaluateGaps(
    caseData: GapCaseData,
    options: GapEvaluationOptions = {}
  ): GapEvaluationResult {
    return evaluateGaps(caseData, this.activeConfig, options);
  }
}
