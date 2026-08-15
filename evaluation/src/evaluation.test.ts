// evaluation/src/evaluation.test.ts
//
// Compile-sanity + core-behaviour unit tests for the Evaluation_Framework.
// Property tests (tasks 31.2, 31.3) are implemented separately.

import { describe, expect, it } from "vitest";
import {
  InMemoryGroundTruthReader,
  GROUND_TRUTH_ACCESS_CLASSIFICATION,
  isInMetricRange,
  runEvaluation,
  renderReports,
  SAFETY_CHECK_IDS,
  NOT_RANKED,
  type GroundTruth
} from "./index.js";

const groundTruth: GroundTruth = {
  caseId: "case-1",
  accessClassification: GROUND_TRUTH_ACCESS_CLASSIFICATION,
  syntheticIndicator: true,
  expectedOutcome: "confirmed_diagnosis",
  causalFindings: [
    {
      gene: "SYNGENE-CARDIAC-1",
      variantId: "SYN-var-1",
      inheritanceModel: "autosomal_dominant",
      zygosity: "heterozygous"
    }
  ],
  expectedPhenotypes: [
    { hpoId: "SYN-HP-1", assertion: "present", onset: "childhood" },
    { hpoId: "SYN-HP-2", assertion: "absent" }
  ],
  expectedReanalysisMatches: { "update-1": true }
};

const reader = new InMemoryGroundTruthReader([groundTruth]);

describe("runEvaluation", () => {
  it("computes every metric in range and renders both reports", () => {
    const report = runEvaluation(
      {
        phenotype: [
          {
            caseId: "case-1",
            phenotypes: [
              { hpoId: "SYN-HP-1", assertion: "present", onset: "childhood", resolved: true },
              { hpoId: "SYN-HP-2", assertion: "absent", resolved: true }
            ]
          }
        ],
        prioritisation: [
          {
            caseId: "case-1",
            rankedVariantIds: ["SYN-var-1", "SYN-var-9"],
            rankedGenes: ["SYNGENE-CARDIAC-1"],
            appliedInheritanceModel: "autosomal_dominant"
          }
        ],
        reanalysis: [
          {
            caseId: "case-1",
            updateId: "update-1",
            matched: true,
            explanationComplete: true,
            linkedToTrigger: true,
            rankingChangeCorrect: true
          }
        ],
        grounding: [
          {
            caseId: "case-1",
            outputValidationPassed: true,
            claims: [
              {
                hasSourceReference: true,
                supported: true,
                sourceLinkCorrect: true,
                hasUncertaintyIndicator: true
              }
            ]
          }
        ],
        safety: {}
      },
      reader,
      { now: "2024-01-01T00:00:00.000Z" }
    );

    // Perfect submission scores 1.0 recall/precision and ranks the causal item first.
    expect(report.phenotype.recall).toBe(1);
    expect(report.phenotype.precision).toBe(1);
    expect(report.prioritisation.perCase[0]?.causalVariantRank).toBe(1);
    expect(report.prioritisation.top5Recall).toBe(1);

    // Every ratio metric stays within [0.0, 1.0].
    const ratios = [
      report.phenotype.precision,
      report.phenotype.recall,
      report.phenotype.f1,
      report.phenotype.assertionAccuracy,
      report.phenotype.onsetAccuracy,
      report.phenotype.hpoMappingAccuracy,
      report.phenotype.unsupportedTermRate,
      report.prioritisation.top5Recall,
      report.prioritisation.top10Recall,
      report.prioritisation.inheritanceFilterAccuracy,
      report.reanalysis.retrievalCorrectness,
      report.reanalysis.falsePositiveRate,
      report.reanalysis.explanationCompleteness,
      report.reanalysis.evidenceLinkage,
      report.reanalysis.rankingChangeAccuracy,
      report.grounding.validSourceReferenceRate,
      report.grounding.unsupportedClaimRate,
      report.grounding.incorrectSourceLinkRate,
      report.grounding.missingUncertaintyRate,
      report.grounding.outputValidationFailureRate
    ];
    for (const value of ratios) {
      expect(isInMetricRange(value)).toBe(true);
    }

    // All seven safety checks pass when no violation is observed.
    expect(report.safety).toHaveLength(SAFETY_CHECK_IDS.length);
    expect(report.safety.every((c) => c.passed)).toBe(true);

    const rendered = renderReports(report);
    expect(rendered.json).toContain("\"precision\"");
    expect(rendered.html).toContain("<!DOCTYPE html>");
    expect(rendered.html).toContain("Phenotype extraction");
  });

  it("excludes malformed entries and continues scoring", () => {
    const report = runEvaluation(
      {
        phenotype: [
          { caseId: "", phenotypes: [] },
          { caseId: "unknown-case", phenotypes: [] }
        ],
        prioritisation: [
          {
            caseId: "case-1",
            rankedVariantIds: ["SYN-var-9"],
            rankedGenes: []
          }
        ]
      },
      reader,
      { now: "2024-01-01T00:00:00.000Z" }
    );

    // Two malformed/unmatched phenotype entries were excluded, never scored.
    expect(report.exclusions.length).toBeGreaterThanOrEqual(2);
    // The causal variant is absent from the ranking -> not-ranked, recall 0.
    expect(report.prioritisation.perCase[0]?.causalVariantRank).toBe(NOT_RANKED);
    expect(report.prioritisation.top5Recall).toBe(0);
  });
});
