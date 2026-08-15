// data/generator/src/demo-cases.ts
//
// Curated demonstration cases (task 33.1).
//
// The Navigator ships at least three polished demonstration cases, each of
// which runs to completion and produces its full expected result set without
// unhandled errors (see docs/DEMO_GUIDE.md). This module pins those three
// cases to specific, clinically-coherent scenarios and produces each case's
// complete artifact bundle + hidden Ground_Truth DETERMINISTICALLY by reusing
// the existing generator machinery (blueprints -> buildGeneratedCase ->
// buildGroundTruth -> composeCaseArtifacts). No generative model is involved.
//
// The three scenarios map one-to-one onto the demo guide:
//
//   1. missed_phenotype              — a `previously_missed_diagnosis` case
//      where AI phenotype extraction + human confirmation surface a
//      previously missed phenotype.
//   2. structural_variant            — a `structural_variant` case whose
//      resolution depends on a structural variant in the genomic results
//      (its artifact bundle carries CNV/SV results, Req 2.9).
//   3. knowledge_triggered_reanalysis — an `unsolved_case` that carries stored
//      candidate variants, genes, and phenotype associations but no confirmed
//      answer, so it can be re-surfaced when a simulated Knowledge_Update
//      references one of those stored references.
//
// SYNTHETIC + ISOLATED: every identifier is minted through the synthetic-id
// path, every case carries the synthetic indicator, and Ground_Truth is kept
// in its own field (never embedded in the Case/Patient entities) exactly as
// the corpus generator does (Requirements 1.7, 1.9, 2.1, 2.10, 30.6).

import { composeCaseArtifacts, type CaseArtifacts } from "./artifacts.js";
import type { CaseBlueprint } from "./blueprints.js";
import {
  buildGeneratedCase,
  type GeneratedCase
} from "./generator.js";
import { buildGroundTruth, type GroundTruth } from "./ground-truth.js";
import type {
  AgeBucket,
  Ancestry,
  GenomicTestHistory,
  OnsetCategory,
  RecordCompleteness,
  Sex
} from "./taxonomy.js";

/**
 * Dedicated seed for the demonstration corpus. Distinct from the default
 * corpus seed so demo case identifiers never collide with the main library.
 */
export const DEMO_SEED = 0xde305eed >>> 0;

/** The three demonstration scenarios, in guided-demo order. */
export const DEMO_SCENARIOS = [
  "missed_phenotype",
  "structural_variant",
  "knowledge_triggered_reanalysis"
] as const;

/** A single demonstration scenario identifier. */
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

/**
 * The fully-pinned definition of one demonstration case: its scenario, a
 * stable human-readable id, a short description, a corpus index (kept well
 * above the corpus range so ids never collide), the categorical
 * {@link CaseBlueprint}, and the pinned decorating attributes.
 */
interface DemoCaseDefinition {
  scenario: DemoScenario;
  /** Stable, clearly-synthetic demonstration identifier. */
  id: string;
  /** Short human-readable description of what the case demonstrates. */
  description: string;
  /** Corpus index; offset well above the corpus range to avoid id collisions. */
  index: number;
  blueprint: CaseBlueprint;
  age: AgeBucket;
  onset: OnsetCategory;
  sex: Sex;
  ancestry: Ancestry;
  recordCompleteness: RecordCompleteness;
  genomicTestHistory: GenomicTestHistory;
}

/**
 * The three curated demonstration case definitions. Every attribute is pinned
 * (not seeded) so the demonstrations are polished and byte-for-byte stable.
 */
const DEMO_CASE_DEFINITIONS: readonly DemoCaseDefinition[] = [
  {
    scenario: "missed_phenotype",
    id: "demo-missed-phenotype",
    description:
      "AI phenotype extraction and clinician confirmation surface a " +
      "previously missed phenotype in fragmented records (synthetic).",
    index: 900,
    blueprint: {
      clinicalArea: "neurodevelopmental",
      archetype: "previously_missed_diagnosis",
      inheritanceModel: "autosomal_dominant",
      familyStructure: "single_patient",
      title:
        "Demo A - Missed phenotype surfaced by extraction and confirmation (synthetic)"
    },
    age: "child",
    onset: "childhood",
    sex: "female",
    ancestry: "european",
    recordCompleteness: "sparse",
    genomicTestHistory: "exome_prior"
  },
  {
    scenario: "structural_variant",
    id: "demo-structural-variant",
    description:
      "Diagnosis resolved by a structural variant in the genomic results " +
      "(the case carries CNV/SV results) (synthetic).",
    index: 901,
    blueprint: {
      clinicalArea: "immunodeficiency",
      archetype: "structural_variant",
      inheritanceModel: "autosomal_recessive",
      familyStructure: "single_patient",
      title: "Demo B - Diagnosis resolved by a structural variant (synthetic)"
    },
    age: "infant",
    onset: "infantile",
    sex: "male",
    ancestry: "admixed_american",
    recordCompleteness: "partial",
    genomicTestHistory: "panel_only"
  },
  {
    scenario: "knowledge_triggered_reanalysis",
    id: "demo-knowledge-triggered-reanalysis",
    description:
      "Unresolved case re-surfaced when a simulated Knowledge_Update " +
      "references one of its stored variants, genes, or phenotypes (synthetic).",
    index: 902,
    blueprint: {
      clinicalArea: "multisystem",
      archetype: "unsolved_case",
      inheritanceModel: "uncertain",
      familyStructure: "single_patient",
      title:
        "Demo C - Unresolved case re-surfaced by a simulated knowledge update (synthetic)"
    },
    age: "adult",
    onset: "adult",
    sex: "unknown",
    ancestry: "south_asian",
    recordCompleteness: "comprehensive",
    genomicTestHistory: "genome_prior"
  }
];

/**
 * A fully-composed demonstration case: the demo metadata, the application-facing
 * {@link GeneratedCase}, the hidden {@link GroundTruth} (kept separate, never
 * embedded in the Case/Patient), and the complete {@link CaseArtifacts} bundle.
 */
export interface DemoCase {
  scenario: DemoScenario;
  /** Stable, clearly-synthetic demonstration identifier. */
  id: string;
  /** Human-readable, clearly-synthetic case title. */
  title: string;
  /** Short description of what the case demonstrates. */
  description: string;
  /** The minted synthetic case id (embeds the demo seed). */
  caseId: string;
  /** Application-facing Case + Patient + selection spec. */
  generated: GeneratedCase;
  /** Hidden intended answer, isolated from the case-facing entities. */
  groundTruth: GroundTruth;
  /** Complete per-case artifact bundle (FHIR / Phenopacket / pedigree / genomic). */
  artifacts: CaseArtifacts;
}

/** 8-character hex form of the demo seed, used for stable synthetic ids. */
const DEMO_SEED_HEX = DEMO_SEED.toString(16).padStart(8, "0");

/** Compose a single demonstration case from its pinned definition. */
function buildDemoCase(definition: DemoCaseDefinition): DemoCase {
  const generated = buildGeneratedCase({
    blueprint: definition.blueprint,
    index: definition.index,
    seedHex: DEMO_SEED_HEX,
    age: definition.age,
    onset: definition.onset,
    sex: definition.sex,
    ancestry: definition.ancestry,
    recordCompleteness: definition.recordCompleteness,
    genomicTestHistory: definition.genomicTestHistory
  });

  const caseId = generated.case.caseId;
  const groundTruth = buildGroundTruth({
    caseId,
    spec: generated.spec,
    seedHex: DEMO_SEED_HEX,
    index: definition.index
  });
  const artifacts = composeCaseArtifacts(generated, groundTruth);

  return {
    scenario: definition.scenario,
    id: definition.id,
    title: definition.blueprint.title,
    description: definition.description,
    caseId,
    generated,
    groundTruth,
    artifacts
  };
}

/**
 * Generate the three polished demonstration cases, each with its full artifact
 * bundle and hidden Ground_Truth. Deterministic: called repeatedly it returns
 * deeply-equal results (no seed input, no wall clock, no generative model).
 */
export function generateDemoCases(): DemoCase[] {
  return DEMO_CASE_DEFINITIONS.map(buildDemoCase);
}

/**
 * Retrieve the single demonstration case for a given scenario. Throws if the
 * scenario is unknown (the {@link DemoScenario} type makes that unreachable for
 * type-checked callers).
 */
export function getDemoCase(scenario: DemoScenario): DemoCase {
  const definition = DEMO_CASE_DEFINITIONS.find(
    (candidate) => candidate.scenario === scenario
  );
  if (!definition) {
    throw new RangeError(`Unknown demonstration scenario: ${scenario}`);
  }
  return buildDemoCase(definition);
}
