// services/audit/src/audit-log.test.ts
//
// Example-based audit-log tests for allowed and disallowed cases (Requirement
// 31.4). Where the property tests (complete-events, immutability) assert
// universal invariants across generated inputs, these focused example tests
// assert specific, expected recording outcomes for concrete scenarios — both
// the allowed/normal path (an action is recorded as a well-formed event) and
// the disallowed/failure path (a rejected mutation, an exhausted sink, or a
// malformed correction).

import { describe, expect, it } from "vitest";
import type { AuditAction, AuditEvent } from "@udn/domain";

import { AuditRecorder } from "./recorder.js";
import { InMemoryPendingStore } from "./pending.js";
import { sinkFromWriter, type AuditSink } from "./sink.js";
import { AuditImmutabilityError, InMemoryImmutableAuditStore } from "./guard.js";

const FIXED_NOW = "2024-06-01T09:15:30.000Z";

/** A sink that captures every event it receives and never fails (allowed path). */
function recordingSink(): { sink: AuditSink; written: AuditEvent[] } {
  const written: AuditEvent[] = [];
  const sink = sinkFromWriter(async (event) => {
    written.push(event);
  });
  return { sink, written };
}

/** A sink that always rejects, forcing retry exhaustion (disallowed path). */
function alwaysFailingSink(): { sink: AuditSink; attempts: () => number } {
  let attempts = 0;
  const sink = sinkFromWriter(async () => {
    attempts += 1;
    throw new Error("sink unavailable");
  });
  return { sink, attempts: () => attempts };
}

describe("audit log — allowed cases (Req 31.4)", () => {
  it.each<AuditAction>(["create", "approve", "reject"])(
    "records a well-formed event for a '%s' action",
    async (action) => {
      const { sink, written } = recordingSink();
      const recorder = new AuditRecorder(sink, { now: () => FIXED_NOW });

      const result = await recorder.record({
        caseId: "Case-100",
        actorId: "Clinician-3",
        action,
        affectedObjectId: "PhenotypeCandidate-9"
      });

      expect(result.status).toBe("recorded");
      expect(result.attempts).toBe(1);
      expect(written).toHaveLength(1);

      const event = written[0]!;
      expect(event.entityType).toBe("AuditEvent");
      expect(event.action).toBe(action);
      expect(event.actorId).toBe("Clinician-3");
      expect(event.affectedObjectId).toBe("PhenotypeCandidate-9");
      expect(event.caseId).toBe("Case-100");
      expect(event.at).toBe(FIXED_NOW);
      expect(event.immutable).toBe(true);
      expect(event.id).toBeTruthy();
      expect(event.version).toBe(1);
    }
  );

  it("records a correction capturing both original and corrected values", async () => {
    const store = new InMemoryImmutableAuditStore();
    const recorder = new AuditRecorder(store, { now: () => FIXED_NOW });

    const result = await recorder.recordCorrection({
      caseId: "Case-100",
      actorId: "Clinician-3",
      affectedObjectId: "PhenotypeCandidate-9",
      originalValue: { hpo: "HP:0001250" },
      correctedValue: { hpo: "HP:0002133" }
    });

    expect(result.status).toBe("recorded");
    expect(result.event.action).toBe("modify");
    expect(result.event.originalValue).toEqual({ hpo: "HP:0001250" });
    expect(result.event.correctedValue).toEqual({ hpo: "HP:0002133" });
    expect(store.get(result.event.id)?.correctedValue).toEqual({ hpo: "HP:0002133" });
  });

  it("re-records a preserved pending event and clears it via reprocessPending", async () => {
    // Fail long enough to exhaust the initial record (4 attempts), then let the
    // store accept the reprocessed event.
    let attempts = 0;
    const written: AuditEvent[] = [];
    const flaky = sinkFromWriter(async (event) => {
      attempts += 1;
      if (attempts <= 4) {
        throw new Error(`transient failure #${attempts}`);
      }
      written.push(event);
    });
    const store = new InMemoryPendingStore();
    const recorder = new AuditRecorder(flaky, { maxRetries: 3, pendingStore: store });

    const first = await recorder.record({
      caseId: "Case-100",
      actorId: "Clinician-3",
      action: "approve",
      affectedObjectId: "PhenotypeCandidate-9"
    });
    expect(first.status).toBe("failed");
    expect(store.size).toBe(1);

    const results = await recorder.reprocessPending();

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("recorded");
    expect(store.size).toBe(0);
    expect(written).toHaveLength(1);
    expect(written[0]?.affectedObjectId).toBe("PhenotypeCandidate-9");
  });
});

describe("audit log — disallowed cases (Req 31.4)", () => {
  it("exhausts retries and preserves the pending event when the sink keeps failing", async () => {
    const failing = alwaysFailingSink();
    const store = new InMemoryPendingStore();
    const recorder = new AuditRecorder(failing.sink, { maxRetries: 3, pendingStore: store });

    const result = await recorder.record({
      caseId: "Case-100",
      actorId: "Clinician-3",
      action: "create",
      affectedObjectId: "PhenotypeCandidate-9"
    });

    expect(result.status).toBe("failed");
    expect(result.attempts).toBe(4);
    expect(failing.attempts()).toBe(4);
    if (result.status === "failed") {
      expect(result.error).toBeInstanceOf(Error);
    }
    // The event is preserved unrecorded for later reprocessing (Req 22.5).
    expect(store.size).toBe(1);
    expect(store.pending()[0]?.affectedObjectId).toBe("PhenotypeCandidate-9");
  });

  it("rejects modifying a retained event and preserves it unchanged", async () => {
    const store = new InMemoryImmutableAuditStore();
    const recorder = new AuditRecorder(store);

    const result = await recorder.record({
      caseId: "Case-100",
      actorId: "Clinician-3",
      action: "create",
      affectedObjectId: "PhenotypeCandidate-9"
    });
    expect(result.status).toBe("recorded");

    expect(() => store.modify(result.event.id)).toThrow(AuditImmutabilityError);
    expect(store.get(result.event.id)?.actorId).toBe("Clinician-3");
    expect(store.size).toBe(1);
  });

  it("rejects deleting a retained event and preserves it unchanged", async () => {
    const store = new InMemoryImmutableAuditStore();
    const recorder = new AuditRecorder(store);

    const result = await recorder.record({
      caseId: "Case-100",
      actorId: "Clinician-3",
      action: "create",
      affectedObjectId: "PhenotypeCandidate-9"
    });
    expect(result.status).toBe("recorded");

    expect(() => store.delete(result.event.id)).toThrow(AuditImmutabilityError);
    expect(store.get(result.event.id)).toBeDefined();
    expect(store.size).toBe(1);
  });

  it("rejects re-writing (overwriting) a retained event id", async () => {
    const store = new InMemoryImmutableAuditStore();
    const recorder = new AuditRecorder(store);
    const event = recorder.buildEvent({
      caseId: "Case-100",
      actorId: "Clinician-3",
      action: "create",
      affectedObjectId: "PhenotypeCandidate-9"
    });

    await store.write(event);
    await expect(
      store.write({ ...event, actorId: "Intruder-1" })
    ).rejects.toBeInstanceOf(AuditImmutabilityError);
    expect(store.get(event.id)?.actorId).toBe("Clinician-3");
    expect(store.size).toBe(1);
  });

  it("rejects a correction missing the original value", async () => {
    const recorder = new AuditRecorder(new InMemoryImmutableAuditStore());

    await expect(
      recorder.recordCorrection({
        caseId: "Case-100",
        actorId: "Clinician-3",
        affectedObjectId: "PhenotypeCandidate-9",
        originalValue: undefined as unknown,
        correctedValue: { hpo: "HP:0002133" }
      })
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects a correction missing the corrected value", async () => {
    const recorder = new AuditRecorder(new InMemoryImmutableAuditStore());

    await expect(
      recorder.recordCorrection({
        caseId: "Case-100",
        actorId: "Clinician-3",
        affectedObjectId: "PhenotypeCandidate-9",
        originalValue: { hpo: "HP:0001250" },
        correctedValue: undefined as unknown
      })
    ).rejects.toBeInstanceOf(TypeError);
  });
});
