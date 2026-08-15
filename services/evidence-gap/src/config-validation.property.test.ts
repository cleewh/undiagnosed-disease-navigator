// services/evidence-gap/src/config-validation.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 21: Gap-rule configuration validation
//
// Validates: Requirements 8.6, 8.7
//
// Property 21 (design.md): *For any* submitted gap-rule configuration, a valid
// configuration is applied to all case evaluations initiated after it is saved,
// and an invalid configuration is rejected while the previously active rule set
// is retained and the validation failure is identified.
//
// This test drives the stateful `GapRulesEngine` (which owns the configuration
// lifecycle) with randomly-generated well-formed and malformed configurations
// and asserts:
//   - a well-formed configuration is accepted (`valid`), becomes the active
//     rule set, and is applied to every subsequent evaluation (Req 8.6), and
//   - a malformed configuration is rejected with a structured, non-empty set of
//     identified failures and a human-readable indication, while the previously
//     active rule set is retained unchanged and continues to drive evaluations
//     (Req 8.7).
//
// A fixed evaluation timestamp keeps each evaluation byte-for-byte deterministic
// across the >= 100 iterations.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { GapRulesEngine } from "./engine.js";
import {
  DEFAULT_GAP_RULE_CONFIG,
  GAP_CATEGORIES,
  type GapCategory,
  type GapRule,
  type GapRuleConfig
} from "./rules.js";
import { PROHIBITED_NECESSITY_TERMS } from "./config.js";
import type { GapCaseData } from "./case-data.js";

// A fixed timestamp so envelope stamping and time-relative rules are
// byte-for-byte deterministic.
const AT = "2024-01-01T00:00:00.000Z";
const OPTS = { evaluatedAt: AT, evaluatorId: "prop-tester" } as const;

// A minimal, well-formed case projection to exercise evaluation after a
// configuration change. Its exact shape is irrelevant to Property 21; only the
// number of rules applied (which reflects the active configuration) matters.
const SAMPLE_CASE: GapCaseData = { caseId: "case-1", isFamilyBased: false };

function containsNecessityWording(text: string): boolean {
  const haystack = text.toLowerCase();
  return PROHIBITED_NECESSITY_TERMS.some((term) => haystack.includes(term));
}

const gapCategoryArb: fc.Arbitrary<GapCategory> = fc.constantFrom(
  ...GAP_CATEGORIES
);

// Safe, non-empty descriptive text that never trips the medical-necessity
// wording check (Req 8.3), so a "well-formed" config is genuinely valid.
const safeTextArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !containsNecessityWording(s));

// The variable body of a valid rule (everything except its id, which is
// assigned by index so the config has unique rule ids).
interface RuleBody {
  category: GapCategory;
  whyItMatters: string;
  suggestedNextStep: string;
  requiredApprover: string;
  priority: number;
}

const ruleBodyArb: fc.Arbitrary<RuleBody> = fc.record({
  category: gapCategoryArb,
  whyItMatters: safeTextArb,
  suggestedNextStep: safeTextArb,
  requiredApprover: safeTextArb,
  priority: fc.integer({ min: 0, max: 100 })
});

function bodyToRule(body: RuleBody, index: number): GapRule {
  return {
    id: `rule-${index}`,
    category: body.category,
    predicate: () => null,
    metadata: {
      whyItMatters: body.whyItMatters,
      suggestedNextStep: body.suggestedNextStep,
      category: body.category,
      requiredApprover: body.requiredApprover,
      priority: body.priority
    }
  };
}

// A well-formed configuration: a non-empty rule set with unique ids, predicate
// functions, valid categories, complete metadata, and no prohibited wording.
const validConfigArb: fc.Arbitrary<GapRuleConfig> = fc
  .array(ruleBodyArb, { minLength: 1, maxLength: 6 })
  .map((bodies) => ({ rules: bodies.map(bodyToRule) }));

// ---------------------------------------------------------------------------
// Malformed configuration generation: take a valid config and inject exactly
// one fault that the validator must catch.
// ---------------------------------------------------------------------------

type Fault =
  | { kind: "emptyRules" }
  | { kind: "notArray" }
  | { kind: "emptyId" }
  | { kind: "noPredicate" }
  | { kind: "badCategory" }
  | { kind: "missingWhy" }
  | { kind: "duplicateId" }
  | { kind: "necessityWording"; term: string };

const faultArb: fc.Arbitrary<Fault> = fc.oneof(
  fc.constant<Fault>({ kind: "emptyRules" }),
  fc.constant<Fault>({ kind: "notArray" }),
  fc.constant<Fault>({ kind: "emptyId" }),
  fc.constant<Fault>({ kind: "noPredicate" }),
  fc.constant<Fault>({ kind: "badCategory" }),
  fc.constant<Fault>({ kind: "missingWhy" }),
  fc.constant<Fault>({ kind: "duplicateId" }),
  fc
    .constantFrom(...PROHIBITED_NECESSITY_TERMS)
    .map<Fault>((term) => ({ kind: "necessityWording", term }))
);

function cloneRule(rule: GapRule): GapRule {
  return { ...rule, metadata: { ...rule.metadata } };
}

// Apply a single fault, returning a configuration guaranteed to be invalid.
function applyFault(base: GapRuleConfig, fault: Fault): GapRuleConfig {
  const rules = base.rules.map(cloneRule);

  switch (fault.kind) {
    case "emptyRules":
      return { rules: [] };
    case "notArray":
      return { rules: "not-an-array" } as unknown as GapRuleConfig;
    case "emptyId": {
      const target = rules[0] as GapRule;
      target.id = "";
      return { rules };
    }
    case "noPredicate": {
      const target = rules[0] as GapRule;
      (target as { predicate?: unknown }).predicate = undefined;
      return { rules };
    }
    case "badCategory": {
      const target = rules[0] as GapRule;
      (target as { category: string }).category = "not-a-category";
      return { rules };
    }
    case "missingWhy": {
      const target = rules[0] as GapRule;
      target.metadata.whyItMatters = "";
      return { rules };
    }
    case "duplicateId": {
      const dup = cloneRule(rules[0] as GapRule);
      dup.id = (rules[0] as GapRule).id;
      return { rules: [...rules, dup] };
    }
    case "necessityWording": {
      const target = rules[0] as GapRule;
      target.metadata.whyItMatters = `Closing this gap ${fault.term} for the patient.`;
      return { rules };
    }
  }
}

const invalidConfigArb: fc.Arbitrary<GapRuleConfig> = fc
  .tuple(validConfigArb, faultArb)
  .map(([base, fault]) => applyFault(base, fault));

describe("Feature: undiagnosed-disease-navigator, Property 21: Gap-rule configuration validation", () => {
  it("accepts a well-formed configuration and applies it to all subsequent case evaluations (Req 8.6)", () => {
    fc.assert(
      fc.property(validConfigArb, (submitted) => {
        const engine = new GapRulesEngine(DEFAULT_GAP_RULE_CONFIG);

        const result = engine.configureRules(submitted);

        // Accepted, with no identified failures.
        expect(result.valid).toBe(true);
        expect(result.failures).toEqual([]);

        // The submitted configuration becomes the active rule set...
        expect(engine.getActiveConfig()).toBe(submitted);

        // ...and is applied to evaluations initiated after it is saved: the
        // number of rules applied reflects the newly submitted configuration,
        // not the previous default rule set.
        const evaluation = engine.evaluateGaps(SAMPLE_CASE, OPTS);
        expect(evaluation.completed).toBe(true);
        expect(evaluation.ruleCount).toBe(submitted.rules.length);
      }),
      { numRuns: 100 }
    );
  });

  it("rejects a malformed configuration, identifies the validation failure, and retains the previously active rule set (Req 8.7)", () => {
    fc.assert(
      fc.property(invalidConfigArb, (malformed) => {
        const engine = new GapRulesEngine(DEFAULT_GAP_RULE_CONFIG);
        const priorConfig = engine.getActiveConfig();
        const priorRuleCount = priorConfig.rules.length;

        const result = engine.configureRules(malformed);

        // Rejected, with a structured, non-empty set of identified failures and
        // a human-readable indication of the failure (Req 8.7).
        expect(result.valid).toBe(false);
        expect(result.failures.length).toBeGreaterThan(0);
        expect(result.indication.length).toBeGreaterThan(0);

        // The previously active rule set is retained unchanged...
        expect(engine.getActiveConfig()).toBe(priorConfig);

        // ...and continues to drive subsequent evaluations (the malformed
        // configuration is never applied).
        const evaluation = engine.evaluateGaps(SAMPLE_CASE, OPTS);
        expect(evaluation.completed).toBe(true);
        expect(evaluation.ruleCount).toBe(priorRuleCount);
      }),
      { numRuns: 100 }
    );
  });
});
