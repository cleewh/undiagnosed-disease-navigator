// services/ai-gateway/src/invocation-logging.property.test.ts
//
// Property-based test for design Correctness Property 53 (Task 12.14,
// Requirement 19.5).
//
// Feature: undiagnosed-disease-navigator, Property 53: Every invocation is
// logged with required fields
//
// Design (Property 53): For any completed model invocation, an invocation-log
// entry records the model identifier, the invoking user identifier, the
// invocation timestamp, and the validation outcome.
//
// Requirement 19.5: WHEN the AI_Gateway completes a model invocation, THE
// AI_Gateway SHALL create a log entry containing the model identifier, the
// invoking user identifier, the invocation timestamp, and the validation
// outcome.
//
// Strategy: drive the FULL AiGateway.invoke path across every terminal outcome
// the gateway can reach and assert that each produces exactly one invocation-log
// entry carrying all four required fields. The gateway is always constructed
// with a configured model id and an injected deterministic clock, so the
// recorded model identifier and timestamp are fully determined and can be
// asserted exactly. The generated scenario selects the outcome:
//
//   - "invoked"        -> a schema-conformant, grounded, supported, allowlisted
//                         output; every validator passes (validationOutcome
//                         "passed").
//   - "needs_review"   -> output that fails a validator (malformed, or a valid
//                         document with disallowed extra top-level keys), so the
//                         gateway flags it (validationOutcome "failed").
//   - "provider-error" -> the provider throws; with maxAttempts = 1 the single
//                         failed attempt is the sole log entry.
//   - "timeout"        -> the provider hangs and an immediate scheduler fires
//                         the abort; with maxAttempts = 1 the single timed-out
//                         attempt is the sole log entry.
//   - "rejected"       -> a task type outside the allowlist; the request is
//                         refused at stage 1 without contacting any model.
//
// maxAttempts is pinned to 1 so a failing/timing-out invocation produces exactly
// one entry (the gateway logs one entry per failed attempt), keeping the
// "exactly one log entry per invocation" invariant crisp across all outcomes.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { AiGateway } from "./gateway.js";
import { directAccessGuard } from "./mediation.js";
import { groundingValidators } from "./output-validation.js";
import { InMemoryInvocationLogger } from "./invocation-logger.js";
import { ALLOWED_TASK_TYPES, isAllowedTaskType, type GenerativeTaskType } from "./task-types.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GenerativeRequest, ValidationOutcome } from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";

const MODEL_ID = "anthropic.test-model-v1";

// The source objects the invoking user is authorised to access. Generated
// statements cite only these ids, so grounding (>=1 ref) and support (refs in
// provided data) always pass for the "invoked" scenario and the output-level
// outcome is controlled purely by the generated document.
const SOURCE_IDS = ["Doc-1", "Doc-2", "Doc-3"] as const;

// The complete set of validation outcomes the gateway may record (pipeline.ts).
const VALIDATION_OUTCOMES: readonly ValidationOutcome[] = [
  "passed",
  "failed",
  "not_validated",
  "not_applicable"
];

// A scheduler whose timer never fires: the 30-second abort is never triggered,
// so a synchronous provider response/error is what surfaces.
const neverScheduler: Scheduler = {
  setTimeout(): unknown {
    return {};
  },
  clearTimeout(): void {
    // no-op
  }
};

// A scheduler that fires the timeout handler on the microtask queue, forcing the
// timeout/abort path deterministically without real waiting.
function immediateScheduler(): Scheduler {
  return {
    setTimeout(handler: () => void): unknown {
      queueMicrotask(handler);
      return {};
    },
    clearTimeout(): void {
      // no-op
    }
  };
}

/** A fake provider returning a fixed outputText once the mediation guard passes. */
function providerReturning(outputText: string): ModelProvider {
  return {
    async invoke(request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      return { outputText, modelId: request.modelId };
    }
  };
}

/** A fake provider that always throws the supplied value (provider-error mode). */
function erroringProvider(thrown: unknown): ModelProvider {
  return {
    async invoke(_request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      throw thrown;
    }
  };
}

/** A fake provider that only settles when aborted (timeout mode). */
function hangingProvider(): ModelProvider {
  return {
    invoke(_request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      return new Promise<ModelResponse>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
  };
}

// A schema-conformant, grounded, and supported statement: non-empty text, at
// least one authorised sourceRef, confidence in [0, 1], and a valid basis.
const statementArb = fc.record({
  statement: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  sourceRefs: fc.uniqueArray(fc.constantFrom(...SOURCE_IDS), {
    minLength: 1,
    maxLength: SOURCE_IDS.length
  }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  basis: fc.constantFrom("observed", "inferred")
});

const statementsArb = fc.array(statementArb, { minLength: 1, maxLength: 5 });

// A fully valid, allowlisted output document -> the "invoked" outcome.
const validOutputArb = statementsArb.map((statements) => JSON.stringify({ statements }));

// Extra top-level keys that are NOT on the response allowlist.
const extraKeysArb = fc.dictionary(
  fc.string({ minLength: 1 }).filter((k) => k !== "statements"),
  fc.jsonValue(),
  { minKeys: 1, maxKeys: 3 }
);

// An output that fails validation -> the "needs_review" outcome. Either a
// malformed (non-JSON) document (schema violation) or a valid statements
// document carrying disallowed extra top-level fields (allowlist violation).
const invalidOutputArb = fc.oneof(
  fc.constant("this is not valid json"),
  fc.constant("{ not: json"),
  fc
    .tuple(statementsArb, extraKeysArb)
    .map(([statements, extraKeys]) => JSON.stringify({ statements, ...extraKeys }))
);

// A thrown value for the provider-error mode: Error instances plus non-Error
// throws to exercise the wrap-unknown-cause path.
const thrownArb = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string(),
  fc.integer(),
  fc.constant(null),
  fc.constant(undefined)
);

const validTaskTypeArb: fc.Arbitrary<GenerativeTaskType> = fc.constantFrom(...ALLOWED_TASK_TYPES);

// A task type that is NOT on the allowlist -> the "rejected" (stage 1) outcome.
const invalidTaskTypeArb = fc
  .string({ minLength: 1 })
  .filter((t) => !isAllowedTaskType(t));

// One scenario per terminal outcome the gateway can reach.
const scenarioArb = fc.oneof(
  fc.record({ kind: fc.constant("invoked" as const), taskType: validTaskTypeArb, outputText: validOutputArb }),
  fc.record({ kind: fc.constant("needs_review" as const), taskType: validTaskTypeArb, outputText: invalidOutputArb }),
  fc.record({ kind: fc.constant("provider-error" as const), taskType: validTaskTypeArb, thrown: thrownArb }),
  fc.record({ kind: fc.constant("timeout" as const), taskType: validTaskTypeArb }),
  fc.record({ kind: fc.constant("rejected" as const), taskType: invalidTaskTypeArb })
);

const invokingUserArb = fc.string({ minLength: 1 }).map((s) => `User-${s}`);

// A deterministic invocation timestamp so the recorded `at` field is fully
// determined and can be asserted exactly.
const timestampArb = fc
  .date({ min: new Date("2000-01-01T00:00:00.000Z"), max: new Date("2100-01-01T00:00:00.000Z") })
  .map((d) => d.toISOString());

function requestFor(taskType: string, invokingUserId: string): GenerativeRequest {
  return {
    taskType,
    invokingUserId,
    systemInstructions: "Use only the provided data.",
    context: SOURCE_IDS.map((id) => ({ sourceObjectId: id, content: `clinical note ${id}` })),
    authorizedScope: { authorizedSourceObjectIds: [...SOURCE_IDS] }
  };
}

describe("Feature: undiagnosed-disease-navigator, Property 53: Every invocation is logged with required fields", () => {
  // Validates: Requirements 19.5
  it("produces exactly one invocation-log entry recording the model id, invoking user, timestamp, and validation outcome for every gateway invocation outcome", async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        invokingUserArb,
        timestampArb,
        async (scenario, invokingUserId, at) => {
          const logger = new InMemoryInvocationLogger();

          const provider =
            scenario.kind === "provider-error"
              ? erroringProvider(scenario.thrown)
              : scenario.kind === "timeout"
                ? hangingProvider()
                : scenario.kind === "invoked" || scenario.kind === "needs_review"
                  ? providerReturning(scenario.outputText)
                  : // "rejected": the model is never contacted, but a provider is
                    // still required whenever a model id is configured.
                    providerReturning(JSON.stringify({ statements: [] }));

          const scheduler = scenario.kind === "timeout" ? immediateScheduler() : neverScheduler;

          const gateway = new AiGateway({
            modelId: MODEL_ID,
            provider,
            scheduler,
            outputValidators: groundingValidators,
            logger,
            now: () => at,
            // One attempt so a failing/timing-out invocation logs exactly once.
            maxAttempts: 1
          });

          const result = await gateway.invoke(requestFor(scenario.taskType, invokingUserId));

          // Sanity: the scenario reached the intended terminal outcome, so the
          // property genuinely exercises each branch.
          switch (scenario.kind) {
            case "invoked":
              expect(result.outcome).toBe("invoked");
              break;
            case "needs_review":
              expect(result.outcome).toBe("needs_review");
              break;
            case "provider-error":
            case "timeout":
            case "rejected":
              expect(result.outcome).toBe("rejected");
              break;
          }

          // Core invariant (Property 53 / Req 19.5): exactly one invocation-log
          // entry is produced for the invocation.
          expect(logger.count).toBe(1);
          const entry = logger.last;
          expect(entry).toBeDefined();
          if (entry === undefined) {
            throw new Error("expected an invocation-log entry to be recorded");
          }

          // Required field 1: the model identifier (a configured, non-empty id).
          expect(entry.modelId).toBe(MODEL_ID);

          // Required field 2: the invoking user identifier.
          expect(entry.invokingUserId).toBe(invokingUserId);

          // Required field 3: the invocation timestamp (the deterministic clock).
          expect(entry.at).toBe(at);

          // Required field 4: the validation outcome (one of the defined values).
          expect(VALIDATION_OUTCOMES).toContain(entry.validationOutcome);
        }
      ),
      { numRuns: 200 }
    );
  });
});
