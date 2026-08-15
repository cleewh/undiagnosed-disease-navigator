// services/evidence-gap/src/case-data.ts
//
// Input shapes for the evidence-gap rules engine (Gap_Service, task 16.1).
//
// `GapCaseData` is a deterministic, self-contained projection of the case data
// that gap rules reason over. It is declared locally (rather than importing the
// generator's rich `CaseArtifacts`) so the engine has no runtime dependency
// beyond `@udn/domain` and so rule predicates operate on a small, stable, and
// explicitly-referenced surface. Every element a rule can inspect carries a
// `ref` (a stable case-data element reference) so that a triggered gap can be
// linked back to the exact element that triggered it (Req 8.4).

/**
 * The kinds of genomic analysis whose presence/absence gap rules consider.
 * `genome` and `exome` are both treated as primary sequence analyses.
 */
export type GenomicAnalysisType =
  | "genome"
  | "exome"
  | "sv"
  | "repeat"
  | "mitochondrial";

/** A biosample collected for the case, with its pedigree relationship. */
export interface GapBiosample {
  /** Stable case-data element reference (Req 8.4). */
  ref: string;
  /**
   * Relationship of the sampled individual to the proband, e.g. "proband",
   * "mother", "father", "sibling". Compared case-insensitively.
   */
  relationship: string;
}

/** A single individual in the case pedigree. */
export interface GapPedigreeMember {
  /** Stable individual identifier within the pedigree. */
  id: string;
  /** Recorded sex; absence contributes to an incomplete-pedigree gap. */
  sex?: string;
  /** Parent individual identifiers, if recorded. */
  parents?: readonly string[];
}

/** The case pedigree projection. */
export interface GapPedigree {
  /** Stable case-data element reference (Req 8.4). */
  ref: string;
  members: readonly GapPedigreeMember[];
}

/** A completed or recorded genomic analysis for the case. */
export interface GapAnalysis {
  /** Stable case-data element reference (Req 8.4). */
  ref: string;
  type: GenomicAnalysisType;
  /** ISO-8601 completion timestamp, if completed. */
  completedAt?: string;
}

/** Recorded age of onset for the proband. */
export interface GapAgeOfOnset {
  /** Stable case-data element reference (Req 8.4). */
  ref: string;
  /** The recorded value; `null`/empty means onset was not captured. */
  value?: string | null;
}

/** Inheritance-model evaluation state for the case. */
export interface GapInheritance {
  /** Stable case-data element reference (Req 8.4). */
  ref: string;
  /** Whether inheritance could be evaluated from the available evidence. */
  evaluable?: boolean;
  /** The evaluated model, e.g. "autosomal_recessive", "uncertain". */
  model?: string;
}

/** Consent record governing what the case data may be used for. */
export interface GapConsent {
  /** Stable case-data element reference (Req 8.4). */
  ref: string;
  /** Whether consent permits matching against external repositories. */
  permitsExternalMatching?: boolean;
}

/**
 * The deterministic projection of a case that the gap rules engine evaluates.
 *
 * All collections are optional; an absent collection is treated as "no such
 * data recorded", which is exactly the condition many gap rules detect. The
 * shape is intentionally small and flat so evaluation stays well within the
 * 30-second / 10,000-element performance bound (Req 8.1).
 */
export interface GapCaseData {
  /** Owning case identifier; used to build the gap envelope (Req 23.3). */
  caseId: string;
  /**
   * Whether the case is family-based. Some rules (parental samples, pedigree
   * completeness) apply only to family-based cases.
   */
  isFamilyBased?: boolean;
  biosamples?: readonly GapBiosample[];
  pedigree?: GapPedigree;
  ageOfOnset?: GapAgeOfOnset;
  analyses?: readonly GapAnalysis[];
  /** ISO-8601 timestamp of the most recent reanalysis, if any. */
  lastReanalysisAt?: string | null;
  inheritance?: GapInheritance;
  consent?: GapConsent;
}

/**
 * Build a stable case-level element reference for gaps whose trigger is the
 * *absence* of a specific sub-element (there is no sub-element to point at, so
 * the case aspect itself is the triggering element — Req 8.4).
 */
export function caseElementRef(caseId: string, aspect: string): string {
  return `Case/${caseId}#${aspect}`;
}
