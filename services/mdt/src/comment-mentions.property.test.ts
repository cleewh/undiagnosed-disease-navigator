// services/mdt/src/comment-mentions.property.test.ts
//
// Property-based test for MDT comment validation and mention integrity
// (MDT_Service, task 23.2, Requirement 12.1, 12.2).
//
// Feature: undiagnosed-disease-navigator, Property 32: MDT comment validation
// and mention integrity
//
// Validates: Requirements 12.1, 12.2

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { addComment, openMdtRecord, MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "./mdt.js";
import { registeredUserResolver } from "./registered-users.js";

/** Short, non-empty identifier tokens for users. */
const idArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 8 });

/** ISO-8601 UTC timestamps. */
const timestampArb: fc.Arbitrary<string> = fc
  .date({ min: new Date("2000-01-01T00:00:00.000Z"), max: new Date("2100-01-01T00:00:00.000Z") })
  .map((d) => d.toISOString());

/** Duplicate-free, first-seen-order copy of `ids` (mirrors the service). */
function dedupePreserveOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * A single comment scenario: a registered-user directory, an authorised author,
 * a body of a chosen length (spanning below, within, and above the permitted
 * range), and a mention list drawn from both registered members and arbitrary
 * (possibly unregistered) ids.
 */
const scenarioArb = fc
  .uniqueArray(idArb, { minLength: 1, maxLength: 6 })
  .chain((registeredIds) => {
    const memberArb = fc.constantFrom(...registeredIds);
    const candidateArb = fc.oneof(memberArb, idArb);
    return fc.record({
      registeredIds: fc.constant(registeredIds),
      authorId: memberArb,
      at: timestampArb,
      bodyLength: fc.integer({ min: 0, max: MAX_COMMENT_LENGTH + 100 }),
      mentions: fc.array(candidateArb, { maxLength: 10 })
    });
  });

describe("Feature: undiagnosed-disease-navigator, Property 32: MDT comment validation and mention integrity", () => {
  // Feature: undiagnosed-disease-navigator, Property 32: MDT comment validation
  // and mention integrity
  // Validates: Requirements 12.1, 12.2
  it("stores a comment iff its body is in [1,5000] and every mention resolves to a registered user, recording author, timestamp, and resolved mentions; otherwise rejects leaving the record unchanged", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const isRegisteredUser = registeredUserResolver(scenario.registeredIds);

        const opened = openMdtRecord({
          caseId: "case-1",
          hypothesisId: "hyp-1",
          createdById: scenario.authorId,
          at: scenario.at,
          isAuthorised: true
        });
        expect(opened.ok).toBe(true);
        if (!opened.ok) return;
        const record = opened.record;

        const body = "x".repeat(scenario.bodyLength);
        const lengthValid =
          scenario.bodyLength >= MIN_COMMENT_LENGTH && scenario.bodyLength <= MAX_COMMENT_LENGTH;
        const mentionsAllRegistered = scenario.mentions.every((m) => isRegisteredUser(m));
        const expectedStored = lengthValid && mentionsAllRegistered;

        const result = addComment(record, {
          authorId: scenario.authorId,
          body,
          at: scenario.at,
          mentions: scenario.mentions,
          isAuthorised: true,
          isRegisteredUser
        });

        // The input record is never mutated.
        expect(record.comments).toHaveLength(0);

        expect(result.ok).toBe(expectedStored);

        if (result.ok) {
          // Stored: author + timestamp recorded, and the de-duplicated resolved
          // mentions are associated with the stored comment (Req 12.1, 12.2).
          expect(result.comment.authorId).toBe(scenario.authorId);
          expect(result.comment.body).toBe(body);
          expect(result.comment.at).toBe(scenario.at);
          expect(result.comment.mentions).toEqual(dedupePreserveOrder(scenario.mentions));
          expect(result.comment.mentions.every((m) => isRegisteredUser(m))).toBe(true);
          expect(result.record.comments).toHaveLength(1);
          expect(result.record.comments[0]).toEqual(result.comment);
        } else {
          // Rejected: record retained unchanged, with a diagnostic error whose
          // code matches the violated constraint (Req 12.1, 12.2).
          expect(result.record).toBe(record);
          expect(result.record.comments).toHaveLength(0);
          if (!lengthValid) {
            expect(result.error.code).toBe("invalid_comment_length");
          } else {
            expect(result.error.code).toBe("unregistered_mention");
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
