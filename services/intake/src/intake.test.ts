// services/intake/src/intake.test.ts
//
// Unit tests for the Intake_Service pipeline (task 8.1, Requirement 3).
//
// The valid-path tests drive intake with REAL artifacts produced by the
// synthetic case generator (@udn/data-generator, `generateCorpus({
// withArtifacts: true })`) persisted through the real SingleTableRepository
// over the dependency-free InMemoryDocumentClient — no mocks, no AWS. The
// rejection tests mutate a known-good input to exercise each failure mode.

import { describe, it, expect, beforeEach } from "vitest";
import { SingleTableRepository, InMemoryDocumentClient } from "@udn/persistence";
import { generateCorpus, type CaseArtifacts, type GeneratedCase } from "@udn/data-generator";
import type { Case } from "@udn/domain";

import { ingestCase, type IngestArtifact, type IngestCaseInput } from "./intake.js";
import { MAX_ARTIFACT_SIZE_BYTES } from "./errors.js";

/** Build an intake input from a generated case and its artifact bundle. */
function inputFromGenerated(
  generated: GeneratedCase,
  artifacts: CaseArtifacts
): IngestCaseInput {
  const createdById = "test-intake-actor";

  const mk = (
    name: string,
    kind: IngestArtifact["kind"],
    content: unknown
  ): IngestArtifact => ({
    name,
    kind,
    content,
    sourceId: `${generated.case.caseId}-${name}`,
    versionId: "gen-v1",
    createdById
  });

  const items: IngestArtifact[] = [
    mk("fhir", "fhir", artifacts.fhir),
    mk("phenopacket", "phenopacket", artifacts.phenopacket),
    mk("pedigree", "pedigree", artifacts.pedigree),
    mk("vcf", "vcf", artifacts.vcf),
    mk("annotation", "annotation", artifacts.annotation),
    mk("qc", "qc", artifacts.qc),
    mk("candidates", "candidates", artifacts.candidates)
  ];
  if (artifacts.inheritanceResults) {
    items.push(mk("inheritance", "inheritance", artifacts.inheritanceResults));
  }

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

describe("ingestCase — valid case", () => {
  let client: InMemoryDocumentClient;
  let repository: SingleTableRepository;
  let generated: GeneratedCase;
  let artifacts: CaseArtifacts;
  let input: IngestCaseInput;

  beforeEach(() => {
    client = new InMemoryDocumentClient();
    repository = new SingleTableRepository(client);
    const corpus = generateCorpus({ withArtifacts: true });
    generated = corpus.cases[0]!;
    artifacts = corpus.artifacts![generated.case.caseId]!;
    input = inputFromGenerated(generated, artifacts);
  });

  it("creates a Case in the initial intake status and persists it (Req 3.4)", async () => {
    const result = await ingestCase(repository, input);

    expect(result.status).toBe("created");
    if (result.status !== "created") return;

    expect(result.case.entityType).toBe("Case");
    expect(result.case.dispositionStatus).toBe("intake");
    expect(result.case.status).toBe("intake");
    expect(result.case.caseId).toBe(generated.case.caseId);

    const stored = await repository.getById<Case>(
      generated.case.caseId,
      "Case",
      generated.case.caseId
    );
    expect(stored).toBeDefined();
    expect(stored?.dispositionStatus).toBe("intake");
    expect(client.size).toBe(1);
  });

  it("retains every ingested artifact byte-for-byte unmodified (Req 3.4)", async () => {
    const result = await ingestCase(repository, input);
    expect(result.status).toBe("created");
    if (result.status !== "created") return;

    expect(result.artifacts).toHaveLength(input.artifacts.length);
    for (const original of input.artifacts) {
      const retained = result.artifacts.find((a) => a.name === original.name);
      expect(retained).toBeDefined();
      // Same reference: content is retained unmodified, not copied/reshaped.
      expect(retained?.content).toBe(original.content);
      expect(retained?.content).toStrictEqual(original.content);
    }
  });

  it("records provenance for each artifact with all four required fields (Req 3.5)", async () => {
    const result = await ingestCase(repository, input);
    expect(result.status).toBe("created");
    if (result.status !== "created") return;

    for (const retained of result.artifacts) {
      expect(retained.provenance.sourceId).toBeTruthy();
      expect(retained.provenance.versionId).toBe("gen-v1");
      expect(retained.provenance.createdById).toBe("test-intake-actor");
      expect(retained.provenance.ingestedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/
      );
    }
  });
});

describe("ingestCase — rejection creates no Case record", () => {
  let client: InMemoryDocumentClient;
  let repository: SingleTableRepository;
  let input: IngestCaseInput;

  beforeEach(() => {
    client = new InMemoryDocumentClient();
    repository = new SingleTableRepository(client);
    const corpus = generateCorpus({ withArtifacts: true });
    const generated = corpus.cases[0]!;
    const artifacts = corpus.artifacts![generated.case.caseId]!;
    input = inputFromGenerated(generated, artifacts);
  });

  it("rejects an invalid Phenopacket with field/expected/actual and no Case (Req 3.2)", async () => {
    const phenopacket = input.artifacts.find((a) => a.kind === "phenopacket")!;
    // Corrupt subject.sex to a value outside the GA4GH enum.
    phenopacket.content = {
      ...(phenopacket.content as Record<string, unknown>),
      subject: { id: "subj-1", sex: "M" }
    };

    const result = await ingestCase(repository, input);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;

    const err = result.errors.find(
      (e) => e.code === "schema_validation" && e.field === "subject.sex"
    );
    expect(err).toBeDefined();
    expect(err?.artifact).toBe("phenopacket");
    expect(err?.expected).toContain("FEMALE");
    expect(err?.actual).toBe('"M"');

    expect(client.size).toBe(0);
  });

  it("rejects an oversized artifact naming the max-size constraint and no Case (Req 3.3)", async () => {
    const vcf = input.artifacts.find((a) => a.kind === "vcf")!;
    vcf.sizeBytes = MAX_ARTIFACT_SIZE_BYTES + 1;

    const result = await ingestCase(repository, input);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;

    const err = result.errors.find((e) => e.code === "artifact_too_large");
    expect(err).toBeDefined();
    expect(err?.artifact).toBe("vcf");
    expect(err?.constraint).toBe("max_size");
    expect(client.size).toBe(0);
  });

  it("rejects a missing required artifact naming the constraint and no Case (Req 3.3)", async () => {
    input.artifacts = input.artifacts.filter((a) => a.kind !== "vcf");

    const result = await ingestCase(repository, input);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;

    const err = result.errors.find(
      (e) => e.code === "artifact_missing" && e.artifact === "vcf"
    );
    expect(err).toBeDefined();
    expect(err?.constraint).toBe("required");
    expect(client.size).toBe(0);
  });

  it("rejects a malformed artifact (null content) and creates no Case (Req 3.3)", async () => {
    const qc = input.artifacts.find((a) => a.kind === "qc")!;
    qc.content = null;

    const result = await ingestCase(repository, input);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;

    const err = result.errors.find(
      (e) => e.code === "artifact_malformed" && e.artifact === "qc"
    );
    expect(err).toBeDefined();
    expect(err?.constraint).toBe("well_formed");
    expect(client.size).toBe(0);
  });
});
