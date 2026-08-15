// services/ai-gateway/src/bedrock-failure.property.test.ts
//
// Property-based test for Correctness Property 46 (Requirement 16.6).
//
// Feature: undiagnosed-disease-navigator, Property 46: Bedrock errors and
// timeouts are aborted safely.
//
// Design (Property 46): For any generative invocation in which Bedrock returns
// an error or does not respond within 30 seconds, the AI_Gateway aborts and
// returns a model-invocation-failed error.
//
// Strategy: drive both failure modes through the full AiGateway.invoke path
// with an injected fake provider and a controllable Scheduler.
//   - "provider-error": the provider throws an arbitrary error; a
//     never-scheduler ensures the timeout never fires, so the provider's own
//     error is what surfaces. The gateway must map it to a
//     MODEL_INVOCATION_FAILED rejection (timedOut === false).
//   - "timeout": the provider hangs forever; an immediate scheduler fires the
//     timeout via queueMicrotask, forcing the abort path. The gateway must map
//     it to a MODEL_INVOCATION_FAILED rejection with timedOut === true.
// maxAttempts is set to 1 to keep the property focused on the error mapping
// (the invocation still exhausts its budget and gives up).

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { AiGateway } from "./gateway.js";
import { directAccessGuard } from "./mediation.js";
import { ALLOWED_TASK_TYPES, type GenerativeTaskType } from "./task-types.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GenerativeRequest } from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";

const MODEL_ID = "anthropic.test-model-v1";

// A scheduler that never fires its handler: the timeout arm of the race never
// settles, so a provider error is free to surface as the invocation outcome.
const neverScheduler: Scheduler = {
  setTimeout(): unknown {
    return {};
  },
  clearTimeout(): void {
    // no-op
  }
};

// A scheduler that fires the timeout handler on the microtask queue, forcing
// the timeout/abort path deterministically without real waiting.
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

// A provider that always throws the supplied error (provider-error mode).
function erroringProvider(error: unknown): { provider: ModelProvider; calls: () => number } {
  let calls = 0;
  const provider: ModelProvider = {
    async invoke(_request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      calls += 1;
      throw error;
    }
  };
  return { provider, calls: () => calls };
}

// A provider that never resolves on its own and only settles when aborted
// (timeout mode). Rejecting on abort mirrors a real backend honouring the
// gateway's abort signal.
function hangingProvider(): { provider: ModelProvider; calls: () => number } {
  let calls = 0;
  const provider: ModelProvider = {
    invoke(_request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      calls += 1;
      return new Promise<ModelResponse>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
  };
  return { provider, calls: () => calls };
}

// Generate a failure mode. For provider-error mode we generate an arbitrary
// thrown value (Error instances with arbitrary messages, plus non-Error throws
// like strings/numbers, to exercise the wrap-unknown-cause path).
const failureModeArb = fc.oneof(
  fc.record({
    kind: fc.constant("provider-error" as const),
    thrown: fc.oneof(
      fc.string().map((message) => new Error(message)),
      fc.string(),
      fc.integer(),
      fc.constant(null),
      fc.constant(undefined)
    )
  }),
  fc.record({ kind: fc.constant("timeout" as const) })
);

const taskTypeArb: fc.Arbitrary<GenerativeTaskType> = fc.constantFrom(...ALLOWED_TASK_TYPES);

function requestFor(taskType: GenerativeTaskType): GenerativeRequest {
  return {
    taskType,
    invokingUserId: "User-1",
    systemInstructions: "Use only the provided data.",
    context: [{ sourceObjectId: "Doc-1", content: "clinical note one" }]
  };
}

describe("Feature: undiagnosed-disease-navigator, Property 46: Bedrock errors and timeouts are aborted safely", () => {
  it("aborts and returns MODEL_INVOCATION_FAILED (timedOut for timeouts) and never returns invoked", async () => {
    await fc.assert(
      fc.asyncProperty(failureModeArb, taskTypeArb, async (mode, taskType) => {
        const { provider, calls } =
          mode.kind === "timeout" ? hangingProvider() : erroringProvider(mode.thrown);
        const scheduler = mode.kind === "timeout" ? immediateScheduler() : neverScheduler;

        const gateway = new AiGateway({
          modelId: MODEL_ID,
          provider,
          scheduler,
          maxAttempts: 1
        });

        const result = await gateway.invoke(requestFor(taskType));

        // The gateway aborts and reports failure: no successful invocation is
        // returned for a failing/timing-out provider.
        expect(result.outcome).toBe("rejected");
        if (result.outcome !== "rejected") {
          throw new Error("expected a rejected outcome for a failing/timing-out provider");
        }
        // The rejection is a model-invocation-failed error.
        expect(result.error.code).toBe("MODEL_INVOCATION_FAILED");
        // Timeouts are distinguished by the timedOut flag; provider errors are not.
        const timedOut = (result.error as { timedOut?: boolean }).timedOut;
        if (mode.kind === "timeout") {
          expect(timedOut).toBe(true);
        } else {
          expect(timedOut).toBe(false);
        }
        // The provider was actually contacted exactly maxAttempts (1) times.
        expect(calls()).toBe(1);
      }),
      { numRuns: 200 }
    );
  });
});
