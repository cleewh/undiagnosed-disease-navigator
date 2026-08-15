// services/intake/src/invalid-intake.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 6: Invalid intake is rejected with structured errors and no Case
//
// Validates: Requirements 3.2, 3.3
//
// Property 6 (design.md): *For any* ingested case that fails schema validation,
// has a missing or malformed artifact, or has an artifact exceeding 50 MB,
// intake creates no Case record and returns a structured validation error
// identifying the failing field with expected and actual values, or the
// violated artifact constraint.
//
// Strategy: from a deterministically generated corpus (@udn/data-generator,
// `generateCorpus({ withArtifacts: true })`) we build a KNOWN-GOOD
// IngestCaseInput carrying every required artifact (fhir, phenopacket,
// pedigree, vcf, annotation, qc, candidates). For each iteration we:
//   1. positive control — ingest the pristine input against a fresh in-memory
//      repository and assert status "created" (the input is genuinely valid);
//   2. apply one randomly chosen invalidation:
//        (a) drop a required artifact kind          -> artifact_missing/required
//        (b) null-out an artifact's content          -> artifact_malformed/well_formed
//        (c) set sizeBytes to MAX + 1 (too large)    -> artifact_too_large/max_size
//        (d) corrupt phenopacket subject.sex          -> schema_validation @ subject.sex
//      and ingest the invalidated input against ANOTHER fresh in-memory
//      repository, asserting status "rejected" with a non-empty structured
//      errors array naming the failing field / artifact / constraint, and that
//      NO Case was persisted (client.size === 0).
//
// The corpus is deterministic per seed and cached; ingest is pure + in-memory,
// so >= 100 iterations stay cheap. No mocks: the real SingleTableRepository
// runs over the dependency-free InMemoryDocumentClient.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { SingleTableRepository, InMemoryDocumentClient } from "@udn/persistence";
import {
  generateCorpus,
  type CaseArtifacts,
  type GeneratedCase,
  type GeneratedCorpus
} from "@udn/data-generator";

import {
  ingestCase,
  REQUIRED_ARTIFACT_KINDS,
  type ArtifactKind,
  type IngestArtifact,
  type IngestCaseInput
} from "./intake.js";
import { MAX_ARTIFACT_SIZE_BYTES } from "./errors.js";

// Deterministic per-seed corpus generation, cached to keep iterations cheap.
const corpusCache = new Map<number, GeneratedCorpus>();

function corpusForSeed(seed: number): GeneratedCorpus {
  let corpus = corpusCache.get(seed);
  if (!corpus) {
    corpus = generateCorpus({ seed, withArtifacts: true });
    corpusCache.set(seed, corpus);
  }
  return corpus;
}

// Build a fresh, known-good intake input from a generated case. Each call
// produces brand-new IngestArtifact wrappers so that per-run invalidations
// never mutate the shared/cached corpus content.
function inputFromGenerated(
  generated: GeneratedCase,
  artifacts: CaseArtifacts
): IngestCaseInput {
  const createdById = "test-intake-actor";

  const mk = (kind: ArtifactKind, content: unknown): IngestArtifact => ({
    name: kind,
    kind,
    content,
    sourceId: `${generated.case.caseId}-${kind}`,
    versionId: "gen-v1",
    createdById
  });

  const items: IngestArtifact[] = [
    mk("fhir", artifacts.fhir),
    mk("phenopacket", artifacts.phenopacket),
    mk("pedigree", artifacts.pedigree),
    mk("vcf", artifacts.vcf),
    mk("annotation", artifacts.annotation),
    mk("qc", artifacts.qc),
    mk("candidates", artifacts.candidates)
  ];

  return {
    caseId: generated.case.caseId,
    caseMetadata: {
      clinicalArea: generated.spec.clinicalArea,
      archetype: generated.spec.archetype,
      inheritanceModel: generated.spec.inheritanceModel,
      familyBased: generated.spec.familyBased
    },
    artifacts: items,
    createdById
  };
}

// The four invalidations Property 6 covers: a missing required artifact, a
// malformed (null-content) artifact, an oversized artifact, and a schema
// violation (corrupt Phenopacket subject.sex).
type Invalidation =
  | { mode: "drop"; kind: ArtifactKind }
  | { mode: "null"; kind: ArtifactKind }
  | { mode: "oversize"; kind: ArtifactKind }
  | { mode: "corrupt_sex"; sex: string };

// Sex values that are NOT in the accepted GA4GH subset [FEMALE, MALE,
// UNKNOWN_SEX], so they must fail schema validation at subject.sex.
const INVALID_SEX_VALUES = ["M", "F", "male", "female", "", "Other", "UNKNOWN"];

const requiredKindArb = fc.constantFrom<ArtifactKind>(...REQUIRED_ARTIFACT_KINDS);

const invalidationArb: fc.Arbitrary<Invalidation> = fc.oneof(
  requiredKindArb.map((kind) => ({ mode: "drop" as const, kind })),
  requiredKindArb.map((kind) => ({ mode: "null" as const, kind })),
  requiredKindArb.map((kind) => ({ mode: "oversize" as const, kind })),
  fc.constantFrom(...INVALID_SEX_VALUES).map((sex) => ({
    mode: "corrupt_sex" as const,
    sex
  }))
);

// Apply an invalidation to a fresh input, returning the mutated input. Only
// per-run wrapper objects are touched; shared corpus content is never mutated.
function applyInvalidation(
  input: IngestCaseInput,
  inv: Invalidation
): IngestCaseInput {
  switch (inv.mode) {
    case "drop":
      input.artifacts = input.artifacts.filter((a) => a.kind !== inv.kind);
      return input;
    case "null": {
      const target = input.artifacts.find((a) => a.kind === inv.kind)!;
      target.content = null;
      return input;
    }
    case "oversize": {
      const target = input.artifacts.find((a) => a.kind === inv.kind)!;
      target.sizeBytes = MAX_ARTIFACT_SIZE_BYTES + 1;
      return input;
    }
    case "corrupt_sex": {
      const target = input.artifacts.find((a) => a.kind === "phenopacket")!;
      const original = target.content as Record<string, unknown>;
      const subject = (original.subject ?? {}) as Record<string, unknown>;
      target.content = { ...original, subject: { ...subject, sex: inv.sex } };
      return input;
    }
  }
}

describe("Feature: undiagnosed-disease-navigator, Property 6: Invalid intake is rejected with structured errors and no Case", () => {
  it("rejects any schema-invalid / missing / malformed / oversized intake with structured errors and creates no Case, while the pristine input is accepted", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 24 }),
        fc.nat(),
        invalidationArb,
        async (seed, caseSelector, inv) => {
          const { cases, artifacts } = corpusForSeed(seed);
          expect(cases.length).toBeGreaterThan(0);
          const generated = cases[caseSelector % cases.length]!;
          const bundle = artifacts![generated.case.caseId]!;

          // --- Positive control: the pristine input is genuinely valid. -----
          const goodClient = new InMemoryDocumentClient();
          const goodRepo = new SingleTableRepository(goodClient);
          const goodResult = await ingestCase(
            goodRepo,
            inputFromGenerated(generated, bundle)
          );
          expect(goodResult.status).toBe("created");
          expect(goodClient.size).toBe(1);

          // --- Invalidated input must be rejected with structured errors. ---
          const badClient = new InMemoryDocumentClient();
          const badRepo = new SingleTableRepository(badClient);
          const input = applyInvalidation(
            inputFromGenerated(generated, bundle),
            inv
          );
          const result = await ingestCase(badRepo, input);

          expect(result.status).toBe("rejected");
          if (result.status !== "rejected") return;

          // A non-empty, structured errors array is always returned.
          expect(Array.isArray(result.errors)).toBe(true);
          expect(result.errors.length).toBeGreaterThan(0);
          for (const err of result.errors) {
            expect(typeof err.code).toBe("string");
            expect(typeof err.message).toBe("string");
            expect(err.message.length).toBeGreaterThan(0);
          }

          // The error naming the specific violated constraint / field exists.
          switch (inv.mode) {
            case "drop": {
              const err = result.errors.find(
                (e) => e.code === "artifact_missing" && e.artifact === inv.kind
              );
              expect(err).toBeDefined();
              expect(err?.constraint).toBe("required");
              break;
            }
            case "null": {
              const err = result.errors.find(
                (e) =>
                  e.code === "artifact_malformed" && e.artifact === inv.kind
              );
              expect(err).toBeDefined();
              expect(err?.constraint).toBe("well_formed");
              break;
            }
            case "oversize": {
              const err = result.errors.find(
                (e) =>
                  e.code === "artifact_too_large" && e.artifact === inv.kind
              );
              expect(err).toBeDefined();
              expect(err?.constraint).toBe("max_size");
              break;
            }
            case "corrupt_sex": {
              const err = result.errors.find(
                (e) =>
                  e.code === "schema_validation" &&
                  e.artifact === "phenopacket" &&
                  e.field === "subject.sex"
              );
              expect(err).toBeDefined();
              // Names the expected format and the actual value received.
              expect(err?.expected).toContain("FEMALE");
              expect(typeof err?.actual).toBe("string");
              break;
            }
          }

          // No Case record was created or persisted on rejection (Req 3.2/3.3).
          expect(badClient.size).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
