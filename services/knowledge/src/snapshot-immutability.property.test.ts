// services/knowledge/src/snapshot-immutability.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 37: Knowledge snapshots are complete and immutable
//
// Validates: Requirements 14.1, 14.7, 14.8
//
// Property 37 (design.md): *For any* created Knowledge_Snapshot, it has a
// unique version identifier, a creation timestamp, and the versions of HPO,
// ClinVar, gene-disease associations, ontology, annotation, transcript, and
// prioritisation logic; and *for any* subsequent request to modify or delete a
// retained snapshot, the request is rejected and the snapshot is preserved
// unchanged.
//
// Strategy: generate a batch of snapshots with arbitrary but distinct version
// identifiers, source versions, actors, and timestamps, record them in a fresh
// store, then assert completeness (all seven source versions plus version id +
// creation timestamp) and uniqueness of the recorded versions. Finally, attempt
// to modify and delete every retained snapshot and assert each attempt is
// rejected while the stored record remains byte-for-byte unchanged.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { KnowledgeSnapshotStore, type SnapshotSourceVersions } from "./index.js";

const versionString = (): fc.Arbitrary<string> =>
  fc.string({ minLength: 1, maxLength: 12 }).map((s) => s.replace(/\s/g, "_"));

const sourcesArb: fc.Arbitrary<SnapshotSourceVersions> = fc.record({
  hpoVersion: versionString(),
  clinvarVersion: versionString(),
  geneDiseaseVersion: versionString(),
  ontologyVersion: versionString(),
  annotationVersion: versionString(),
  transcriptVersion: versionString(),
  prioritisationLogicVersion: versionString()
});

interface SnapshotSpec {
  readonly version: string;
  readonly sources: SnapshotSourceVersions;
  readonly createdById: string;
  readonly at: string;
}

const specsArb: fc.Arbitrary<SnapshotSpec[]> = fc
  .uniqueArray(
    fc.record({
      version: versionString(),
      sources: sourcesArb,
      createdById: fc.string({ minLength: 1, maxLength: 16 }),
      at: fc
        .date({
          min: new Date("2000-01-01T00:00:00.000Z"),
          max: new Date("2100-01-01T00:00:00.000Z")
        })
        .map((d) => d.toISOString())
    }),
    { minLength: 1, maxLength: 12, selector: (spec) => spec.version }
  );

describe("Feature: undiagnosed-disease-navigator, Property 37: Knowledge snapshots are complete and immutable", () => {
  it("records complete, uniquely-versioned snapshots that reject modify/delete and remain unchanged", () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const store = new KnowledgeSnapshotStore();
        const recorded = new Map<string, ReturnType<typeof structuredClone>>();

        for (const spec of specs) {
          const result = store.createSnapshot({
            sources: spec.sources,
            createdById: spec.createdById,
            at: spec.at,
            snapshotVersion: spec.version
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const s = result.snapshot;

          // Req 14.1: unique version id, creation timestamp, all source versions.
          expect(s.snapshotVersion).toBe(spec.version);
          expect(s.createdAt).toBe(spec.at);
          expect(s.hpoVersion).toBe(spec.sources.hpoVersion);
          expect(s.clinvarVersion).toBe(spec.sources.clinvarVersion);
          expect(s.geneDiseaseVersion).toBe(spec.sources.geneDiseaseVersion);
          expect(s.ontologyVersion).toBe(spec.sources.ontologyVersion);
          expect(s.annotationVersion).toBe(spec.sources.annotationVersion);
          expect(s.transcriptVersion).toBe(spec.sources.transcriptVersion);
          expect(s.prioritisationLogicVersion).toBe(
            spec.sources.prioritisationLogicVersion
          );

          // A deep, detached copy of the retained record for later comparison.
          recorded.set(spec.version, structuredClone(s));
        }

        // Req 14.1 uniqueness: every distinct version was retained exactly once.
        expect(store.size).toBe(specs.length);

        // Req 14.7, 14.8: modify/delete are rejected; the record is preserved.
        for (const spec of specs) {
          const before = recorded.get(spec.version);
          expect(before).toBeDefined();

          const modify = store.rejectModify(spec.version);
          expect(modify.ok).toBe(false);
          if (!modify.ok) expect(modify.error.code).toBe("immutable");

          const del = store.rejectDelete(spec.version);
          expect(del.ok).toBe(false);
          if (!del.ok) expect(del.error.code).toBe("immutable");

          // Byte-for-byte unchanged after the rejected mutations.
          expect(store.getByVersion(spec.version)).toEqual(before);
        }

        // Store cardinality is unchanged by the rejected mutations.
        expect(store.size).toBe(specs.length);
      }),
      { numRuns: 100 }
    );
  });
});
