// services/hypothesis/src/vocabulary.ts
//
// Non-diagnostic vocabulary guard for the Hypothesis_Service (Req 11.3).
//
// A Hypothesis_Card must be expressed using wording drawn from a predefined
// NON-DIAGNOSTIC vocabulary, and any card text containing a prohibited
// diagnostic term must be rejected (Req 11.3). Correctness Property 30 pins the
// enforcement rule precisely: card text is accepted IF AND ONLY IF it contains
// no prohibited diagnostic term.
//
// This module is pure and deterministic. It never mutates its inputs and never
// calls a generative model; the same text always yields the same decision.

/**
 * The predefined set of non-diagnostic phrasings the Hypothesis_Service
 * encourages authors to use when wording a card (Req 11.3). This vocabulary is
 * advisory: it is exported so the UI and reviewers can steer wording toward
 * hedged, review-framed language. Acceptance itself is governed solely by the
 * absence of prohibited diagnostic terms (Correctness Property 30).
 */
export const NON_DIAGNOSTIC_VOCABULARY: readonly string[] = [
  "candidate explanation",
  "possible contributor",
  "consistent with",
  "may suggest",
  "could be associated with",
  "warrants further review",
  "supported by the evidence",
  "under consideration",
  "potential mechanism",
  "hypothesised"
];

/**
 * The predefined set of prohibited diagnostic terms (Req 11.3). Any card text
 * containing one of these terms (as a whole word or phrase, case-insensitive)
 * is rejected. The list targets assertions of diagnostic certainty and
 * treatment/prognosis advice — wording inappropriate for a system that is
 * explicitly NOT a medical device.
 */
export const PROHIBITED_DIAGNOSTIC_TERMS: readonly string[] = [
  "diagnosis",
  "diagnoses",
  "diagnosed",
  "diagnose",
  "diagnosing",
  "pathognomonic",
  "definitive diagnosis",
  "definitively",
  "confirmed diagnosis",
  "confirms the diagnosis",
  "proves",
  "proven cause",
  "certainly caused by",
  "definite cause",
  "cure",
  "cures",
  "treatment plan",
  "prescribe",
  "prognosis"
];

/**
 * Build a case-insensitive, whole-word/phrase matcher for a prohibited term.
 *
 * Single tokens are matched on Unicode letter/number boundaries so that a term
 * such as "diagnosis" does not spuriously match inside a longer word. Phrases
 * (terms containing whitespace) match across any run of whitespace.
 */
function toPattern(term: string): RegExp {
  const escaped = term
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
}

/**
 * Precompiled patterns, one per prohibited term, paired with the original term
 * text for reporting. Compiled once at module load for deterministic reuse.
 */
const PROHIBITED_PATTERNS: readonly { readonly term: string; readonly pattern: RegExp }[] =
  PROHIBITED_DIAGNOSTIC_TERMS.map((term) => ({ term, pattern: toPattern(term) }));

/**
 * Return the first prohibited diagnostic term found in `text`, or `undefined`
 * when the text is free of prohibited terms. Matching is case-insensitive and
 * respects whole-word/phrase boundaries.
 */
export function findProhibitedTerm(text: string): string | undefined {
  return PROHIBITED_PATTERNS.find(({ pattern }) => pattern.test(text))?.term;
}

/**
 * Whether `text` uses only non-diagnostic wording, i.e. it contains no
 * prohibited diagnostic term (Req 11.3, Correctness Property 30).
 */
export function isNonDiagnostic(text: string): boolean {
  return findProhibitedTerm(text) === undefined;
}
