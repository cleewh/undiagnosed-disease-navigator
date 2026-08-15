// apps/api/src/auth/authorised-reads.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 16: Reads return only authorised records
//
// Validates: Requirements 21.5
//
// Property 16 (design.md): *For any* user query for case data, the returned
// result contains only records the user's role is authorised to access and
// excludes all others.
//
// This exercises the read-filtering half of the RBAC enforcement wrapper
// (`filterAuthorisedReads` / `isReadAuthorised` in ./enforcement.ts). For a
// random collection of records — each tagged with a random access
// classification and/or required capability — and a random role set, the
// filtered result must be exactly the sublist of records for which
// `isReadAuthorised` holds, in their original relative order, and must NEVER
// include a `ground_truth`-classified record (denied to every interactive
// role).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  USER_ROLES,
  type AccessClassification,
  type UserRole,
} from "@udn/domain";

import { CAPABILITIES, type Capability } from "./rbac.js";
import {
  filterAuthorisedReads,
  isReadAuthorised,
  type ReadAccessRequirement,
} from "./enforcement.js";

/** A record carrying read-access requirements plus a stable id for ordering. */
interface TaggedRecord extends ReadAccessRequirement {
  readonly id: number;
}

const accessClassificationArb: fc.Arbitrary<AccessClassification | undefined> =
  fc.constantFrom<(AccessClassification | undefined)[]>(
    "research",
    "clinical",
    "ground_truth",
    undefined,
  );

const requiredCapabilityArb: fc.Arbitrary<Capability | undefined> =
  fc.constantFrom<(Capability | undefined)[]>(...CAPABILITIES, undefined);

/** A random record: may carry a classification, a capability, both, or neither. */
const recordArb = (id: number): fc.Arbitrary<TaggedRecord> =>
  fc.record({
    accessClassification: accessClassificationArb,
    requiredCapability: requiredCapabilityArb,
  }).map((requirement) => {
    const record: { id: number } & ReadAccessRequirement = { id };
    if (requirement.accessClassification !== undefined) {
      (record as { accessClassification?: AccessClassification }).accessClassification =
        requirement.accessClassification;
    }
    if (requirement.requiredCapability !== undefined) {
      (record as { requiredCapability?: Capability }).requiredCapability =
        requirement.requiredCapability;
    }
    return record;
  });

/** A list of records with unique, order-revealing ids. */
const recordsArb: fc.Arbitrary<TaggedRecord[]> = fc
  .array(fc.boolean(), { maxLength: 30 })
  .chain((slots) =>
    slots.length === 0
      ? fc.constant<TaggedRecord[]>([])
      : fc.tuple(...slots.map((_, index) => recordArb(index))),
  );

/** A random (possibly empty) set of the seven interactive roles. */
const rolesArb: fc.Arbitrary<UserRole[]> = fc.subarray([...USER_ROLES]);

describe("Property 16: Reads return only authorised records (Req 21.5)", () => {
  it("returns exactly the authorised sublist, preserves order, and never leaks ground_truth", () => {
    fc.assert(
      fc.property(rolesArb, recordsArb, (roles, records) => {
        const visible = filterAuthorisedReads(roles, records);

        // 1. Result is exactly the sublist for which isReadAuthorised holds,
        //    in original relative order (compared by id sequence).
        const expected = records.filter((record) =>
          isReadAuthorised(roles, record),
        );
        expect(visible.map((r) => r.id)).toEqual(expected.map((r) => r.id));

        // 2. Every returned record is genuinely authorised (only authorised
        //    records, excludes all others).
        for (const record of visible) {
          expect(isReadAuthorised(roles, record)).toBe(true);
        }

        // 3. No ground_truth-classified record is ever included, for any role.
        for (const record of visible) {
          expect(record.accessClassification).not.toBe("ground_truth");
        }

        // 4. Result is a subsequence of the input (no fabricated records).
        expect(visible.length).toBeLessThanOrEqual(records.length);
      }),
      { numRuns: 200 },
    );
  });
});
