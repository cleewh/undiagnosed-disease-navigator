// services/prioritisation/src/factors.ts
//
// The fixed, ordered deterministic scoring factor set, pinned weights, and the
// recorded prioritisation logic version (Requirements 10.1, 10.5, 10.7).
//
// This module is PURE and DETERMINISTIC. Every factor is a deterministic
// function of the item's inputs and the pinned knowledge snapshot; there are no
// randomised inputs (Req 10.1) and no generative-model interpretation (Req 10.6).
//
// The exact factor set, weights, tie-break order, and the enumerations below
// are FROZEN per `PRIORITISATION_LOGIC_VERSION`. Any change to scoring
// behaviour must bump that version so every recorded ranking remains
// reproducible against the logic that produced it (Req 10.7).

/**
 * Identifier of the pinned prioritisation logic version recorded on every
 * completed ranking (Req 10.7). Bump this whenever the factor set, weights,
 * enumerations, or tie-break order change.
 */
export const PRIORITISATION_LOGIC_VERSION = "priority-logic-v1";

// ---------------------------------------------------------------------------
// Factor 1 — predicted molecular consequence severity (LoF > missense > ...)
// ---------------------------------------------------------------------------

/**
 * Ordered molecular-consequence categories, MOST severe first. The severity
 * factor value is the position mapped onto [0,1] (most severe = 1.0). The order
 * also drives the first tie-break step (higher severity wins).
 */
export const MOLECULAR_CONSEQUENCES = [
  "loss_of_function",
  "splice",
  "missense",
  "inframe_indel",
  "synonymous",
  "non_coding"
] as const;

export type MolecularConsequence = (typeof MOLECULAR_CONSEQUENCES)[number];

/**
 * Deterministic severity value in [0,1] for a molecular consequence: the most
 * severe category scores 1.0 and the least severe scores 0.0, evenly spaced.
 */
export function molecularConsequenceSeverity(consequence: MolecularConsequence): number {
  const index = MOLECULAR_CONSEQUENCES.indexOf(consequence);
  const lastIndex = MOLECULAR_CONSEQUENCES.length - 1;
  // Position 0 (most severe) -> 1.0; last position -> 0.0.
  return (lastIndex - index) / lastIndex;
}

// ---------------------------------------------------------------------------
// Factor 2 — population allele-frequency rarity (rarer scores higher)
// ---------------------------------------------------------------------------

/**
 * Deterministic allele-frequency rarity bins (Req 10.1: "deterministic bins").
 * Rarer frequencies score higher. `maxExclusive` is the upper bound (exclusive)
 * of the bin; the list is ordered from rarest to most common.
 */
export const ALLELE_FREQUENCY_BINS: readonly { maxExclusive: number; value: number }[] = [
  { maxExclusive: 0.000001, value: 1.0 }, // effectively novel
  { maxExclusive: 0.0001, value: 0.9 },
  { maxExclusive: 0.001, value: 0.7 },
  { maxExclusive: 0.01, value: 0.5 },
  { maxExclusive: 0.05, value: 0.3 },
  { maxExclusive: Number.POSITIVE_INFINITY, value: 0.1 }
];

/** Deterministic rarity value in [0,1] for a population allele frequency. */
export function alleleFrequencyRarity(alleleFrequency: number): number {
  for (const bin of ALLELE_FREQUENCY_BINS) {
    if (alleleFrequency < bin.maxExclusive) {
      return bin.value;
    }
  }
  // Unreachable: the final bin's bound is +Infinity.
  return 0.1;
}

// ---------------------------------------------------------------------------
// Factor 3 — ClinVar-style classification (from the pinned snapshot)
// ---------------------------------------------------------------------------

/** Ordered ClinVar-style classifications, most pathogenic first. */
export const CLINVAR_CLASSIFICATIONS = [
  "pathogenic",
  "likely_pathogenic",
  "uncertain_significance",
  "likely_benign",
  "benign"
] as const;

export type ClinvarClassification = (typeof CLINVAR_CLASSIFICATIONS)[number];

const CLINVAR_VALUES: Readonly<Record<ClinvarClassification, number>> = {
  pathogenic: 1.0,
  likely_pathogenic: 0.75,
  uncertain_significance: 0.5,
  likely_benign: 0.25,
  benign: 0.0
};

/** Deterministic value in [0,1] for a ClinVar-style classification. */
export function clinvarClassificationValue(classification: ClinvarClassification): number {
  return CLINVAR_VALUES[classification];
}

// ---------------------------------------------------------------------------
// Factor 4 — gene-disease association strength for the case phenotypes
// ---------------------------------------------------------------------------

/** Ordered gene-disease association strengths, strongest first. */
export const GENE_DISEASE_STRENGTHS = [
  "definitive",
  "strong",
  "moderate",
  "limited",
  "no_known"
] as const;

export type GeneDiseaseStrength = (typeof GENE_DISEASE_STRENGTHS)[number];

const GENE_DISEASE_VALUES: Readonly<Record<GeneDiseaseStrength, number>> = {
  definitive: 1.0,
  strong: 0.75,
  moderate: 0.5,
  limited: 0.25,
  no_known: 0.0
};

/** Deterministic value in [0,1] for a gene-disease association strength. */
export function geneDiseaseStrengthValue(strength: GeneDiseaseStrength): number {
  return GENE_DISEASE_VALUES[strength];
}

// ---------------------------------------------------------------------------
// Ordered factor set and pinned weights
// ---------------------------------------------------------------------------

/**
 * The canonical, ordered names of the seven deterministic scoring factors
 * (design: "Fixed factors"). Order is significant: it fixes the order in which
 * per-factor explanations are enumerated (Req 10.5).
 */
export const FACTOR_NAMES = [
  "molecular_consequence_severity",
  "allele_frequency_rarity",
  "clinvar_classification",
  "gene_disease_association",
  "inheritance_fit",
  "phenotype_similarity",
  "quality_pass"
] as const;

export type FactorName = (typeof FACTOR_NAMES)[number];

/**
 * Pinned per-factor weights, frozen per {@link PRIORITISATION_LOGIC_VERSION}.
 * The weights sum to 1.0, so a weighted score is bounded to [0,1] when every
 * factor value is bounded to [0,1].
 */
export const FACTOR_WEIGHTS: Readonly<Record<FactorName, number>> = {
  molecular_consequence_severity: 0.25,
  allele_frequency_rarity: 0.15,
  clinvar_classification: 0.25,
  gene_disease_association: 0.15,
  inheritance_fit: 0.1,
  phenotype_similarity: 0.07,
  quality_pass: 0.03
};
