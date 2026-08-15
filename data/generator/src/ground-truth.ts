// data/generator/src/ground-truth.ts
//
// Hidden per-case Ground_Truth generation (task 7.2).
//
// A Ground_Truth record describes the *intended answer* for a synthetic case:
// the intended causal finding(s), the expected diagnostic outcome, and the
// expected relevant phenotypes (Requirements 2.10, 30.6).
//
// CRITICAL ISOLATION PROPERTY: Ground_Truth is modelled as a distinct typed
// structure that is returned SEPARATELY from the application-facing
// `GeneratedCase` (Case/Patient). It is *never* embedded in the Case or Patient
// entities that interactive users see. Downstream (the CDK) isolates a
// Ground_Truth bucket readable only by the Evaluation_Framework; here we mirror
// that boundary in the data model by keeping Ground_Truth in its own type and
// its own keyed collection. Its access classification is `ground_truth`
// (Requirements 2.10, 3.6, 30.6).

import type { InheritanceModel } from "@udn/domain";
import type { CaseGenerationSpec } from "./generator.js";
import { SYNTHETIC_ID_MARKER } from "./identifiers.js";
import type {
  CaseArchetype,
  ClinicalArea,
  DiagnosticOutcome
} from "./taxonomy.js";

/**
 * Access classification for Ground_Truth data. Matches the domain
 * `AccessClassification` literal reserved for evaluation-only material
 * (Requirements 2.10, 3.6, 30.6).
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

/**
 * A single intended causal finding: the synthetic gene and variant a solved
 * case is designed to resolve to, with its intended inheritance and zygosity.
 * All identifiers are clearly synthetic.
 */
export interface CausalFinding {
  /** Clearly-synthetic gene symbol (e.g. `SYNGENE-CARDIAC-1`). */
  gene: string;
  /** Clearly-synthetic normalized variant identifier. */
  variantId: string;
  /** Intended inheritance model for this finding. */
  inheritanceModel: InheritanceModel;
  /** Intended allelic state. */
  zygosity: Zygosity;
}

/**
 * The hidden intended answer for one case. Stored SEPARATELY from the
 * case-facing Case/Patient entities (Requirements 2.10, 30.6).
 */
export interface GroundTruth {
  /** The case this Ground_Truth belongs to. */
  caseId: string;
  /** Evaluation-only access classification (Req 2.10, 3.6, 30.6). */
  accessClassification: typeof GROUND_TRUTH_ACCESS_CLASSIFICATION;
  /** Ground_Truth is itself synthetic. */
  syntheticIndicator: true;
  /** The archetype the case was built from. */
  archetype: CaseArchetype;
  /** The expected diagnostic outcome for the case. */
  expectedOutcome: DiagnosticOutcome;
  /** Intended causal finding(s): 0 for unsolved/non-genetic, 1–2 otherwise. */
  causalFindings: CausalFinding[];
  /** Expected relevant phenotypes (clearly-synthetic HPO-like identifiers). */
  expectedPhenotypes: string[];
  /**
   * For a non-genetic outcome, the intended non-genetic explanation; otherwise
   * undefined.
   */
  nonGeneticExplanation?: string;
  /** Human-readable note describing the intended answer. */
  note: string;
}

/** Deterministic zygosity for an intended finding. */
function zygosityFor(
  archetype: CaseArchetype,
  inheritance: InheritanceModel
): Zygosity {
  if (archetype === "mosaic_variant") {
    return "mosaic";
  }
  switch (inheritance) {
    case "autosomal_recessive":
      return "homozygous";
    case "autosomal_dominant":
      return "heterozygous";
    case "x_linked":
      return "hemizygous";
    case "mitochondrial":
      return "homoplasmic";
    case "sporadic":
      return "heterozygous";
    case "uncertain":
      return "unknown";
    default: {
      const _exhaustive: never = inheritance;
      return _exhaustive;
    }
  }
}

/** Uppercase, hyphen-safe token for a clinical area (used in synthetic ids). */
function areaToken(area: ClinicalArea): string {
  return area.toUpperCase().replace(/[^A-Z0-9]+/g, "-");
}

/** Build one clearly-synthetic causal finding for a case. */
function buildCausalFinding(
  spec: CaseGenerationSpec,
  seedHex: string,
  index: string,
  ordinal: number
): CausalFinding {
  const token = areaToken(spec.clinicalArea);
  return {
    gene: `SYNGENE-${token}-${ordinal}`,
    variantId: `${SYNTHETIC_ID_MARKER}-var-${seedHex}-${index}-${ordinal}`,
    inheritanceModel: spec.inheritanceModel,
    zygosity: zygosityFor(spec.archetype, spec.inheritanceModel)
  };
}

/**
 * How many intended causal findings a given outcome carries.
 *  - confirmed / revised diagnoses: exactly one causal finding
 *  - dual diagnosis: two
 *  - non-genetic explanation and unsolved: none
 */
function causalFindingCount(outcome: DiagnosticOutcome): number {
  switch (outcome) {
    case "confirmed_diagnosis":
    case "revised_diagnosis":
      return 1;
    case "dual_diagnosis":
      return 2;
    case "non_genetic_explanation":
    case "unsolved":
      return 0;
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

/** Build the expected relevant phenotypes (2–4 clearly-synthetic HPO-like ids). */
function buildExpectedPhenotypes(
  spec: CaseGenerationSpec,
  index: number
): string[] {
  const token = areaToken(spec.clinicalArea);
  // Deterministic count in [2, 4] derived from the case index.
  const count = 2 + (index % 3);
  const phenotypes: string[] = [];
  for (let i = 1; i <= count; i++) {
    phenotypes.push(`SYN-HP-${token}-${i}`);
  }
  return phenotypes;
}

/** Arguments needed to build a case's Ground_Truth. */
export interface BuildGroundTruthArgs {
  caseId: string;
  spec: CaseGenerationSpec;
  /** 8-character hex form of the generation seed (for stable variant ids). */
  seedHex: string;
  /** Zero-based case index within the corpus. */
  index: number;
}

/** Zero-padded index for stable, human-readable synthetic identifiers. */
function pad(index: number): string {
  return String(index).padStart(3, "0");
}

/**
 * Build the hidden Ground_Truth for a single case, derived from its
 * {@link CaseGenerationSpec} (archetype, inheritance model, and intended
 * diagnostic outcome). Deterministic in its inputs (Requirements 2.10, 30.6).
 */
export function buildGroundTruth(args: BuildGroundTruthArgs): GroundTruth {
  const { caseId, spec, seedHex, index } = args;
  const paddedIndex = pad(index);
  const outcome = spec.diagnosticOutcome;

  const findingCount = causalFindingCount(outcome);
  const causalFindings: CausalFinding[] = [];
  for (let ordinal = 1; ordinal <= findingCount; ordinal++) {
    causalFindings.push(
      buildCausalFinding(spec, seedHex, paddedIndex, ordinal)
    );
  }

  const nonGeneticExplanation =
    outcome === "non_genetic_explanation"
      ? `Synthetic non-genetic explanation for a ${spec.clinicalArea} presentation`
      : undefined;

  const note =
    outcome === "unsolved"
      ? `Intended to remain unsolved pending reanalysis: ${spec.title}`
      : `Intended answer for: ${spec.title}`;

  return {
    caseId,
    accessClassification: GROUND_TRUTH_ACCESS_CLASSIFICATION,
    syntheticIndicator: true,
    archetype: spec.archetype,
    expectedOutcome: outcome,
    causalFindings,
    expectedPhenotypes: buildExpectedPhenotypes(spec, index),
    ...(nonGeneticExplanation ? { nonGeneticExplanation } : {}),
    note
  };
}
