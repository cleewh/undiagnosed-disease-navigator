// data/generator/src/phenopacket.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 3: Phenopacket serialization round-trip and validation
//
// Validates: Requirements 2.4, 2.5
//
// Property 3 (design.md): *For any* generated case, its GA4GH Phenopacket
// parses and re-serializes without loss (round-trip identity) and validates
// against the Phenopacket schema with zero errors; any structurally mutated
// packet is rejected with a schema-validation error.
//
// For any seed we generate the corpus with per-case artifacts and, for a
// sampled case per run, assert that its Phenopacket:
//   - survives a JSON round-trip unchanged (JSON.parse(JSON.stringify(p))
//     deep-equals p) — Req 2.4 serialization fidelity, and
//   - validates with zero errors — Req 2.4, and
//   - once structurally mutated (subject removed, or subject.sex set to an
//     invalid value), is rejected with a non-empty error list — Req 2.5.
//
// NOTE on validator wiring: the Intake_Service (@udn/intake) owns the
// authoritative `validatePhenopacket`, but @udn/intake already dev-depends on
// @udn/data-generator (see services/intake/tsconfig.json references). Adding a
// reverse @udn/intake reference from this package would introduce a TypeScript
// project-reference build cycle and break `tsc --build`. To keep the root build
// green we re-implement the SAME minimal structural check inline here (it
// mirrors services/intake/src/validation.ts::validatePhenopacket exactly).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateCorpus, type GeneratedCorpus } from "./generator.js";

// ---------------------------------------------------------------------------
// Inline structural Phenopacket validator (mirrors @udn/intake
// validatePhenopacket to avoid a build cycle — see file header).
// Returns [] when structurally valid, otherwise one error string per failing
// field.
// ---------------------------------------------------------------------------

const PHENOPACKET_SEX = ["FEMALE", "MALE", "UNKNOWN_SEX"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validatePhenopacket(candidate: unknown): string[] {
  const errors: string[] = [];

  if (!isObject(candidate)) {
    errors.push("phenopacket: expected a JSON object");
    return errors;
  }

  if (!isNonEmptyString(candidate.id)) {
    errors.push("id: expected a non-empty string");
  }

  const subject = candidate.subject;
  if (!isObject(subject)) {
    errors.push("subject: expected a JSON object");
  } else {
    if (!isNonEmptyString(subject.id)) {
      errors.push("subject.id: expected a non-empty string");
    }
    if (
      typeof subject.sex !== "string" ||
      !(PHENOPACKET_SEX as readonly string[]).includes(subject.sex)
    ) {
      errors.push(
        `subject.sex: expected one of [${PHENOPACKET_SEX.join(", ")}]`
      );
    }
  }

  const features = candidate.phenotypicFeatures;
  if (!Array.isArray(features)) {
    errors.push("phenotypicFeatures: expected an array");
  } else if (features.length === 0) {
    errors.push("phenotypicFeatures: expected a non-empty array");
  } else {
    features.forEach((feature, index) => {
      const type = isObject(feature) ? feature.type : undefined;
      const typeId = isObject(type) ? type.id : undefined;
      if (!isNonEmptyString(typeId)) {
        errors.push(
          `phenotypicFeatures[${index}].type.id: expected a non-empty id`
        );
      }
    });
  }

  return errors;
}

// A small, deterministic seed set keeps runtime bounded: each distinct seed
// generates the corpus (with artifacts) at most once.
const corpusCache = new Map<number, GeneratedCorpus>();

function corpusForSeed(seed: number): GeneratedCorpus {
  let corpus = corpusCache.get(seed);
  if (!corpus) {
    corpus = generateCorpus({ seed, withArtifacts: true });
    corpusCache.set(seed, corpus);
  }
  return corpus;
}

describe("Feature: undiagnosed-disease-navigator, Property 3: Phenopacket serialization round-trip and validation", () => {
  it("round-trips + validates every generated Phenopacket and rejects structural mutations", () => {
    fc.assert(
      fc.property(
        // Draw the seed from a small set to keep corpus generation bounded.
        fc.integer({ min: 0, max: 24 }),
        // Sample one case per run rather than re-checking the whole corpus.
        fc.nat(),
        (seed, caseIdx) => {
          const { cases, artifacts } = corpusForSeed(seed);
          expect(cases.length).toBeGreaterThan(0);
          expect(artifacts).toBeDefined();

          const generated = cases[caseIdx % cases.length]!;
          const phenopacket = artifacts![generated.case.caseId]!.phenopacket;
          expect(phenopacket).toBeDefined();

          // Req 2.4: JSON round-trip identity (parse ∘ stringify == identity).
          const roundTripped = JSON.parse(JSON.stringify(phenopacket));
          expect(roundTripped).toEqual(phenopacket);

          // Req 2.4: validates with zero errors.
          expect(validatePhenopacket(phenopacket)).toEqual([]);

          // Req 2.5: a structurally mutated packet is rejected.
          // Mutation A: remove the required `subject`.
          const withoutSubject = JSON.parse(JSON.stringify(phenopacket));
          delete withoutSubject.subject;
          expect(validatePhenopacket(withoutSubject).length).toBeGreaterThan(0);

          // Mutation B: set `subject.sex` to a value outside the GA4GH enum.
          const invalidSex = JSON.parse(JSON.stringify(phenopacket));
          invalidSex.subject.sex = "NOT_A_SEX";
          expect(validatePhenopacket(invalidSex).length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
