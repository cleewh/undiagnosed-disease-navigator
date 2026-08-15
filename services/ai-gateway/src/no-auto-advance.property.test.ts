// services/ai-gateway/src/no-auto-advance.property.test.ts
//
// Property-based test for design Correctness Property 56 (Task 12.17,
// Requirement 20.6).
//
// Feature: undiagnosed-disease-navigator, Property 56: Review-flagged output
// does not auto-advance workflow
//
// Design (Property 56): For any case with an AI output marked for review, the
// workflow state of that case does not auto-advance.
//
// Requirement 20.6: Output marked for review never auto-advances case workflow
// state.
//
// The gateway is the sole path to a generative model and the point at which an
// output is either CONFIRMED (outcome "invoked") or FLAGGED FOR REVIEW (outcome
// "needs_review"). A downstream workflow that auto-advances on the strength of
// an AI output does so only when the gateway confirms that output; a flagged
// output must leave the workflow exactly where it was.
//
// This drives the full stage-7 validation/gating path through
// AiGateway.invoke with an injected fake provider, a scheduler whose timeout is
// inert, the real `groundingValidators` chain, and a configured confidence
// threshold, so every generated invocation is flagged for review by one of four
// independent failure modes (ungrounded, unsupported, schema-violating, or
// below-threshold confidence). For each flagged invocation the property asserts
// (Req 20.6 / Property 56):
//
//   1. the result signals review is required (outcome "needs_review", carrying a
//      review indication) and is NEVER a confirmed "invoked" result; and
//   2. feeding that result to a workflow reducer that advances ONLY on a
//      confirmed result leaves the workflow state unchanged, for any prior
//      state; and
//   3. no confirmed-persistence side effect occurs — the grounded-input cache
//      (which the gateway writes only for validated, confirmed output) is never
//      written for flagged output.
//
// The failure mode, prior workflow state, and flagged content are all varied
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
import type {
  GenerativeInvocationResult,
  GenerativeRequest,
  GroundedInputCache
} from "./pipeline.js";
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

// A cache that records every write, so the test can assert flagged output is
// never persisted as a confirmed result (the gateway writes the cache only at
// stage 8, after every validator has passed).
class SpyCache implements GroundedInputCache {
  public writes = 0;
  get(): ModelResponse | undefined {
    return undefined;
  }
  set(): void {
    this.writes += 1;
  }
}

// The workflow states a case can occupy before an AI output is adjudicated. The
// reducer below advances the workflow ONLY on a confirmed generative result; a
// flagged (needs_review) or rejected result must leave the state untouched.
const WORKFLOW_STATES = [
  "intake",
  "phenotype_extraction",
  "clinician_review",
  "hypothesis_review"
] as const;
type WorkflowState = (typeof WORKFLOW_STATES)[number];

// Model of a downstream consumer that auto-advances the case workflow on the
// strength of an AI output. It advances to the next stage ONLY for a confirmed
// ("invoked") gateway result; any other outcome (needs_review / rejected) is a
// no-op, so a review-flagged output cannot auto-advance the workflow (Req 20.6).
function applyGatewayResultToWorkflow(
  prev: WorkflowState,
  result: GenerativeInvocationResult
): WorkflowState {
  if (result.outcome !== "invoked") {
    return prev;
  }
  const index = WORKFLOW_STATES.indexOf(prev);
  const nextIndex = Math.min(index + 1, WORKFLOW_STATES.length - 1);
  return WORKFLOW_STATES[nextIndex] ?? prev;
}

// The four independent ways the generated output is guaranteed to be flagged
// for review, so the invocation never confirms. Varying this varies both the
// failure mode and the review reason across runs.
type FlagKind = "ungrounded" | "unsupported" | "schema" | "low_confidence";

interface FlaggedScenario {
  readonly taskType: GenerativeTaskType;
  readonly invokingUserId: string;
  readonly providedIds: readonly string[];
  readonly outputText: string;
  readonly confidenceThreshold: number;
  readonly priorState: WorkflowState;
}

// Build a scenario whose model output ALWAYS ends up flagged for review, while
// varying the failure mode, the concrete statement content, the confidence
// threshold, and the prior workflow state.
const scenarioArb: fc.Arbitrary<FlaggedScenario> = fc
  .record({
    taskType: fc.constantFrom<GenerativeTaskType>(...ALLOWED_TASK_TYPES),
    invokingUserId: fc.string({ minLength: 1 }),
    providedCount: fc.integer({ min: 1, max: 4 }),
    flagKind: fc.constantFrom<FlagKind>(
      "ungrounded",
      "unsupported",
      "schema",
      "low_confidence"
    ),
    text: fc.string({ minLength: 1 }),
    threshold: fc.double({ min: 0.2, max: 1, noNaN: true }),
    lowConfFraction: fc.double({ min: 0, max: 0.9, noNaN: true }),
    highConfidence: fc.double({ min: 0, max: 1, noNaN: true }),
    basis: fc.constantFrom<"observed" | "inferred">("observed", "inferred"),
    priorState: fc.constantFrom<WorkflowState>(...WORKFLOW_STATES)
  })
  .map((raw) => {
    const providedIds = Array.from({ length: raw.providedCount }, (_, i) => `Doc-${i}`);
    let outputText: string;
    if (raw.flagKind === "schema") {
      // Not a conforming response document: fails the schema validator.
      outputText = JSON.stringify({ unexpected: raw.text });
    } else if (raw.flagKind === "ungrounded") {
      // No link to any source -> ungrounded_statement.
      outputText = JSON.stringify({
        statements: [
          { statement: `flagged: ${raw.text}`, sourceRefs: [], confidence: raw.highConfidence, basis: raw.basis }
        ]
      });
    } else if (raw.flagKind === "unsupported") {
      // Cites a source outside the provided data -> unsupported_statement.
      outputText = JSON.stringify({
        statements: [
          { statement: `flagged: ${raw.text}`, sourceRefs: ["Ext-outside"], confidence: raw.highConfidence, basis: raw.basis }
        ]
      });
    } else {
      // low_confidence: a schema-valid, grounded, supported statement whose
      // confidence is strictly below the configured threshold -> flagged as
      // below_threshold_confidence. Guaranteed strictly below by construction.
      const lowConfidence = raw.threshold * raw.lowConfFraction;
      const groundedSource = providedIds[0] ?? "Doc-0";
      outputText = JSON.stringify({
        statements: [
          { statement: `flagged: ${raw.text}`, sourceRefs: [groundedSource], confidence: lowConfidence, basis: raw.basis }
        ]
      });
    }
    return {
      taskType: raw.taskType,
      invokingUserId: raw.invokingUserId,
      providedIds,
      outputText,
      confidenceThreshold: raw.threshold,
      priorState: raw.priorState
    };
  });

describe("Feature: undiagnosed-disease-navigator, Property 56: Review-flagged output does not auto-advance workflow", () => {
  // Validates: Requirements 20.6
  it("never confirms review-flagged output, so a workflow that advances only on confirmation stays put and no confirmed persistence occurs", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const cache = new SpyCache();
        const gateway = new AiGateway({
          modelId: MODEL_ID,
          provider: providerReturning(scenario.outputText),
          scheduler: neverScheduler,
          outputValidators: groundingValidators,
          confidenceThreshold: scenario.confidenceThreshold,
          cache
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

        // 1. The result signals review is required and is NEVER a confirmed
        //    "invoked" result (Property 56 precondition + Req 20.6).
        expect(result.outcome).toBe("needs_review");
        expect(result.outcome).not.toBe("invoked");
        if (result.outcome !== "needs_review") {
          return;
        }
        // The review indication carries a recorded reason.
        expect(result.review.reason).toBeDefined();
        expect(typeof result.review.detail).toBe("string");

        // 2. A workflow that auto-advances only on a confirmed result does NOT
        //    advance for this flagged output, regardless of the prior state.
        const nextState = applyGatewayResultToWorkflow(scenario.priorState, result);
        expect(nextState).toBe(scenario.priorState);

        // 3. No confirmed-persistence side effect occurs: the gateway writes the
        //    grounded-input cache only for validated, confirmed output, so a
        //    flagged output is never persisted as confirmed.
        expect(cache.writes).toBe(0);
      }),
      { numRuns: 200 }
    );
  });
});
