// services/audit/src/correction.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 17: Correction retains original and corrected values with attribution
//
// Validates: Requirements 6.4, 22.4, 25.7
//
// Property 17 (design.md): *For any* correction or pre-approval edit of an
// AI-generated value, both the original AI value and the corrected value are
// retained together with the identity of the correcting user and the edit
// timestamp.
//
// Backing acceptance criteria:
//   - Req 6.4:  On a pre-approval edit, record the original AI-extracted value,
//               the corrected value, the editing reviewer identity, and the
//               edit timestamp.
//   - Req 22.4: When an AI output is corrected, the audit event records BOTH
//               the original value and the corrected value.
//   - Req 25.7: Correcting AI information retains both the original AI value and
//               the corrected value with attribution to the correcting user.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { AuditEvent } from "@udn/domain";

import { AuditRecorder } from "./recorder.js";
import type { RecordCorrectionInput } from "./recorder.js";

// ISO-8601 UTC timestamp with at least second precision, ending in Z or +00:00
// (optional fractional seconds).
const ISO_UTC_AT_LEAST_SECONDS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/;

// A non-empty, trimmed identity/identifier string.
const nonEmptyString = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

// A defined AI/corrected value: arbitrary JSON plus explicit null and
// empty-string edge cases. fc.jsonValue never yields `undefined`, so every
// generated value is defined as the property requires.
const definedValue: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 6, arbitrary: fc.jsonValue() },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant("") }
);

const correctionArb = fc.record({
  caseId: nonEmptyString,
  actorId: nonEmptyString,
  affectedObjectId: nonEmptyString,
  originalValue: definedValue,
  correctedValue: definedValue
});

describe("Property 17: Correction retains original and corrected values with attribution", () => {
  it("retains both the original AI value and the corrected value with correcting-user attribution and a timestamp", async () => {
    await fc.assert(
      fc.asyncProperty(correctionArb, async (input) => {
        // A capturing sink records every event it receives.
        const captured: AuditEvent[] = [];
        const recorder = new AuditRecorder(async (event) => {
          captured.push(event);
        });

        const result = await recorder.recordCorrection(input);

        // The correction was recorded (Req 22.4).
        expect(result.status).toBe("recorded");
        expect(captured).toHaveLength(1);
        const event = captured[0]!;

        // A correction is a modification.
        expect(event.action).toBe("modify");

        // BOTH values are retained exactly, by deep equality, including null,
        // empty string, and nested structures (Req 6.4, 22.4, 25.7).
        expect(event.originalValue).toStrictEqual(input.originalValue);
        expect(event.correctedValue).toStrictEqual(input.correctedValue);

        // Attribution to the correcting user (Req 6.4, 25.7).
        expect(event.actorId).toBe(input.actorId);

        // The edit timestamp: UTC, ISO-8601, parseable, at least second
        // precision (Req 6.4, 22.4).
        expect(typeof event.at).toBe("string");
        expect(event.at).toMatch(ISO_UTC_AT_LEAST_SECONDS);
        expect(Number.isNaN(Date.parse(event.at))).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("rejects a correction that omits a value with a TypeError", async () => {
    await fc.assert(
      fc.asyncProperty(
        correctionArb,
        fc.constantFrom("original", "corrected"),
        async (input, missing) => {
          const captured: AuditEvent[] = [];
          const recorder = new AuditRecorder(async (event) => {
            captured.push(event);
          });

          // Drop exactly one of the two required values, leaving it undefined.
          const broken: RecordCorrectionInput = {
            ...input,
            ...(missing === "original"
              ? { originalValue: undefined }
              : { correctedValue: undefined })
          };

          // A correction missing either side of the change is rejected, and
          // no audit event is recorded.
          await expect(recorder.recordCorrection(broken)).rejects.toThrow(
            TypeError
          );
          expect(captured).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
