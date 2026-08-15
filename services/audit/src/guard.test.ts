// services/audit/src/guard.test.ts
//
// Unit tests for the immutability guard and create-only append store
// (Requirement 22.3) and AI-correction value capture (Requirement 22.4).

import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@udn/domain";

import { AuditRecorder, type RecordCorrectionInput } from "./recorder.js";
import {
  AuditImmutabilityError,
  InMemoryImmutableAuditStore,
  guardImmutability
} from "./guard.js";

function sampleEvent(recorder: AuditRecorder): AuditEvent {
  return recorder.buildEvent({
    caseId: "Case-1",
    actorId: "User-42",
    action: "create",
    affectedObjectId: "PhenotypeCandidate-7"
  });
}

describe("guardImmutability (Req 22.3)", () => {
  it("always rejects a modify request with a structured error", () => {
    let thrown: unknown;
    try {
      guardImmutability({ id: "AuditEvent-1" }, "modify");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AuditImmutabilityError);
    const err = thrown as AuditImmutabilityError;
    expect(err.code).toBe("AUDIT_EVENT_IMMUTABLE");
    expect(err.eventId).toBe("AuditEvent-1");
    expect(err.operation).toBe("modify");
  });

  it("always rejects a delete request with a structured error", () => {
    expect(() => guardImmutability({ id: "AuditEvent-2" }, "delete")).toThrow(
      AuditImmutabilityError
    );
    try {
      guardImmutability({ id: "AuditEvent-2" }, "delete");
    } catch (error) {
      expect((error as AuditImmutabilityError).operation).toBe("delete");
    }
  });
});

describe("InMemoryImmutableAuditStore (Req 22.3)", () => {
  it("appends and retains events (create-only)", async () => {
    const recorder = new AuditRecorder(new InMemoryImmutableAuditStore());
    const store = new InMemoryImmutableAuditStore();
    const event = sampleEvent(recorder);

    await store.write(event);

    expect(store.size).toBe(1);
    expect(store.get(event.id)?.affectedObjectId).toBe("PhenotypeCandidate-7");
    expect(store.all()).toHaveLength(1);
  });

  it("rejects overwriting a retained event id (no update via append)", async () => {
    const recorder = new AuditRecorder(new InMemoryImmutableAuditStore());
    const store = new InMemoryImmutableAuditStore();
    const event = sampleEvent(recorder);

    await store.write(event);
    await expect(store.write({ ...event, actorId: "Someone-Else" })).rejects.toBeInstanceOf(
      AuditImmutabilityError
    );
    // Original event preserved unchanged.
    expect(store.get(event.id)?.actorId).toBe("User-42");
    expect(store.size).toBe(1);
  });

  it("rejects modify requests and preserves the event unchanged", async () => {
    const recorder = new AuditRecorder(new InMemoryImmutableAuditStore());
    const store = new InMemoryImmutableAuditStore();
    const event = sampleEvent(recorder);
    await store.write(event);

    expect(() => store.modify(event.id)).toThrow(AuditImmutabilityError);
    expect(store.get(event.id)?.actorId).toBe("User-42");
    expect(store.size).toBe(1);
  });

  it("rejects delete requests and preserves the event unchanged", async () => {
    const recorder = new AuditRecorder(new InMemoryImmutableAuditStore());
    const store = new InMemoryImmutableAuditStore();
    const event = sampleEvent(recorder);
    await store.write(event);

    expect(() => store.delete(event.id)).toThrow(AuditImmutabilityError);
    expect(store.get(event.id)).toBeDefined();
    expect(store.size).toBe(1);
  });

  it("does not expose internal references (returns copies)", async () => {
    const recorder = new AuditRecorder(new InMemoryImmutableAuditStore());
    const store = new InMemoryImmutableAuditStore();
    const event = sampleEvent(recorder);
    await store.write(event);

    const retrieved = store.get(event.id)!;
    retrieved.actorId = "Mutated";
    expect(store.get(event.id)?.actorId).toBe("User-42");
  });

  it("works as a recorder sink, recording appended events", async () => {
    const store = new InMemoryImmutableAuditStore();
    const recorder = new AuditRecorder(store);

    const result = await recorder.record({
      caseId: "Case-1",
      actorId: "User-42",
      action: "create",
      affectedObjectId: "PhenotypeCandidate-7"
    });

    expect(result.status).toBe("recorded");
    expect(store.size).toBe(1);
  });
});

describe("AuditRecorder.recordCorrection (Req 22.4)", () => {
  const correction: RecordCorrectionInput = {
    caseId: "Case-1",
    actorId: "User-42",
    affectedObjectId: "PhenotypeCandidate-7",
    originalValue: { hpo: "HP:0001250" },
    correctedValue: { hpo: "HP:0002133" }
  };

  it("records both original and corrected values on a modify action", async () => {
    const store = new InMemoryImmutableAuditStore();
    const recorder = new AuditRecorder(store);

    const result = await recorder.recordCorrection(correction);

    expect(result.status).toBe("recorded");
    expect(result.event.action).toBe("modify");
    expect(result.event.originalValue).toEqual({ hpo: "HP:0001250" });
    expect(result.event.correctedValue).toEqual({ hpo: "HP:0002133" });
    expect(result.event.actorId).toBe("User-42");
    expect(result.event.immutable).toBe(true);
    expect(store.get(result.event.id)?.correctedValue).toEqual({ hpo: "HP:0002133" });
  });

  it("preserves falsy-but-defined values such as null and empty string", async () => {
    const recorder = new AuditRecorder(new InMemoryImmutableAuditStore());

    const result = await recorder.recordCorrection({
      ...correction,
      originalValue: "",
      correctedValue: null
    });

    expect(result.status).toBe("recorded");
    expect(result.event.originalValue).toBe("");
    expect(result.event.correctedValue).toBeNull();
  });

  it("rejects a correction missing the original value", async () => {
    const recorder = new AuditRecorder(new InMemoryImmutableAuditStore());
    await expect(
      recorder.recordCorrection({
        ...correction,
        originalValue: undefined as unknown
      })
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects a correction missing the corrected value", async () => {
    const recorder = new AuditRecorder(new InMemoryImmutableAuditStore());
    await expect(
      recorder.recordCorrection({
        ...correction,
        correctedValue: undefined as unknown
      })
    ).rejects.toBeInstanceOf(TypeError);
  });
});
