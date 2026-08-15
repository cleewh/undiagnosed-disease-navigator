// services/ai-gateway/src/flagged-output-availability.property.test.ts
//
// Property-based test for design Correctness Property 50 (Task 12.11,
// Requirement 18.6).
//
// Feature: undiagnosed-disease-navigator, Property 50: Flagged output is
// available to an authorised reviewer
//
// Design (Property 50): For any output marked for review, the flagged output
// and its review indication are retrievable by an authorised reviewer.
//
// This drives the full stage-7 validation/flagging path through
// AiGateway.invoke with an injected fake provider that returns output which
// fails validation (ungrounded, unsupported, or schema-violating), a scheduler
// that never fires (so the timeout is inert), and the real `groundingValidators`
// chain. Every generated invocation is therefore flagged for review, and the
// property asserts the retrieval boundary (Req 18.6): an AUTHORISED reviewer can
// retrieve the flagged output (via getFlaggedOutput, carrying the same review
// indication, and it appears in listFlaggedOutput), while an UNAUTHORISED
// reviewer receives undefined from getFlaggedOutput and an empty list from
// listFlaggedOutput. Reviewer authorisation and the flagged content are varied
// across runs.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { AiGateway } from "./gateway.js";
import { groundingValidators } from "./output-validation.js";
import { directAccessGuard } from "./mediation.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GenerativeRequest, ReviewerContext } from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";
import { ALLOWED_TASK_TYPES, type GenerativeTaskType } from "./task-types.js";

const MODEL_ID = "anthropic.test-model-v1";

// A scheduler whose timer never fires, so the 30s timeout stays inert and the
// injected provider's synchronous response always wins the race.
const neverScheduler: Scheduler = {
  setTimeout(): unknown {
    return {};
  },
  clearTimeout(): void {
    // no-op
  }
};

// A provider that returns a fixed, pre-chosen response document verbatim.
function providerReturning(outputText: string): ModelProvider {
  return {
    async invoke(request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      return { outputText, modelId: request.modelId };
    }
  };
}

// The three ways the generated output is guaranteed to fail validation, so the
// invocation is always flagged for review. Varying this varies the flagged
// content (and the review reason) across runs.
type FlagKind = "ungrounded" | "unsupported" | "schema";

interface FlaggedScenario {
  readonly taskType: GenerativeTaskType;
  readonly invokingUserId: string;
  readonly providedIds: readonly string[];
  readonly outputText: string;
  readonly authorisedReviewerId: string;
  readonly unauthorisedReviewerId: string;
}

// Build a scenario whose model output ALWAYS fails the grounding validator
// chain (so it is flagged for review), while varying the failure mode and the
// concrete statement content.
const scenarioArb: fc.Arbitrary<FlaggedScenario> = fc
  .record({
    taskType: fc.constantFrom<GenerativeTaskType>(...ALLOWED_TASK_TYPES),
    invokingUserId: fc.string({ minLength: 1 }),
    providedCount: fc.integer({ min: 1, max: 4 }),
    flagKind: fc.constantFrom<FlagKind>("ungrounded", "unsupported", "schema"),
    text: fc.string({ minLength: 1 }),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    basis: fc.constantFrom<"observed" | "inferred">("observed", "inferred"),
    authorisedReviewerId: fc.string({ minLength: 1 }),
    unauthorisedReviewerId: fc.string({ minLength: 1 })
  })
  .map((raw) => {
    const providedIds = Array.from({ length: raw.providedCount }, (_, i) => `Doc-${i}`);
    let outputText: string;
    if (raw.flagKind === "schema") {
      // Not a conforming response document: fails the schema validator.
      outputText = JSON.stringify({ unexpected: raw.text });
    } else {
      const sourceRefs =
        raw.flagKind === "ungrounded"
          ? [] // no link to any source -> ungrounded_statement
          : ["Ext-outside"]; // cites a source outside the provided data -> unsupported_statement
      outputText = JSON.stringify({
        statements: [
          {
            statement: `flagged: ${raw.text}`,
            sourceRefs,
            confidence: raw.confidence,
            basis: raw.basis
          }
        ]
      });
    }
    return {
      taskType: raw.taskType,
      invokingUserId: raw.invokingUserId,
      providedIds,
      outputText,
      authorisedReviewerId: raw.authorisedReviewerId,
      unauthorisedReviewerId: raw.unauthorisedReviewerId
    };
  });

describe("Feature: undiagnosed-disease-navigator, Property 50: Flagged output is available to an authorised reviewer", () => {
  // Validates: Requirements 18.6
  it("makes any flagged output retrievable by an authorised reviewer (with its review indication) while an unauthorised reviewer gets nothing", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const gateway = new AiGateway({
          modelId: MODEL_ID,
          provider: providerReturning(scenario.outputText),
          scheduler: neverScheduler,
          outputValidators: groundingValidators
        });

        const request: GenerativeRequest = {
          taskType: scenario.taskType,
          invokingUserId: scenario.invokingUserId,
          systemInstructions: "Answer using only the provided data.",
          context: scenario.providedIds.map((id) => ({
            sourceObjectId: id,
            content: `clinical content for ${id}`
          }))
        };

        const result = await gateway.invoke(request);

        // Precondition of the property: the output was marked for review.
        expect(result.outcome).toBe("needs_review");
        if (result.outcome !== "needs_review") {
          return;
        }
        const { reviewId, review } = result;

        const authorised: ReviewerContext = {
          reviewerId: scenario.authorisedReviewerId,
          isAuthorisedReviewer: true
        };
        const unauthorised: ReviewerContext = {
          reviewerId: scenario.unauthorisedReviewerId,
          isAuthorisedReviewer: false
        };

        // An authorised reviewer can retrieve the flagged output, verbatim, with
        // its review indication.
        const retrieved = gateway.getFlaggedOutput(reviewId, authorised);
        expect(retrieved).toBeDefined();
        if (retrieved === undefined) {
          return;
        }
        expect(retrieved.id).toBe(reviewId);
        expect(retrieved.response.outputText).toBe(scenario.outputText);
        expect(retrieved.review.reason).toBe(review.reason);
        expect(retrieved.review.detail).toBe(review.detail);
        expect(retrieved.review.offendingStatement).toBe(review.offendingStatement);
        expect(retrieved.invokingUserId).toBe(scenario.invokingUserId);
        expect(retrieved.taskType).toBe(scenario.taskType);

        // It appears in the authorised reviewer's list.
        const listed = gateway.listFlaggedOutput(authorised);
        expect(listed.some((entry) => entry.id === reviewId)).toBe(true);

        // An unauthorised reviewer can retrieve nothing.
        expect(gateway.getFlaggedOutput(reviewId, unauthorised)).toBeUndefined();
        expect(gateway.listFlaggedOutput(unauthorised)).toEqual([]);
      }),
      { numRuns: 200 }
    );
  });
});
