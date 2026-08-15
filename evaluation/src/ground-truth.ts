// evaluation/src/ground-truth.ts
//
// Ground_Truth reader model for the Evaluation_Framework (Requirements 2.10,
// 3.6, 30.6).
//
// The Evaluation_Framework is the ONLY component permitted to read
// Ground_Truth. Ground_Truth is generated (by the synthetic data generator)
// and stored in an isolated location whose access is granted to this
// framework's identity alone; every other subsystem is denied. This module
// defines the reader-facing schema this privileged reader interprets, plus a
// `GroundTruthReader` abstraction so callers supply an already-authorised
// source of Ground_Truth (a directory, an S3 prefix, an in-memory fixture)
// without this package assuming any particular transport.

import type { InheritanceModel } from "@udn/domain";

/**
 * Access classification reserved for evaluation-only material. Matches the
 * domain `AccessClassification` literal used for Ground_Truth (Req 2.10, 3.6,
 * 30.6). A Ground_Truth record MUST carry this classification; any other value
 * marks the record as malformed for scoring purposes.
 */
export const GROUND_TRUTH_ACCESS_CLASSIFICATION = "ground_truth" as const;

/** Allelic state of an intended causal finding. */
export type Zygosity =
  | "heterozygous"
  | "homozygous"
  | "hemizygous"
  | "homoplasmic"
  | "mosaic"
  | "unknown";

/** The intended diagnostic outcome recorded in Ground_Truth. */
export type ExpectedOutcome =
  | "confirmed_diagnosis"
  | "revised_diagnosis"
  | "dual_diagnosis"
  | "non_genetic_explanation"
  | "unsolved";

/** A single intended causal finding (the answer a solved case resolves to). */
export interface GroundTruthCausalFinding {
  /** Clearly-synthetic gene symbol. */
  gene: string;
  /** Clearly-synthetic normalized variant identifier. */
  variantId: string;
  /** Intended inheritance model for this finding. */
  inheritanceModel: InheritanceModel;
  /** Intended allelic state. */
  zygosity: Zygosity;
}

/** An expected phenotype term with its intended assertion and onset. */
export interface GroundTruthPhenotype {
  /** Expected HPO (or synthetic HPO-like) identifier. */
  hpoId: string;
  /** Expected assertion polarity. */
  assertion: "present" | "absent" | "uncertain" | "historical";
  /** Expected onset descriptor, when the answer pins one. */
  onset?: string;
}

/**
 * The hidden intended answer for one case, as read by the Evaluation_Framework.
 * Kept intentionally separate from any case-facing entity.
 */
export interface GroundTruth {
  /** The case this Ground_Truth belongs to. */
  caseId: string;
  /** Evaluation-only access classification (Req 2.10, 3.6, 30.6). */
  accessClassification: typeof GROUND_TRUTH_ACCESS_CLASSIFICATION;
  /** Ground_Truth is itself synthetic. */
  syntheticIndicator: true;
  /** The expected diagnostic outcome for the case. */
  expectedOutcome: ExpectedOutcome;
  /** Intended causal finding(s): 0 for unsolved/non-genetic, 1–2 otherwise. */
  causalFindings: GroundTruthCausalFinding[];
  /** Expected relevant phenotypes for phenotype-extraction scoring. */
  expectedPhenotypes: GroundTruthPhenotype[];
  /**
   * Case identifiers expected to be affected by a given Knowledge_Update,
   * keyed by update id, for reanalysis-matching scoring. Optional: absent when
   * the case carries no reanalysis expectation.
   */
  expectedReanalysisMatches?: Record<string, boolean>;
}

/**
 * A source of Ground_Truth already authorised for this framework's identity.
 * Callers wire this to a directory, S3 prefix, or fixture; the framework never
 * exposes Ground_Truth to any other component.
 */
export interface GroundTruthReader {
  /** Return the Ground_Truth for a case, or `undefined` when none exists. */
  read(caseId: string): GroundTruth | undefined;
}

/**
 * A deterministic in-memory {@link GroundTruthReader}. Suitable for offline
 * scoring runs where Ground_Truth has been loaded into memory by an authorised
 * process, and for tests.
 */
export class InMemoryGroundTruthReader implements GroundTruthReader {
  private readonly byCase: Map<string, GroundTruth>;

  constructor(records: readonly GroundTruth[]) {
    this.byCase = new Map();
    for (const record of records) {
      this.byCase.set(record.caseId, record);
    }
  }

  read(caseId: string): GroundTruth | undefined {
    return this.byCase.get(caseId);
  }
}

/**
 * Structural guard: is `value` a well-formed Ground_Truth record this framework
 * can score against? A record that fails this guard is treated as malformed and
 * excluded from scoring with a recorded reason (Req 30.7).
 */
export function isWellFormedGroundTruth(value: unknown): value is GroundTruth {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record["caseId"] === "string" &&
    record["caseId"].length > 0 &&
    record["accessClassification"] === GROUND_TRUTH_ACCESS_CLASSIFICATION &&
    record["syntheticIndicator"] === true &&
    Array.isArray(record["causalFindings"]) &&
    Array.isArray(record["expectedPhenotypes"])
  );
}
