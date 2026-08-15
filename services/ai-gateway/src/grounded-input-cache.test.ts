// services/ai-gateway/src/grounded-input-cache.test.ts
//
// Unit tests for the grounded-input cache (Task 12.5, Req 32.2, 32.3).
//
// Covers: identical grounded input returns the cached result without
// re-invoking the provider (32.2); a different grounded input misses and
// invokes (32.3); the cache key is canonical (same logical input -> same key,
// insignificant ordering ignored); and needs_review/failed output is NOT cached
// (Req 19.4 - only validated output reaches the cache STORE step).

import { describe, expect, it } from "vitest";

import {
  canonicalGroundedInputKey,
  InMemoryGroundedInputCache
} from "./grounded-input-cache.js";
import { AiGateway } from "./gateway.js";
import { directAccessGuard } from "./mediation.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GenerativeRequest, OutputValidator } from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";

const MODEL_ID = "anthropic.test-model-v1";

/** A scheduler whose timeout never fires, so timing never interferes with the test. */
const neverScheduler: Scheduler = {
  setTimeout(): unknown {
    return {};
  },
  clearTimeout(): void {
    // no-op
  }
};

/** A provider that counts how many times it was invoked. */
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

const baseRequest: GenerativeRequest = {
  taskType: "summarisation",
  invokingUserId: "User-1",
  systemInstructions: "Summarise the case using only the provided data.",
  context: [{ sourceObjectId: "Doc-1", content: "clinical note text" }]
};

describe("canonicalGroundedInputKey (Req 32.2)", () => {
  it("is stable: identical logical input yields the same key", () => {
    const key1 = canonicalGroundedInputKey({
      taskType: "summarisation",
      modelId: MODEL_ID,
      context: [{ sourceObjectId: "Doc-1", content: "a" }],
      promptTemplateVersion: "v1"
    });
    const key2 = canonicalGroundedInputKey({
      taskType: "summarisation",
      modelId: MODEL_ID,
      context: [{ sourceObjectId: "Doc-1", content: "a" }],
      promptTemplateVersion: "v1"
    });
    expect(key1).toBe(key2);
  });

  it("is canonical over context ordering: reordered authorised context yields the same key", () => {
    const key1 = canonicalGroundedInputKey({
      taskType: "summarisation",
      modelId: MODEL_ID,
      context: [
        { sourceObjectId: "Doc-1", content: "first" },
        { sourceObjectId: "Doc-2", content: "second" }
      ]
    });
    const key2 = canonicalGroundedInputKey({
      taskType: "summarisation",
      modelId: MODEL_ID,
      context: [
        { sourceObjectId: "Doc-2", content: "second" },
        { sourceObjectId: "Doc-1", content: "first" }
      ]
    });
    expect(key1).toBe(key2);
  });

  it("distinguishes task type, model id, context, and prompt template version", () => {
    const base = {
      taskType: "summarisation",
      modelId: MODEL_ID,
      context: [{ sourceObjectId: "Doc-1", content: "a" }],
      promptTemplateVersion: "v1"
    } as const;
    const baseKey = canonicalGroundedInputKey(base);

    expect(canonicalGroundedInputKey({ ...base, taskType: "phenotype_extraction" })).not.toBe(
      baseKey
    );
    expect(canonicalGroundedInputKey({ ...base, modelId: "other-model" })).not.toBe(baseKey);
    expect(
      canonicalGroundedInputKey({ ...base, context: [{ sourceObjectId: "Doc-1", content: "b" }] })
    ).not.toBe(baseKey);
    expect(
      canonicalGroundedInputKey({ ...base, context: [{ sourceObjectId: "Doc-2", content: "a" }] })
    ).not.toBe(baseKey);
    expect(canonicalGroundedInputKey({ ...base, promptTemplateVersion: "v2" })).not.toBe(baseKey);
  });
});

describe("InMemoryGroundedInputCache", () => {
  it("returns undefined on a miss and the stored value on a hit", () => {
    const cache = new InMemoryGroundedInputCache();
    const response: ModelResponse = { outputText: "cached", modelId: MODEL_ID };

    expect(cache.get("k")).toBeUndefined();
    cache.set("k", response);
    expect(cache.get("k")).toBe(response);
    expect(cache.size).toBe(1);
  });
});

describe("AiGateway grounded-input cache (Req 32.2, 32.3)", () => {
  it("returns the cached result for an identical grounded input without re-invoking the provider", async () => {
    const { provider, calls } = countingProvider();
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider,
      scheduler: neverScheduler,
      cache: new InMemoryGroundedInputCache()
    });

    const first = await gateway.invoke(baseRequest);
    const second = await gateway.invoke(baseRequest);

    expect(first.outcome).toBe("invoked");
    expect(second.outcome).toBe("invoked");
    // Req 32.3: miss computes, stores, returns. Req 32.2: the identical second
    // input hits the cache, so the provider is invoked exactly once.
    expect(calls()).toBe(1);
    if (first.outcome === "invoked" && second.outcome === "invoked") {
      expect(second.response).toEqual(first.response);
    }
  });

  it("treats a grounded input differing only by context ordering as a cache hit", async () => {
    const { provider, calls } = countingProvider();
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider,
      scheduler: neverScheduler,
      cache: new InMemoryGroundedInputCache()
    });

    const twoItems: GenerativeRequest = {
      ...baseRequest,
      context: [
        { sourceObjectId: "Doc-1", content: "first" },
        { sourceObjectId: "Doc-2", content: "second" }
      ]
    };
    const reordered: GenerativeRequest = {
      ...baseRequest,
      context: [
        { sourceObjectId: "Doc-2", content: "second" },
        { sourceObjectId: "Doc-1", content: "first" }
      ]
    };

    await gateway.invoke(twoItems);
    await gateway.invoke(reordered);

    expect(calls()).toBe(1);
  });

  it("misses and invokes the provider for a different grounded input", async () => {
    const { provider, calls } = countingProvider();
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider,
      scheduler: neverScheduler,
      cache: new InMemoryGroundedInputCache()
    });

    await gateway.invoke(baseRequest);
    await gateway.invoke({
      ...baseRequest,
      context: [{ sourceObjectId: "Doc-9", content: "different note" }]
    });

    // Distinct grounded inputs => distinct keys => two provider invocations.
    expect(calls()).toBe(2);
  });

  it("does not cache needs_review output, so a repeat invocation re-invokes the provider", async () => {
    const { provider, calls } = countingProvider();
    // A validator that always rejects, forcing every invocation onto the
    // needs_review path (stage 7) which never reaches the cache STORE (stage 8).
    const alwaysReject: OutputValidator = {
      validate() {
        return {
          status: "rejected",
          reason: "ungrounded_statement",
          detail: "statement not linked to any source object"
        };
      }
    };
    const cache = new InMemoryGroundedInputCache();
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider,
      scheduler: neverScheduler,
      outputValidators: [alwaysReject],
      cache
    });

    const first = await gateway.invoke(baseRequest);
    const second = await gateway.invoke(baseRequest);

    expect(first.outcome).toBe("needs_review");
    expect(second.outcome).toBe("needs_review");
    // Req 19.4: flagged output is never persisted, so nothing was cached and the
    // provider is invoked again for the identical input.
    expect(cache.size).toBe(0);
    expect(calls()).toBe(2);
  });
});
