// services/knowledge/src/knowledge.test.ts
//
// Compile-sanity and behavioural unit tests for the Knowledge_Service
// (task 26.1). Property tests (26.2–26.4) are implemented separately.

import { describe, it, expect } from "vitest";
import {
  KnowledgeSnapshotStore,
  generateKnowledgeUpdates,
  MIN_KNOWLEDGE_UPDATES,
  MAX_KNOWLEDGE_UPDATES,
  type SnapshotSourceVersions
} from "./index.js";

const NOW = "2024-01-01T00:00:00.000Z";

const SOURCES: SnapshotSourceVersions = {
  hpoVersion: "hpo-2024",
  clinvarVersion: "clinvar-2024",
  geneDiseaseVersion: "gd-2024",
  ontologyVersion: "onto-2024",
  annotationVersion: "annot-2024",
  transcriptVersion: "tx-2024",
  prioritisationLogicVersion: "prio-1.0.0"
};

function makeStore(): KnowledgeSnapshotStore {
  return new KnowledgeSnapshotStore();
}

describe("KnowledgeSnapshotStore.createSnapshot (Req 14.1)", () => {
  it("records a snapshot with a unique version, creation timestamp, and all source versions", () => {
    const store = makeStore();
    const result = store.createSnapshot({
      sources: SOURCES,
      createdById: "researcher-1",
      at: NOW,
      snapshotVersion: "v1"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const s = result.snapshot;
    expect(s.snapshotVersion).toBe("v1");
    expect(s.createdAt).toBe(NOW);
    expect(s.hpoVersion).toBe("hpo-2024");
    expect(s.clinvarVersion).toBe("clinvar-2024");
    expect(s.geneDiseaseVersion).toBe("gd-2024");
    expect(s.ontologyVersion).toBe("onto-2024");
    expect(s.annotationVersion).toBe("annot-2024");
    expect(s.transcriptVersion).toBe("tx-2024");
    expect(s.prioritisationLogicVersion).toBe("prio-1.0.0");
    expect(s.immutable).toBe(true);
    expect(s.entityType).toBe("KnowledgeSnapshot");
  });

  it("derives unique versions when none supplied", () => {
    const store = makeStore();
    const a = store.createSnapshot({ sources: SOURCES, createdById: "u", at: NOW });
    const b = store.createSnapshot({ sources: SOURCES, createdById: "u", at: NOW });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.snapshot.snapshotVersion).not.toBe(b.snapshot.snapshotVersion);
    }
    expect(store.size).toBe(2);
  });

  it("rejects a duplicate version and leaves the store unchanged (Req 14.1)", () => {
    const store = makeStore();
    store.createSnapshot({ sources: SOURCES, createdById: "u", at: NOW, snapshotVersion: "v1" });
    const dup = store.createSnapshot({
      sources: SOURCES,
      createdById: "u",
      at: NOW,
      snapshotVersion: "v1"
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("duplicate_version");
    expect(store.size).toBe(1);
  });
});

describe("associateRecording (Req 14.5, 14.6)", () => {
  it("rejects when no snapshot exists (Req 14.6)", () => {
    const store = makeStore();
    const result = store.associateRecording();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("no_snapshot");
  });

  it("associates with the most recently created (active) snapshot (Req 14.5)", () => {
    const store = makeStore();
    store.createSnapshot({ sources: SOURCES, createdById: "u", at: NOW, snapshotVersion: "v1" });
    store.createSnapshot({ sources: SOURCES, createdById: "u", at: NOW, snapshotVersion: "v2" });
    const result = store.associateRecording();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshotVersion).toBe("v2");
  });
});

describe("immutability (Req 14.7, 14.8)", () => {
  it("rejects modify and delete, preserving the retained snapshot unchanged", () => {
    const store = makeStore();
    const created = store.createSnapshot({
      sources: SOURCES,
      createdById: "u",
      at: NOW,
      snapshotVersion: "v1"
    });
    expect(created.ok).toBe(true);

    const modify = store.rejectModify("v1");
    expect(modify.ok).toBe(false);
    if (!modify.ok) expect(modify.error.code).toBe("immutable");

    const del = store.rejectDelete("v1");
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.error.code).toBe("immutable");

    // The retained snapshot is preserved byte-for-byte.
    if (created.ok) {
      expect(store.getByVersion("v1")).toEqual(created.snapshot);
    }
    expect(store.size).toBe(1);
  });

  it("reports no_snapshot when modifying an unknown version", () => {
    const store = makeStore();
    const result = store.rejectModify("missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("no_snapshot");
  });
});

describe("generateKnowledgeUpdates (Req 14.2, 14.3)", () => {
  it("produces exactly `count` synthetic-labelled updates within range", () => {
    const result = generateKnowledgeUpdates({ count: 10, createdById: "u", at: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updates).toHaveLength(10);
    expect(result.updates.every((u) => u.syntheticIndicator === true)).toBe(true);
    expect(result.updates.every((u) => u.entityType === "KnowledgeUpdate")).toBe(true);
    // Deltas are populated so updates can intersect case feature vectors.
    expect(result.updates.every((u) => u.delta.genes.length > 0)).toBe(true);
  });

  it("accepts the inclusive bounds 5 and 50", () => {
    expect(generateKnowledgeUpdates({ count: MIN_KNOWLEDGE_UPDATES, createdById: "u", at: NOW }).ok).toBe(true);
    expect(generateKnowledgeUpdates({ count: MAX_KNOWLEDGE_UPDATES, createdById: "u", at: NOW }).ok).toBe(true);
  });

  it("rejects counts below 5 or above 50 with no records (Req 14.2)", () => {
    const low = generateKnowledgeUpdates({ count: 4, createdById: "u", at: NOW });
    const high = generateKnowledgeUpdates({ count: 51, createdById: "u", at: NOW });
    expect(low.ok).toBe(false);
    expect(high.ok).toBe(false);
    if (!low.ok) expect(low.error.code).toBe("count_out_of_range");
    if (!high.ok) expect(high.error.code).toBe("count_out_of_range");
  });

  it("is deterministic across repeated generation", () => {
    const a = generateKnowledgeUpdates({ count: 7, createdById: "u", at: NOW });
    const b = generateKnowledgeUpdates({ count: 7, createdById: "u", at: NOW });
    expect(a).toEqual(b);
  });
});
