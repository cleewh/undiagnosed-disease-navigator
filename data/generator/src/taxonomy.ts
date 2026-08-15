// data/generator/src/taxonomy.ts
//
// Controlled vocabularies for the synthetic case dataset. Each vocabulary is
// declared once as a readonly tuple and a derived string-literal union so that
// the generator, the coverage verifier, and downstream tasks (7.2 labelling /
// Ground_Truth, 7.3 artifact composition) all share a single source of truth.
//
// Requirement mapping:
//   Req 1.2 — clinical areas (>= 1 case per area)
//   Req 1.3 — diversity attributes (>= 2 distinct values each)
//   Req 1.4 — inheritance models (>= 1 case per model)
//   Req 1.6 — case archetypes (>= 1 case per archetype)

import type { InheritanceModel } from "@udn/domain";

/**
 * Clinical areas the case library must span, with at least one case each
 * (Requirement 1.2).
 */
export const CLINICAL_AREAS = [
  "neurodevelopmental",
  "neuromuscular",
  "mitochondrial",
  "metabolic",
  "immunodeficiency",
  "renal",
  "cardiac",
  "connective-tissue",
  "ophthalmic",
  "hearing",
  "multisystem",
  "adult-onset"
] as const;
export type ClinicalArea = (typeof CLINICAL_AREAS)[number];

/**
 * Case archetypes the library must represent, with at least one case each
 * (Requirement 1.6).
 */
export const CASE_ARCHETYPES = [
  "previously_missed_diagnosis",
  "newly_established_gene_disease",
  "structural_variant",
  "repeat_expansion",
  "mitochondrial",
  "mosaic_variant",
  "phenocopy",
  "dual_diagnosis",
  "unsolved_case",
  "non_genetic_explanation"
] as const;
export type CaseArchetype = (typeof CASE_ARCHETYPES)[number];

/**
 * Inheritance models the library must represent, with at least one case each
 * (Requirement 1.4). Re-exported from the domain union so the generator and
 * the `Case` entity agree on the exact literal set.
 */
export const INHERITANCE_MODELS: readonly InheritanceModel[] = [
  "sporadic",
  "autosomal_recessive",
  "autosomal_dominant",
  "x_linked",
  "mitochondrial",
  "uncertain"
];

/**
 * Family structure. Drives the single-patient vs family-based distinction
 * (Requirement 1.5) and later trio/family artifact composition (task 7.3).
 */
export const FAMILY_STRUCTURES = [
  "single_patient",
  "trio",
  "quad",
  "extended_family"
] as const;
export type FamilyStructure = (typeof FAMILY_STRUCTURES)[number];

// --- Diversity attributes (Requirement 1.3): >= 2 distinct values each -------

/** Patient age band at presentation. */
export const AGE_BUCKETS = [
  "neonate",
  "infant",
  "child",
  "adolescent",
  "adult",
  "older_adult"
] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

/** Symptom onset category. */
export const ONSET_CATEGORIES = [
  "congenital",
  "neonatal",
  "infantile",
  "childhood",
  "adolescent",
  "adult"
] as const;
export type OnsetCategory = (typeof ONSET_CATEGORIES)[number];

/** Recorded patient sex. */
export const SEXES = ["female", "male", "unknown"] as const;
export type Sex = (typeof SEXES)[number];

/** Broad ancestry grouping (synthetic, non-identifying). */
export const ANCESTRIES = [
  "african",
  "admixed_american",
  "east_asian",
  "european",
  "south_asian",
  "other"
] as const;
export type Ancestry = (typeof ANCESTRIES)[number];

/** How complete the fragmented clinical record is. */
export const RECORD_COMPLETENESS = [
  "sparse",
  "partial",
  "comprehensive"
] as const;
export type RecordCompleteness = (typeof RECORD_COMPLETENESS)[number];

/** Prior genomic testing history for the patient. */
export const GENOMIC_TEST_HISTORIES = [
  "none_prior",
  "panel_only",
  "exome_prior",
  "genome_prior",
  "exome_and_panel"
] as const;
export type GenomicTestHistory = (typeof GENOMIC_TEST_HISTORIES)[number];

/**
 * Intended diagnostic outcome for the case (the "answer" a later Ground_Truth
 * artifact will encode in task 7.2). Deterministically derived from the case
 * archetype by {@link outcomeForArchetype}.
 */
export const DIAGNOSTIC_OUTCOMES = [
  "confirmed_diagnosis",
  "dual_diagnosis",
  "revised_diagnosis",
  "non_genetic_explanation",
  "unsolved"
] as const;
export type DiagnosticOutcome = (typeof DIAGNOSTIC_OUTCOMES)[number];

/**
 * Map a case archetype to its intended diagnostic outcome. Deterministic and
 * total over {@link CASE_ARCHETYPES}, so outcome coverage follows directly
 * from archetype coverage (Requirement 1.3 diagnostic-outcome diversity).
 */
export function outcomeForArchetype(
  archetype: CaseArchetype
): DiagnosticOutcome {
  switch (archetype) {
    case "previously_missed_diagnosis":
    case "newly_established_gene_disease":
    case "structural_variant":
    case "repeat_expansion":
    case "mitochondrial":
    case "mosaic_variant":
      return "confirmed_diagnosis";
    case "dual_diagnosis":
      return "dual_diagnosis";
    case "phenocopy":
      return "revised_diagnosis";
    case "non_genetic_explanation":
      return "non_genetic_explanation";
    case "unsolved_case":
      return "unsolved";
    default: {
      // Exhaustiveness guard: a new archetype must extend this mapping.
      const _exhaustive: never = archetype;
      return _exhaustive;
    }
  }
}
