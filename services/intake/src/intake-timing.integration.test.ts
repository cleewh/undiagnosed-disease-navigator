// services/intake/src/intake-timing.integration.test.ts
//
// Task 8.6 — Intake timing integration test.
//
// Validates: Requirement 3.1 — "WHEN a synthetic case is ingested, THE
// Intake_Service SHALL validate the case data against the Phenopacket schema
// and the FHIR R4 resource definitions used, completing validation within 30
// seconds per case."
//
// This is an INTEGRATION/timing test (hence the `.integration.test.ts` suffix
// so the report script categorises it as integration). It exercises the REAL
// `ingestCase` pipeline against REAL synthetic artifacts produced by
// @udn/data-generator (`generateCorpus({ withArtifacts: true })`), persisted
// through the real SingleTableRepository over the dependency-free
// InMemoryDocumentClient — no mocks, no AWS, no artificial delays.
//
// It measures wall-clock time (performance.now) around each `ingestCase` call
// for a handful of generated cases and asserts each completes well within the
// 30-second per-case bound. In practice ingestion is a few milliseconds; the
// generous bound is the contractual requirement, and the test also records the
// observed maximum for visibility.

import { describe, it, expect } from "vitest";
import { SingleTableRepository, InMemoryDocumentClient } from "@udn/persistence";
import {
  generateCorpus,
  type CaseArtifacts,
  type GeneratedCase
} from "@udn/data-generator";

import { ingestCase, type IngestArtifact, type IngestCaseInput } from "./intake.js";

/** The Requirement 3.1 per-case validation bound, in milliseconds. */
const PER_CASE_VALIDATION_BOUND_MS = 30_000;

/** How many generated cases to exercise (a representative handful). */
const CASE_SAMPLE_SIZE = 8;

// Build the ordered ingest-artifact list from a generated case's bundle. The
// seven required artifact kinds always exist; inheritance is included when the
// case is family-based so family cases exercise a fuller artifact set.
function buildArtifacts(
  generated: GeneratedCase,
  bundle: CaseArtifacts
): IngestArtifact[] {
  const mk = (
    name: string,
    kind: IngestArtifact["kind"],
    content: unknown
  ): IngestArtifact => ({
    name,
    kind,
    content,
    sourceId: `timing-${generated.case.caseId}-${name}`,
    versionId: "1",
    createdById: "integration-test"
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

function buildInput(
  generated: GeneratedCase,
  bundle: CaseArtifacts
): IngestCaseInput {
  return {
    caseId: generated.case.caseId,
    caseMetadata: {
      clinicalArea: generated.spec.clinicalArea,
      archetype: generated.spec.archetype,
      inheritanceModel: generated.spec.inheritanceModel,
      familyBased: generated.spec.familyBased
    },
    artifacts: buildArtifacts(generated, bundle),
    createdById: "integration-test"
  };
}

describe("Intake timing (Req 3.1): per-case validation completes within 30 seconds", () => {
  const corpus = generateCorpus({ withArtifacts: true });
  const sample = corpus.cases.slice(0, CASE_SAMPLE_SIZE);

  it("ingests a handful of generated cases each within the 30-second bound", async () => {
    expect(sample.length).toBeGreaterThan(0);

    let maxElapsedMs = 0;

    for (const generated of sample) {
      const bundle = corpus.artifacts![generated.case.caseId]!;
      const input = buildInput(generated, bundle);

      // Fresh persistence per case so timing reflects a single ingestion.
      const client = new InMemoryDocumentClient();
      const repository = new SingleTableRepository(client);

      const start = performance.now();
      const result = await ingestCase(repository, input);
      const elapsedMs = performance.now() - start;
      maxElapsedMs = Math.max(maxElapsedMs, elapsedMs);

      // The generated cases are valid, so intake must succeed and, critically,
      // must have completed its validation within the per-case bound (Req 3.1).
      expect(result.status).toBe("created");
      expect(elapsedMs).toBeLessThan(PER_CASE_VALIDATION_BOUND_MS);
    }

    // The observed maximum is expected to be a few milliseconds — far under the
    // bound. Asserting it here documents the headroom and guards the whole run.
    expect(maxElapsedMs).toBeLessThan(PER_CASE_VALIDATION_BOUND_MS);
  });
});
