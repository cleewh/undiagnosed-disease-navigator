// services/prioritisation/src/scoring.ts
//
// Deterministic variant/gene scoring, total-order tie-break, and per-factor
// explanations (Requirement 10: 10.1–10.7).
//
// This engine is PURE and DETERMINISTIC and contains NO AI (design:
// "Deterministic Engines"). It never calls the AI_Gateway or any generative
// model, and produces no AI-generated clinical interpretation (Req 10.6).
//
//   score = Σ (w_i × factor_i)
//
// over the fixed, ordered factor set with pinned weights (see `factors.ts`).
// Byte-for-byte identical inputs always yield identical order and scores
// (Req 10.3) because every factor is a deterministic function of the inputs and
// there are no randomised inputs (Req 10.1). Ties are broken by a fixed,
// documented sequence yielding a strict total order (Req 10.2). Missing/invalid
// inputs are rejected with an error naming the offending input and NO partial
// ranking is produced (Req 10.4).

import type { FactorContribution } from "@udn/domain";
import { InvalidPrioritisationInputError } from "./errors.js";
import {
  CLINVAR_CLASSIFICATIONS,
  FACTOR_WEIGHTS,
  GENE_DISEASE_STRENGTHS,
  MOLECULAR_CONSEQUENCES,
  PRIORITISATION_LOGIC_VERSION,
  alleleFrequencyRarity,
  clinvarClassificationValue,
  geneDiseaseStrengthValue,
  molecularConsequenceSeverity,
  type ClinvarClassification,
  type GeneDiseaseStrength,
  type MolecularConsequence
} from "./factors.js";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Whether a ranked entity is a variant or a gene. */
export type PrioritisationItemKind = "variant" | "gene";

/**
 * The complete set of deterministic scoring inputs for one variant or gene.
 * Every field is required; a missing or out-of-range field causes rejection
 * with no partial ranking (Req 10.4).
 */
export interface PrioritisationItemInput {
  /** Stable, unique identifier for the item (drives the final tie-break). */
  id: string;
  /** Whether this item is a variant or a gene. */
  kind: PrioritisationItemKind;
  /** Predicted molecular consequence category (factor 1). */
  consequence: MolecularConsequence;
  /** Population allele frequency in [0,1] (factor 2). */
  alleleFrequency: number;
  /** ClinVar-style classification from the pinned snapshot (factor 3). */
  clinvarClassification: ClinvarClassification;
  /** Gene-disease association strength for the case phenotypes (factor 4). */
  geneDiseaseAssociation: GeneDiseaseStrength;
  /** Inheritance-model + segregation fit in [0,1] (factor 5). */
  inheritanceFit: number;
  /** Phenotype-similarity score in [0,1] (factor 6). */
  phenotypeSimilarity: number;
  /** Quality/QC pass flag from the candidate list (factor 7). */
  qualityPass: boolean;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * A single deterministic per-factor explanation for a ranked item (Req 10.5):
 * the factor name, its pinned weight, the bounded raw factor value, and the
 * weighted contribution (`weight × rawValue`) it added to the score. Contains
 * NO AI-generated interpretation (Req 10.6).
 */
export interface FactorExplanation {
  factor: string;
  weight: number;
  rawValue: number;
  contribution: number;
}

/** A ranked variant or gene with its score, rank, and factor explanation. */
export interface RankedItem {
  id: string;
  kind: PrioritisationItemKind;
  /** Weighted-sum score in [0,1]. */
  score: number;
  /** 1-based rank in the strict total order (Req 10.2). */
  rank: number;
  /** Full per-factor explanation, in the fixed factor order (Req 10.5). */
  explanation: FactorExplanation[];
  /**
   * Domain-compatible per-factor contributions (`{ factor, contribution }`),
   * suitable for stamping onto a `Variant`/`Gene` envelope (Req 10.5).
   */
  factorContributions: FactorContribution[];
  /** The pinned prioritisation logic version used (Req 10.7). */
  prioritisationLogicVersion: string;
}

/** The completed ranking with the recorded logic version (Req 10.7). */
export interface PrioritisationResult {
  /** The prioritisation logic version that produced this ranking (Req 10.7). */
  logicVersion: string;
  /** Items in strict total-order rank sequence (rank 1 first). */
  ranked: RankedItem[];
}

// ---------------------------------------------------------------------------
// Input validation (Req 10.4)
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUnitInterval(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

/**
 * Validate one item's inputs, throwing {@link InvalidPrioritisationInputError}
 * naming the first missing/invalid input (Req 10.4). Called for every item
 * BEFORE any scoring, so a single invalid item yields no partial ranking.
 */
function validateItem(item: PrioritisationItemInput | undefined, index: number): void {
  if (item === null || typeof item !== "object") {
    throw new InvalidPrioritisationInputError({
      input: "item",
      itemIndex: index,
      reason: "the item is missing or is not an object"
    });
  }

  const id = item.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new InvalidPrioritisationInputError({
      input: "id",
      itemIndex: index,
      reason: "a non-empty string identifier is required"
    });
  }

  if (item.kind !== "variant" && item.kind !== "gene") {
    throw new InvalidPrioritisationInputError({
      input: "kind",
      itemId: id,
      itemIndex: index,
      reason: 'must be "variant" or "gene"'
    });
  }

  if (!MOLECULAR_CONSEQUENCES.includes(item.consequence)) {
    throw new InvalidPrioritisationInputError({
      input: "consequence",
      itemId: id,
      itemIndex: index,
      reason: `must be one of: ${MOLECULAR_CONSEQUENCES.join(", ")}`
    });
  }

  if (!isUnitInterval(item.alleleFrequency)) {
    throw new InvalidPrioritisationInputError({
      input: "alleleFrequency",
      itemId: id,
      itemIndex: index,
      reason: "must be a finite number in [0,1]"
    });
  }

  if (!CLINVAR_CLASSIFICATIONS.includes(item.clinvarClassification)) {
    throw new InvalidPrioritisationInputError({
      input: "clinvarClassification",
      itemId: id,
      itemIndex: index,
      reason: `must be one of: ${CLINVAR_CLASSIFICATIONS.join(", ")}`
    });
  }

  if (!GENE_DISEASE_STRENGTHS.includes(item.geneDiseaseAssociation)) {
    throw new InvalidPrioritisationInputError({
      input: "geneDiseaseAssociation",
      itemId: id,
      itemIndex: index,
      reason: `must be one of: ${GENE_DISEASE_STRENGTHS.join(", ")}`
    });
  }

  if (!isUnitInterval(item.inheritanceFit)) {
    throw new InvalidPrioritisationInputError({
      input: "inheritanceFit",
      itemId: id,
      itemIndex: index,
      reason: "must be a finite number in [0,1]"
    });
  }

  if (!isUnitInterval(item.phenotypeSimilarity)) {
    throw new InvalidPrioritisationInputError({
      input: "phenotypeSimilarity",
      itemId: id,
      itemIndex: index,
      reason: "must be a finite number in [0,1]"
    });
  }

  if (typeof item.qualityPass !== "boolean") {
    throw new InvalidPrioritisationInputError({
      input: "qualityPass",
      itemId: id,
      itemIndex: index,
      reason: "must be a boolean"
    });
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Internal scored record retaining the raw factor values needed by the
 * tie-break comparator (severity, allele frequency, gene-disease value).
 */
interface ScoredItem {
  input: PrioritisationItemInput;
  score: number;
  explanation: FactorExplanation[];
  severityValue: number;
  geneDiseaseValue: number;
}

function explanationEntry(factor: string, rawValue: number): FactorExplanation {
  const weight = FACTOR_WEIGHTS[factor as keyof typeof FACTOR_WEIGHTS];
  return { factor, weight, rawValue, contribution: weight * rawValue };
}

/**
 * Compute the deterministic score and per-factor explanation for one item.
 * The explanation enumerates every factor in the fixed factor order (Req 10.5).
 */
function scoreItem(item: PrioritisationItemInput): ScoredItem {
  const severityValue = molecularConsequenceSeverity(item.consequence);
  const rarityValue = alleleFrequencyRarity(item.alleleFrequency);
  const clinvarValue = clinvarClassificationValue(item.clinvarClassification);
  const geneDiseaseValue = geneDiseaseStrengthValue(item.geneDiseaseAssociation);
  const qualityValue = item.qualityPass ? 1 : 0;

  const explanation: FactorExplanation[] = [
    explanationEntry("molecular_consequence_severity", severityValue),
    explanationEntry("allele_frequency_rarity", rarityValue),
    explanationEntry("clinvar_classification", clinvarValue),
    explanationEntry("gene_disease_association", geneDiseaseValue),
    explanationEntry("inheritance_fit", item.inheritanceFit),
    explanationEntry("phenotype_similarity", item.phenotypeSimilarity),
    explanationEntry("quality_pass", qualityValue)
  ];

  const score = explanation.reduce((sum, entry) => sum + entry.contribution, 0);

  return { input: item, score, explanation, severityValue, geneDiseaseValue };
}

// ---------------------------------------------------------------------------
// Tie-break (Req 10.2) — strict total order
// ---------------------------------------------------------------------------

/**
 * Documented tie-break sequence yielding a strict total order (Req 10.2):
 *   1. higher weighted score
 *   2. higher molecular consequence severity
 *   3. lower population allele frequency
 *   4. stronger gene-disease association
 *   5. lexicographically smaller stable identifier
 *
 * Because identifiers are unique (enforced by validation), step 5 always
 * resolves any remaining tie, leaving no ambiguous ordering.
 */
function compareScored(a: ScoredItem, b: ScoredItem): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.severityValue !== b.severityValue) return b.severityValue - a.severityValue;
  if (a.input.alleleFrequency !== b.input.alleleFrequency) {
    return a.input.alleleFrequency - b.input.alleleFrequency;
  }
  if (a.geneDiseaseValue !== b.geneDiseaseValue) return b.geneDiseaseValue - a.geneDiseaseValue;
  if (a.input.id < b.input.id) return -1;
  if (a.input.id > b.input.id) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rank variants and/or genes deterministically (Req 10.1–10.7).
 *
 * Validates every item first; if any required input is missing or invalid the
 * whole request is rejected with {@link InvalidPrioritisationInputError} and NO
 * partial ranking is produced (Req 10.4). Item identifiers must be unique —
 * a duplicate id is rejected, because it would make the total order ambiguous
 * (Req 10.2). Otherwise computes each item's weighted score, applies the fixed
 * tie-break to produce a strict total order, and returns per-factor
 * explanations plus the recorded logic version (Req 10.5, 10.7).
 *
 * Pure and deterministic: identical inputs always yield identical order and
 * scores (Req 10.3), independent of the order in which items are supplied.
 *
 * @throws {InvalidPrioritisationInputError} on any missing/invalid/duplicate input.
 */
export function prioritise(items: readonly PrioritisationItemInput[]): PrioritisationResult {
  if (!Array.isArray(items)) {
    throw new InvalidPrioritisationInputError({
      input: "items",
      reason: "a list of items is required"
    });
  }

  // Validate all items BEFORE scoring so no partial ranking is produced (10.4).
  const seenIds = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    validateItem(item, index);
    // `validateItem` guarantees a non-empty string id when it returns.
    const id = (item as PrioritisationItemInput).id;
    if (seenIds.has(id)) {
      throw new InvalidPrioritisationInputError({
        input: "id",
        itemId: id,
        itemIndex: index,
        reason: "duplicate identifier; identifiers must be unique for a total order"
      });
    }
    seenIds.add(id);
  }

  const scored = items.map((item) => scoreItem(item));
  scored.sort(compareScored);

  const ranked: RankedItem[] = scored.map((entry, position) => ({
    id: entry.input.id,
    kind: entry.input.kind,
    score: entry.score,
    rank: position + 1,
    explanation: entry.explanation,
    factorContributions: entry.explanation.map((e) => ({
      factor: e.factor,
      contribution: e.contribution
    })),
    prioritisationLogicVersion: PRIORITISATION_LOGIC_VERSION
  }));

  return { logicVersion: PRIORITISATION_LOGIC_VERSION, ranked };
}
