// evaluation/src/evaluate.ts
//
// Top-level offline evaluation orchestrator (Requirement 30).
//
// Combines the four metric families, the workflow-safety checks, and the
// malformed-entry exclusion log into a single deterministic evaluation report.
// No generative model is invoked anywhere in this framework.

import type { GroundTruthReader } from "./ground-truth.js";
import { ExclusionLog, type Exclusion } from "./exclusion.js";
import {
  scorePhenotypeExtraction,
  type PhenotypeMetrics,
  type PhenotypeSubmission
} from "./phenotype.js";
import {
  scoreVariantPrioritisation,
  type PrioritisationMetrics,
  type PrioritisationSubmission
} from "./prioritisation.js";
import {
  scoreReanalysisMatching,
  type ReanalysisMetrics,
  type ReanalysisSubmission
} from "./reanalysis.js";
import {
  scoreAiGrounding,
  type GroundingMetrics,
  type GroundingSubmission
} from "./grounding.js";
import {
  evaluateSafetyChecks,
  type SafetyCheckResult,
  type SafetyObservations
} from "./safety.js";

/** The complete set of submitted system outputs for one evaluation run. */
export interface EvaluationInput {
  phenotype?: readonly PhenotypeSubmission[];
  prioritisation?: readonly PrioritisationSubmission[];
  reanalysis?: readonly ReanalysisSubmission[];
  grounding?: readonly GroundingSubmission[];
  safety?: SafetyObservations;
}

/** The full evaluation report containing every computed metric (Req 30.8). */
export interface EvaluationReport {
  /** ISO-8601 UTC timestamp the report was generated. */
  generatedAt: string;
  phenotype: PhenotypeMetrics;
  prioritisation: PrioritisationMetrics;
  reanalysis: ReanalysisMetrics;
  grounding: GroundingMetrics;
  safety: SafetyCheckResult[];
  /** Every excluded entry with its recorded reason (Req 30.7). */
  exclusions: readonly Exclusion[];
}

/** Options controlling report generation. */
export interface EvaluationOptions {
  /**
   * Fixed timestamp for deterministic reports/tests. When omitted the current
   * time is used. Supplying a fixed value keeps a run byte-for-byte stable.
   */
  now?: string;
}

/**
 * Run the full offline evaluation against Ground_Truth. Each metric family is
 * scored independently; malformed or unmatched entries are excluded and
 * recorded (Req 30.7); workflow-safety checks are evaluated (Req 30.5). The
 * result contains every computed metric (Req 30.8).
 */
export function runEvaluation(
  input: EvaluationInput,
  groundTruth: GroundTruthReader,
  options: EvaluationOptions = {}
): EvaluationReport {
  const log = new ExclusionLog();

  const phenotype = scorePhenotypeExtraction(
    input.phenotype ?? [],
    groundTruth,
    log
  );
  const prioritisation = scoreVariantPrioritisation(
    input.prioritisation ?? [],
    groundTruth,
    log
  );
  const reanalysis = scoreReanalysisMatching(
    input.reanalysis ?? [],
    groundTruth,
    log
  );
  const grounding = scoreAiGrounding(input.grounding ?? [], log);
  const safety = evaluateSafetyChecks(input.safety ?? {});

  return {
    generatedAt: options.now ?? new Date().toISOString(),
    phenotype,
    prioritisation,
    reanalysis,
    grounding,
    safety,
    exclusions: log.all()
  };
}
