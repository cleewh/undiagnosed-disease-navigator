// services/intake/src/ground-truth-access.property.test.ts
//
// Property-based test for the Ground_Truth access-restriction guard
// (Intake_Service, design "Property 5: Ground_Truth access is restricted to
// the Evaluation_Framework").
//
// Feature: undiagnosed-disease-navigator, Property 5: Ground_Truth access is
// restricted to the Evaluation_Framework
//
// Validates: Requirements 2.10, 3.6, 30.6
//
// Design text: "For any requesting principal, read or write access to a
// Ground_Truth artifact is granted if and only if the principal is the
// Evaluation_Framework; every other principal receives an authorization error
// and no data."

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { USER_ROLES, type UserRole } from "@udn/domain";

import {
  accessGroundTruth,
  authorizeGroundTruthAccess,
  isEvaluationFramework,
  sealGroundTruth,
  GroundTruthAccessError,
  EVALUATION_FRAMEWORK_IDENTITY,
  type GroundTruthAccessMode,
  type Principal,
  type PrincipalKind,
} from "./ground-truth-access.js";

/** The four principal kinds, including the sole authorised Evaluation_Framework. */
const PRINCIPAL_KINDS: readonly PrincipalKind[] = [
  EVALUATION_FRAMEWORK_IDENTITY,
  "InteractiveUser",
  "Service",
  "Anonymous",
];

/** A subset of the seven interactive roles (possibly empty), unique. */
const rolesArb: fc.Arbitrary<UserRole[]> = fc.subarray([...USER_ROLES]);

/**
 * An arbitrary Principal. The kind is biased so that the Evaluation_Framework
 * appears roughly half the time and the three non-evaluation kinds share the
 * rest — this guarantees both branches of the "iff" are exercised across the
 * 100+ runs. InteractiveUser principals carry a random role subset; holding any
 * role must never grant Ground_Truth access.
 */
const principalArb: fc.Arbitrary<Principal> = fc
  .tuple(
    // Bias: ~50% Evaluation_Framework, ~50% split over the other three kinds.
    fc.oneof(
      { weight: 3, arbitrary: fc.constant(EVALUATION_FRAMEWORK_IDENTITY) },
      { weight: 3, arbitrary: fc.constantFrom(...PRINCIPAL_KINDS.slice(1)) },
    ),
    fc.string({ minLength: 1, maxLength: 24 }),
    rolesArb,
  )
  .map(([kind, id, roles]) =>
    kind === "InteractiveUser"
      ? ({ id, kind, roles } as Principal)
      : ({ id, kind } as Principal),
  );

/** An arbitrary sealed Ground_Truth handle plus the payload it protects. */
const sealedArb = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.record({
      caseId: fc.string({ minLength: 1, maxLength: 20 }),
      // A distinctive secret token (a UUID) that cannot coincidentally appear
      // in a denial message, so the "no leak" check is meaningful rather than
      // tripping on a trivial substring like a single space.
      answer: fc.uuid(),
      score: fc.integer(),
    }),
  )
  .map(([resource, payload]) => ({
    resource,
    payload,
    sealed: sealGroundTruth(resource, payload),
  }));

const modeArb: fc.Arbitrary<GroundTruthAccessMode> = fc.constantFrom(
  "read",
  "write",
);

describe("Property 5: Ground_Truth access is restricted to the Evaluation_Framework", () => {
  // Feature: undiagnosed-disease-navigator, Property 5: Ground_Truth access is
  // restricted to the Evaluation_Framework
  // Validates: Requirements 2.10, 3.6, 30.6
  it("grants read/write access iff the principal is the Evaluation_Framework, and denies everyone else with an error and no data", () => {
    // Track that both branches of the iff are actually exercised.
    let sawEvaluation = false;
    let sawNonEvaluation = false;

    fc.assert(
      fc.property(principalArb, sealedArb, modeArb, (principal, box, mode) => {
        const { sealed, payload } = box;
        const isEval = isEvaluationFramework(principal);

        // The non-throwing decision agrees exactly with the identity check.
        const decision = authorizeGroundTruthAccess(
          principal,
          mode,
          sealed.resource,
        );
        expect(decision.allow).toBe(isEval);

        if (isEval) {
          sawEvaluation = true;
          expect(principal.kind).toBe(EVALUATION_FRAMEWORK_IDENTITY);

          // Access returns the protected payload unchanged.
          const opened = accessGroundTruth(principal, sealed, mode);
          expect(opened).toEqual(payload);
        } else {
          sawNonEvaluation = true;

          // Access throws an authorization error and yields no data.
          let leaked: unknown = undefined;
          expect(() => {
            leaked = accessGroundTruth(principal, sealed, mode);
          }).toThrow(GroundTruthAccessError);
          expect(leaked).toBeUndefined();

          // The decision carries the same structured error, never the payload.
          expect(decision.allow).toBe(false);
          if (!decision.allow) {
            expect(decision.error).toBeInstanceOf(GroundTruthAccessError);
            expect(decision.error.mode).toBe(mode);
            expect(decision.error.message).not.toContain(payload.answer);
          }
        }
      }),
      { numRuns: 200 },
    );

    // The biased generator must have produced both kinds, so the "iff" was
    // verified in both directions rather than vacuously.
    expect(sawEvaluation).toBe(true);
    expect(sawNonEvaluation).toBe(true);
  });
});
