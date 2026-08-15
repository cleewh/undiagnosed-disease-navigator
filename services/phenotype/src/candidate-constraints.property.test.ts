// services/phenotype/src/candidate-constraints.property.test.ts
//
// Property-based test for Correctness Property 11 (Task 13.2, Requirements
// 5.2, 5.3, 5.4, 5.5, 5.6).
//
// Feature: undiagnosed-disease-navigator, Property 11: Phenotype candidates
// satisfy structural constraints.
//
// Design (Property 11): For any AI-extracted phenotype candidate, it maps to
// between 1 and 20 HPO terms, its assertion is exactly one of
// present/absent/uncertain/historical, its confidence is in [0.00, 1.00], it
// presents at most 10 alternative mappings ordered by descending confidence, it
// links to a supporting source object, and its initial status is pending
// review.
//
// The test drives the real `extractPhenotypes` pipeline with a fake gateway
// that returns a generated, schema-conforming grounded document (no AWS, no
// Bedrock) and a deterministic in-memory HPO resolver seeded from the same
// generated lexicon. The structural constraints of Property 11 that describe a
// mapped candidate (1-20 HPO terms, initial status pending review, source link)
// are asserted on resolvable candidates; the shared constraints (assertion set,
// confidence bound, at-most-10 ordered alternatives, no auto-confirm) are
// asserted on every produced candidate.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  GenerativeInvocationResult,
  GenerativeRequest
} from "@udn/ai-gateway";
import type { Assertion } from "@udn/domain";

import {
  extractPhenotypes,
  MAX_ALTERNATIVES,
  MAX_HPO_MAPPINGS,
  type PhenotypeExtractionGateway,
  type SourceDocument
} from "./extract.js";
import {
  createLexiconHpoResolver,
  isValidHpoIdFormat,
  type HpoLexiconEntry
} from "./hpo-resolver.js";

const MODEL_ID = "anthropic.test-model";

const VALID_ASSERTIONS: readonly Assertion[] = [
  "present",
  "absent",
  "uncertain",
  "historical"
];

/** Format a numeric id as a syntactically valid HPO identifier (HP:0000000). */
function hpoId(num: number): string {
  return `HP:${String(num).padStart(7, "0")}`;
}

/** One HPO term with a model-reported confidence. */
const hpoTermArb = fc.record({
  num: fc.integer({ min: 0, max: 9999999 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true })
});

/**
 * A single generated statement spec. `cue` biases the deterministic assertion
 * classifier across all four polarities; `pool` is a unique set of candidate
 * HPO terms later partitioned into chosen mappings and alternatives so the two
 * lists never overlap; `mappingFraction` selects the partition point (allowing
 * 0 chosen mappings, i.e. an unresolvable term, and up to 40 chosen mappings so
 * the 20-term cap is exercised).
 */
const specArb = fc.record({
  cue: fc.constantFrom("", "no ", "history of ", "possible ", "suspected ", "denies "),
  sourceRef: fc.string({ minLength: 1, maxLength: 6 }),
  statementConfidence: fc.double({ min: 0, max: 1, noNaN: true }),
  pool: fc.uniqueArray(hpoTermArb, {
    minLength: 0,
    maxLength: 40,
    selector: (entry) => entry.num
  }),
  mappingFraction: fc.double({ min: 0, max: 1, noNaN: true })
});

const specsArb = fc.array(specArb, { minLength: 1, maxLength: 8 });

/** A fake gateway that returns the supplied grounded document as `invoked`. */
function gatewayReturning(document: unknown): PhenotypeExtractionGateway {
  return {
    invoke(_request: GenerativeRequest): Promise<GenerativeInvocationResult> {
      return Promise.resolve({
        outcome: "invoked",
        modelId: MODEL_ID,
        taskType: "phenotype_extraction",
        response: { outputText: JSON.stringify(document), modelId: MODEL_ID }
      });
    }
  };
}

describe("Feature: undiagnosed-disease-navigator, Property 11: Phenotype candidates satisfy structural constraints", () => {
  it("every produced candidate satisfies the structural constraints (Req 5.2-5.6)", async () => {
    await fc.assert(
      fc.asyncProperty(specsArb, async (specs) => {
        // Build the lexicon, known-id allowlist, gateway document, and source
        // documents from the generated specs. Statement text is unique per
        // index so lexicon keys never collide.
        const lexicon: Record<string, HpoLexiconEntry> = {};
        const knownHpoIds = new Set<string>();
        const documents: SourceDocument[] = [];
        const statements: unknown[] = [];

        specs.forEach((spec, index) => {
          const base = `finding-${index}`;
          const statementText = `${spec.cue}${base}`;
          const sourceRef = `doc-${spec.sourceRef}`;

          const splitAt = Math.floor(spec.mappingFraction * spec.pool.length);
          const mappingEntries = spec.pool.slice(0, splitAt);
          const alternativeEntries = spec.pool.slice(splitAt);

          const mappings = mappingEntries.map((entry) => ({
            hpoId: hpoId(entry.num),
            confidence: entry.confidence
          }));
          const alternatives = alternativeEntries.map((entry) => ({
            hpoId: hpoId(entry.num),
            confidence: entry.confidence
          }));

          for (const entry of spec.pool) {
            knownHpoIds.add(hpoId(entry.num));
          }

          lexicon[statementText] = {
            mappings,
            ...(alternatives.length > 0 ? { alternatives } : {})
          };
          documents.push({ sourceObjectId: sourceRef, content: `note ${index}` });
          statements.push({
            statement: statementText,
            sourceRefs: [sourceRef],
            confidence: spec.statementConfidence,
            basis: "observed"
          });
        });

        const resolver = createLexiconHpoResolver({ knownHpoIds, lexicon });
        const gateway = gatewayReturning({ statements });

        const result = await extractPhenotypes("case-1", documents, gateway, {
          resolver,
          invokingUserId: "user-1",
          now: () => "2024-01-01T00:00:00.000Z"
        });

        expect(result.outcome).toBe("extracted");
        if (result.outcome !== "extracted") {
          return;
        }

        // One candidate per grounded statement.
        expect(result.candidates).toHaveLength(specs.length);

        for (const candidate of result.candidates) {
          expect(candidate.entityType).toBe("PhenotypeCandidate");
          expect(candidate.caseId).toBe("case-1");
          expect(candidate.aiExtracted).toBe(true);

          // Req 5.3: assertion is exactly one of the permitted values.
          expect(VALID_ASSERTIONS).toContain(candidate.assertion);

          // Req 5.4: confidence is within [0.00, 1.00].
          expect(candidate.confidence).toBeGreaterThanOrEqual(0);
          expect(candidate.confidence).toBeLessThanOrEqual(1);

          // Req 5.2: at most 20 chosen HPO mappings.
          expect(candidate.hpoMappings.length).toBeLessThanOrEqual(MAX_HPO_MAPPINGS);

          // Req 5.5: at most 10 alternatives, ordered by descending confidence,
          // disjoint from the chosen mappings, and each a valid HPO id.
          expect(candidate.alternatives.length).toBeLessThanOrEqual(MAX_ALTERNATIVES);
          const altConfidences = candidate.alternatives.map((a) => a.confidence);
          const sortedDescending = [...altConfidences].sort((a, b) => b - a);
          expect(altConfidences).toEqual(sortedDescending);
          const chosenIds = new Set(candidate.hpoMappings.map((m) => m.hpoId));
          for (const alternative of candidate.alternatives) {
            expect(isValidHpoIdFormat(alternative.hpoId)).toBe(true);
            expect(chosenIds.has(alternative.hpoId)).toBe(false);
          }

          // Req 5.6: no candidate is ever auto-confirmed on extraction.
          expect(["pending_review", "unresolved"]).toContain(candidate.status);
          expect(candidate.status).not.toBe("approved");
          expect(candidate.status).not.toBe("rejected");

          if (candidate.hpoMappings.length > 0) {
            // A resolvable candidate: Req 5.2 (1-20 HPO terms), Req 5.6 (initial
            // status pending review), Req 5.4 (link to a supporting source).
            expect(candidate.hpoMappings.length).toBeGreaterThanOrEqual(1);
            expect(candidate.status).toBe("pending_review");
            expect(candidate.sourceObjectRef.length).toBeGreaterThan(0);
            for (const mapping of candidate.hpoMappings) {
              expect(isValidHpoIdFormat(mapping.hpoId)).toBe(true);
            }
          } else {
            // An unresolvable term is retained but not marked pending review.
            expect(candidate.status).toBe("unresolved");
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
