// services/evidence-gap/src/engine.test.ts
//
// Unit tests for the deterministic, configurable evidence-gap rules engine
// (Gap_Service, task 16.1).
//
// Covers: a case missing parental samples yields the corresponding gap linked
// to its trigger and framed as a review item (Req 8.2, 8.3, 8.4); a complete
// case yields the no-gaps indication (Req 8.5); an invalid rule configuration
// is rejected while the previously active rule set is retained (Req 8.6, 8.7);
// engine-failure handling never presents partial results as complete (Req 8.8);
// and evaluation is deterministic (design: deterministic engine). The
// exhaustive traceability and configuration-validation property tests are
// tasks 16.2 and 16.3.

import { describe, it, expect } from "vitest";

import {
  GapRulesEngine,
  evaluateGaps,
  NO_GAPS_INDICATION,
  MAX_SUPPORTED_ELEMENTS,
  EVALUATION_TIME_BOUND_MS,
  type EvidenceGapReviewItem
} from "./engine.js";
import {
  DEFAULT_GAP_RULE_CONFIG,
  type GapRule,
  type GapRuleConfig
} from "./rules.js";
import { validateRuleConfig } from "./config.js";
import { caseElementRef, type GapCaseData } from "./case-data.js";

// A fixed timestamp so envelope stamping is byte-for-byte deterministic.
const AT = "2024-01-01T00:00:00.000Z";
const OPTS = { evaluatedAt: AT, evaluatorId: "tester" } as const;

/**
 * A fully-populated, family-based case with no outstanding gaps against the
 * default rule set: trio samples, complete pedigree, onset, all analyses,
 * a recent reanalysis, an evaluable inheritance model, and external-matching
 * consent.
 */
function completeCase(): GapCaseData {
  return {
    caseId: "case-complete",
    isFamilyBased: true,
    biosamples: [
      { ref: "Biosample/proband", relationship: "proband" },
      { ref: "Biosample/mother", relationship: "mother" },
      { ref: "Biosample/father", relationship: "father" }
    ],
    pedigree: {
      ref: "Pedigree/ped-1",
      members: [
        { id: "proband", sex: "female", parents: ["mother", "father"] },
        { id: "mother", sex: "female" },
        { id: "father", sex: "male" }
      ]
    },
    ageOfOnset: { ref: "Observation/onset", value: "3 years" },
    analyses: [
      { ref: "AnalysisRun/genome", type: "genome" },
      { ref: "AnalysisRun/sv", type: "sv" },
      { ref: "AnalysisRun/repeat", type: "repeat" },
      { ref: "AnalysisRun/mito", type: "mitochondrial" }
    ],
    lastReanalysisAt: "2023-10-01T00:00:00.000Z",
    inheritance: { ref: "Inheritance/inh-1", evaluable: true, model: "autosomal_recessive" },
    consent: { ref: "Consent/consent-1", permitsExternalMatching: true }
  };
}

describe("evaluateGaps: missing parental samples (Req 8.2, 8.3, 8.4)", () => {
  it("yields the no-parental-samples gap linked to its trigger and framed as a review item", () => {
    const base = completeCase();
    const caseData: GapCaseData = {
      ...base,
      // Remove the parental samples, leaving only the proband.
      biosamples: [{ ref: "Biosample/proband", relationship: "proband" }]
    };

    const result = evaluateGaps(caseData, DEFAULT_GAP_RULE_CONFIG, OPTS);
    expect(result.completed).toBe(true);
    expect(result.noGapsFound).toBe(false);

    const gap = result.gaps.find((g) => g.ruleId === "no-parental-samples");
    expect(gap).toBeDefined();
    if (!gap) return;

    // Framed as a review item, never medical necessity (Req 8.3).
    expect(gap.framedAsReviewItem).toBe(true);
    expect(gap.entityType).toBe("EvidenceGap");
    // Linked to the specific triggering case-data element (Req 8.4).
    expect(gap.triggeringElementRef).toBe("Pedigree/ped-1");
    expect(gap.caseId).toBe(caseData.caseId);
    expect(gap.provenance.sourceId).toBe(gap.triggeringElementRef);
    // Carries review guidance rather than a necessity statement.
    expect(gap.suggestedNextStep.toLowerCase()).toContain("consider");
  });

  it("falls back to a case-level trigger ref when no pedigree is present", () => {
    const caseData: GapCaseData = {
      caseId: "case-fam",
      isFamilyBased: true,
      biosamples: [{ ref: "Biosample/proband", relationship: "proband" }]
    };
    const result = evaluateGaps(caseData, DEFAULT_GAP_RULE_CONFIG, OPTS);
    const gap = result.gaps.find((g) => g.ruleId === "no-parental-samples");
    expect(gap?.triggeringElementRef).toBe(
      caseElementRef("case-fam", "biosamples")
    );
  });

  it("does not fire the parental-samples rule for a single-patient case", () => {
    const caseData: GapCaseData = { caseId: "case-solo", isFamilyBased: false };
    const result = evaluateGaps(caseData, DEFAULT_GAP_RULE_CONFIG, OPTS);
    expect(result.gaps.some((g) => g.ruleId === "no-parental-samples")).toBe(false);
  });
});

describe("evaluateGaps: complete case (Req 8.5)", () => {
  it("returns the no-gaps indication when no rule fires", () => {
    const result = evaluateGaps(completeCase(), DEFAULT_GAP_RULE_CONFIG, OPTS);
    expect(result.completed).toBe(true);
    expect(result.noGapsFound).toBe(true);
    expect(result.gaps).toEqual([]);
    expect(result.indication).toBe(NO_GAPS_INDICATION);
  });
});

describe("evaluateGaps: every gap is a traceable review item (Req 8.2, 8.3, 8.4)", () => {
  it("produces gaps that each link to an element and are framed as review items", () => {
    // An almost-empty case triggers many rules at once.
    const caseData: GapCaseData = { caseId: "case-sparse", isFamilyBased: true };
    const result = evaluateGaps(caseData, DEFAULT_GAP_RULE_CONFIG, OPTS);
    expect(result.completed).toBe(true);
    expect(result.gaps.length).toBeGreaterThan(1);

    const seenRuleIds = new Set<string>();
    for (const gap of result.gaps) {
      expect(gap.framedAsReviewItem).toBe(true);
      expect(gap.triggeringElementRef.length).toBeGreaterThan(0);
      expect(gap.ruleId.length).toBeGreaterThan(0);
      // Distinct review items (Req 8.2).
      expect(seenRuleIds.has(gap.ruleId)).toBe(false);
      seenRuleIds.add(gap.ruleId);
    }
  });

  it("orders gaps deterministically by (priority, ruleId)", () => {
    const caseData: GapCaseData = { caseId: "case-sparse", isFamilyBased: true };
    const gaps = evaluateGaps(caseData, DEFAULT_GAP_RULE_CONFIG, OPTS).gaps;
    const priorities = gaps.map((g: EvidenceGapReviewItem) => g.priority);
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
  });
});

describe("evaluateGaps: determinism", () => {
  it("produces byte-identical results for identical inputs", () => {
    const caseData: GapCaseData = { caseId: "case-det", isFamilyBased: true };
    const a = JSON.stringify(evaluateGaps(caseData, DEFAULT_GAP_RULE_CONFIG, OPTS));
    const b = JSON.stringify(evaluateGaps(caseData, DEFAULT_GAP_RULE_CONFIG, OPTS));
    expect(a).toBe(b);
  });
});

describe("evaluateGaps: engine-failure handling (Req 8.8)", () => {
  it("reports not-completed and returns no partial results when a predicate throws", () => {
    const throwingRule: GapRule = {
      id: "throwing-rule",
      category: "administrative",
      metadata: {
        whyItMatters: "A rule that fails during evaluation.",
        suggestedNextStep: "Consider fixing the rule.",
        category: "administrative",
        requiredApprover: "Administrator",
        priority: 5
      },
      predicate: () => {
        throw new Error("boom");
      }
    };
    // Include a normal rule too; its (partial) result must NOT be presented.
    const config: GapRuleConfig = {
      rules: [...DEFAULT_GAP_RULE_CONFIG.rules, throwingRule]
    };
    const caseData: GapCaseData = { caseId: "case-fail", isFamilyBased: true };

    const result = evaluateGaps(caseData, config, OPTS);
    expect(result.completed).toBe(false);
    expect(result.gaps).toEqual([]);
    expect(result.noGapsFound).toBe(false);
    expect(result.error).toContain("boom");
    expect(result.indication.toLowerCase()).toContain("did not complete");
  });
});

describe("GapRulesEngine configuration lifecycle (Req 8.6, 8.7)", () => {
  it("applies a valid submitted configuration to subsequent evaluations (Req 8.6)", () => {
    const engine = new GapRulesEngine();
    // A minimal valid config with a single rule that fires on every case.
    const alwaysRule: GapRule = {
      id: "always-fires",
      category: "administrative",
      metadata: {
        whyItMatters: "Marks every case for a review checkpoint.",
        suggestedNextStep: "Consider a periodic review of the case.",
        category: "administrative",
        requiredApprover: "Genetic counsellor",
        priority: 1
      },
      predicate: (caseData) => ({
        triggeringElementRef: caseElementRef(caseData.caseId, "case")
      })
    };
    const submitted: GapRuleConfig = { rules: [alwaysRule] };

    const outcome = engine.configureRules(submitted);
    expect(outcome.valid).toBe(true);

    // The complete case now yields exactly the newly configured gap.
    const result = engine.evaluateGaps(completeCase(), OPTS);
    expect(result.gaps.map((g) => g.ruleId)).toEqual(["always-fires"]);
  });

  it("rejects an invalid configuration and retains the previously active rule set (Req 8.7)", () => {
    const engine = new GapRulesEngine();
    const before = engine.getActiveConfig();

    // Invalid: empty id, missing predicate, bad category, prohibited wording.
    const invalid = {
      rules: [
        {
          id: "",
          category: "not-a-category",
          metadata: {
            whyItMatters: "This test is medically necessary.",
            suggestedNextStep: "",
            category: "administrative",
            requiredApprover: "",
            priority: Number.NaN
          }
        }
      ]
    } as unknown as GapRuleConfig;

    const outcome = engine.configureRules(invalid);
    expect(outcome.valid).toBe(false);
    expect(outcome.failures.length).toBeGreaterThan(0);
    // Identifies the validation failure(s) (Req 8.7).
    expect(outcome.indication.toLowerCase()).toContain("rejected");

    // Previously active rule set retained (unchanged reference and behaviour).
    expect(engine.getActiveConfig()).toBe(before);
    const result = engine.evaluateGaps({ caseId: "case-x", isFamilyBased: true }, OPTS);
    expect(result.completed).toBe(true);
    expect(result.gaps.some((g) => g.ruleId === "no-parental-samples")).toBe(true);
  });

  it("rejects an empty rule set", () => {
    expect(validateRuleConfig({ rules: [] }).valid).toBe(false);
  });

  it("rejects duplicate rule ids", () => {
    const rule = DEFAULT_GAP_RULE_CONFIG.rules[0]!;
    const result = validateRuleConfig({ rules: [rule, rule] });
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes("duplicate"))).toBe(true);
  });

  it("accepts the default configuration", () => {
    expect(validateRuleConfig(DEFAULT_GAP_RULE_CONFIG).valid).toBe(true);
  });
});

describe("performance bound constants (Req 8.1)", () => {
  it("documents the 30-second / 10,000-element bound", () => {
    expect(MAX_SUPPORTED_ELEMENTS).toBe(10_000);
    expect(EVALUATION_TIME_BOUND_MS).toBe(30_000);
  });
});
