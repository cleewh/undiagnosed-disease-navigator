// services/safeguards/src/manual-confirmation.property.test.ts
//
// Property-based test for manual-confirmation gating of external sharing /
// family contact (Safeguards_Service, design "Manual confirmation").
//
// Feature: undiagnosed-disease-navigator, Property 63: External sharing and
// family contact require manual confirmation
//
// Validates: Requirements 25.4

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  authoriseExternalAction,
  canProceedWithExternalAction,
  EXTERNAL_ACTION_TYPES,
  type ExternalActionRequest,
  type ManualConfirmation
} from "./manual-confirmation.js";

/** A recorded manual confirmation, authorised or not. */
const confirmationArb: fc.Arbitrary<ManualConfirmation> = fc.record({
  confirmedById: fc.string({ minLength: 1, maxLength: 12 }),
  confirmedAt: fc.constant("2024-01-01T00:00:00.000Z"),
  isAuthorised: fc.boolean()
});

/** Any external-action request across every gated action type. */
const requestArb: fc.Arbitrary<ExternalActionRequest> = fc.record({
  actionType: fc.constantFrom(...EXTERNAL_ACTION_TYPES),
  initiatedByAutomation: fc.boolean(),
  confirmation: fc.option(confirmationArb, { nil: undefined })
});

/**
 * Independent oracle: an external action proceeds iff it is not initiated by
 * automation AND an authorised manual confirmation is present (Req 25.4).
 */
function shouldProceed(request: ExternalActionRequest): boolean {
  return (
    !request.initiatedByAutomation &&
    request.confirmation !== undefined &&
    request.confirmation.isAuthorised
  );
}

describe("Property 63: External sharing and family contact require manual confirmation", () => {
  // Feature: undiagnosed-disease-navigator, Property 63: External sharing and
  // family contact require manual confirmation
  // Validates: Requirements 25.4
  it("proceeds iff not automation-initiated and an authorised manual confirmation is present; otherwise blocks with the right code", () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        const expected = shouldProceed(request);
        const result = authoriseExternalAction(request);

        expect(result.ok).toBe(expected);
        expect(canProceedWithExternalAction(request)).toBe(expected);

        if (result.ok) {
          expect(result.actionType).toBe(request.actionType);
          // Only an authorised confirmation could have cleared the gate.
          expect(request.confirmation).toBeDefined();
          if (request.confirmation) {
            expect(result.confirmedById).toBe(request.confirmation.confirmedById);
          }
        } else {
          // Blocking-code precedence mirrors the guard: automation first, then
          // missing confirmation, then unauthorised confirmation (Req 25.4).
          if (request.initiatedByAutomation) {
            expect(result.error.code).toBe("automation_not_permitted");
          } else if (request.confirmation === undefined) {
            expect(result.error.code).toBe("manual_confirmation_required");
          } else {
            expect(request.confirmation.isAuthorised).toBe(false);
            expect(result.error.code).toBe("not_authorised");
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
