// services/ai-gateway/src/generative-gating.property.test.ts
//
// Property-based test for Correctness Property 44 (Requirements 16.2, 16.3, 16.5).
//
// Feature: undiagnosed-disease-navigator, Property 44: Generative invocation
// requires configured model and allowed task type.
//
// Design (Property 44): For any generative task request, the AI_Gateway invokes
// a model if and only if the model identifier environment variable is present
// and non-empty and the requested task type is one of phenotype extraction,
// summarisation, or drafting of explanations/reports; otherwise it rejects the
// request without invoking any model.
//
// The gateway is exercised without AWS by injecting a fake counting
// ModelProvider (which enforces the mediation boundary via directAccessGuard)
// and a never-firing scheduler, so the model-invocation count is a faithful
// witness of whether a model was contacted.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { AiGateway } from "./gateway.js";
import { directAccessGuard } from "./mediation.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GenerativeRequest } from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";
import { ALLOWED_TASK_TYPES, isAllowedTaskType } from "./task-types.js";

const MODEL_ID = "anthropic.test-model-v1";

// A provider that records how many times the gateway invoked it. It asserts the
// call is gateway-mediated (Req 16.4) so the count is only ever incremented on a
// legitimate, gateway-routed invocation.
function countingProvider(): { provider: ModelProvider; calls: () => number } {
  let calls = 0;
  const provider: ModelProvider = {
    async invoke(request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      calls += 1;
      return { outputText: "grounded output", modelId: request.modelId };
    }
  };
  return { provider, calls: () => calls };
}

// A scheduler whose timer never fires: the counting provider settles
// synchronously, so the timeout path is never taken.
const neverScheduler: Scheduler = {
  setTimeout(): unknown {
    return {};
  },
  clearTimeout(): void {
    // no-op
  }
};

// Generate a task type that mixes the permitted allowlist values with arbitrary
// (mostly disallowed) strings, so both branches of the allowlist gate are
// exercised. `isAllowedTaskType` is the single source of truth for the expected
// classification, so an arbitrary string that happens to equal an allowed value
// is still handled correctly.
const taskTypeArb = fc.oneof(
  { weight: 1, arbitrary: fc.constantFrom<string>(...ALLOWED_TASK_TYPES) },
  { weight: 1, arbitrary: fc.string() }
);

const requestArb = fc.record({
  taskType: taskTypeArb,
  invokingUserId: fc.string({ minLength: 1 }),
  systemInstructions: fc.string(),
  content: fc.string()
});

describe("Feature: undiagnosed-disease-navigator, Property 44: Generative invocation requires configured model and allowed task type", () => {
  it("invokes the model iff the task type is allowed and the model id is configured; otherwise rejects without invoking, task-type check first", async () => {
    await fc.assert(
      fc.asyncProperty(requestArb, fc.boolean(), async (input, modelConfigured) => {
        const fake = countingProvider();
        const gateway = new AiGateway({
          modelId: modelConfigured ? MODEL_ID : undefined,
          provider: fake.provider,
          scheduler: neverScheduler
        });

        const request: GenerativeRequest = {
          taskType: input.taskType,
          invokingUserId: input.invokingUserId,
          systemInstructions: input.systemInstructions,
          context: [{ sourceObjectId: "Doc-1", content: input.content }]
        };

        const taskAllowed = isAllowedTaskType(input.taskType);
        const shouldInvoke = taskAllowed && modelConfigured;

        const result = await gateway.invoke(request);

        if (shouldInvoke) {
          // IFF: allowed task type AND configured model => the model is invoked.
          expect(result.outcome).toBe("invoked");
          expect(fake.calls()).toBe(1);
        } else {
          // Otherwise: rejected WITHOUT invoking any model.
          expect(result.outcome).toBe("rejected");
          expect(fake.calls()).toBe(0);
          if (result.outcome === "rejected") {
            // The task-type check precedes the config check (Req 16.5 before
            // 16.2/16.3): a disallowed task type is rejected as not permitted
            // even when the model is also unconfigured.
            const expectedCode = !taskAllowed
              ? "TASK_TYPE_NOT_PERMITTED"
              : "MODEL_CONFIG_MISSING";
            expect(result.error.code).toBe(expectedCode);
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
