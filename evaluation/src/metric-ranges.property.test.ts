// evaluation/src/metric-ranges.property.test.ts
//
// Property-based test for design Correctness Property 68 (task 31.2).
//
// Feature: undiagnosed-disease-navigator, Property 68: Evaluation metrics stay
// within defined ranges
//
// *For any* submitted output scored by the Evaluation_Framework, each computed
// phenotype-extraction, reanalysis-matching, and AI-grounding metric falls
// within [0.0, 1.0], and each variant/gene rank is a positive integer or a
// not-ranked indicator while its recall and accuracy metrics fall within
// [0.0, 1.0] (Requirements 30.1, 30.2, 30.3, 30.4).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { InheritanceModel } from "@udn/domain";
import {
  runEvaluation,
  scorePhenotypeExtraction,
  scoreVariantPrioritisation,
  scoreReanalysisMatching,
  scoreAiGrounding,
  ExclusionLog,
  InMemoryGroundTruthReader,
  GROUND_TRUTH_ACCESS_CLASSIFICATION,
  isInMetricRange,
  isValidRank,
  type GroundTruth,
  type GroundTruthCausalFinding,
  type GroundTruthPhenotype,
  type Zygosity,
  type ExpectedOutcome,
  type PhenotypeSubmission,
  type PrioritisationSubmission,
  type ReanalysisSubmission,
  type GroundingSubmission,
  type EvaluationReport,
  type PhenotypeMetrics,
  type PrioritisationMetrics,
  type ReanalysisMetrics,
  type GroundingMetrics
} from "./index.js";

// ---------------------------------------------------------------------------
// Shared identifier pools
//
// Ground_Truth and submissions draw identifiers from overlapping pools so that
// true positives, correct ranks, and matches genuinely occur (exercising the
// non-trivial numerators), while the disjoint tails exercise the zero and
// not-ranked branches.
// ---------------------------------------------------------------------------

const CASE_IDS = ["case-1", "case-2", "case-3"] as const;
const UNKNOWN_CASE_IDS = ["ghost-1", "ghost-2", ""] as const;
const HPO_IDS = ["SYN-HP-1", "SYN-HP-2", "SYN-HP-3", "SYN-HP-4"] as const;
const GENES = ["SYNGENE-1", "SYNGENE-2", "SYNGENE-3"] as const;
const VARIANT_IDS = ["SYN-var-1", "SYN-var-2", "SYN-var-3", "SYN-var-9"] as const;
const UPDATE_IDS = ["update-1", "update-2"] as const;
const ONSETS = ["congenital", "childhood", "adult"] as const;

const inheritanceModelArb = fc.constantFrom<InheritanceModel>(
  "sporadic",
  "autosomal_recessive",
  "autosomal_dominant",
  "x_linked",
  "mitochondrial",
  "uncertain"
);
const zygosityArb = fc.constantFrom<Zygosity>(
  "heterozygous",
  "homozygous",
  "hemizygous",
  "homoplasmic",
  "mosaic",
  "unknown"
);
const outcomeArb = fc.constantFrom<ExpectedOutcome>(
  "confirmed_diagnosis",
  "revised_diagnosis",
  "dual_diagnosis",
  "non_genetic_explanation",
  "unsolved"
);
const assertionArb = fc.constantFrom(
  "present" as const,
  "absent" as const,
  "uncertain" as const,
  "historical" as const
);

// ---------------------------------------------------------------------------
// Ground_Truth generators
// ---------------------------------------------------------------------------

const causalFindingArb: fc.Arbitrary<GroundTruthCausalFinding> = fc.record({
  gene: fc.constantFrom(...GENES),
  variantId: fc.constantFrom(...VARIANT_IDS),
  inheritanceModel: inheritanceModelArb,
  zygosity: zygosityArb
});

const groundTruthPhenotypeArb: fc.Arbitrary<GroundTruthPhenotype> = fc
  .record({
    hpoId: fc.constantFrom(...HPO_IDS),
    assertion: assertionArb,
    onset: fc.option(fc.constantFrom(...ONSETS), { nil: undefined })
  })
  .map(({ hpoId, assertion, onset }) =>
    onset === undefined
      ? { hpoId, assertion }
      : { hpoId, assertion, onset }
  );

function groundTruthArb(caseId: string): fc.Arbitrary<GroundTruth> {
  return fc
    .record({
      expectedOutcome: outcomeArb,
      causalFindings: fc.array(causalFindingArb, { maxLength: 2 }),
      expectedPhenotypes: fc.array(groundTruthPhenotypeArb, { maxLength: 5 }),
      expectedReanalysisMatches: fc.option(
        fc.dictionary(fc.constantFrom(...UPDATE_IDS), fc.boolean()),
        { nil: undefined }
      )
    })
    .map((partial) => {
      const base: GroundTruth = {
        caseId,
        accessClassification: GROUND_TRUTH_ACCESS_CLASSIFICATION,
        syntheticIndicator: true,
        expectedOutcome: partial.expectedOutcome,
        causalFindings: partial.causalFindings,
        expectedPhenotypes: partial.expectedPhenotypes
      };
      return partial.expectedReanalysisMatches === undefined
        ? base
        : { ...base, expectedReanalysisMatches: partial.expectedReanalysisMatches };
    });
}

/** A reader populated with Ground_Truth for a subset of the case-id pool. */
const readerArb: fc.Arbitrary<InMemoryGroundTruthReader> = fc
  .subarray([...CASE_IDS], { minLength: 0, maxLength: CASE_IDS.length })
  .chain((ids) =>
    fc
      .tuple(...ids.map((id) => groundTruthArb(id)))
      .map((records) => new InMemoryGroundTruthReader(records))
  );

// ---------------------------------------------------------------------------
// Submission generators. Case ids are drawn from both the known and unknown
// pools so that some entries match Ground_Truth and some are excluded; the
// metric-range invariant must hold either way.
// ---------------------------------------------------------------------------

const anyCaseIdArb = fc.constantFrom(...CASE_IDS, ...UNKNOWN_CASE_IDS);

const submittedPhenotypeArb = fc
  .record({
    hpoId: fc.constantFrom(...HPO_IDS),
    assertion: assertionArb,
    onset: fc.option(fc.constantFrom(...ONSETS), { nil: undefined }),
    resolved: fc.boolean()
  })
  .map(({ hpoId, assertion, onset, resolved }) =>
    onset === undefined
      ? { hpoId, assertion, resolved }
      : { hpoId, assertion, onset, resolved }
  );

const phenotypeSubmissionArb: fc.Arbitrary<PhenotypeSubmission> = fc.record({
  caseId: anyCaseIdArb,
  phenotypes: fc.array(submittedPhenotypeArb, { maxLength: 6 })
});

const prioritisationSubmissionArb: fc.Arbitrary<PrioritisationSubmission> = fc
  .record({
    caseId: anyCaseIdArb,
    rankedVariantIds: fc.array(fc.constantFrom(...VARIANT_IDS), { maxLength: 6 }),
    rankedGenes: fc.array(fc.constantFrom(...GENES), { maxLength: 6 }),
    appliedInheritanceModel: fc.option(inheritanceModelArb, { nil: undefined })
  })
  .map(({ caseId, rankedVariantIds, rankedGenes, appliedInheritanceModel }) =>
    appliedInheritanceModel === undefined
      ? { caseId, rankedVariantIds, rankedGenes }
      : { caseId, rankedVariantIds, rankedGenes, appliedInheritanceModel }
  );

const reanalysisSubmissionArb: fc.Arbitrary<ReanalysisSubmission> = fc.record({
  caseId: anyCaseIdArb,
  updateId: fc.constantFrom(...UPDATE_IDS),
  matched: fc.boolean(),
  explanationComplete: fc.boolean(),
  linkedToTrigger: fc.boolean(),
  rankingChangeCorrect: fc.boolean()
});

const submittedClaimArb = fc.record({
  hasSourceReference: fc.boolean(),
  supported: fc.boolean(),
  sourceLinkCorrect: fc.boolean(),
  hasUncertaintyIndicator: fc.boolean()
});

const groundingSubmissionArb: fc.Arbitrary<GroundingSubmission> = fc.record({
  caseId: anyCaseIdArb,
  claims: fc.array(submittedClaimArb, { maxLength: 6 }),
  outputValidationPassed: fc.boolean()
});

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

/** Every ratio/rate/accuracy metric produced across all four families. */
function rateMetrics(
  phenotype: PhenotypeMetrics,
  prioritisation: PrioritisationMetrics,
  reanalysis: ReanalysisMetrics,
  grounding: GroundingMetrics
): number[] {
  return [
    phenotype.precision,
    phenotype.recall,
    phenotype.f1,
    phenotype.assertionAccuracy,
    phenotype.onsetAccuracy,
    phenotype.hpoMappingAccuracy,
    phenotype.unsupportedTermRate,
    prioritisation.top5Recall,
    prioritisation.top10Recall,
    prioritisation.inheritanceFilterAccuracy,
    reanalysis.retrievalCorrectness,
    reanalysis.falsePositiveRate,
    reanalysis.explanationCompleteness,
    reanalysis.evidenceLinkage,
    reanalysis.rankingChangeAccuracy,
    grounding.validSourceReferenceRate,
    grounding.unsupportedClaimRate,
    grounding.incorrectSourceLinkRate,
    grounding.missingUncertaintyRate,
    grounding.outputValidationFailureRate
  ];
}

function assertReportInRange(report: EvaluationReport): void {
  for (const value of rateMetrics(
    report.phenotype,
    report.prioritisation,
    report.reanalysis,
    report.grounding
  )) {
    expect(isInMetricRange(value)).toBe(true);
  }
  for (const perCase of report.prioritisation.perCase) {
    expect(isValidRank(perCase.causalVariantRank)).toBe(true);
    expect(isValidRank(perCase.causalGeneRank)).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Property 68
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 68: Evaluation metrics stay within defined ranges", () => {
  // Validates: Requirements 30.1, 30.2, 30.3, 30.4
  it("keeps every computed metric in [0.0, 1.0] and every rank a positive integer or not-ranked, for any submission", () => {
    fc.assert(
      fc.property(
        readerArb,
        fc.array(phenotypeSubmissionArb, { maxLength: 8 }),
        fc.array(prioritisationSubmissionArb, { maxLength: 8 }),
        fc.array(reanalysisSubmissionArb, { maxLength: 8 }),
        fc.array(groundingSubmissionArb, { maxLength: 8 }),
        (reader, phenotype, prioritisation, reanalysis, grounding) => {
          // Whole-framework composition (runEvaluation).
          const report = runEvaluation(
            { phenotype, prioritisation, reanalysis, grounding },
            reader,
            { now: "2024-01-01T00:00:00.000Z" }
          );
          assertReportInRange(report);

          // Individual scoring functions, each with a fresh exclusion log.
          const phenotypeMetrics = scorePhenotypeExtraction(
            phenotype,
            reader,
            new ExclusionLog()
          );
          const prioritisationMetrics = scoreVariantPrioritisation(
            prioritisation,
            reader,
            new ExclusionLog()
          );
          const reanalysisMetrics = scoreReanalysisMatching(
            reanalysis,
            reader,
            new ExclusionLog()
          );
          const groundingMetrics = scoreAiGrounding(grounding, new ExclusionLog());

          for (const value of rateMetrics(
            phenotypeMetrics,
            prioritisationMetrics,
            reanalysisMetrics,
            groundingMetrics
          )) {
            expect(isInMetricRange(value)).toBe(true);
          }
          for (const perCase of prioritisationMetrics.perCase) {
            expect(isValidRank(perCase.causalVariantRank)).toBe(true);
            expect(isValidRank(perCase.causalGeneRank)).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
