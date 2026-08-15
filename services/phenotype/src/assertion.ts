// services/phenotype/src/assertion.ts
//
// Assertion classification (Requirement 5.3).
//
// Every phenotype candidate must be classified as EXACTLY ONE of present,
// absent, uncertain, or historical. The AI response schema carries grounded
// statement text but no explicit assertion polarity, so the Phenotype_Service
// derives it deterministically from the statement text. Classification is
// intentionally deterministic (no generative model) and injectable so callers
// can supply a richer classifier without changing the extraction pipeline.

import type { Assertion } from "@udn/domain";

/**
 * Classify a phenotype statement's assertion polarity (Req 5.3). Deterministic
 * and side-effect free; given the same text it always returns the same
 * assertion, and the returned value is always exactly one of the four
 * permitted values.
 */
export interface AssertionClassifier {
  classify(statementText: string): Assertion;
}

/** Whole-word/phrase match, case-insensitive, for the given cue list. */
function matchesAny(text: string, cues: readonly string[]): boolean {
  return cues.some((cue) => new RegExp(`\\b${cue}\\b`, "i").test(text));
}

/** Negation cues indicating the phenotype is asserted ABSENT. */
const ABSENT_CUES = [
  "no",
  "not",
  "without",
  "absent",
  "denies",
  "denied",
  "negative for",
  "ruled out"
] as const;

/** Cues indicating a HISTORICAL assertion (present in the past). */
const HISTORICAL_CUES = [
  "history of",
  "previously",
  "past",
  "prior",
  "formerly",
  "resolved"
] as const;

/** Cues indicating an UNCERTAIN assertion. */
const UNCERTAIN_CUES = [
  "possible",
  "possibly",
  "suspected",
  "uncertain",
  "query",
  "likely",
  "probable",
  "questionable"
] as const;

/**
 * The default deterministic assertion classifier (Req 5.3).
 *
 * Precedence is deliberate and total: an explicit negation (absent) is checked
 * first, then a historical cue, then an uncertainty cue; any statement matching
 * none of these is classified `present`. This guarantees exactly one of the
 * four assertions is always returned.
 */
export const defaultAssertionClassifier: AssertionClassifier = {
  classify(statementText: string): Assertion {
    const text = statementText.trim();
    if (text.includes("?") || matchesAny(text, UNCERTAIN_CUES)) {
      if (matchesAny(text, ABSENT_CUES)) {
        return "absent";
      }
      return "uncertain";
    }
    if (matchesAny(text, ABSENT_CUES)) {
      return "absent";
    }
    if (matchesAny(text, HISTORICAL_CUES)) {
      return "historical";
    }
    return "present";
  }
};
