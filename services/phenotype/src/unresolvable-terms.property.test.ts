// services/phenotype/src/unresolvable-terms.property.test.ts
//
// Property-based test for Correctness Property 12 (Task 13.3, Requirement 5.7).
//
// Feature: undiagnosed-disease-navigator, Property 12: Unresolvable phenotype
// terms are retained and flagged.
//
// Design (Property 12): For any returned phenotype term that cannot be resolved
// to a valid HPO identifier, the candidate is marked unresolved, retained, and
// flagged for review.
//
// Requirement 5.7: IF the AI_Gateway returns a phenotype term that cannot be
// resolved to a valid HPO identifier, THEN THE Phenotype_Service SHALL mark the
// phenotype candidate as unresolved, retain the candidate record, and flag it
// for review.
//
// The test drives the real `extractPhenotypes` pipeline with a fake gateway
// that returns a generated, schema-conforming grounded document (no AWS, no
// Bedrock) and a deterministic in-memory HPO resolver seeded from the same
// generated lexicon. Every generated statement is given a supporting source, so
// the ONLY reason a candidate can be unresolvable here is that its term does
// not resolve to a valid, known HPO identifier — isolating exactly the
// condition Property 12 / Req 5.7 describe. Statements are generated in three
// unresolvable flavours (absent from the lexicon, mapped only to
// malformed HPO ids, mapped only to well-formed-but-unknown ids) alongside a
// resolvable control group; the test asserts every unresolvable statement is
// retained as a flagged "unresolved" candidate and every resolvable one becomes
// a "pending_review" candidate.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  GenerativeInvocationResult,
  GenerativeRequest
} from "@udn/ai-gateway";
import type { HpoMapping } from "@udn/domain";

import {
  extractPhenotypes,
  type PhenotypeExtractionGateway,
  type SourceDocument
} from "./extract.js";
import {
  createLexiconHpoResolver,
  isValidHpoIdFormat,
  type HpoLexiconEntry
} from "./hpo-resolver.js";

const MODEL_ID = "anthropic.test-model";

/** Format a numeric id as a syntactically valid HPO identifier (HP:0000000). */
function hpoId(num: number): string {
  return `HP:${String(num).padStart(7, "0")}`;
}

/** One HPO term (by numeric id) with a model-reported confidence. */
const hpoTermArb = fc.record({
  num: fc.integer({ min: 0, max: 9999999 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true })
});

// A RESOLVABLE statement: maps to 1-20 well-formed HPO ids that the resolver is
// told are known. Its numeric ids are drawn from the LOW half of the id space.
const resolvableSpecArb = fc.record({
  kind: fc.constant("resolvable" as const),
  mappings: fc.uniqueArray(
    fc.record({
      num: fc.integer({ min: 0, max: 4999999 }),
      confidence: fc.double({ min: 0, max: 1, noNaN: true })
    }),
    { minLength: 1, maxLength: 20, selector: (entry) => entry.num }
  )
});

// UNRESOLVABLE flavour A: the term is absent from the lexicon entirely, so the
// resolver returns no mappings at all.
const noEntrySpecArb = fc.record({
  kind: fc.constant("no-entry" as const)
});

// UNRESOLVABLE flavour B: the term resolves ONLY to malformed HPO ids (none
// pass the HP:####### format check).
const invalidFormatSpecArb = fc.record({
  kind: fc.constant("invalid-format" as const),
  badIds: fc.array(
    fc.constantFrom(
      "NOPE",
      "HP:12",
      "12345",
      "hp:0000001",
      "HP:00000001",
      "HP:ABCDEFG",
      "HPO:0000001",
      " "
    ),
    { minLength: 1, maxLength: 5 }
  ),
  confidence: fc.double({ min: 0, max: 1, noNaN: true })
});

// UNRESOLVABLE flavour C: the term resolves ONLY to well-formed ids that are
// NOT in the resolver's known-id allowlist. Numeric ids are drawn from the HIGH
// half of the id space and never added to `knownHpoIds`, so they can never
// collide with a resolvable statement's (low-half) known ids.
const unknownIdSpecArb = fc.record({
  kind: fc.constant("unknown-id" as const),
  unknownNums: fc.uniqueArray(fc.integer({ min: 5000000, max: 9999999 }), {
    minLength: 1,
    maxLength: 5
  }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true })
});

const specArb = fc.oneof(
  resolvableSpecArb,
  noEntrySpecArb,
  invalidFormatSpecArb,
  unknownIdSpecArb
);

// At least one statement, up to eight, mixing resolvable and unresolvable kinds.
const specsArb = fc.array(specArb, { minLength: 1, maxLength: 8 });

type Spec = typeof specArb extends fc.Arbitrary<infer T> ? T : never;

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

/** Whether a spec is expected to yield an unresolvable candidate. */
function isUnresolvable(spec: Spec): boolean {
  return spec.kind !== "resolvable";
}

describe("Feature: undiagnosed-disease-navigator, Property 12: Unresolvable phenotype terms are retained and flagged", () => {
  it("retains and flags every unresolvable term while resolvable terms remain pending review (Req 5.7)", async () => {
    await fc.assert(
      fc.asyncProperty(specsArb, async (specs) => {
        // Build the lexicon, known-id allowlist, gateway document, and source
        // documents from the generated specs. Statement text is unique per
        // index so lexicon keys never collide, and EVERY statement carries a
        // supporting source so unresolvability is driven solely by HPO mapping.
        const lexicon: Record<string, HpoLexiconEntry> = {};
        const knownHpoIds = new Set<string>();
        const documents: SourceDocument[] = [];
        const statements: unknown[] = [];

        specs.forEach((spec, index) => {
          const statementText = `finding-${index}`;
          const sourceRef = `doc-${index}`;

          switch (spec.kind) {
            case "resolvable": {
              const mappings: HpoMapping[] = spec.mappings.map((entry) => ({
                hpoId: hpoId(entry.num),
                confidence: entry.confidence
              }));
              for (const entry of spec.mappings) {
                knownHpoIds.add(hpoId(entry.num));
              }
              lexicon[statementText] = { mappings };
              break;
            }
            case "no-entry": {
              // Deliberately no lexicon entry for this term.
              break;
            }
            case "invalid-format": {
              const mappings: HpoMapping[] = spec.badIds.map((id) => ({
                hpoId: id,
                confidence: spec.confidence
              }));
              lexicon[statementText] = { mappings };
              break;
            }
            case "unknown-id": {
              const mappings: HpoMapping[] = spec.unknownNums.map((num) => ({
                hpoId: hpoId(num),
                confidence: spec.confidence
              }));
              // NB: intentionally NOT added to knownHpoIds.
              lexicon[statementText] = { mappings };
              break;
            }
          }

          documents.push({ sourceObjectId: sourceRef, content: `note ${index}` });
          statements.push({
            statement: statementText,
            sourceRefs: [sourceRef],
            confidence: 0.5,
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

        // Retention: exactly one candidate per grounded statement — no term is
        // ever dropped, including the unresolvable ones (Req 5.7 "retain").
        expect(result.candidates).toHaveLength(specs.length);

        specs.forEach((spec, index) => {
          const candidate = result.candidates[index];
          // Candidate must exist (retained) and correspond to its statement.
          expect(candidate).toBeDefined();
          if (candidate === undefined) {
            return;
          }
          expect(candidate.entityType).toBe("PhenotypeCandidate");
          expect(candidate.caseId).toBe("case-1");
          expect(candidate.aiExtracted).toBe(true);

          if (isUnresolvable(spec)) {
            // Req 5.7: unresolvable term is retained, marked "unresolved", and
            // flagged for review (never dropped, never auto-confirmed, never
            // silently marked pending review).
            expect(candidate.status).toBe("unresolved");
            expect(candidate.hpoMappings).toHaveLength(0);
            expect(candidate.status).not.toBe("pending_review");
            expect(candidate.status).not.toBe("approved");
            expect(candidate.status).not.toBe("rejected");
            // The record is retained with its supporting source intact.
            expect(candidate.sourceObjectRef).toBe(`doc-${index}`);
          } else {
            // Control group: a resolvable term maps to 1-20 valid HPO ids and
            // is stored pending review, confirming unresolved-flagging does not
            // over-fire on mappable terms.
            expect(candidate.status).toBe("pending_review");
            expect(candidate.hpoMappings.length).toBeGreaterThanOrEqual(1);
            expect(candidate.hpoMappings.length).toBeLessThanOrEqual(20);
            for (const mapping of candidate.hpoMappings) {
              expect(isValidHpoIdFormat(mapping.hpoId)).toBe(true);
              expect(knownHpoIds.has(mapping.hpoId)).toBe(true);
            }
          }
        });
      }),
      { numRuns: 200 }
    );
  });
});
