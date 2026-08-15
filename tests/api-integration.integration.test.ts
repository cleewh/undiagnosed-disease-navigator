// tests/api-integration.integration.test.ts
//
// Task 32.3 — API-integration-category completion test (Requirement 31.1).
//
// This file carries the `.integration.test.` infix so the harness (task 32.1,
// scripts/test-report.mjs) categorises it as `integration`. It exercises a REAL
// integration path across multiple service packages, with deterministic
// assertions and no AWS/Bedrock:
//
//   @udn/data-generator  -> produces a synthetic case + its artifact bundle
//   @udn/intake          -> validates + creates the Case, retaining artifacts
//   @udn/persistence     -> persists the Case through the SingleTableRepository
//                           over the dependency-free InMemoryDocumentClient
//   @udn/timeline        -> reconstructs the diagnostic timeline from the
//                           retained FHIR record and resolves its source links
//
// The path composes intake -> persistence -> timeline end to end using only the
// packages' public APIs, so a regression in the seam between any two services
// fails here. Every input is generated from a fixed seed, so the assertions are
// deterministic and reproducible.

import { describe, it, expect } from "vitest";
import type { Case } from "@udn/domain";
import { SingleTableRepository, InMemoryDocumentClient } from "@udn/persistence";
import {
  generateCorpus,
  type CaseArtifacts,
  type GeneratedCase
} from "@udn/data-generator";
import {
  ingestCase,
  type IngestArtifact,
  type IngestCaseInput
} from "@udn/intake";
import {
  buildTimeline,
  resolveSourceObject,
  type CaseClinicalData
} from "@udn/timeline";

// A fixed seed keeps the whole integration path byte-for-byte reproducible.
const corpus = generateCorpus({ seed: 20240601, withArtifacts: true });

/** Build the ordered ingest-artifact list from a generated case's bundle. */
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
    sourceId: `integration-${generated.case.caseId}-${name}`,
    versionId: "1",
    createdById: "api-integration-test"
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
    createdById: "api-integration-test"
  };
}

describe("API integration (Req 31.1): intake -> persistence -> timeline", () => {
  it("has a generated case with artifacts to exercise", () => {
    expect(corpus.cases.length).toBeGreaterThan(0);
    expect(corpus.artifacts).toBeDefined();
  });

  it("ingests a synthetic case, persists it, and reconstructs a resolvable timeline", async () => {
    const generated = corpus.cases[0]!;
    const caseId = generated.case.caseId;
    const bundle = corpus.artifacts![caseId]!;

    const client = new InMemoryDocumentClient();
    const repository = new SingleTableRepository(client);

    // --- Stage 1: intake validates and creates the Case (via persistence) ---
    const result = await ingestCase(repository, buildInput(generated, bundle));
    expect(result.status).toBe("created");
    if (result.status !== "created") return;

    // The Case enters the initial intake status and retains every artifact.
    expect(result.case.dispositionStatus).toBe("intake");
    expect(result.artifacts.length).toBeGreaterThanOrEqual(7);

    // --- Stage 2: the Case is retrievable through the persistence port -------
    expect(client.size).toBe(1);
    const stored = await repository.getById<Case>(caseId, "Case", caseId);
    expect(stored).toBeDefined();
    expect(stored!.caseId).toBe(caseId);
    expect(stored!.clinicalArea).toBe(generated.spec.clinicalArea);
    expect(stored!.inheritanceModel).toBe(generated.spec.inheritanceModel);

    // --- Stage 3: the retained FHIR record drives timeline reconstruction ----
    const retainedFhir = result.artifacts.find((a) => a.kind === "fhir");
    expect(retainedFhir).toBeDefined();
    const fhir = retainedFhir!.content as CaseArtifacts["fhir"];
    const clinical: CaseClinicalData = {
      encounters: fhir.encounters,
      observations: fhir.observations,
      conditions: fhir.conditions
    };

    const timeline = buildTimeline(clinical);
    expect(timeline.isEmpty).toBe(false);
    expect(timeline.entries.length).toBeGreaterThan(0);

    // The timeline is ordered oldest-first and every entry link resolves.
    for (let i = 1; i < timeline.entries.length; i += 1) {
      const prev = timeline.entries[i - 1]!;
      const curr = timeline.entries[i]!;
      expect(Date.parse(prev.eventDate)).toBeLessThanOrEqual(Date.parse(curr.eventDate));
    }
    for (const entry of timeline.entries) {
      expect(resolveSourceObject(clinical, entry.sourceObjectRef)).toBeDefined();
    }
  });

  it("is deterministic: re-running the path yields the same Case and timeline shape", async () => {
    const generated = corpus.cases[0]!;
    const caseId = generated.case.caseId;
    const bundle = corpus.artifacts![caseId]!;

    const run = async (): Promise<{ status: string; entryCount: number }> => {
      const repository = new SingleTableRepository(new InMemoryDocumentClient());
      const result = await ingestCase(repository, buildInput(generated, bundle));
      const fhir = bundle.fhir;
      const timeline = buildTimeline({
        encounters: fhir.encounters,
        observations: fhir.observations,
        conditions: fhir.conditions
      });
      return { status: result.status, entryCount: timeline.entries.length };
    };

    const first = await run();
    const second = await run();
    expect(second).toEqual(first);
    expect(first.status).toBe("created");
  });
});
