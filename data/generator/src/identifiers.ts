// data/generator/src/identifiers.ts
//
// Identifier safety for the synthetic case corpus (task 7.2).
//
// Two responsibilities:
//   1. Mint identifiers that are *clearly synthetic* — every generated id
//      carries the {@link SYNTHETIC_ID_MARKER} prefix so it is visibly not a
//      real-world identifier (Requirements 1.9, 2.1).
//   2. Guard against accidental real identifiers — a small, illustrative
//      blocklist of real-identifier shapes (national ids, MRNs, emails, long
//      numeric runs) that a synthetic identifier must never match. The guard
//      lets the generator (and later the Intake_Service, Requirement 2.2)
//      reject any record whose identifier fields resemble a real identifier.
//
// The blocklist is deliberately small and illustrative: its purpose is to
// demonstrate the safety check and to catch obvious mistakes, not to be an
// exhaustive PII detector.

/**
 * Prefix stamped on every synthetic identifier so it is unmistakably
 * artificial (Req 1.9, 2.1). Kept lowercase and hyphen-delimited so ids remain
 * URL/PK safe.
 */
export const SYNTHETIC_ID_MARKER = "syn";

/**
 * A single illustrative rule describing the shape of a *real* identifier that
 * synthetic data must never contain.
 */
export interface RealIdentifierRule {
  /** Stable rule name, surfaced in rejection errors. */
  name: string;
  /** A human-readable description of what the rule detects. */
  description: string;
  /** Returns true when `value` looks like this kind of real identifier. */
  test: (value: string) => boolean;
}

/**
 * Small, illustrative blocklist of real-identifier shapes. A generated
 * identifier that matches any rule is treated as unsafe and rejected
 * (Requirements 1.9, 2.1, 2.2).
 *
 * NOTE: this is intentionally not an exhaustive PII detector. It catches the
 * common, obviously-real identifier formats so an accidental leak fails fast.
 */
export const REAL_IDENTIFIER_RULES: readonly RealIdentifierRule[] = [
  {
    name: "us-ssn",
    description: "US Social Security Number (NNN-NN-NNNN)",
    test: (v) => /\b\d{3}-\d{2}-\d{4}\b/.test(v)
  },
  {
    name: "nhs-number",
    description: "UK NHS number (three-three-four digit grouping)",
    test: (v) => /\b\d{3}[ -]\d{3}[ -]\d{4}\b/.test(v)
  },
  {
    name: "medical-record-number",
    description: "Labelled medical record number (MRN…)",
    test: (v) => /\bMRN[:#\- ]?\s*\d{5,}\b/i.test(v)
  },
  {
    name: "email-address",
    description: "Email address",
    test: (v) => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(v)
  },
  {
    name: "long-numeric-run",
    description: "Unbroken run of 9 or more digits (e.g. a real record id)",
    test: (v) => /\d{9,}/.test(v)
  }
];

/** The kinds of synthetic identifier the generator mints. */
export type SyntheticIdKind = "case" | "patient";

/**
 * Build a clearly-synthetic identifier of the given kind.
 *
 * The result is deterministic in its inputs and always begins with
 * {@link SYNTHETIC_ID_MARKER}, e.g. `syn-case-5eedca5e-000` (Req 1.9, 2.1).
 *
 * @param kind    the entity the identifier belongs to.
 * @param seedHex the 8-character hex form of the generation seed.
 * @param index   zero-padded case index (kept stable and human-readable).
 */
export function syntheticIdentifier(
  kind: SyntheticIdKind,
  seedHex: string,
  index: string
): string {
  return `${SYNTHETIC_ID_MARKER}-${kind}-${seedHex}-${index}`;
}

/**
 * True when `value` carries the synthetic marker prefix (Req 1.9, 2.1).
 */
export function isSyntheticIdentifier(value: string): boolean {
  return value.startsWith(`${SYNTHETIC_ID_MARKER}-`);
}

/** The outcome of screening a single identifier value. */
export interface IdentifierScreenResult {
  /** The value that was screened. */
  value: string;
  /** True when the value matches no real-identifier rule. */
  safe: boolean;
  /** Names of the rules the value matched (empty when safe). */
  matchedRules: string[];
}

/**
 * Screen a single identifier value against {@link REAL_IDENTIFIER_RULES}.
 * Returns every matched rule so callers can report the complete reason.
 */
export function screenIdentifier(value: string): IdentifierScreenResult {
  const matchedRules = REAL_IDENTIFIER_RULES.filter((rule) =>
    rule.test(value)
  ).map((rule) => rule.name);
  return { value, safe: matchedRules.length === 0, matchedRules };
}

/**
 * True when `value` does not resemble any real identifier in the blocklist
 * (Requirements 1.9, 2.1). Convenience wrapper over {@link screenIdentifier}.
 */
export function isSafeSyntheticIdentifier(value: string): boolean {
  return screenIdentifier(value).safe;
}
