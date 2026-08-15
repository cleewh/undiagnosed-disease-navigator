// packages/domain/src/envelope.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 59: Domain objects carry a complete, unique-id provenance envelope
//
// Validates: Requirements 23.2, 23.3
//
// Property 59 (design.md): *For any* persisted clinically relevant object, it
// carries a globally unique identifier distinct from every other object across
// all entity types, a created-by attribute, source, case identifier, status,
// provenance, an access classification drawn from the defined set, and UTC
// created/modified timestamps with millisecond precision.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  ACCESS_CLASSIFICATIONS,
  ENTITY_TYPES,
  createEnvelope,
  type AccessClassification,
  type CreateEnvelopeInput,
  type EntityType
} from "./envelope.js";

// ISO-8601 UTC with exactly millisecond precision, e.g. 2024-01-01T12:34:56.789Z
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// A non-empty, trimmed string usable as an identity/origin attribute.
const nonEmptyString = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

const entityTypeArb: fc.Arbitrary<EntityType> = fc.constantFrom(
  ...ENTITY_TYPES
);

const accessClassificationArb: fc.Arbitrary<AccessClassification> =
  fc.constantFrom(...ACCESS_CLASSIFICATIONS);

const provenanceArb = fc.record({
  sourceId: nonEmptyString,
  versionId: nonEmptyString,
  createdById: nonEmptyString,
  ingestedAt: fc
    .date({
      min: new Date("2000-01-01T00:00:00.000Z"),
      max: new Date("2035-12-31T23:59:59.999Z")
    })
    .map((d) => d.toISOString())
});

// A full create-envelope input across every entity type. `id` and `now` are
// intentionally omitted so createEnvelope assigns a globally unique id and
// millisecond-precision UTC timestamps itself (the behaviour under test).
const createInputArb: fc.Arbitrary<CreateEnvelopeInput> = fc.record({
  entityType: entityTypeArb,
  caseId: nonEmptyString,
  source: nonEmptyString,
  status: nonEmptyString,
  provenance: provenanceArb,
  accessClassification: accessClassificationArb,
  createdById: nonEmptyString
});

describe("Property 59: Domain objects carry a complete, unique-id provenance envelope", () => {
  it("every created object is complete and all ids are globally unique across entity types", () => {
    fc.assert(
      // Generate many objects at once so the uniqueness check spans a large
      // population of ids drawn from all entity types.
      fc.property(
        fc.array(createInputArb, { minLength: 1, maxLength: 50 }),
        (inputs) => {
          const envelopes = inputs.map((input) => createEnvelope(input));

          for (const env of envelopes) {
            // Globally unique identifier present (uniqueness across the whole
            // population is asserted below).
            expect(typeof env.id).toBe("string");
            expect(env.id.length).toBeGreaterThan(0);

            // Created-by attribute (Req 23.2).
            expect(typeof env.createdById).toBe("string");
            expect(env.createdById.length).toBeGreaterThan(0);

            // Source, case identifier, and status (Req 23.3).
            expect(env.source.length).toBeGreaterThan(0);
            expect(env.caseId.length).toBeGreaterThan(0);
            expect(env.status.length).toBeGreaterThan(0);

            // Provenance with its required sub-fields (Req 23.3).
            expect(env.provenance).toBeDefined();
            expect(env.provenance.sourceId.length).toBeGreaterThan(0);
            expect(env.provenance.versionId.length).toBeGreaterThan(0);
            expect(env.provenance.createdById.length).toBeGreaterThan(0);
            expect(env.provenance.ingestedAt.length).toBeGreaterThan(0);

            // Access classification within the defined set (Req 23.3).
            expect(ACCESS_CLASSIFICATIONS).toContain(env.accessClassification);

            // UTC created/modified timestamps with millisecond precision
            // (Req 23.2).
            expect(env.createdAt).toMatch(ISO_UTC_MS);
            expect(env.modifiedAt).toMatch(ISO_UTC_MS);

            // Entity-type discriminator is one of the defined types.
            expect(ENTITY_TYPES).toContain(env.entityType);
          }

          // Globally unique id distinct across all entity types: every id in
          // the generated population is distinct (Req 23.2).
          const ids = envelopes.map((env) => env.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      ),
      { numRuns: 200 }
    );
  });
});
