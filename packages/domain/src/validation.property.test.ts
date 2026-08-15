// packages/domain/src/validation.property.test.ts
//
// Property-based test for the persistence validation guard (Requirement 23.6).
//
// Feature: undiagnosed-disease-navigator, Property 61: Persistence rejects
// incomplete or invalidly classified objects.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  ACCESS_CLASSIFICATIONS,
  ENTITY_TYPES,
  createEnvelope,
  type Envelope
} from "./envelope.js";
import { validateEnvelope } from "./validation.js";

/**
 * ISO-8601 UTC timestamps drawn from epoch-millis in [1970, ~2100] so
 * `new Date(ms).toISOString()` always yields a well-formed UTC timestamp.
 */
const isoUtc = fc
  .integer({ min: 0, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString());

const nonEmpty = fc.string({ minLength: 1 });

/** Smart generator for a well-formed, valid envelope. */
const validEnvelopeArb: fc.Arbitrary<Envelope> = fc
  .record({
    entityType: fc.constantFrom(...ENTITY_TYPES),
    caseId: nonEmpty,
    source: nonEmpty,
    status: nonEmpty,
    accessClassification: fc.constantFrom(...ACCESS_CLASSIFICATIONS),
    createdById: nonEmpty,
    provSourceId: nonEmpty,
    provVersionId: nonEmpty,
    provCreatedById: nonEmpty,
    ingestedAt: isoUtc,
    now: isoUtc
  })
  .map((f) =>
    createEnvelope({
      entityType: f.entityType,
      caseId: f.caseId,
      source: f.source,
      status: f.status,
      accessClassification: f.accessClassification,
      createdById: f.createdById,
      provenance: {
        sourceId: f.provSourceId,
        versionId: f.provVersionId,
        createdById: f.provCreatedById,
        ingestedAt: f.ingestedAt
      },
      now: f.now
    })
  );

// Required top-level envelope attributes whose removal must be rejected.
const REQUIRED_TOP_LEVEL = [
  "id",
  "caseId",
  "source",
  "status",
  "createdById",
  "entityType",
  "version",
  "createdAt",
  "modifiedAt",
  "accessClassification",
  "provenance",
  "syntheticIndicator"
] as const;

// Required provenance sub-fields whose removal must be rejected.
const PROVENANCE_FIELDS = ["sourceId", "versionId", "createdById", "ingestedAt"] as const;

type Mutation =
  | { kind: "removeTopLevel"; field: string; expected: string }
  | { kind: "removeProvenance"; field: string; expected: string }
  | { kind: "invalidAccess"; value: unknown; expected: string };

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  fc
    .constantFrom(...REQUIRED_TOP_LEVEL)
    .map((field) => ({ kind: "removeTopLevel" as const, field, expected: field })),
  fc
    .constantFrom(...PROVENANCE_FIELDS)
    .map((field) => ({
      kind: "removeProvenance" as const,
      field,
      expected: `provenance.${field}`
    })),
  fc
    .oneof(
      fc.string().filter((s) => !ACCESS_CLASSIFICATIONS.includes(s as never)),
      fc.integer(),
      fc.boolean()
    )
    .map((value) => ({
      kind: "invalidAccess" as const,
      value,
      expected: "accessClassification"
    }))
);

function applyMutation(
  envelope: Envelope,
  mutation: Mutation
): Record<string, unknown> {
  const clone = structuredClone(envelope) as unknown as Record<string, unknown>;
  switch (mutation.kind) {
    case "removeTopLevel":
      delete clone[mutation.field];
      break;
    case "removeProvenance":
      delete (clone.provenance as Record<string, unknown>)[mutation.field];
      break;
    case "invalidAccess":
      clone.accessClassification = mutation.value;
      break;
  }
  return clone;
}

describe("Property 61: Persistence rejects incomplete or invalidly classified objects", () => {
  // Feature: undiagnosed-disease-navigator, Property 61: Persistence rejects
  // incomplete or invalidly classified objects
  // Validates: Requirements 23.6
  it("rejects objects missing a required attribute or with an invalid access classification, naming the attribute", () => {
    fc.assert(
      fc.property(validEnvelopeArb, mutationArb, (validEnvelope, mutation) => {
        // Positive control: a well-formed envelope is accepted.
        const positive = validateEnvelope(validEnvelope);
        expect(positive.valid).toBe(true);
        expect(positive.errors).toEqual([]);

        // Mutation makes the object incomplete or invalidly classified.
        const mutated = applyMutation(validEnvelope, mutation);
        const result = validateEnvelope(mutated);

        // Persistence is rejected...
        expect(result.valid).toBe(false);
        // ...and an error identifies the offending attribute.
        expect(result.errors.some((e) => e.attribute === mutation.expected)).toBe(true);

        // The candidate is left unchanged (guard never mutates input).
        if (mutation.kind === "invalidAccess") {
          expect(mutated.accessClassification).toBe(mutation.value);
        }
      }),
      { numRuns: 100 }
    );
  });
});
