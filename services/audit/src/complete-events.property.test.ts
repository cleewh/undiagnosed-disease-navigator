// services/audit/src/complete-events.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 57: Auditable actions produce complete audit events
//
// Validates: Requirements 22.1, 22.2
//
// Property 57 (design.md): *For any* create, modify, approve, reject, or delete
// action on case data, an audit event is recorded containing the actor
// identity, the action performed, the affected object identifier, and a UTC
// timestamp with at least second-level precision.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { AuditAction, AuditEvent } from "@udn/domain";

import { AuditRecorder } from "./recorder.js";

// ISO-8601 UTC timestamp with at least second precision, ending in Z or +00:00
// (optional fractional seconds), e.g. 2024-01-01T12:34:56Z or
// 2024-01-01T12:34:56.789+00:00.
const ISO_UTC_AT_LEAST_SECONDS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/;

// A non-empty, trimmed identity/identifier string.
const nonEmptyString = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

const AUDIT_ACTIONS: readonly AuditAction[] = [
  "create",
  "modify",
  "approve",
  "reject",
  "delete"
];

const actionArb: fc.Arbitrary<AuditAction> = fc.constantFrom(...AUDIT_ACTIONS);

// A generated auditable action input: random case, actor, action, and
// affected object identifier.
const actionInputArb = fc.record({
  caseId: nonEmptyString,
  actorId: nonEmptyString,
  action: actionArb,
  affectedObjectId: nonEmptyString
});

describe("Property 57: Auditable actions produce complete audit events", () => {
  it("records exactly one complete audit event for any auditable action", async () => {
    await fc.assert(
      fc.asyncProperty(actionInputArb, async (input) => {
        // A capturing sink records every event it receives.
        const captured: AuditEvent[] = [];
        const recorder = new AuditRecorder(async (event) => {
          captured.push(event);
        });

        const result = await recorder.record(input);

        // Recording succeeded (Req 22.1).
        expect(result.status).toBe("recorded");

        // Exactly one audit event was produced.
        expect(captured).toHaveLength(1);
        const event = captured[0]!;

        // Non-empty actor identity (Req 22.2).
        expect(typeof event.actorId).toBe("string");
        expect(event.actorId.length).toBeGreaterThan(0);
        expect(event.actorId).toBe(input.actorId);

        // The action performed (Req 22.1).
        expect(event.action).toBe(input.action);
        expect(AUDIT_ACTIONS).toContain(event.action);

        // The affected object identifier (Req 22.2).
        expect(typeof event.affectedObjectId).toBe("string");
        expect(event.affectedObjectId.length).toBeGreaterThan(0);
        expect(event.affectedObjectId).toBe(input.affectedObjectId);

        // A UTC timestamp, ISO-8601, parseable, ending in Z or +00:00, with at
        // least second-level precision (Req 22.2).
        expect(typeof event.at).toBe("string");
        expect(event.at).toMatch(ISO_UTC_AT_LEAST_SECONDS);
        expect(Number.isNaN(Date.parse(event.at))).toBe(false);

        // Audit events are immutable.
        expect(event.immutable).toBe(true);
      }),
      { numRuns: 200 }
    );
  });
});
