// services/mdt/src/decision-records.property.test.ts
//
// Property-based test for MDT decision records capturing participants and
// disposition (MDT_Service, task 23.4, Requirement 12.3, 12.6).
//
// Feature: undiagnosed-disease-navigator, Property 34: MDT decisions record
// participants and disposition
//
// Validates: Requirements 12.3, 12.6

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { openMdtRecord, recordDecision, MDT_STATUS_DECIDED } from "./mdt.js";
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
 * A decision scenario: a registered directory, an authorised recorder, free
 * decision/disposition text, a timestamp, and a participant list drawn from
 * both members and arbitrary (possibly unregistered) ids.
 */
const scenarioArb = fc
  .uniqueArray(idArb, { minLength: 1, maxLength: 6 })
  .chain((registeredIds) => {
    const memberArb = fc.constantFrom(...registeredIds);
    const participantArb = fc.oneof(memberArb, idArb);
    return fc.record({
      registeredIds: fc.constant(registeredIds),
      recorderId: memberArb,
      decision: fc.string({ maxLength: 40 }),
      disposition: fc.string({ maxLength: 40 }),
      participants: fc.array(participantArb, { maxLength: 8 }),
      at: timestampArb
    });
  });

describe("Feature: undiagnosed-disease-navigator, Property 34: MDT decisions record participants and disposition", () => {
  // Feature: undiagnosed-disease-navigator, Property 34: MDT decisions record
  // participants and disposition
  // Validates: Requirements 12.3, 12.6
  it("stores the decision, disposition, participants, and timestamp when every participant is registered; otherwise rejects leaving the record unchanged", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const isRegisteredUser = registeredUserResolver(scenario.registeredIds);

        const opened = openMdtRecord({
          caseId: "case-1",
          hypothesisId: "hyp-1",
          createdById: scenario.recorderId,
          at: scenario.at,
          isAuthorised: true
        });
        expect(opened.ok).toBe(true);
        if (!opened.ok) return;
        const record = opened.record;

        const allRegistered = scenario.participants.every((p) => isRegisteredUser(p));

        const result = recordDecision(record, {
          decision: scenario.decision,
          disposition: scenario.disposition,
          participants: scenario.participants,
          userId: scenario.recorderId,
          at: scenario.at,
          isAuthorised: true,
          isRegisteredUser
        });

        expect(result.ok).toBe(allRegistered);

        if (result.ok) {
          // Decision, disposition, participants (de-duplicated), and timestamp
          // are all recorded; participants are registered (Req 12.3, 12.6).
          expect(result.record.decision).toBe(scenario.decision);
          expect(result.record.disposition).toBe(scenario.disposition);
          expect(result.record.participants).toEqual(dedupePreserveOrder(scenario.participants));
          expect(result.record.participants.every((p) => isRegisteredUser(p))).toBe(true);
          expect(result.record.decidedAt).toBe(scenario.at);
          expect(result.record.status).toBe(MDT_STATUS_DECIDED);
        } else {
          // Rejected: record retained unchanged (Req 12.6).
          expect(result.error.code).toBe("unregistered_user");
          expect(result.record).toBe(record);
          expect(result.record.decision).toBe("");
          expect(result.record.disposition).toBe("");
          expect(result.record.participants).toEqual([]);
        }
      }),
      { numRuns: 200 }
    );
  });
});
