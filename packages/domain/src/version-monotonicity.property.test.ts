// packages/domain/src/version-monotonicity.property.test.ts
//
// Property-based test for Correctness Property 60 (Requirements 23.4, 23.5).
//
// Feature: undiagnosed-disease-navigator, Property 60: Version monotonicity
// across create and modify.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createEnvelope,
  touchEnvelope,
  ENTITY_TYPES,
  ACCESS_CLASSIFICATIONS,
  type CreateEnvelopeInput
} from "./envelope.js";

// Bound generated timestamps to a realistic range so that adding a modification
// offset stays inside the valid Date range (fc.date() otherwise reaches the max
// JS Date, where any positive offset overflows to an Invalid Date).
const dateArb = fc.date({
  min: new Date("1970-01-01T00:00:00.000Z"),
  max: new Date("2100-01-01T00:00:00.000Z")
});

// Arbitrary for the caller-supplied fields of a create input. Envelope-managed
// fields (id, version, createdAt, modifiedAt, syntheticIndicator) are set by
// createEnvelope and are therefore not generated here.
const createInputArb: fc.Arbitrary<CreateEnvelopeInput> = fc.record({
  entityType: fc.constantFrom(...ENTITY_TYPES),
  caseId: fc.string({ minLength: 1 }),
  source: fc.string({ minLength: 1 }),
  status: fc.string({ minLength: 1 }),
  provenance: fc.record({
    sourceId: fc.string({ minLength: 1 }),
    versionId: fc.string({ minLength: 1 }),
    createdById: fc.string({ minLength: 1 }),
    ingestedAt: dateArb.map((d) => d.toISOString())
  }),
  accessClassification: fc.constantFrom(...ACCESS_CLASSIFICATIONS),
  createdById: fc.string({ minLength: 1 }),
  // Pin the creation timestamp so we can assert timestamp monotonicity against
  // a known, non-decreasing sequence of modification timestamps.
  now: dateArb.map((d) => d.toISOString())
});

describe("Feature: undiagnosed-disease-navigator, Property 60: Version monotonicity across create and modify", () => {
  it("creation sets createdAt == modifiedAt and version == 1; after N modifications version == 1 + N with createdAt/createdById preserved and modifiedAt >= createdAt", () => {
    fc.assert(
      fc.property(
        createInputArb,
        // N modifications, 0..20 as specified by the task.
        fc.integer({ min: 0, max: 20 }),
        // A non-decreasing sequence of modification timestamps (>= createdAt is
        // enforced below by clamping each to the creation time).
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), {
          minLength: 20,
          maxLength: 20
        }),
        (input, n, offsets) => {
          const created = createEnvelope(input);

          // Creation invariants (Req 23.4).
          expect(created.version).toBe(1);
          expect(created.createdAt).toBe(created.modifiedAt);

          const createdMs = Date.parse(created.createdAt);

          let current = created;
          for (let i = 0; i < n; i++) {
            // Each modification's timestamp is at or after creation time so the
            // modifiedAt >= createdAt invariant is meaningful.
            const modifiedAt = new Date(createdMs + (offsets[i] ?? 0)).toISOString();
            current = touchEnvelope(current, modifiedAt);

            // Version increments by exactly 1 each modification (Req 23.5).
            expect(current.version).toBe(i + 2);
            // createdAt and createdById are preserved across modification.
            expect(current.createdAt).toBe(created.createdAt);
            expect(current.createdById).toBe(created.createdById);
            // modifiedAt is updated and never precedes createdAt.
            expect(current.modifiedAt).toBe(modifiedAt);
            expect(Date.parse(current.modifiedAt)).toBeGreaterThanOrEqual(
              createdMs
            );
          }

          // After the full sequence of N modifications: version == 1 + N.
          expect(current.version).toBe(1 + n);
          expect(current.createdAt).toBe(created.createdAt);
          expect(current.createdById).toBe(created.createdById);
        }
      ),
      { numRuns: 100 }
    );
  });
});
