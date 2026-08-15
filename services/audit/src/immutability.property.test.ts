// services/audit/src/immutability.property.test.ts
//
// Property-based test for Correctness Property 58 (Requirement 22.3).
//
// Feature: undiagnosed-disease-navigator, Property 58: Audit events are
// immutable.
//
// Design (Property 58): For any retained audit event and any request to modify
// or delete it, the request is rejected and the event is preserved unchanged.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { AuditAction } from "@udn/domain";

import { AuditRecorder } from "./recorder.js";
import { AuditImmutabilityError, InMemoryImmutableAuditStore } from "./guard.js";

// Bound generated timestamps to a realistic range so the derived ISO-8601
// string is always valid.
const dateArb = fc.date({
  min: new Date("1970-01-01T00:00:00.000Z"),
  max: new Date("2100-01-01T00:00:00.000Z")
});

const AUDIT_ACTIONS: readonly AuditAction[] = [
  "create",
  "modify",
  "approve",
  "reject",
  "delete"
];

// Arbitrary for the caller-supplied details of an auditable action. The
// recorder derives the envelope-managed fields (id, version, timestamps).
const recordInputArb = fc.record({
  caseId: fc.string({ minLength: 1 }),
  actorId: fc.string({ minLength: 1 }),
  action: fc.constantFrom(...AUDIT_ACTIONS),
  affectedObjectId: fc.string({ minLength: 1 }),
  at: dateArb.map((d) => d.toISOString())
});

describe("Feature: undiagnosed-disease-navigator, Property 58: Audit events are immutable", () => {
  it("rejects modify/delete/overwrite of a retained event and preserves it byte-for-byte", async () => {
    await fc.assert(
      fc.asyncProperty(recordInputArb, async (input) => {
        const store = new InMemoryImmutableAuditStore();
        const recorder = new AuditRecorder(store);

        // Record (retain) an audit event.
        const result = await recorder.record(input);
        expect(result.status).toBe("recorded");
        const { event } = result;

        // Snapshot the retained event exactly as stored.
        const original = store.get(event.id);
        expect(original).toBeDefined();
        const originalSnapshot = structuredClone(original);

        // modify(id) is always rejected with AuditImmutabilityError.
        expect(() => store.modify(event.id)).toThrow(AuditImmutabilityError);

        // delete(id) is always rejected with AuditImmutabilityError.
        expect(() => store.delete(event.id)).toThrow(AuditImmutabilityError);

        // A second write of the same id is rejected (create-only append).
        await expect(
          store.write({ ...event, actorId: `${event.actorId}-tampered` })
        ).rejects.toBeInstanceOf(AuditImmutabilityError);

        // The retained event is preserved unchanged (deep-equals the original
        // snapshot) and the store still holds exactly one event.
        expect(store.get(event.id)).toEqual(originalSnapshot);
        expect(store.size).toBe(1);
      }),
      { numRuns: 200 }
    );
  });
});
