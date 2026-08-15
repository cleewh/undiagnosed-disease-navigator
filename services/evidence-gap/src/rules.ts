// services/evidence-gap/src/rules.ts
//
// Rule model and the default rule set for the evidence-gap rules engine
// (Gap_Service, task 16.1).
//
// A rule is a pure, deterministic predicate over `GapCaseData` plus descriptive
// metadata. Each predicate returns either `null` (no gap for this case) or a
// `GapTrigger` naming the specific case-data element that triggered the rule
// (Req 8.4). Rules NEVER assert medical necessity; their wording is framed as
// review guidance (Req 8.2, 8.3), and the configuration validator rejects any
// rule whose wording uses a prohibited medical-necessity term.

import {
  caseElementRef,
  type GapCaseData,
  type GenomicAnalysisType
} from "./case-data.js";

/**
 * The disciplines a gap can belong to. Drives the default required-approver
 * role and lets the UI group review items.
 */
export type GapCategory =
  | "clinical"
  | "lab"
  | "bioinformatics"
  | "administrative";

/** The complete set of gap categories, exported for validation. */
export const GAP_CATEGORIES: readonly GapCategory[] = [
  "clinical",
  "lab",
  "bioinformatics",
  "administrative"
];

/**
 * The result of a rule predicate firing: the specific case-data element that
 * triggered it (Req 8.4) and an optional human-readable detail.
 */
export interface GapTrigger {
  /** Reference to the specific case data element that triggered the rule. */
  triggeringElementRef: string;
  /** Optional detail describing the specific trigger for reviewers. */
  detail?: string;
}

/**
 * Context passed to every predicate so that time-relative rules are
 * deterministic: given the same `referenceDate` and case data, a predicate
 * always produces the same result.
 */
export interface RuleEvaluationContext {
  /** Reference "now" (ISO-8601) for time-relative rules. */
  referenceDate: string;
}

/** A pure, deterministic predicate over case data. */
export type GapPredicate = (
  caseData: GapCaseData,
  ctx: RuleEvaluationContext
) => GapTrigger | null;

/** Descriptive, review-oriented metadata attached to a rule. */
export interface GapRuleMetadata {
  /** Why closing this gap matters, framed as review guidance (Req 8.3). */
  whyItMatters: string;
  /** A concrete suggested next investigative step, framed as a suggestion. */
  suggestedNextStep: string;
  /** Discipline the gap belongs to. */
  category: GapCategory;
  /** Role suggested to review/approve the next step. */
  requiredApprover: string;
  /** Lower value = higher review priority. Used for deterministic ordering. */
  priority: number;
}

/** A configurable evidence-gap rule. */
export interface GapRule {
  /** Stable, unique rule identifier. */
  id: string;
  /** Discipline the rule belongs to (mirrors `metadata.category`). */
  category: GapCategory;
  /** Pure predicate deciding whether the rule fires for a case. */
  predicate: GapPredicate;
  /** Descriptive, review-oriented metadata. */
  metadata: GapRuleMetadata;
}

/**
 * A submitted rule configuration. An administrator submits an ordered rule set;
 * a valid configuration replaces the active rule set for subsequent evaluations
 * (Req 8.6), and an invalid one is rejected while the previous set is retained
 * (Req 8.7).
 */
export interface GapRuleConfig {
  rules: readonly GapRule[];
}

/**
 * The number of days without a reanalysis after which the reanalysis-staleness
 * rule fires. Frozen here so the default rule set is fully deterministic.
 */
export const REANALYSIS_STALENESS_DAYS = 365;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days from `fromIso` to `toIso`; `NaN` when either is unparseable. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.NaN;
  return (to - from) / MS_PER_DAY;
}

/** Case-insensitive membership check over a biosample relationship list. */
function hasRelationship(
  caseData: GapCaseData,
  relationships: readonly string[]
): boolean {
  const wanted = new Set(relationships.map((r) => r.toLowerCase()));
  return (caseData.biosamples ?? []).some((s) =>
    wanted.has(s.relationship.toLowerCase())
  );
}

/** Whether the case records at least one analysis of the given type. */
function hasAnalysis(
  caseData: GapCaseData,
  types: readonly GenomicAnalysisType[]
): boolean {
  const wanted = new Set(types);
  return (caseData.analyses ?? []).some((a) => wanted.has(a.type));
}

// ---------------------------------------------------------------------------
// Default rule set (covers the design examples)
// ---------------------------------------------------------------------------

/** No maternal or paternal biosample for a family-based case. */
const noParentalSamples: GapRule = {
  id: "no-parental-samples",
  category: "clinical",
  metadata: {
    whyItMatters:
      "Parental samples enable trio-based inheritance filtering and de novo review.",
    suggestedNextStep:
      "Consider requesting maternal and paternal samples to support trio analysis.",
    category: "clinical",
    requiredApprover: "Clinical geneticist",
    priority: 20
  },
  predicate: (caseData) => {
    if (!caseData.isFamilyBased) return null;
    if (hasRelationship(caseData, ["mother", "father"])) return null;
    return {
      triggeringElementRef:
        caseData.pedigree?.ref ?? caseElementRef(caseData.caseId, "biosamples"),
      detail: "No maternal or paternal biosample is recorded for this family-based case."
    };
  }
};

/** Pedigree missing, or a member lacks sex, or too few members to form a trio. */
const incompletePedigree: GapRule = {
  id: "incomplete-pedigree",
  category: "clinical",
  metadata: {
    whyItMatters:
      "A complete pedigree supports segregation review and inheritance interpretation.",
    suggestedNextStep:
      "Consider completing the pedigree, including each individual's sex and parent links.",
    category: "clinical",
    requiredApprover: "Genetic counsellor",
    priority: 30
  },
  predicate: (caseData) => {
    const ref = caseData.pedigree?.ref ?? caseElementRef(caseData.caseId, "pedigree");
    if (!caseData.pedigree) {
      return { triggeringElementRef: ref, detail: "No pedigree is recorded." };
    }
    const members = caseData.pedigree.members;
    const memberMissingSex = members.some(
      (m) => m.sex === undefined || m.sex.trim() === ""
    );
    if (memberMissingSex) {
      return {
        triggeringElementRef: ref,
        detail: "At least one pedigree individual has no recorded sex."
      };
    }
    if (caseData.isFamilyBased && members.length < 3) {
      return {
        triggeringElementRef: ref,
        detail: "The family-based pedigree has fewer members than a proband and two parents."
      };
    }
    return null;
  }
};

/** Age of onset not captured. */
const missingAgeOfOnset: GapRule = {
  id: "missing-age-of-onset",
  category: "clinical",
  metadata: {
    whyItMatters:
      "Age of onset informs differential review and phenotype interpretation.",
    suggestedNextStep:
      "Consider capturing the age of onset from the clinical record.",
    category: "clinical",
    requiredApprover: "Clinical geneticist",
    priority: 40
  },
  predicate: (caseData) => {
    const onset = caseData.ageOfOnset;
    const value = onset?.value;
    const missing =
      value === undefined || value === null || value.trim() === "";
    if (!missing) return null;
    return {
      triggeringElementRef:
        onset?.ref ?? caseElementRef(caseData.caseId, "ageOfOnset"),
      detail: "No age of onset is recorded."
    };
  }
};

/** No primary sequence (genome/exome) analysis on record. */
const noGenomeAnalysis: GapRule = {
  id: "no-genome-analysis",
  category: "bioinformatics",
  metadata: {
    whyItMatters:
      "A primary sequencing analysis is the basis for variant-level review.",
    suggestedNextStep:
      "Consider whether a genome or exome analysis would add value for this case.",
    category: "bioinformatics",
    requiredApprover: "Bioinformatician",
    priority: 10
  },
  predicate: (caseData) => {
    if (hasAnalysis(caseData, ["genome", "exome"])) return null;
    return {
      triggeringElementRef: caseElementRef(caseData.caseId, "analyses"),
      detail: "No genome or exome analysis is recorded."
    };
  }
};

/** No structural-variant analysis on record. */
const noSvAnalysis: GapRule = {
  id: "no-sv-analysis",
  category: "bioinformatics",
  metadata: {
    whyItMatters:
      "Structural-variant analysis can reveal changes not visible to SNV calling.",
    suggestedNextStep:
      "Consider whether a structural-variant (CNV/SV) analysis is warranted.",
    category: "bioinformatics",
    requiredApprover: "Bioinformatician",
    priority: 50
  },
  predicate: (caseData) => {
    if (hasAnalysis(caseData, ["sv"])) return null;
    return {
      triggeringElementRef: caseElementRef(caseData.caseId, "analyses"),
      detail: "No structural-variant (CNV/SV) analysis is recorded."
    };
  }
};

/** No repeat-expansion analysis on record. */
const noRepeatAnalysis: GapRule = {
  id: "no-repeat-expansion-analysis",
  category: "bioinformatics",
  metadata: {
    whyItMatters:
      "Repeat-expansion analysis covers a variant class standard calling can miss.",
    suggestedNextStep:
      "Consider whether a repeat-expansion analysis is warranted for this phenotype.",
    category: "bioinformatics",
    requiredApprover: "Bioinformatician",
    priority: 60
  },
  predicate: (caseData) => {
    if (hasAnalysis(caseData, ["repeat"])) return null;
    return {
      triggeringElementRef: caseElementRef(caseData.caseId, "analyses"),
      detail: "No repeat-expansion analysis is recorded."
    };
  }
};

/** No mitochondrial analysis on record. */
const noMitochondrialAnalysis: GapRule = {
  id: "no-mitochondrial-analysis",
  category: "bioinformatics",
  metadata: {
    whyItMatters:
      "Mitochondrial analysis covers variants outside the nuclear genome.",
    suggestedNextStep:
      "Consider whether a mitochondrial analysis is warranted for this phenotype.",
    category: "bioinformatics",
    requiredApprover: "Bioinformatician",
    priority: 70
  },
  predicate: (caseData) => {
    if (hasAnalysis(caseData, ["mitochondrial"])) return null;
    return {
      triggeringElementRef: caseElementRef(caseData.caseId, "analyses"),
      detail: "No mitochondrial analysis is recorded."
    };
  }
};

/** No reanalysis since the staleness window (or never reanalysed). */
const noRecentReanalysis: GapRule = {
  id: "no-recent-reanalysis",
  category: "administrative",
  metadata: {
    whyItMatters:
      "Periodic reanalysis surfaces new evidence for cases that remain unresolved.",
    suggestedNextStep:
      "Consider scheduling a reanalysis against the current knowledge snapshot.",
    category: "administrative",
    requiredApprover: "Genetic counsellor",
    priority: 80
  },
  predicate: (caseData, ctx) => {
    const ref = caseElementRef(caseData.caseId, "reanalysis");
    const last = caseData.lastReanalysisAt;
    if (last === undefined || last === null || last.trim() === "") {
      return { triggeringElementRef: ref, detail: "No reanalysis has been recorded." };
    }
    const age = daysBetween(last, ctx.referenceDate);
    if (Number.isNaN(age) || age > REANALYSIS_STALENESS_DAYS) {
      return {
        triggeringElementRef: ref,
        detail: `No reanalysis recorded within the last ${REANALYSIS_STALENESS_DAYS} days.`
      };
    }
    return null;
  }
};

/** Inheritance could not be evaluated. */
const inheritanceNotEvaluable: GapRule = {
  id: "inheritance-not-evaluable",
  category: "bioinformatics",
  metadata: {
    whyItMatters:
      "An evaluable inheritance model supports segregation and prioritisation review.",
    suggestedNextStep:
      "Consider gathering the family or segregation evidence needed to evaluate inheritance.",
    category: "bioinformatics",
    requiredApprover: "Bioinformatician",
    priority: 25
  },
  predicate: (caseData) => {
    const inh = caseData.inheritance;
    const ref = inh?.ref ?? caseElementRef(caseData.caseId, "inheritance");
    if (!inh) {
      return { triggeringElementRef: ref, detail: "No inheritance evaluation is recorded." };
    }
    const model = inh.model?.trim().toLowerCase();
    const unevaluable =
      inh.evaluable === false || model === "uncertain" || model === "unknown";
    if (!unevaluable) return null;
    return {
      triggeringElementRef: ref,
      detail: "Inheritance could not be evaluated from the available evidence."
    };
  }
};

/** Consent does not permit matching against external repositories. */
const consentNoExternalMatching: GapRule = {
  id: "consent-no-external-matching",
  category: "administrative",
  metadata: {
    whyItMatters:
      "External matching can identify additional cases, subject to consent.",
    suggestedNextStep:
      "Consider reviewing consent scope with the family before external matching.",
    category: "administrative",
    requiredApprover: "Genetic counsellor",
    priority: 35
  },
  predicate: (caseData) => {
    const consent = caseData.consent;
    const ref = consent?.ref ?? caseElementRef(caseData.caseId, "consent");
    if (!consent) {
      return { triggeringElementRef: ref, detail: "No consent record is present." };
    }
    if (consent.permitsExternalMatching === false) {
      return {
        triggeringElementRef: ref,
        detail: "Consent does not currently permit external matching."
      };
    }
    return null;
  }
};

/**
 * The default rule set, covering the design's evidence-gap examples. Ordered
 * here for readability; evaluation output is deterministically re-ordered by
 * (priority, ruleId) regardless of this order.
 */
export const DEFAULT_RULES: readonly GapRule[] = [
  noParentalSamples,
  incompletePedigree,
  missingAgeOfOnset,
  noGenomeAnalysis,
  noSvAnalysis,
  noRepeatAnalysis,
  noMitochondrialAnalysis,
  noRecentReanalysis,
  inheritanceNotEvaluable,
  consentNoExternalMatching
];

/** The default, ready-to-use gap-rule configuration. */
export const DEFAULT_GAP_RULE_CONFIG: GapRuleConfig = { rules: DEFAULT_RULES };
