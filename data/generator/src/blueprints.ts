// data/generator/src/blueprints.ts
//
// Curated case "blueprints" that pin the categorical identity of every
// synthetic case: its clinical area (Req 1.2), archetype (Req 1.6),
// inheritance model (Req 1.4), and family structure (Req 1.5). The list is
// hand-authored (rather than combinatorially generated) so each case is
// clinically coherent and the categorical coverage is auditable at a glance.
//
// The seeded generator layers the diverse *decorating* attributes (age, onset,
// sex, ancestry, record completeness, genomic test history — Req 1.3) on top
// of these blueprints; see generator.ts.
//
// Coverage of this table is asserted at runtime by verifyCoverage (coverage.ts)
// and by the unit tests, so an accidental gap fails fast rather than silently
// shipping an incomplete corpus.

import type {
  CaseArchetype,
  ClinicalArea,
  FamilyStructure
} from "./taxonomy.js";
import type { InheritanceModel } from "@udn/domain";

/**
 * The categorical identity of a synthetic case. A short `title` gives each
 * case a human-readable, clearly-synthetic label for demonstrations.
 */
export interface CaseBlueprint {
  clinicalArea: ClinicalArea;
  archetype: CaseArchetype;
  inheritanceModel: InheritanceModel;
  familyStructure: FamilyStructure;
  title: string;
}

/**
 * 32 curated blueprints (>= 30 required by Req 1.1). Collectively they cover
 * all 12 clinical areas, all 10 archetypes, all 6 inheritance models, and both
 * single-patient and family-based structures. See verifyCoverage for the
 * enforced guarantees.
 */
export const CASE_BLUEPRINTS: readonly CaseBlueprint[] = [
  {
    clinicalArea: "neurodevelopmental",
    archetype: "previously_missed_diagnosis",
    inheritanceModel: "autosomal_dominant",
    familyStructure: "single_patient",
    title: "Global developmental delay with a re-examined prior variant"
  },
  {
    clinicalArea: "neurodevelopmental",
    archetype: "newly_established_gene_disease",
    inheritanceModel: "autosomal_recessive",
    familyStructure: "trio",
    title: "Neurodevelopmental disorder linked to a newly described gene"
  },
  {
    clinicalArea: "neurodevelopmental",
    archetype: "repeat_expansion",
    inheritanceModel: "x_linked",
    familyStructure: "single_patient",
    title: "Intellectual disability with an X-linked repeat expansion"
  },
  {
    clinicalArea: "neuromuscular",
    archetype: "repeat_expansion",
    inheritanceModel: "autosomal_dominant",
    familyStructure: "extended_family",
    title: "Progressive myopathy with a dominant repeat expansion"
  },
  {
    clinicalArea: "neuromuscular",
    archetype: "structural_variant",
    inheritanceModel: "x_linked",
    familyStructure: "trio",
    title: "Muscular dystrophy from an X-linked structural variant"
  },
  {
    clinicalArea: "neuromuscular",
    archetype: "unsolved_case",
    inheritanceModel: "uncertain",
    familyStructure: "single_patient",
    title: "Unexplained progressive weakness, prior testing non-diagnostic"
  },
  {
    clinicalArea: "mitochondrial",
    archetype: "mitochondrial",
    inheritanceModel: "mitochondrial",
    familyStructure: "trio",
    title: "Mitochondrial encephalopathy with an mtDNA variant"
  },
  {
    clinicalArea: "mitochondrial",
    archetype: "mitochondrial",
    inheritanceModel: "autosomal_recessive",
    familyStructure: "single_patient",
    title: "Mitochondrial disease from a nuclear-encoded recessive variant"
  },
  {
    clinicalArea: "metabolic",
    archetype: "previously_missed_diagnosis",
    inheritanceModel: "autosomal_recessive",
    familyStructure: "single_patient",
    title: "Inborn error of metabolism missed on earlier review"
  },
  {
    clinicalArea: "metabolic",
    archetype: "newly_established_gene_disease",
    inheritanceModel: "autosomal_recessive",
    familyStructure: "trio",
    title: "Metabolic phenotype tied to a newly established association"
  },
  {
    clinicalArea: "immunodeficiency",
    archetype: "structural_variant",
    inheritanceModel: "autosomal_recessive",
    familyStructure: "single_patient",
    title: "Primary immunodeficiency from a copy-number deletion"
  },
  {
    clinicalArea: "immunodeficiency",
    archetype: "dual_diagnosis",
    inheritanceModel: "x_linked",
    familyStructure: "trio",
    title: "Immunodeficiency with a second co-occurring condition"
  },
  {
    clinicalArea: "renal",
    archetype: "previously_missed_diagnosis",
    inheritanceModel: "autosomal_dominant",
    familyStructure: "extended_family",
    title: "Familial kidney disease reclassified on re-review"
  },
  {
    clinicalArea: "renal",
    archetype: "phenocopy",
    inheritanceModel: "uncertain",
    familyStructure: "single_patient",
    title: "Renal phenotype mimicking a genetic syndrome (phenocopy)"
  },
  {
    clinicalArea: "cardiac",
    archetype: "newly_established_gene_disease",
    inheritanceModel: "autosomal_dominant",
    familyStructure: "extended_family",
    title: "Familial cardiomyopathy with a newly linked gene"
  },
  {
    clinicalArea: "cardiac",
    archetype: "mosaic_variant",
    inheritanceModel: "sporadic",
    familyStructure: "single_patient",
    title: "Cardiac phenotype driven by a mosaic variant"
  },
  {
    clinicalArea: "connective-tissue",
    archetype: "previously_missed_diagnosis",
    inheritanceModel: "autosomal_dominant",
    familyStructure: "single_patient",
    title: "Connective-tissue disorder overlooked in fragmented records"
  },
  {
    clinicalArea: "connective-tissue",
    archetype: "dual_diagnosis",
    inheritanceModel: "autosomal_recessive",
    familyStructure: "trio",
    title: "Connective-tissue features with a concurrent second diagnosis"
  },
  {
    clinicalArea: "ophthalmic",
    archetype: "structural_variant",
    inheritanceModel: "autosomal_recessive",
    familyStructure: "single_patient",
    title: "Inherited retinal disease from a structural variant"
  },
  {
    clinicalArea: "ophthalmic",
    archetype: "repeat_expansion",
    inheritanceModel: "autosomal_dominant",
    familyStructure: "single_patient",
    title: "Ophthalmic phenotype with a dominant repeat expansion"
  },
  {
    clinicalArea: "hearing",
    archetype: "newly_established_gene_disease",
    inheritanceModel: "autosomal_recessive",
    familyStructure: "trio",
    title: "Syndromic hearing loss tied to a newly described gene"
  },
  {
    clinicalArea: "hearing",
    archetype: "mitochondrial",
    inheritanceModel: "mitochondrial",
    familyStructure: "extended_family",
    title: "Maternally inherited (mitochondrial) hearing loss"
  },
  {
    clinicalArea: "multisystem",
    archetype: "mosaic_variant",
    inheritanceModel: "sporadic",
    familyStructure: "single_patient",
    title: "Multisystem overgrowth from a post-zygotic mosaic variant"
  },
  {
    clinicalArea: "multisystem",
    archetype: "dual_diagnosis",
    inheritanceModel: "uncertain",
    familyStructure: "trio",
    title: "Multisystem presentation explained by two diagnoses"
  },
  {
    clinicalArea: "multisystem",
    archetype: "unsolved_case",
    inheritanceModel: "uncertain",
    familyStructure: "single_patient",
    title: "Unsolved multisystem case awaiting reanalysis"
  },
  {
    clinicalArea: "adult-onset",
    archetype: "repeat_expansion",
    inheritanceModel: "autosomal_dominant",
    familyStructure: "extended_family",
    title: "Adult-onset neurodegeneration with a dominant repeat expansion"
  },
  {
    clinicalArea: "adult-onset",
    archetype: "previously_missed_diagnosis",
    inheritanceModel: "autosomal_dominant",
    familyStructure: "single_patient",
    title: "Adult-onset disorder identifiable in older, sparse records"
  },
  {
    clinicalArea: "adult-onset",
    archetype: "non_genetic_explanation",
    inheritanceModel: "sporadic",
    familyStructure: "single_patient",
    title: "Adult-onset presentation with a non-genetic explanation"
  },
  {
    clinicalArea: "metabolic",
    archetype: "non_genetic_explanation",
    inheritanceModel: "sporadic",
    familyStructure: "single_patient",
    title: "Metabolic disturbance attributable to a non-genetic cause"
  },
  {
    clinicalArea: "neurodevelopmental",
    archetype: "phenocopy",
    inheritanceModel: "sporadic",
    familyStructure: "single_patient",
    title: "Neurodevelopmental phenocopy of a genetic syndrome"
  },
  {
    clinicalArea: "cardiac",
    archetype: "unsolved_case",
    inheritanceModel: "uncertain",
    familyStructure: "single_patient",
    title: "Unexplained cardiac phenotype, no candidate variant yet"
  },
  {
    clinicalArea: "renal",
    archetype: "mosaic_variant",
    inheritanceModel: "sporadic",
    familyStructure: "trio",
    title: "Renal mosaicism identified on deep sequencing"
  }
];
