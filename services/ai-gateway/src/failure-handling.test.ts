// services/ai-gateway/src/failure-handling.test.ts
//
// Unit tests for AI_Gateway failure handling and review gating (Task 12.4,
// Requirement 20.1-20.6).
//
// Confidence gating and bounded retry are exercised both in isolation (the
// confidence-gate validator and overall-confidence derivation) and through the
// full AiGateway.invoke path with injected providers and a controllable
// scheduler, so retry, error indication, failure logging, and no-auto-advance
// are all deterministic.

import { describe, expect, it } from "vitest";

import {
  confidenceGateValidator,
  DEFAULT_MAX_INVOCATION_ATTEMPTS,
  deriveOverallConfidence
} from "./failure-handling.js";
import { AiGateway } from "./gateway.js";
import { InMemoryFlaggedOutputStore } from "./flagged-output-store.js";
import { InMemoryInvocationLogger } from "./invocation-logger.js";
import { directAccessGuard } from "./mediation.js";
import { groundingValidators } from "./output-validation.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GenerativeRequest, GroundedInputCache, ReviewerContext } from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";

const MODEL_ID = "anthropic.test-model-v1";

const neverScheduler: Scheduler = {
  setTimeout(): unknown {
    return {};
  },
  clearTimeout(): void {
    // no-op
  }
};

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

const baseRequest: GenerativeRequest = {
  taskType: "summarisation",
  invokingUserId: "User-1",
  systemInstructions: "Summarise the case using only the provided data.",
  context: [{ sourceObjectId: "Doc-1", content: "clinical note one" }]
};

const authorisedReviewer: ReviewerContext = { reviewerId: "Reviewer-1", isAuthorisedReviewer: true };

function grounded(statements: unknown): string {
  return JSON.stringify({ statements });
}

function providerReturning(outputText: string): { provider: ModelProvider; calls: () => number } {
  let calls = 0;
  const provider: ModelProvider = {
    async invoke(request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      calls += 1;
      return { outputText, modelId: request.modelId };
    }
  };
  return { provider, calls: () => calls };
}

function erroringProvider(error = new Error("bedrock service error")): {
  provider: ModelProvider;
  calls: () => number;
} {
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

/** A provider that fails `failuresBefore` times then succeeds, to prove retry works. */
function flakyProvider(
  failuresBefore: number,
  outputText: string
): { provider: ModelProvider; calls: () => number } {
  let calls = 0;
  const provider: ModelProvider = {
    async invoke(request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      calls += 1;
      if (calls <= failuresBefore) {
        throw new Error(`transient failure ${calls}`);
      }
      return { outputText, modelId: request.modelId };
    }
  };
  return { provider, calls: () => calls };
}

function response(outputText: string): ModelResponse {
  return { outputText, modelId: MODEL_ID };
}

// ---------------------------------------------------------------------------
// deriveOverallConfidence / confidenceGateValidator (Req 20.1, 20.2)
// ---------------------------------------------------------------------------

describe("deriveOverallConfidence (Req 20.1)", () => {
  it("derives the minimum statement confidence as the overall confidence", () => {
    const output = grounded([
      { statement: "a", sourceRefs: ["Doc-1"], confidence: 0.9, basis: "observed" },
      { statement: "b", sourceRefs: ["Doc-1"], confidence: 0.4, basis: "inferred" },
      { statement: "c", sourceRefs: ["Doc-1"], confidence: 0.7, basis: "observed" }
    ]);
    expect(deriveOverallConfidence(response(output))).toBe(0.4);
  });

  it("returns undefined when confidence cannot be derived (unparseable or empty)", () => {
    expect(deriveOverallConfidence(response("{not json"))).toBeUndefined();
    expect(deriveOverallConfidence(response(grounded([])))).toBeUndefined();
  });
});

describe("confidenceGateValidator (Req 20.1, 20.2)", () => {
  it("rejects output whose overall confidence is below the threshold", () => {
    const gate = confidenceGateValidator(0.6);
    const output = grounded([
      { statement: "a", sourceRefs: ["Doc-1"], confidence: 0.9, basis: "observed" },
      { statement: "b", sourceRefs: ["Doc-1"], confidence: 0.3, basis: "inferred" }
    ]);
    expect(gate.validate(response(output), baseRequest, baseRequest.context)).toMatchObject({
      status: "rejected",
      reason: "below_threshold_confidence"
    });
  });

  it("passes output whose overall confidence meets the threshold", () => {
    const gate = confidenceGateValidator(0.6);
    const output = grounded([
      { statement: "a", sourceRefs: ["Doc-1"], confidence: 0.6, basis: "observed" }
    ]);
    expect(gate.validate(response(output), baseRequest, baseRequest.context)).toEqual({
      status: "valid"
    });
  });

  it("rejects a threshold outside [0, 1]", () => {
    expect(() => confidenceGateValidator(1.5)).toThrow(RangeError);
    expect(() => confidenceGateValidator(-0.1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Confidence gating through the gateway (Req 20.1, 20.2, 20.6)
// ---------------------------------------------------------------------------

describe("AiGateway confidence gating (Req 20.1, 20.2, 20.6)", () => {
  it("marks below-threshold output for review, does not confirm it, and never returns `invoked`", async () => {
    const output = grounded([
      { statement: "Patient likely has a rare disorder.", sourceRefs: ["Doc-1"], confidence: 0.3, basis: "inferred" }
    ]);
    const logger = new InMemoryInvocationLogger();
    const store = new InMemoryFlaggedOutputStore();
    const writes: string[] = [];
    const cache: GroundedInputCache = {
      get: () => undefined,
      set: (key) => {
        writes.push(key);
      }
    };
    const { provider } = providerReturning(output);
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider,
      scheduler: neverScheduler,
      logger,
      flaggedOutputStore: store,
      cache,
      confidenceThreshold: 0.7
    });

    const result = await gateway.invoke(baseRequest);

    // Req 20.6 / 20.2: never `invoked`; a distinct needs_review result.
    expect(result.outcome).toBe("needs_review");
    if (result.outcome === "needs_review") {
      // Req 20.2: marked for review recording the below-threshold reason.
      expect(result.review.reason).toBe("below_threshold_confidence");
      // Req 20.1: retained unconfirmed for an authorised reviewer.
      const flagged = gateway.getFlaggedOutput(result.reviewId, authorisedReviewer);
      expect(flagged?.response.outputText).toBe(output);
    }
    // Req 20.1: not stored as confirmed — the cache (confirmed-output store) is
    // never written, so any previously confirmed output is not overwritten.
    expect(writes).toHaveLength(0);
    // Req 20.5: logged as a validation failure.
    expect(logger.last?.validationOutcome).toBe("failed");
    expect(store.count).toBe(1);
  });

  it("does NOT overwrite previously confirmed output when new output is below threshold", async () => {
    // The cache models confirmed output. Seed a prior confirmed response and
    // prove a below-threshold invocation leaves it untouched (Req 20.1).
    const priorConfirmed = response(
      grounded([{ statement: "confirmed finding", sourceRefs: ["Doc-1"], confidence: 0.95, basis: "observed" }])
    );
    const confirmedStore = new Map<string, ModelResponse>();
    const cache: GroundedInputCache = {
      get: (key) => confirmedStore.get(key),
      set: (key, value) => {
        confirmedStore.set(key, value);
      }
    };
    // Pre-seed with an unrelated confirmed entry.
    confirmedStore.set("prior-key", priorConfirmed);

    const lowOutput = grounded([
      { statement: "low confidence claim", sourceRefs: ["Doc-1"], confidence: 0.2, basis: "inferred" }
    ]);
    const { provider } = providerReturning(lowOutput);
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider,
      scheduler: neverScheduler,
      cache,
      confidenceThreshold: 0.7
    });

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("needs_review");
    // The previously confirmed output is intact and no new confirmed entry added.
    expect(confirmedStore.size).toBe(1);
    expect(confirmedStore.get("prior-key")).toBe(priorConfirmed);
  });

  it("returns `invoked` for above-threshold, valid output (confirmation path)", async () => {
    const output = grounded([
      { statement: "Patient reports seizures.", sourceRefs: ["Doc-1"], confidence: 0.85, basis: "observed" }
    ]);
    const { provider } = providerReturning(output);
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider,
      scheduler: neverScheduler,
      outputValidators: groundingValidators,
      confidenceThreshold: 0.7
    });

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("invoked");
  });
});

// ---------------------------------------------------------------------------
// Bounded retry and error indication (Req 20.3, 20.4, 20.5)
// ---------------------------------------------------------------------------

describe("AiGateway bounded retry (Req 20.3, 20.4, 20.5)", () => {
  it("retries a failing provider up to the maximum of 3 attempts, then returns an error indication", async () => {
    expect(DEFAULT_MAX_INVOCATION_ATTEMPTS).toBe(3);
    const cause = new Error("bedrock throttled");
    const fake = erroringProvider(cause);
    const logger = new InMemoryInvocationLogger();
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider: fake.provider,
      scheduler: neverScheduler,
      logger,
      now: () => "2024-01-01T00:00:00.000Z"
    });

    const result = await gateway.invoke(baseRequest);

    // Req 20.3: retried up to the configured maximum of 3 attempts.
    expect(fake.calls()).toBe(3);
    // Req 20.4: exhaustion returns an error indication (never `invoked`).
    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.error.code).toBe("MODEL_INVOCATION_FAILED");
    }
    // Req 20.5: each failed attempt is logged with a reason and a timestamp.
    expect(logger.count).toBe(3);
    for (const entry of logger.entries) {
      expect(entry.outcome).toBe("rejected");
      expect(entry.failureReason).toBe("provider_error");
      expect(entry.at).toBe("2024-01-01T00:00:00.000Z");
    }
  });

  it("logs a timeout failure reason on each timed-out attempt (Req 20.5)", async () => {
    // Force timeouts: a provider that never resolves plus an immediate timer.
    const hanging: ModelProvider = {
      invoke(_request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
        directAccessGuard(context.mediation);
        return new Promise<ModelResponse>((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
    };
    const logger = new InMemoryInvocationLogger();
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider: hanging,
      scheduler: immediateScheduler(),
      logger
    });

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.error).toMatchObject({ code: "MODEL_INVOCATION_FAILED", timedOut: true });
    }
    expect(logger.count).toBe(3);
    for (const entry of logger.entries) {
      expect(entry.failureReason).toBe("invocation_timeout");
    }
  });

  it("succeeds without an error when a transient failure clears within the retry budget", async () => {
    const output = grounded([
      { statement: "Patient reports seizures.", sourceRefs: ["Doc-1"], confidence: 0.9, basis: "observed" }
    ]);
    const fake = flakyProvider(2, output);
    const logger = new InMemoryInvocationLogger();
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider: fake.provider,
      scheduler: neverScheduler,
      logger,
      outputValidators: groundingValidators
    });

    const result = await gateway.invoke(baseRequest);

    // Two failures then a success on the third attempt.
    expect(fake.calls()).toBe(3);
    expect(result.outcome).toBe("invoked");
    // The two failed attempts were logged with a reason; the success is logged too.
    const failed = logger.entries.filter((e) => e.outcome === "rejected");
    expect(failed).toHaveLength(2);
    expect(logger.last?.outcome).toBe("invoked");
  });

  it("rejects a non-positive or non-integer maxAttempts at construction", () => {
    const { provider } = providerReturning("x");
    expect(() => new AiGateway({ modelId: MODEL_ID, provider, maxAttempts: 0 })).toThrow(RangeError);
    expect(() => new AiGateway({ modelId: MODEL_ID, provider, maxAttempts: 2.5 })).toThrow(RangeError);
  });
});
