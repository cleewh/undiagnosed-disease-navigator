// apps/api/src/auth/authorization.property.test.ts
//
// Property-based test for uniform RBAC authorisation enforcement across every
// role-gated operation (Auth_Service, design "Auth_Service, Cognito, and the
// RBAC Matrix").
//
// Feature: undiagnosed-disease-navigator, Property 15: Authorisation is
// enforced uniformly across role-gated operations
//
// Validates: Requirements 6.6, 7.7, 11.6, 12.7, 21.3, 21.4

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { USER_ROLES, type UserRole } from "@udn/domain";

import {
  authorize,
  RBAC_MATRIX,
  CAPABILITIES,
  OPERATIONS,
  type Capability,
  type Operation,
} from "./rbac.js";
import { enforce, type AuthorisationDenialEvent } from "./enforcement.js";
import type { AuthContext } from "./authorizer.js";

/** A subset of the seven roles (possibly empty), order-preserving and unique. */
const rolesArb: fc.Arbitrary<UserRole[]> = fc.subarray([...USER_ROLES]);
const capabilityArb: fc.Arbitrary<Capability> = fc.constantFrom(...CAPABILITIES);
const operationArb: fc.Arbitrary<Operation> = fc.constantFrom(...OPERATIONS);

/**
 * Ground truth straight from the compiled matrix: the caller is permitted iff
 * at least one of its roles grants the operation on the capability (roles are
 * additive).
 */
function matrixPermits(
  roles: readonly UserRole[],
  capability: Capability,
  operation: Operation,
): boolean {
  return roles.some((role) => RBAC_MATRIX[capability][role].has(operation));
}

function actorFor(roles: readonly UserRole[]): AuthContext {
  return { userId: "actor-1", username: "actor-one", roles };
}

describe("Property 15: Authorisation is enforced uniformly across role-gated operations", () => {
  // Feature: undiagnosed-disease-navigator, Property 15: Authorisation is
  // enforced uniformly across role-gated operations
  // Validates: Requirements 6.6, 7.7, 11.6, 12.7, 21.3, 21.4
  it("allows an operation iff the matrix permits it, and denials skip perform while emitting exactly one audit event", async () => {
    await fc.assert(
      fc.asyncProperty(
        rolesArb,
        capabilityArb,
        operationArb,
        async (roles, capability, operation) => {
          const expected = matrixPermits(roles, capability, operation);

          // The pure decision matches the matrix exactly.
          const decision = authorize(roles, { capability, operation });
          expect(decision.allow).toBe(expected);

          // Enforcement wrapper: a capturing function sink for denial events.
          const denials: AuthorisationDenialEvent[] = [];
          let performCalls = 0;

          const outcome = await enforce({
            actor: actorFor(roles),
            action: { capability, operation },
            affectedObjectId: "object-1",
            caseId: "case-1",
            perform: () => {
              performCalls += 1;
              return "performed" as const;
            },
            audit: (event) => {
              denials.push(event);
            },
            now: () => "2025-01-01T00:00:00.000Z",
          });

          expect(outcome.authorised).toBe(expected);

          if (expected) {
            // Allowed: perform runs exactly once, no denial audit event.
            expect(performCalls).toBe(1);
            expect(denials).toHaveLength(0);
          } else {
            // Denied: perform never runs (target data unchanged) and exactly
            // one denial audit event is recorded with actor, attempted
            // operation, and timestamp (Req 21.4).
            expect(performCalls).toBe(0);
            expect(denials).toHaveLength(1);
            const event = denials[0];
            expect(event).toBeDefined();
            if (event) {
              expect(event.outcome).toBe("denied");
              expect(event.actorId).toBe("actor-1");
              expect(event.attemptedCapability).toBe(capability);
              expect(event.attemptedOperation).toBe(operation);
              expect(event.attemptedAction).toBe(`${capability}:${operation}`);
              expect(event.at).toBe("2025-01-01T00:00:00.000Z");
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
