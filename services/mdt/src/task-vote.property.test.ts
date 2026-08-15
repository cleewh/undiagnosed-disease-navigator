// services/mdt/src/task-vote.property.test.ts
//
// Property-based test for MDT task assignment and vote uniqueness
// (MDT_Service, task 23.3, Requirement 12.4, 12.5).
//
// Feature: undiagnosed-disease-navigator, Property 33: MDT task assignment and
// vote uniqueness
//
// Validates: Requirements 12.4, 12.5

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { MdtDecision } from "@udn/domain";

import { castVote, createTask, openMdtRecord } from "./mdt.js";
import { registeredUserResolver } from "./registered-users.js";

/** Short, non-empty identifier tokens for users. */
const idArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 8 });

/** ISO-8601 UTC timestamps. */
const timestampArb: fc.Arbitrary<string> = fc
  .date({ min: new Date("2000-01-01T00:00:00.000Z"), max: new Date("2100-01-01T00:00:00.000Z") })
  .map((d) => d.toISOString());

/** A task scenario: a registered directory plus a (possibly unregistered) assignee. */
const taskScenarioArb = fc
  .uniqueArray(idArb, { minLength: 1, maxLength: 6 })
  .chain((registeredIds) => {
    const memberArb = fc.constantFrom(...registeredIds);
    return fc.record({
      registeredIds: fc.constant(registeredIds),
      creatorId: memberArb,
      assigneeId: fc.oneof(memberArb, idArb),
      at: timestampArb
    });
  });

/**
 * A voting scenario: a registered directory, an authorised opener, and a
 * sequence of vote attempts by ids drawn from both members and arbitrary
 * (possibly unregistered) users.
 */
const voteScenarioArb = fc
  .uniqueArray(idArb, { minLength: 1, maxLength: 6 })
  .chain((registeredIds) => {
    const memberArb = fc.constantFrom(...registeredIds);
    const voterArb = fc.oneof(memberArb, idArb);
    return fc.record({
      registeredIds: fc.constant(registeredIds),
      openerId: memberArb,
      at: timestampArb,
      votes: fc.array(fc.record({ userId: voterArb, value: idArb }), { maxLength: 20 })
    });
  });

describe("Feature: undiagnosed-disease-navigator, Property 33: MDT task assignment and vote uniqueness", () => {
  // Feature: undiagnosed-disease-navigator, Property 33: MDT task assignment and
  // vote uniqueness
  // Validates: Requirements 12.4, 12.5
  it("assigns a task to exactly one registered user, rejecting an unregistered assignee", () => {
    fc.assert(
      fc.property(taskScenarioArb, (scenario) => {
        const isRegisteredUser = registeredUserResolver(scenario.registeredIds);
        const assigneeRegistered = isRegisteredUser(scenario.assigneeId);

        const result = createTask({
          caseId: "case-1",
          assigneeId: scenario.assigneeId,
          description: "follow-up",
          createdById: scenario.creatorId,
          at: scenario.at,
          isAuthorised: true,
          isRegisteredUser
        });

        expect(result.ok).toBe(assigneeRegistered);

        if (result.ok) {
          // Exactly one registered assignee (Req 12.4).
          expect(result.task.assigneeId).toBe(scenario.assigneeId);
          expect(isRegisteredUser(result.task.assigneeId)).toBe(true);
        } else {
          expect(result.error.code).toBe("unregistered_assignee");
        }
      }),
      { numRuns: 200 }
    );
  });

  // Feature: undiagnosed-disease-navigator, Property 33: MDT task assignment and
  // vote uniqueness
  // Validates: Requirements 12.4, 12.5
  it("keeps at most one vote per user after any sequence of votes, with a repeat vote replacing the prior value", () => {
    fc.assert(
      fc.property(voteScenarioArb, (scenario) => {
        const isRegisteredUser = registeredUserResolver(scenario.registeredIds);

        const opened = openMdtRecord({
          caseId: "case-1",
          hypothesisId: "hyp-1",
          createdById: scenario.openerId,
          at: scenario.at,
          isAuthorised: true
        });
        expect(opened.ok).toBe(true);
        if (!opened.ok) return;

        let record: MdtDecision = opened.record;
        // Ground-truth expectation: last successfully-cast value per registered
        // user, in first-seen order.
        const expected = new Map<string, string>();

        for (const attempt of scenario.votes) {
          const before = record;
          const registered = isRegisteredUser(attempt.userId);

          const result = castVote(record, {
            userId: attempt.userId,
            value: attempt.value,
            at: scenario.at,
            isAuthorised: true,
            isRegisteredUser
          });

          expect(result.ok).toBe(registered);

          if (result.ok) {
            const wasPresent = expected.has(attempt.userId);
            expect(result.replacedPrevious).toBe(wasPresent);
            expected.set(attempt.userId, attempt.value);
            record = result.record;
          } else {
            // Unregistered voter rejected, record left unchanged (Req 12.5).
            expect(result.error.code).toBe("unregistered_user");
            expect(result.record).toBe(before);
            record = result.record;
          }
        }

        // At most one vote per user: the stored user ids are unique (Req 12.5).
        const storedUserIds = record.votes.map((v) => v.userId);
        expect(new Set(storedUserIds).size).toBe(storedUserIds.length);

        // The stored votes are exactly the last cast value for each voter.
        expect(storedUserIds.length).toBe(expected.size);
        for (const vote of record.votes) {
          expect(expected.get(vote.userId)).toBe(vote.value);
        }
      }),
      { numRuns: 200 }
    );
  });
});
