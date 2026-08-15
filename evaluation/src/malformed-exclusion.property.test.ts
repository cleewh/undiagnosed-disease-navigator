// evaluation/src/malformed-exclusion.property.test.ts
//
// Property-based test for design Correctness Property 69 (task 31.3).
//
// Feature: undiagnosed-disease-navigator, Property 69: Evaluation excludes
// malformed entries and continues
//
// *For any* submission batch containing malformed or unmatched entries, the
// Evaluation_Framework excludes those entries from the affected metric with a
// recorded reason and continues scoring the remaining entries, producing HTML
// and JSON reports that each contain every computed metric
// (Requirements 30.7, 30.8).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  runEvaluation,
  renderReports,
  InMemoryGroundTruthReader,
  GROUND_TRUTH_ACCESS_CLASSIFICATION,
  isInMetricRange,
  type GroundTruth,
  type MetricFamily,
  type ExclusionReason,
  type PhenotypeSubmission,
  type PrioritisationSubmission,
  type ReanalysisSubmission,
  type GroundingSubmission
} from "./index.js";

// ---------------------------------------------------------------------------
// Fixed Ground_Truth fixtures.
//
// Two fully-answerable "good" cases, plus one case that has Ground_Truth but no
// causal finding (so a prioritisation submission for it is unmatched).
// ---------------------------------------------------------------------------

const GOOD_CASE_IDS = ["case-good-1", "case-good-2"] as const;
const NO_FINDING_CASE_ID = "case-nofinding";
const MATCHED_UPDATE_ID = "update-1";
const UNMATCHED_UPDATE_ID = "update-absent";

function goodGroundTruth(caseId: string): GroundTruth {
  return {
    caseId,
    accessClassification: GROUND_TRUTH_ACCESS_CLASSIFICATION,
    syntheticIndicator: true,
    expectedOutcome: "confirmed_diagnosis",
    causalFindings: [
      {
        gene: "SYNGENE-1",
        variantId: "SYN-var-1",
        inheritanceModel: "autosomal_dominant",
        zygosity: "heterozygous"
      }
    ],
    expectedPhenotypes: [
      { hpoId: "SYN-HP-1", assertion: "present", onset: "childhood" },
      { hpoId: "SYN-HP-2", assertion: "absent" }
    ],
    expectedReanalysisMatches: { [MATCHED_UPDATE_ID]: true }
  };
}

const READER = new InMemoryGroundTruthReader([
  goodGroundTruth(GOOD_CASE_IDS[0]),
  goodGroundTruth(GOOD_CASE_IDS[1]),
  {
    caseId: NO_FINDING_CASE_ID,
    accessClassification: GROUND_TRUTH_ACCESS_CLASSIFICATION,
    syntheticIndicator: true,
    expectedOutcome: "unsolved",
    causalFindings: [],
    expectedPhenotypes: [{ hpoId: "SYN-HP-3", assertion: "present" }]
  }
]);

const VALID_REASONS: readonly ExclusionReason[] = [
  "missing-output",
  "malformed-output",
  "missing-ground-truth",
  "unmatched-ground-truth"
];

function goodCaseId(index: number): string {
  return GOOD_CASE_IDS[index % GOOD_CASE_IDS.length]!;
}

// ---------------------------------------------------------------------------
// Per-family batch generators.
//
// Each generator interleaves well-formed/matched ("good") entries with entries
// that must be excluded ("bad"). The generator reports how many of each it
// produced, plus the set of case ids expected to be scored, so the property can
// assert that exactly the bad entries were excluded and the good entries were
// still scored.
// ---------------------------------------------------------------------------

interface Batch<T> {
  entries: T[];
  good: number;
  bad: number;
  scoredCaseIds: string[];
}

type PhenotypeTag = "good" | "malformed" | "missing";

const phenotypeBatchArb: fc.Arbitrary<Batch<PhenotypeSubmission>> = fc
  .array(fc.constantFrom<PhenotypeTag>("good", "malformed", "missing"), {
    maxLength: 8
  })
  .map((tags) => {
    const entries: PhenotypeSubmission[] = [];
    const scoredCaseIds: string[] = [];
    let good = 0;
    let bad = 0;
    tags.forEach((tag, i) => {
      if (tag === "good") {
        const caseId = goodCaseId(i);
        entries.push({
          caseId,
          phenotypes: [{ hpoId: "SYN-HP-1", assertion: "present", resolved: true }]
        });
        scoredCaseIds.push(caseId);
        good += 1;
      } else if (tag === "malformed") {
        entries.push({ caseId: "", phenotypes: [] });
        bad += 1;
      } else {
        entries.push({ caseId: `ghost-ph-${i}`, phenotypes: [] });
        bad += 1;
      }
    });
    return { entries, good, bad, scoredCaseIds };
  });

type PrioritisationTag = "good" | "malformed" | "missing" | "unmatched";

const prioritisationBatchArb: fc.Arbitrary<Batch<PrioritisationSubmission>> = fc
  .array(
    fc.constantFrom<PrioritisationTag>(
      "good",
      "malformed",
      "missing",
      "unmatched"
    ),
    { maxLength: 8 }
  )
  .map((tags) => {
    const entries: PrioritisationSubmission[] = [];
    const scoredCaseIds: string[] = [];
    let good = 0;
    let bad = 0;
    tags.forEach((tag, i) => {
      if (tag === "good") {
        const caseId = goodCaseId(i);
        entries.push({
          caseId,
          rankedVariantIds: ["SYN-var-1", "SYN-var-9"],
          rankedGenes: ["SYNGENE-1"],
          appliedInheritanceModel: "autosomal_dominant"
        });
        scoredCaseIds.push(caseId);
        good += 1;
      } else if (tag === "malformed") {
        // Missing required ranking arrays -> malformed-output.
        entries.push({
          caseId: "",
          rankedVariantIds: [],
          rankedGenes: []
        });
        bad += 1;
      } else if (tag === "missing") {
        entries.push({
          caseId: `ghost-pr-${i}`,
          rankedVariantIds: ["SYN-var-1"],
          rankedGenes: ["SYNGENE-1"]
        });
        bad += 1;
      } else {
        // Ground_Truth exists but has no causal finding -> unmatched.
        entries.push({
          caseId: NO_FINDING_CASE_ID,
          rankedVariantIds: ["SYN-var-1"],
          rankedGenes: ["SYNGENE-1"]
        });
        bad += 1;
      }
    });
    return { entries, good, bad, scoredCaseIds };
  });

type ReanalysisTag = "good" | "malformed" | "missing" | "unmatched";

function reanalysisEntry(
  caseId: string,
  updateId: string
): ReanalysisSubmission {
  return {
    caseId,
    updateId,
    matched: true,
    explanationComplete: true,
    linkedToTrigger: true,
    rankingChangeCorrect: true
  };
}

const reanalysisBatchArb: fc.Arbitrary<Batch<ReanalysisSubmission>> = fc
  .array(
    fc.constantFrom<ReanalysisTag>("good", "malformed", "missing", "unmatched"),
    { maxLength: 8 }
  )
  .map((tags) => {
    const entries: ReanalysisSubmission[] = [];
    const scoredCaseIds: string[] = [];
    let good = 0;
    let bad = 0;
    tags.forEach((tag, i) => {
      if (tag === "good") {
        const caseId = goodCaseId(i);
        entries.push(reanalysisEntry(caseId, MATCHED_UPDATE_ID));
        scoredCaseIds.push(caseId);
        good += 1;
      } else if (tag === "malformed") {
        entries.push(reanalysisEntry("", MATCHED_UPDATE_ID));
        bad += 1;
      } else if (tag === "missing") {
        entries.push(reanalysisEntry(`ghost-re-${i}`, MATCHED_UPDATE_ID));
        bad += 1;
      } else {
        // Good case, but no expected match decision for this update -> unmatched.
        entries.push(reanalysisEntry(goodCaseId(i), UNMATCHED_UPDATE_ID));
        bad += 1;
      }
    });
    return { entries, good, bad, scoredCaseIds };
  });

type GroundingTag = "good" | "malformed";

const groundingBatchArb: fc.Arbitrary<Batch<GroundingSubmission>> = fc
  .array(fc.constantFrom<GroundingTag>("good", "malformed"), { maxLength: 8 })
  .map((tags) => {
    const entries: GroundingSubmission[] = [];
    const scoredCaseIds: string[] = [];
    let good = 0;
    let bad = 0;
    tags.forEach((tag, i) => {
      if (tag === "good") {
        const caseId = goodCaseId(i);
        entries.push({
          caseId,
          outputValidationPassed: true,
          claims: [
            {
              hasSourceReference: true,
              supported: true,
              sourceLinkCorrect: true,
              hasUncertaintyIndicator: true
            }
          ]
        });
        scoredCaseIds.push(caseId);
        good += 1;
      } else {
        // Missing the required outputValidationPassed flag -> malformed-output.
        entries.push({ caseId: "" } as unknown as GroundingSubmission);
        bad += 1;
      }
    });
    return { entries, good, bad, scoredCaseIds };
  });

// ---------------------------------------------------------------------------
// Property 69
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 69: Evaluation excludes malformed entries and continues", () => {
  // Validates: Requirements 30.7, 30.8
  it("excludes every malformed/unmatched entry with a recorded reason, scores the rest, and still renders both reports", () => {
    fc.assert(
      fc.property(
        phenotypeBatchArb,
        prioritisationBatchArb,
        reanalysisBatchArb,
        groundingBatchArb,
        (phenotype, prioritisation, reanalysis, grounding) => {
          const report = runEvaluation(
            {
              phenotype: phenotype.entries,
              prioritisation: prioritisation.entries,
              reanalysis: reanalysis.entries,
              grounding: grounding.entries
            },
            READER,
            { now: "2024-01-01T00:00:00.000Z" }
          );

          // Scoring never aborted: a full report with in-range metrics exists.
          expect(isInMetricRange(report.phenotype.precision)).toBe(true);
          expect(isInMetricRange(report.prioritisation.top5Recall)).toBe(true);
          expect(isInMetricRange(report.reanalysis.retrievalCorrectness)).toBe(
            true
          );
          expect(
            isInMetricRange(report.grounding.validSourceReferenceRate)
          ).toBe(true);

          // Every recorded exclusion carries a valid reason and a detail string,
          // and only bad entries are excluded (never a well-formed one).
          for (const exclusion of report.exclusions) {
            expect(VALID_REASONS).toContain(exclusion.reason);
            expect(typeof exclusion.detail).toBe("string");
            expect(exclusion.detail.length).toBeGreaterThan(0);
          }

          // The count of exclusions per family equals the injected bad count:
          // malformed/unmatched entries are excluded from the affected metric.
          const countFor = (family: MetricFamily): number =>
            report.exclusions.filter((e) => e.metricFamily === family).length;
          expect(countFor("phenotype-extraction")).toBe(phenotype.bad);
          expect(countFor("variant-prioritisation")).toBe(prioritisation.bad);
          expect(countFor("reanalysis-matching")).toBe(reanalysis.bad);
          expect(countFor("ai-grounding")).toBe(grounding.bad);

          // Well-formed entries in the same batch are still scored: the
          // prioritisation per-case results are exactly the good cases, and no
          // excluded (malformed/unmatched) entry was counted as complete.
          expect(report.prioritisation.perCase).toHaveLength(prioritisation.good);
          const scoredSet = new Set(prioritisation.scoredCaseIds);
          for (const perCase of report.prioritisation.perCase) {
            expect(scoredSet.has(perCase.caseId)).toBe(true);
          }

          // Reports are produced and each contains every computed metric (Req 30.8).
          const rendered = renderReports(report);
          for (const key of [
            '"precision"',
            '"top5Recall"',
            '"retrievalCorrectness"',
            '"validSourceReferenceRate"',
            '"exclusions"'
          ]) {
            expect(rendered.json).toContain(key);
          }
          expect(rendered.html).toContain("<!DOCTYPE html>");
          expect(rendered.html).toContain("Phenotype extraction");
          expect(rendered.html).toContain("Exclusions");
        }
      ),
      { numRuns: 200 }
    );
  });
});
