// services/intake/src/valid-intake.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 7: Valid intake preserves artifacts and records provenance
//
// Validates: Requirements 3.4, 3.5
//
// Property 7 (design.md): *For any* case that passes validation, every ingested
// artifact is retained byte-for-byte unmodified, the Case is created in the
// initial intake status, and each artifact carries provenance with source
// identifier, version identifier, created-by, and ingestion timestamp.
//
// The property is exercised against REAL synthetic artifacts produced by
// @udn/data-generator (`generateCorpus({ withArtifacts: true })`) persisted
// through the real SingleTableRepository over the dependency-free
// InMemoryDocumentClient — no mocks, no AWS. Each iteration varies which case
// is ingested (a generated index into the corpus) and the createdById /
// sourceId / versionId provenance inputs.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { SingleTableRepository, InMemoryDocumentClient } from "@udn/persistence";
import {
  generateCorpus,
  type CaseArtifacts,
  type GeneratedCase
} from "@udn/data-generator";
import type { Case } from "@udn/domain";

import { ingestCase, type IngestArtifact, type IngestCaseInput } from "./intake.js";

// ISO-8601 UTC timestamp with at least second precision, ending in Z or
// +00:00 (optional fractional seconds).
const ISO_UTC_AT_LEAST_SECONDS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/;

// A non-empty, trimmed identifier string for the varied provenance inputs.
const nonEmptyString = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

// The synthetic corpus (with per-case artifact bundles) is deterministic in
// its seed, so it is generated once and reused across all iterations. Each
// iteration selects a case by index and builds fresh intake input from it.
const corpus = generateCorpus({ withArtifacts: true });
const cases = corpus.cases;

// The ordered map from an ingest artifact kind to the corpus bundle field.
// The required kinds always exist; inheritance is included when present.
function buildArtifacts(
  generated: GeneratedCase,
  bundle: CaseArtifacts,
  sourcePrefix: string,
  versionId: string,
  createdById: string
): IngestArtifact[] {
  const mk = (
    name: string,
    kind: IngestArtifact["kind"],
    content: unknown
  ): IngestArtifact => ({
    name,
    kind,
    content,
    sourceId: `${sourcePrefix}-${generated.case.caseId}-${name}`,
    versionId,
    createdById
  });

  const items: IngestArtifact[] = [
    mk("fhir", "fhir", bundle.fhir),
    mk("phenopacket", "phenopacket", bundle.phenopacket),
    mk("pedigree", "pedigree", bundle.pedigree),
    mk("vcf", "vcf", bundle.vcf),
    mk("annotation", "annotation", bundle.annotation),
    mk("qc", "qc", bundle.qc),
    mk("candidates", "candidates", bundle.candidates)
  ];
  if (bundle.inheritanceResults) {
    items.push(mk("inheritance", "inheritance", bundle.inheritanceResults));
  }
  return items;
}

describe("Property 7: Valid intake preserves artifacts and records provenance", () => {
  it("creates the Case in the initial intake status, persists it, and retains every artifact byte-for-byte with complete provenance", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: cases.length - 1 }),
        nonEmptyString,
        nonEmptyString,
        nonEmptyString,
        async (caseIndex, createdById, versionId, sourcePrefix) => {
          const generated = cases[caseIndex]!;
          const bundle = corpus.artifacts![generated.case.caseId]!;

          const artifacts = buildArtifacts(
            generated,
            bundle,
            sourcePrefix,
            versionId,
            createdById
          );

          // Fresh persistence per iteration so `client.size` reflects only
          // this ingestion.
          const client = new InMemoryDocumentClient();
          const repository = new SingleTableRepository(client);

          const input: IngestCaseInput = {
            caseId: generated.case.caseId,
            caseMetadata: {
              clinicalArea: generated.spec.clinicalArea,
              archetype: generated.spec.archetype,
              inheritanceModel: generated.spec.inheritanceModel,
              familyBased: generated.spec.familyBased
            },
            artifacts,
            createdById
          };

          const result = await ingestCase(repository, input);

          // The generated cases are valid, so intake must succeed (Req 3.4).
          expect(result.status).toBe("created");
          if (result.status !== "created") return;

          // A Case is created in the initial intake status (Req 3.4).
          expect(result.case.entityType).toBe("Case");
          expect(result.case.dispositionStatus).toBe("intake");
          expect(result.case.status).toBe("intake");
          expect(result.case.caseId).toBe(generated.case.caseId);

          // The Case is persisted through the repository (Req 3.4).
          const stored = await repository.getById<Case>(
            generated.case.caseId,
            "Case",
            generated.case.caseId
          );
          expect(stored).toBeDefined();
          expect(stored?.dispositionStatus).toBe("intake");
          expect(client.size).toBe(1);

          // Every ingested artifact is retained, none added or dropped.
          expect(result.artifacts).toHaveLength(input.artifacts.length);

          for (const original of input.artifacts) {
            const retained = result.artifacts.find(
              (a) => a.name === original.name
            );
            expect(retained).toBeDefined();
            if (!retained) continue;

            // Byte-for-byte unmodified: same reference AND deep-equal (Req 3.4).
            expect(retained.content).toBe(original.content);
            expect(retained.content).toStrictEqual(original.content);
            expect(retained.kind).toBe(original.kind);

            // Provenance records all four required fields (Req 3.5).
            expect(retained.provenance.sourceId).toBe(original.sourceId);
            expect(retained.provenance.versionId).toBe(original.versionId);
            expect(retained.provenance.createdById).toBe(original.createdById);
            expect(retained.provenance.ingestedAt).toMatch(
              ISO_UTC_AT_LEAST_SECONDS
            );
            expect(
              Number.isNaN(Date.parse(retained.provenance.ingestedAt))
            ).toBe(false);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
