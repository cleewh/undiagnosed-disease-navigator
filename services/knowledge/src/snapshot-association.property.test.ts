// services/knowledge/src/snapshot-association.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 39: Recording associates the active snapshot version or is rejected
//
// Validates: Requirements 14.5, 14.6
//
// Property 39 (design.md): *For any* analysis or hypothesis recording, it is
// associated with the version identifier of the Knowledge_Snapshot in effect if
// a snapshot exists, and is rejected with a no-snapshot indication if none
// exists.
//
// Strategy:
//   - Req 14.6: on a fresh store with no snapshot, associateRecording is
//     rejected with a no_snapshot indication.
//   - Req 14.5: after recording one or more snapshots (distinct versions),
//     associateRecording succeeds and returns the version of the active (most
//     recently created) snapshot.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { KnowledgeSnapshotStore, type SnapshotSourceVersions } from "./index.js";

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

const distinctVersionsArb: fc.Arbitrary<string[]> = fc.uniqueArray(
  fc.string({ minLength: 1, maxLength: 12 }).map((s) => s.replace(/\s/g, "_")),
  { minLength: 1, maxLength: 12 }
);

describe("Feature: undiagnosed-disease-navigator, Property 39: Recording associates the active snapshot version or is rejected", () => {
  it("rejects association with a no_snapshot indication when no snapshot exists (Req 14.6)", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const store = new KnowledgeSnapshotStore();
        const result = store.associateRecording();
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe("no_snapshot");
      }),
      { numRuns: 100 }
    );
  });

  it("associates a recording with the active (most recent) snapshot version when >= 1 snapshot exists (Req 14.5)", () => {
    fc.assert(
      fc.property(distinctVersionsArb, (versions) => {
        const store = new KnowledgeSnapshotStore();

        let lastVersion: string | undefined;
        for (const version of versions) {
          const created = store.createSnapshot({
            sources: SOURCES,
            createdById: "researcher-1",
            at: NOW,
            snapshotVersion: version
          });
          expect(created.ok).toBe(true);
          lastVersion = version;
        }

        expect(lastVersion).toBeDefined();

        const result = store.associateRecording();
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.snapshotVersion).toBe(lastVersion);
      }),
      { numRuns: 100 }
    );
  });
});
