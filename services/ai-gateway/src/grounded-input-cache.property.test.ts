// services/ai-gateway/src/grounded-input-cache.property.test.ts
//
// Property-based test for design Correctness Property 70 (Task 12.18,
// Requirements 32.2, 32.3).
//
// Feature: undiagnosed-disease-navigator, Property 70: Grounded-input caching
// is consistent
//
// Design (Property 70): For any grounded input, the first submission computes
// the result and stores it in the cache, and any subsequent submission of a
// byte-identical grounded input returns the cached result identical to the
// originally computed result.
//
// Requirement 32.2: WHEN a grounded input identical to a previously cached
// input is submitted, THE Navigator SHALL return the cached AI result.
// Requirement 32.3: WHEN a grounded input has no cached result, THE Navigator
// SHALL compute the result, store it in the cache, and return it.
//
// The cache is keyed by a canonical hash of (task type, model id, AUTHORISED
// context, prompt template version). This test proves three things across many
// generated grounded inputs:
//
//   (1) Compute-store-return on miss, return-cached on hit: the FIRST
//       submission of a grounded input invokes the provider exactly once,
//       stores the result, and returns it (Req 32.3); an identical subsequent
//       submission returns the SAME result WITHOUT re-invoking the provider
//       (Req 32.2).
//   (2) Key consistency (biconditional): two grounded inputs map to the same
//       canonical key if and only if they are logically identical (as an
//       order-independent view of task type, model id, authorised context, and
//       prompt template version) — identical inputs collide by design,
//       different inputs never collide.
//   (3) No behavioural collision: two logically-different grounded inputs each
//       reach the provider (distinct keys => two computations => two distinct
//       results), so a distinct input never receives another input's cached
//       result.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  canonicalGroundedInputKey,
  InMemoryGroundedInputCache,
  type GroundedInputKeyComponents
} from "./grounded-input-cache.js";
import { AiGateway } from "./gateway.js";
import { directAccessGuard } from "./mediation.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GatewayContextItem, GenerativeRequest } from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";
import { ALLOWED_TASK_TYPES, type GenerativeTaskType } from "./task-types.js";

const MODEL_ID = "anthropic.test-model-v1";

/** A scheduler whose timer never fires, so the 30s timeout never interferes. */
const neverScheduler: Scheduler = {
  setTimeout(): unknown {
    return {};
  },
  clearTimeout(): void {
    // no-op
  }
};

/**
 * A provider that counts invocations and returns a DISTINCT output per call
 * (`output-1`, `output-2`, ...). The distinctness lets the test detect both a
 * spurious re-invocation (a cache hit that recomputed) and a collision (a
 * distinct input served another input's result).
 */
function countingProvider(): { provider: ModelProvider; calls: () => number } {
  let calls = 0;
  const provider: ModelProvider = {
    async invoke(request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      calls += 1;
      return { outputText: `output-${calls}`, modelId: request.modelId };
    }
  };
  return { provider, calls: () => calls };
}

// --- Generators -------------------------------------------------------------

const taskTypeArb: fc.Arbitrary<GenerativeTaskType> = fc.constantFrom(...ALLOWED_TASK_TYPES);

const sourceIdArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 8 })
  .map((s) => `Doc-${s}`);

const contextItemArb: fc.Arbitrary<GatewayContextItem> = fc.record({
  sourceObjectId: sourceIdArb,
  content: fc.string({ maxLength: 40 })
});

// A non-empty authorised context. Distinct source ids keep the authorised set
// unambiguous (the gateway authorises exactly these ids, so nothing is excluded
// and the authorised context equals the full context).
const contextArb: fc.Arbitrary<readonly GatewayContextItem[]> = fc.uniqueArray(contextItemArb, {
  minLength: 1,
  maxLength: 5,
  selector: (item) => item.sourceObjectId
});

const versionArb: fc.Arbitrary<string> = fc.constantFrom("v1", "v2", "v3");

/** The logical components of a grounded input the gateway keys a cache entry by. */
interface GroundedComponents {
  readonly taskType: GenerativeTaskType;
  readonly context: readonly GatewayContextItem[];
  readonly promptTemplateVersion: string | undefined;
}

const groundedComponentsArb: fc.Arbitrary<GroundedComponents> = fc.record({
  taskType: taskTypeArb,
  context: contextArb,
  promptTemplateVersion: fc.option(versionArb, { nil: undefined })
});

/** Full key components (adds a model id) for exercising canonicalGroundedInputKey directly. */
const keyComponentsArb: fc.Arbitrary<GroundedInputKeyComponents> = fc.record({
  taskType: taskTypeArb,
  modelId: fc.constantFrom("model-a", "model-b", "model-c"),
  context: contextArb,
  promptTemplateVersion: fc.option(versionArb, { nil: undefined })
});

/**
 * An order-independent logical fingerprint of key components, computed WITHOUT
 * hashing, used as the oracle for the key biconditional: two grounded inputs
 * are logically identical iff they agree on task type, model id, the multiset
 * of authorised (sourceObjectId, content) pairs, and prompt template version.
 */
function logicalFingerprint(c: GroundedInputKeyComponents): string {
  const ctx = c.context
    .map((item) => [item.sourceObjectId, item.content] as const)
    .slice()
    .sort((a, b) => {
      if (a[0] !== b[0]) {
        return a[0] < b[0] ? -1 : 1;
      }
      if (a[1] !== b[1]) {
        return a[1] < b[1] ? -1 : 1;
      }
      return 0;
    });
  return JSON.stringify({
    taskType: c.taskType,
    modelId: c.modelId,
    context: ctx,
    promptTemplateVersion: c.promptTemplateVersion ?? null
  });
}

/** Build a caller-facing request that authorises exactly its own context. */
function buildRequest(c: GroundedComponents): GenerativeRequest {
  return {
    taskType: c.taskType,
    invokingUserId: "User-1",
    systemInstructions: "Summarise the case using only the provided data.",
    context: c.context,
    authorizedScope: { authorizedSourceObjectIds: c.context.map((item) => item.sourceObjectId) },
    ...(c.promptTemplateVersion !== undefined
      ? { promptTemplateVersion: c.promptTemplateVersion }
      : {})
  };
}

function logicalFingerprintOfRequest(c: GroundedComponents): string {
  return logicalFingerprint({ ...c, modelId: MODEL_ID });
}

// --- Properties -------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 70: Grounded-input caching is consistent", () => {
  // Validates: Requirements 32.2, 32.3
  it("computes, stores, and returns on the first submission, then returns the identical cached result without re-invoking the model on an identical resubmission", async () => {
    await fc.assert(
      fc.asyncProperty(groundedComponentsArb, async (components) => {
        const request = buildRequest(components);
        const { provider, calls } = countingProvider();
        const cache = new InMemoryGroundedInputCache();
        const gateway = new AiGateway({
          modelId: MODEL_ID,
          provider,
          scheduler: neverScheduler,
          cache
        });

        // Req 32.3: a grounded input with no cached result is computed, stored,
        // and returned.
        const first = await gateway.invoke(request);
        expect(first.outcome).toBe("invoked");
        expect(calls()).toBe(1);
        expect(cache.size).toBe(1);

        // Req 32.2: an identical grounded input returns the cached AI result.
        const second = await gateway.invoke(request);
        expect(second.outcome).toBe("invoked");
        // The provider was NOT invoked again: the second result came from cache.
        expect(calls()).toBe(1);
        expect(cache.size).toBe(1);

        if (first.outcome === "invoked" && second.outcome === "invoked") {
          // The cached result is identical to the originally computed result.
          expect(second.response).toEqual(first.response);
          expect(second.response.outputText).toBe("output-1");
        }
      }),
      { numRuns: 150 }
    );
  });

  it("keys the cache canonically: two grounded inputs share a key iff they are logically identical, so identical inputs collide by design and different inputs never collide", () => {
    fc.assert(
      fc.property(keyComponentsArb, keyComponentsArb, (a, b) => {
        const keyA = canonicalGroundedInputKey(a);
        const keyB = canonicalGroundedInputKey(b);

        // A key is a deterministic function of its components.
        expect(canonicalGroundedInputKey(a)).toBe(keyA);

        if (logicalFingerprint(a) === logicalFingerprint(b)) {
          // Logically-identical grounded inputs map to the same key (hit).
          expect(keyA).toBe(keyB);
        } else {
          // Any difference in task type, model id, authorised context, or
          // prompt template version yields a different key (no collision).
          expect(keyA).not.toBe(keyB);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("does not serve a distinct grounded input another input's cached result: each logically-different input reaches the provider and gets its own result", async () => {
    await fc.assert(
      fc.asyncProperty(
        groundedComponentsArb,
        groundedComponentsArb,
        async (compA, compB) => {
          // Restrict to logically-different inputs (same configured model id).
          fc.pre(logicalFingerprintOfRequest(compA) !== logicalFingerprintOfRequest(compB));

          const requestA = buildRequest(compA);
          const requestB = buildRequest(compB);
          const { provider, calls } = countingProvider();
          const cache = new InMemoryGroundedInputCache();
          const gateway = new AiGateway({
            modelId: MODEL_ID,
            provider,
            scheduler: neverScheduler,
            cache
          });

          const resultA = await gateway.invoke(requestA);
          const resultB = await gateway.invoke(requestB);

          expect(resultA.outcome).toBe("invoked");
          expect(resultB.outcome).toBe("invoked");
          // Distinct keys => two computations => two stored entries.
          expect(calls()).toBe(2);
          expect(cache.size).toBe(2);

          if (resultA.outcome === "invoked" && resultB.outcome === "invoked") {
            // No collision: B received its own freshly computed result, not A's.
            expect(resultB.response.outputText).toBe("output-2");
            expect(resultB.response.outputText).not.toBe(resultA.response.outputText);
          }
        }
      ),
      { numRuns: 150 }
    );
  });
});
