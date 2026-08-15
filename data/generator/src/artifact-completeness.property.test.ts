// data/generator/src/artifact-completeness.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 4: Per-case artifact completeness and conditional artifacts
//
// Validates: Requirements 2.7, 2.8, 2.9, 2.3, 2.6
//
// Property 4 (design.md): *For any* admitted case, the required genomic
// artifacts (at least one VCF, annotation table, QC summary, and candidate
// list) are present; if the case is family-based it additionally has a
// trio/family VCF and inheritance results; and if its archetype requires
// CNV/SV, repeat-expansion, or mitochondrial analysis, the corresponding
// results are present.
//
// For any seed we generate the corpus with per-case artifacts and, for every
// case in that corpus, assert that:
//   - the always-present artifacts exist: fhir, phenopacket, pedigree, vcf,
//     annotation, qc, candidates (Req 2.3, 2.6, 2.7),
//   - the four required genomic artifacts each carry content (>= 1 VCF record,
//     annotation row, and candidate; a QC summary) (Req 2.7),
//   - family-based cases (spec.familyBased) have a family VCF
//     (vcf.isFamilyVcf) and present inheritanceResults, while single-patient
//     cases have neither (Req 2.8), and
//   - the archetype-conditional results are present IFF the archetype requires
//     them: cnvSvResults iff "structural_variant", repeatExpansionResults iff
//     "repeat_expansion", mitochondrialResults iff "mitochondrial" (Req 2.9).
//
// The seed is drawn from a small bounded set so corpus generation (which is
// deterministic per seed) stays cheap across the >= 100 iterations.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateCorpus, type GeneratedCorpus } from "./generator.js";

// A small, deterministic seed set keeps runtime bounded: each distinct seed
// generates the corpus (with artifacts) at most once and is then cached.
const corpusCache = new Map<number, GeneratedCorpus>();

function corpusForSeed(seed: number): GeneratedCorpus {
  let corpus = corpusCache.get(seed);
  if (!corpus) {
    corpus = generateCorpus({ seed, withArtifacts: true });
    corpusCache.set(seed, corpus);
  }
  return corpus;
}

describe("Feature: undiagnosed-disease-navigator, Property 4: Per-case artifact completeness and conditional artifacts", () => {
  it("every case carries the required artifacts and the exact conditional artifacts for its family structure and archetype", () => {
    fc.assert(
      fc.property(
        // Draw the seed from a small set to keep corpus generation bounded.
        fc.integer({ min: 0, max: 24 }),
        (seed) => {
          const { cases, artifacts } = corpusForSeed(seed);
          expect(cases.length).toBeGreaterThan(0);
          expect(artifacts).toBeDefined();

          for (const generated of cases) {
            const caseId = generated.case.caseId;
            const bundle = artifacts![caseId];
            expect(bundle).toBeDefined();

            // Req 2.3 / 2.6: the always-present clinical artifacts exist.
            expect(bundle!.fhir).toBeDefined();
            expect(bundle!.phenopacket).toBeDefined();
            expect(bundle!.pedigree).toBeDefined();

            // Req 2.7: the four required genomic artifacts are present and
            // carry content.
            expect(bundle!.vcf).toBeDefined();
            expect(bundle!.vcf.records.length).toBeGreaterThanOrEqual(1);
            expect(bundle!.annotation).toBeDefined();
            expect(bundle!.annotation.rows.length).toBeGreaterThanOrEqual(1);
            expect(bundle!.qc).toBeDefined();
            expect(bundle!.candidates).toBeDefined();
            expect(
              bundle!.candidates.candidates.length
            ).toBeGreaterThanOrEqual(1);

            // Req 2.8: family-based cases have a trio/family VCF and
            // inheritance results; single-patient cases have neither.
            if (generated.spec.familyBased) {
              expect(bundle!.vcf.isFamilyVcf).toBe(true);
              expect(bundle!.inheritanceResults).toBeDefined();
              expect(
                bundle!.inheritanceResults!.results.length
              ).toBeGreaterThanOrEqual(1);
            } else {
              expect(bundle!.vcf.isFamilyVcf).toBe(false);
              expect(bundle!.inheritanceResults).toBeUndefined();
            }

            // Req 2.9: archetype-conditional results are present IFF the
            // archetype requires them (exact biconditional).
            const archetype = generated.spec.archetype;

            expect(bundle!.cnvSvResults !== undefined).toBe(
              archetype === "structural_variant"
            );
            if (archetype === "structural_variant") {
              expect(
                bundle!.cnvSvResults!.calls.length
              ).toBeGreaterThanOrEqual(1);
            }

            expect(bundle!.repeatExpansionResults !== undefined).toBe(
              archetype === "repeat_expansion"
            );
            if (archetype === "repeat_expansion") {
              expect(
                bundle!.repeatExpansionResults!.calls.length
              ).toBeGreaterThanOrEqual(1);
            }

            expect(bundle!.mitochondrialResults !== undefined).toBe(
              archetype === "mitochondrial"
            );
            if (archetype === "mitochondrial") {
              expect(
                bundle!.mitochondrialResults!.calls.length
              ).toBeGreaterThanOrEqual(1);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
