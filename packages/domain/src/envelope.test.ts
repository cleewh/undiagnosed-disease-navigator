import { describe, it, expect } from "vitest";
import {
  ACCESS_CLASSIFICATIONS,
  ENTITY_TYPES,
  createEnvelope,
  generateId,
  touchEnvelope,
  utcNow,
  type CreateEnvelopeInput
} from "./envelope.js";

const baseInput: CreateEnvelopeInput = {
  entityType: "Case",
  caseId: "case-1",
  source: "intake",
  status: "intake",
  provenance: {
    sourceId: "src-1",
    versionId: "v1",
    createdById: "user-1",
    ingestedAt: "2024-01-01T00:00:00.000Z"
  },
  accessClassification: "research",
  createdById: "user-1"
};

describe("shared value sets", () => {
  it("exposes all three access classifications", () => {
    expect(ACCESS_CLASSIFICATIONS).toEqual([
      "research",
      "clinical",
      "ground_truth"
    ]);
  });

  it("declares every entity type from the spec with no duplicates", () => {
    // Requirement 23.1 / design "Typed Domain Model" enumerate 31 entities.
    expect(ENTITY_TYPES).toHaveLength(31);
    expect(new Set(ENTITY_TYPES).size).toBe(31);
  });
});

describe("utcNow", () => {
  it("renders ISO-8601 UTC with millisecond precision", () => {
    expect(utcNow()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("generateId", () => {
  it("produces distinct ids across many calls and entity types", () => {
    const ids = new Set<string>();
    for (const entityType of ENTITY_TYPES) {
      for (let i = 0; i < 100; i++) {
        ids.add(generateId(entityType));
      }
    }
    expect(ids.size).toBe(ENTITY_TYPES.length * 100);
  });
});

describe("createEnvelope", () => {
  it("sets version 1 and createdAt == modifiedAt (Req 23.4)", () => {
    const env = createEnvelope(baseInput);
    expect(env.version).toBe(1);
    expect(env.createdAt).toBe(env.modifiedAt);
    expect(env.syntheticIndicator).toBe(true);
    expect(env.id).toBeTruthy();
  });
});

describe("touchEnvelope", () => {
  it("increments version and preserves createdAt/createdById (Req 23.5)", () => {
    const env = createEnvelope({ ...baseInput, now: "2024-01-01T00:00:00.000Z" });
    const touched = touchEnvelope(env, "2024-02-02T03:04:05.678Z");
    expect(touched.version).toBe(2);
    expect(touched.createdAt).toBe(env.createdAt);
    expect(touched.createdById).toBe(env.createdById);
    expect(touched.modifiedAt).toBe("2024-02-02T03:04:05.678Z");
    expect(env.version).toBe(1);
  });
});
