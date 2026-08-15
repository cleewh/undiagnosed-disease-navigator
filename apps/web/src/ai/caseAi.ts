// Decision-support "AI assist" for the MDT board.
//
// IMPORTANT: these helpers are a transparent, DETERMINISTIC demonstration
// synthesizer. They do not call a language model; every output is generated
// from the case's own structured data so it is fully explainable and cannot
// hallucinate. All output is clearly labelled AI-assisted, is non-diagnostic,
// and is designed for human-in-the-loop review. A production deployment would
// swap this module for a real model (e.g. Amazon Bedrock) behind an
// authenticated backend, keeping the same grounding + guardrails.

import {
  CASE_SUMMARY,
  CLINVAR_VARIANTS,
  FEATURED_PHENOTYPES,
  GENE_DISEASE,
  DISEASE_MATCHES,
  MECP2_ACMG,
  MECP2_ACMG_RESULT,
  type Tone
} from "../data/reference.js";

export const AI_META = {
  assistant: "UDN Copilot",
  mode: "Demonstration · deterministic, grounded in structured case data",
  version: "0.1"
} as const;

const gene = GENE_DISEASE.MECP2;
const variant = CLINVAR_VARIANTS.MECP2;

/** A single grounding reference for an AI output. */
export interface Grounding {
  readonly label: string;
}

/** Deterministic case summary synthesized from the structured record. */
export function generateCaseSummary(): { text: string; grounding: readonly Grounding[] } {
  const phenos = FEATURED_PHENOTYPES.map((p) => p.label.toLowerCase()).join(", ");
  const text =
    `${CASE_SUMMARY.proband} (${CASE_SUMMARY.demographics}) has ${phenos}. ` +
    `Trio exome identified a ${variant.classification.toLowerCase()} ${variant.gene} variant ` +
    `${variant.hgvs} (${variant.protein}), a ${variant.consequence.toLowerCase()}. ` +
    `This is consistent with ${gene.disease} (${gene.inheritance}; OMIM ${gene.omim}), the working diagnosis. ` +
    `Outstanding items before finalising: parental segregation of the variant and external-matching consent. ` +
    `Generated from structured case data — non-diagnostic; requires clinician review.`;
  return {
    text,
    grounding: [
      { label: "Phenotypes (HPO)" },
      { label: "Genomics — MECP2 variant + ClinVar" },
      { label: "Gene–disease reference" }
    ]
  };
}

/** Plain-language explanation of the ACMG classification (grounded, non-diagnostic). */
export function explainVariant(): { text: string; grounding: readonly Grounding[] } {
  const codes = MECP2_ACMG.map((c) => c.code).join(", ");
  const text =
    `The ${variant.gene} variant ${variant.hgvs} (${variant.protein}) is classified ` +
    `${MECP2_ACMG_RESULT.classification}. In plain terms it is a ${variant.consequence.toLowerCase()} ` +
    `predicted to remove normal gene function, and loss of ${variant.gene} function is a recognised cause of ` +
    `${gene.disease}. The classification combines the evidence criteria ${codes}. Because the variant is ` +
    `"assumed de novo", confirming it arose new in the child (parental testing) would further strengthen the ` +
    `interpretation. This is an explanation of existing evidence, not a diagnosis.`;
  return { text, grounding: [{ label: "ACMG/AMP criteria" }, { label: "ClinVar classification" }] };
}

/** A ranked differential suggestion. */
export interface AiSuggestion {
  readonly title: string;
  readonly confidence: number;
  readonly tone: Tone;
  readonly rationale: string;
}

export function differentialSuggestions(): readonly AiSuggestion[] {
  return DISEASE_MATCHES.map((m) => ({
    title: `${m.disease} (${m.gene})`,
    confidence: m.score,
    tone: m.tone,
    rationale: `${m.matched.length} of ${m.total} case HPO terms overlap: ${m.matched.join(", ")}.`
  }));
}

/** A recommended next action with rationale. */
export interface AiAction {
  readonly action: string;
  readonly rationale: string;
  readonly tone: Tone;
}

export function nextBestActions(): readonly AiAction[] {
  return [
    { action: "Confirm parental segregation of the MECP2 variant", rationale: "Would upgrade PM6 (assumed de novo) toward PS2 and strengthen the classification.", tone: "warning" },
    { action: "Obtain external-matching consent", rationale: "Currently pending; blocks Matchmaker Exchange and cohort matching.", tone: "danger" },
    { action: "Schedule MDT decision on diagnosis disclosure", rationale: "Evidence now supports a working diagnosis of Rett syndrome pending confirmation.", tone: "info" }
  ];
}

/** Grounded Q&A over the structured case (keyword-matched, deterministic). */
export function answerQuestion(question: string): { answer: string; grounding: string } {
  const q = question.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => q.includes(k));

  if (has("diagnos", "disease", "condition", "what is wrong")) {
    return {
      answer: `Working diagnosis is ${gene.disease} (OMIM ${gene.omim}), based on a ${variant.classification.toLowerCase()} ${variant.gene} variant and matching phenotypes. Not yet confirmed — parental segregation and consent are outstanding.`,
      grounding: "genomics + gene–disease reference"
    };
  }
  if (has("variant", "mutation", "gene", "mecp2", "genom")) {
    return {
      answer: `${variant.gene} ${variant.hgvs} (${variant.protein}), a ${variant.consequence.toLowerCase()}, classified ${MECP2_ACMG_RESULT.classification} (${MECP2_ACMG.map((c) => c.code).join(", ")}).`,
      grounding: "genomics + ACMG criteria"
    };
  }
  if (has("phenotyp", "symptom", "hpo", "feature", "present")) {
    return { answer: `Documented phenotypes: ${FEATURED_PHENOTYPES.map((p) => `${p.label} (${p.id})`).join(", ")}.`, grounding: "phenotypes (HPO)" };
  }
  if (has("treat", "therap", "drug", "trial", "medicat")) {
    return {
      answer: `Trofinetide (DAYBUE) is FDA-approved for Rett syndrome; gene therapy (TSHA-102) is in trials. This is informational, not a treatment recommendation — decisions rest with the MDT.`,
      grounding: "therapeutics (FDA / ClinicalTrials.gov)"
    };
  }
  if (has("consent", "match")) {
    return { answer: `External-matching consent is pending, so cohort matching and Matchmaker Exchange results are illustrative only.`, grounding: "consent status" };
  }
  if (has("next", "gap", "todo", "outstanding", "action", "do now")) {
    return { answer: nextBestActions().map((a) => `• ${a.action}`).join(" "), grounding: "evidence gaps + management plan" };
  }
  if (has("inherit", "de novo", "segregation", "parent")) {
    return { answer: `${gene.inheritance}. The variant is assumed de novo; parental testing is pending to confirm.`, grounding: "gene–disease reference + genomics" };
  }
  return {
    answer: `I can only answer from this case's structured data. Try asking about the diagnosis, the variant, phenotypes, inheritance, outstanding actions, or treatment options.`,
    grounding: "n/a"
  };
}

export const SUGGESTED_QUESTIONS: readonly string[] = [
  "What is the working diagnosis?",
  "Explain the variant",
  "What phenotypes are documented?",
  "What are the next best actions?"
];
