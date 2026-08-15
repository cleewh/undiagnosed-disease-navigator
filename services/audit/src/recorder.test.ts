// services/audit/src/recorder.test.ts
//
// Unit tests for audit event recording, bounded retry, and pending-event
// preservation (Requirement 22.1, 22.2, 22.5).

import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@udn/domain";

import { AuditRecorder, type RecordAuditEventInput } from "./recorder.js";
import { InMemoryPendingStore } from "./pending.js";
import { sinkFromWriter, type AuditSink } from "./sink.js";

const baseInput: RecordAuditEventInput = {
  caseId: "Case-1",
  actorId: "User-42",
  action: "approve",
  affectedObjectId: "PhenotypeCandidate-7"
};

/** A sink that records every event it receives and never fails. */
function recordingSink(): { sink: AuditSink; written: AuditEvent[] } {
  const written: AuditEvent[] = [];
  const sink = sinkFromWriter(async (event) => {
    written.push(event);
  });
  return { sink, written };
}

/** A sink that fails the first `failures` attempts, then succeeds. */
function flakySink(failures: number): {
  sink: AuditSink;
  attempts: () => number;
  written: AuditEvent[];
} {
  let attempts = 0;
  const written: AuditEvent[] = [];
  const sink = sinkFromWriter(async (event) => {
    attempts += 1;
    if (attempts <= failures) {
      throw new Error(`sink failure #${attempts}`);
    }
    written.push(event);
  });
  return { sink, attempts: () => attempts, written };
}

/** A sink that always fails. */
function failingSink(): { sink: AuditSink; attempts: () => number } {
  let attempts = 0;
  const sink = sinkFromWriter(async () => {
    attempts += 1;
    throw new Error("permanent sink failure");
  });
  return { sink, attempts: () => attempts };
}

describe("AuditRecorder.buildEvent", () => {
  it("captures actor, action, affected object id, and a UTC timestamp (Req 22.2)", () => {
    const recorder = new AuditRecorder(recordingSink().sink, {
      now: () => "2024-01-01T12:34:56.789Z"
    });

    const event = recorder.buildEvent(baseInput);

    expect(event.entityType).toBe("AuditEvent");
    expect(event.actorId).toBe("User-42");
    expect(event.action).toBe("approve");
    expect(event.affectedObjectId).toBe("PhenotypeCandidate-7");
    expect(event.at).toBe("2024-01-01T12:34:56.789Z");
    // At least second-level precision, expressed in UTC.
    expect(event.at.endsWith("Z")).toBe(true);
    expect(Number.isNaN(Date.parse(event.at))).toBe(false);
    expect(event.immutable).toBe(true);
  });

  it("builds a complete provenance envelope via the domain helpers", () => {
    const recorder = new AuditRecorder(recordingSink().sink);
    const event = recorder.buildEvent(baseInput);

    expect(event.id).toBeTruthy();
    expect(event.version).toBe(1);
    expect(event.createdAt).toBe(event.modifiedAt);
    expect(event.createdById).toBe("User-42");
    expect(event.caseId).toBe("Case-1");
    expect(event.source).toBe("Audit_Service");
    expect(event.accessClassification).toBe("clinical");
    expect(event.syntheticIndicator).toBe(true);
    expect(event.provenance.createdById).toBe("User-42");
  });

  it("carries original and corrected values when supplied (groundwork for Req 22.4)", () => {
    const recorder = new AuditRecorder(recordingSink().sink);
    const event = recorder.buildEvent({
      ...baseInput,
      action: "modify",
      originalValue: { hpo: "HP:0001" },
      correctedValue: { hpo: "HP:0002" }
    });

    expect(event.originalValue).toEqual({ hpo: "HP:0001" });
    expect(event.correctedValue).toEqual({ hpo: "HP:0002" });
  });

  it("rejects input missing required identity fields", () => {
    const recorder = new AuditRecorder(recordingSink().sink);
    expect(() => recorder.buildEvent({ ...baseInput, actorId: "" })).toThrow(TypeError);
    expect(() =>
      recorder.buildEvent({ ...baseInput, affectedObjectId: "" })
    ).toThrow(TypeError);
    expect(() => recorder.buildEvent({ ...baseInput, caseId: "" })).toThrow(TypeError);
  });
});

describe("AuditRecorder.record", () => {
  it("records on the first attempt when the sink succeeds (Req 22.1)", async () => {
    const { sink, written } = recordingSink();
    const recorder = new AuditRecorder(sink);

    const result = await recorder.record(baseInput);

    expect(result.status).toBe("recorded");
    expect(result.attempts).toBe(1);
    expect(written).toHaveLength(1);
    expect(written[0]?.affectedObjectId).toBe("PhenotypeCandidate-7");
  });

  it("retries and eventually succeeds within the bounded attempts (Req 22.5)", async () => {
    const flaky = flakySink(2);
    const recorder = new AuditRecorder(flaky.sink, { maxRetries: 3 });

    const result = await recorder.record(baseInput);

    expect(result.status).toBe("recorded");
    expect(result.attempts).toBe(3);
    expect(flaky.attempts()).toBe(3);
    expect(flaky.written).toHaveLength(1);
  });

  it("makes at most 1 + maxRetries attempts before giving up (Req 22.5)", async () => {
    const failing = failingSink();
    const recorder = new AuditRecorder(failing.sink, { maxRetries: 3 });

    const result = await recorder.record(baseInput);

    expect(result.status).toBe("failed");
    expect(result.attempts).toBe(4);
    expect(failing.attempts()).toBe(4);
  });

  it("returns an error indication and preserves the pending event on exhaustion (Req 22.5)", async () => {
    const failing = failingSink();
    const store = new InMemoryPendingStore();
    const recorder = new AuditRecorder(failing.sink, { pendingStore: store });

    const result = await recorder.record(baseInput);

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.event.affectedObjectId).toBe("PhenotypeCandidate-7");
    }
    // The pending event is preserved for reprocessing.
    expect(store.size).toBe(1);
    expect(store.pending()[0]?.affectedObjectId).toBe("PhenotypeCandidate-7");
  });

  it("does not preserve a pending event when recording succeeds", async () => {
    const store = new InMemoryPendingStore();
    const recorder = new AuditRecorder(recordingSink().sink, { pendingStore: store });

    await recorder.record(baseInput);

    expect(store.size).toBe(0);
  });
});

describe("AuditRecorder.reprocessPending", () => {
  it("reprocesses preserved events and clears them once recorded (Req 22.5)", async () => {
    // Sink fails for the first 4 attempts (exhausting the initial record),
    // then succeeds on reprocessing.
    const flaky = flakySink(4);
    const store = new InMemoryPendingStore();
    const recorder = new AuditRecorder(flaky.sink, {
      maxRetries: 3,
      pendingStore: store
    });

    const first = await recorder.record(baseInput);
    expect(first.status).toBe("failed");
    expect(store.size).toBe(1);

    const results = await recorder.reprocessPending();

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("recorded");
    expect(store.size).toBe(0);
    expect(flaky.written).toHaveLength(1);
  });

  it("keeps events preserved when reprocessing fails again (Req 22.5)", async () => {
    const failing = failingSink();
    const store = new InMemoryPendingStore();
    const recorder = new AuditRecorder(failing.sink, { pendingStore: store });

    await recorder.record(baseInput);
    const results = await recorder.reprocessPending();

    expect(results[0]?.status).toBe("failed");
    expect(store.size).toBe(1);
  });
});

describe("AuditRecorder construction", () => {
  it("accepts a bare writer function as the sink", async () => {
    const written: AuditEvent[] = [];
    const recorder = new AuditRecorder(async (event) => {
      written.push(event);
    });

    const result = await recorder.record(baseInput);

    expect(result.status).toBe("recorded");
    expect(written).toHaveLength(1);
  });

  it("rejects an invalid maxRetries value", () => {
    expect(() => new AuditRecorder(recordingSink().sink, { maxRetries: -1 })).toThrow(
      RangeError
    );
  });
});
