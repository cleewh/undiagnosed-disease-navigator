// services/persistence/src/repository.test.ts
//
// Unit tests for the single-table repository (task 3.2) exercising it through
// the dependency-free InMemoryDocumentClient. They cover:
//
//   * Optimistic concurrency on versioned mutable writes (Req 23.4, 23.5):
//     create-once semantics for version 1, successful version-N updates via
//     touchEnvelope, and stale-update conflicts that leave storage unchanged.
//   * Immutable append-only writes (Req 22.3, 27.5): a single successful write
//     followed by a refused overwrite that preserves the original.
//   * Envelope validation before persistence (Req 23.6): invalid objects are
//     rejected and never written.
//   * Round-trip fidelity (toItem/fromItem) and the documented base-table and
//     GSI access patterns.

import { describe, it, expect, beforeEach } from "vitest";
import { createEnvelope, touchEnvelope, EnvelopeValidationError } from "@udn/domain";
import type {
  AuditEvent,
  Case,
  ProvenanceRef,
  ReanalysisCandidate,
  Variant
} from "@udn/domain";

import { ImmutableWriteError, OptimisticConcurrencyError } from "./errors.js";
import { InMemoryDocumentClient } from "./in-memory-client.js";
import { fromItem, toItem } from "./keys.js";
import { SingleTableRepository } from "./repository.js";

const provenance: ProvenanceRef = {
  sourceId: "src-1",
  versionId: "v1",
  createdById: "user-1",
  ingestedAt: "2024-01-01T00:00:00.000Z"
};

function makeCase(
  opts: {
    caseId?: string;
    id?: string;
    now?: string;
    dispositionStatus?: Case["dispositionStatus"];
  } = {}
): Case {
  return {
    ...createEnvelope({
      entityType: "Case",
      caseId: opts.caseId ?? "case-1",
      source: "intake",
      status: "intake",
      provenance,
      accessClassification: "clinical",
      createdById: "user-1",
      id: opts.id ?? "Case-1",
      now: opts.now ?? "2024-01-01T00:00:00.000Z"
    }),
    entityType: "Case",
    clinicalArea: "neurology",
    archetype: "pediatric-onset",
    inheritanceModel: "autosomal_recessive",
    familyBased: false,
    dispositionStatus: opts.dispositionStatus ?? "unresolved"
  };
}

function makeVariant(opts: {
  caseId?: string;
  id: string;
  normalizedId: string;
}): Variant {
  return {
    ...createEnvelope({
      entityType: "Variant",
      caseId: opts.caseId ?? "case-1",
      source: "analysis",
      status: "active",
      provenance,
      accessClassification: "research",
      createdById: "user-1",
      id: opts.id,
      now: "2024-01-01T00:00:00.000Z"
    }),
    entityType: "Variant",
    normalizedId: opts.normalizedId,
    geneId: "gene-1"
  };
}

function makeCandidate(opts: {
  caseId?: string;
  id: string;
  createdAt: string;
}): ReanalysisCandidate {
  return {
    ...createEnvelope({
      entityType: "ReanalysisCandidate",
      caseId: opts.caseId ?? "case-1",
      source: "reanalysis",
      status: "queued",
      provenance,
      accessClassification: "research",
      createdById: "user-1",
      id: opts.id,
      now: opts.createdAt
    }),
    entityType: "ReanalysisCandidate",
    knowledgeUpdateId: "ku-1",
    relevance: { matchedVariants: [], matchedGenes: [], matchedPhenotypes: [] }
  };
}

function makeAudit(opts: {
  caseId?: string;
  id: string;
  affectedObjectId: string;
  at: string;
}): AuditEvent {
  return {
    ...createEnvelope({
      entityType: "AuditEvent",
      caseId: opts.caseId ?? "case-1",
      source: "audit",
      status: "recorded",
      provenance,
      accessClassification: "clinical",
      createdById: "user-1",
      id: opts.id,
      now: opts.at
    }),
    entityType: "AuditEvent",
    actorId: "user-1",
    action: "create",
    affectedObjectId: opts.affectedObjectId,
    at: opts.at,
    immutable: true
  };
}

let client: InMemoryDocumentClient;
let repo: SingleTableRepository;

beforeEach(() => {
  client = new InMemoryDocumentClient();
  repo = new SingleTableRepository(client);
});

describe("optimistic concurrency (Req 23.4, 23.5)", () => {
  it("creates a version-1 object", async () => {
    const c = makeCase();
    await repo.put(c);

    const stored = await repo.getById<Case>(c.caseId, "Case", c.id);
    expect(stored).toEqual(c);
    expect(client.size).toBe(1);
  });

  it("rejects re-creating an existing key (create-only) with OptimisticConcurrencyError", async () => {
    await repo.put(makeCase());

    await expect(repo.put(makeCase())).rejects.toBeInstanceOf(
      OptimisticConcurrencyError
    );
    expect(client.size).toBe(1);
  });

  it("updates a stored object via touchEnvelope requiring the previous version", async () => {
    const c = makeCase();
    await repo.put(c);

    const updated = touchEnvelope(c, "2024-02-01T00:00:00.000Z");
    await repo.put(updated);

    const stored = await repo.getById<Case>(c.caseId, "Case", c.id);
    expect(stored?.version).toBe(2);
    expect(stored).toEqual(updated);
  });

  it("rejects a stale update and leaves the stored item unchanged", async () => {
    const v1 = makeCase();
    await repo.put(v1);

    const v2 = touchEnvelope(v1, "2024-02-01T00:00:00.000Z");
    await repo.put(v2);

    // A stale writer still holds v1 and derives another version-2 write, which
    // requires the stored version to be 1 — but it is now 2, so it conflicts.
    const staleV2 = touchEnvelope(v1, "2024-03-01T00:00:00.000Z");
    await expect(repo.put(staleV2)).rejects.toBeInstanceOf(
      OptimisticConcurrencyError
    );

    const stored = await repo.getById<Case>(v1.caseId, "Case", v1.id);
    expect(stored).toEqual(v2);
  });
});

describe("immutable append-only writes (Req 22.3, 27.5)", () => {
  it("writes an immutable object exactly once", async () => {
    const audit = makeAudit({
      id: "AuditEvent-1",
      affectedObjectId: "obj-1",
      at: "2024-01-01T00:00:00.000Z"
    });
    await repo.putImmutable(audit);

    const stored = await repo.getById<AuditEvent>(audit.caseId, "AuditEvent", audit.id);
    expect(stored).toEqual(audit);
  });

  it("rejects overwriting an immutable object and preserves the original", async () => {
    const audit = makeAudit({
      id: "AuditEvent-1",
      affectedObjectId: "obj-1",
      at: "2024-01-01T00:00:00.000Z"
    });
    await repo.putImmutable(audit);

    const overwrite = makeAudit({
      id: "AuditEvent-1",
      affectedObjectId: "obj-1",
      at: "2024-05-05T00:00:00.000Z"
    });
    await expect(repo.putImmutable(overwrite)).rejects.toBeInstanceOf(
      ImmutableWriteError
    );

    const stored = await repo.getById<AuditEvent>(audit.caseId, "AuditEvent", audit.id);
    expect(stored).toEqual(audit);
  });
});

describe("envelope validation before persistence (Req 23.6)", () => {
  it("rejects an invalid object before any write occurs", async () => {
    const invalid = { ...makeCase() } as Record<string, unknown>;
    delete invalid.provenance;

    await expect(repo.put(invalid as unknown as Case)).rejects.toBeInstanceOf(
      EnvelopeValidationError
    );
    expect(client.size).toBe(0);
  });

  it("rejects an out-of-set access classification before any write occurs", async () => {
    const invalid = { ...makeCase(), accessClassification: "top_secret" } as unknown as Case;

    await expect(repo.put(invalid)).rejects.toBeInstanceOf(EnvelopeValidationError);
    expect(client.size).toBe(0);
  });
});

describe("round-trip and access patterns", () => {
  it("fromItem(toItem(entity)) deep-equals the original entity", () => {
    const variant = makeVariant({ id: "Variant-1", normalizedId: "ref-1" });
    expect(fromItem<Variant>(toItem(variant))).toEqual(variant);

    // A Case marked unresolved populates GSI1 attributes; those must be
    // stripped on the way back out.
    const c = makeCase();
    expect(fromItem<Case>(toItem(c))).toEqual(c);
  });

  it("queries all objects for a case (base-table PK)", async () => {
    await repo.put(makeCase({ caseId: "case-1", id: "Case-1" }));
    await repo.put(makeVariant({ caseId: "case-1", id: "Variant-A", normalizedId: "ref-1" }));
    await repo.put(makeVariant({ caseId: "case-1", id: "Variant-B", normalizedId: "ref-2" }));
    await repo.put(makeVariant({ caseId: "case-2", id: "Variant-C", normalizedId: "ref-1" }));

    const items = await repo.queryCase("case-1");
    expect(items).toHaveLength(3);
  });

  it("queries objects of one type within a case (SK begins_with)", async () => {
    await repo.put(makeCase({ caseId: "case-1", id: "Case-1" }));
    await repo.put(makeVariant({ caseId: "case-1", id: "Variant-A", normalizedId: "ref-1" }));
    await repo.put(makeVariant({ caseId: "case-1", id: "Variant-B", normalizedId: "ref-2" }));

    const variants = await repo.queryCaseByType<Variant>("case-1", "Variant");
    expect(variants.map((v) => v.id).sort()).toEqual(["Variant-A", "Variant-B"]);
  });

  it("queries by normalized reference across cases (GSI2)", async () => {
    await repo.put(makeVariant({ caseId: "case-1", id: "Variant-A", normalizedId: "ref-1" }));
    await repo.put(makeVariant({ caseId: "case-1", id: "Variant-B", normalizedId: "ref-2" }));
    await repo.put(makeVariant({ caseId: "case-2", id: "Variant-C", normalizedId: "ref-1" }));

    const referencing = await repo.queryByReference<Variant>("variant", "ref-1");
    expect(referencing.map((v) => v.id).sort()).toEqual(["Variant-A", "Variant-C"]);
  });

  it("queries a case review queue oldest-first (GSI3)", async () => {
    await repo.put(makeCandidate({ caseId: "case-1", id: "RC-1", createdAt: "2024-03-01T00:00:00.000Z" }));
    await repo.put(makeCandidate({ caseId: "case-1", id: "RC-2", createdAt: "2024-01-01T00:00:00.000Z" }));

    const queue = await repo.queryReviewQueue<ReanalysisCandidate>("case-1");
    expect(queue.map((entry) => entry.id)).toEqual(["RC-2", "RC-1"]);
  });

  it("queries audit events by affected object oldest-first (GSI4)", async () => {
    await repo.putImmutable(makeAudit({ id: "AE-1", affectedObjectId: "obj-9", at: "2024-02-01T00:00:00.000Z" }));
    await repo.putImmutable(makeAudit({ id: "AE-2", affectedObjectId: "obj-9", at: "2024-01-01T00:00:00.000Z" }));
    await repo.putImmutable(makeAudit({ id: "AE-3", affectedObjectId: "obj-other", at: "2024-01-01T00:00:00.000Z" }));

    const events = await repo.queryAuditByObject<AuditEvent>("obj-9");
    expect(events.map((e) => e.id)).toEqual(["AE-2", "AE-1"]);
  });
});
