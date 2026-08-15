// services/ai-gateway/src/gateway.test.ts
//
// Unit tests for the AI_Gateway core (Requirement 16.1, 16.2, 16.3, 16.5, 16.6).
//
// The gateway is exercised without AWS by injecting fake providers (successful,
// erroring, hanging) and a controllable scheduler, so the 30-second
// timeout/abort path is deterministic.

import { describe, expect, it } from "vitest";

import { AiGateway } from "./gateway.js";
import { DirectModelAccessError } from "./errors.js";
import { directAccessGuard } from "./mediation.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GenerativeRequest } from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";

const MODEL_ID = "anthropic.test-model-v1";

const baseRequest: GenerativeRequest = {
  taskType: "summarisation",
  invokingUserId: "User-1",
  systemInstructions: "Summarise the case using only the provided data.",
  context: [{ sourceObjectId: "Doc-1", content: "clinical note text" }]
};

/** A provider that records invocation count and returns a fixed response. */
function successProvider(outputText = "grounded summary"): {
  provider: ModelProvider;
  calls: () => number;
} {
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

/** A provider that always throws, simulating a Bedrock error (Req 16.6). */
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

/** A provider that never resolves, but rejects when its signal aborts (Req 16.6). */
function hangingProvider(): {
  provider: ModelProvider;
  calls: () => number;
  wasAborted: () => boolean;
} {
  let calls = 0;
  let aborted = false;
  const provider: ModelProvider = {
    invoke(_request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      calls += 1;
      return new Promise<ModelResponse>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("provider aborted"));
        });
      });
    }
  };
  return { provider, calls: () => calls, wasAborted: () => aborted };
}

/** A scheduler whose timer never fires (for tests where the provider settles first). */
const neverScheduler: Scheduler = {
  setTimeout(): unknown {
    return {};
  },
  clearTimeout(): void {
    // no-op
  }
};

/** A scheduler that fires the timeout on the next microtask (deterministic timeout). */
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

describe("AiGateway model configuration (Req 16.2, 16.3)", () => {
  it("rejects all invocations with MODEL_CONFIG_MISSING when the model id is absent, invoking no model", async () => {
    const fake = successProvider();
    const gateway = new AiGateway({ modelId: undefined, provider: fake.provider });

    expect(gateway.isModelConfigured).toBe(false);

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.error.code).toBe("MODEL_CONFIG_MISSING");
    }
    expect(fake.calls()).toBe(0);
  });

  it("throws at construction when a model id is set but no provider is supplied", () => {
    expect(() => new AiGateway({ modelId: MODEL_ID })).toThrow(TypeError);
  });

  it("fromEnv rejects when AI_MODEL_ID is empty and invokes no model (Req 16.3)", async () => {
    const gateway = AiGateway.fromEnv({ env: { AI_MODEL_ID: "   " } });

    expect(gateway.isModelConfigured).toBe(false);
    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.error.code).toBe("MODEL_CONFIG_MISSING");
    }
  });

  it("fromEnv reads AI_MODEL_ID and invokes an injected provider (Req 16.1, 16.2)", async () => {
    const fake = successProvider();
    const gateway = AiGateway.fromEnv({
      env: { AI_MODEL_ID: MODEL_ID },
      provider: fake.provider,
      scheduler: neverScheduler
    });

    expect(gateway.isModelConfigured).toBe(true);
    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("invoked");
    expect(fake.calls()).toBe(1);
  });
});

describe("AiGateway task-type allowlist (Req 16.5)", () => {
  it("rejects a disallowed task type with TASK_TYPE_NOT_PERMITTED and invokes no model", async () => {
    const fake = successProvider();
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider: fake.provider,
      scheduler: neverScheduler
    });

    const result = await gateway.invoke({ ...baseRequest, taskType: "diagnosis" });

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.error.code).toBe("TASK_TYPE_NOT_PERMITTED");
    }
    expect(fake.calls()).toBe(0);
  });

  it.each(["phenotype_extraction", "summarisation", "explanation_drafting"])(
    "invokes the model for the permitted task type %s (Req 16.1, 16.5)",
    async (taskType) => {
      const fake = successProvider();
      const gateway = new AiGateway({
        modelId: MODEL_ID,
        provider: fake.provider,
        scheduler: neverScheduler
      });

      const result = await gateway.invoke({ ...baseRequest, taskType });

      expect(result.outcome).toBe("invoked");
      if (result.outcome === "invoked") {
        expect(result.taskType).toBe(taskType);
      }
      expect(fake.calls()).toBe(1);
    }
  );
});

describe("AiGateway successful invocation (Req 16.1)", () => {
  it("returns the provider response for a configured, allowed request", async () => {
    const fake = successProvider("a grounded summary");
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider: fake.provider,
      scheduler: neverScheduler
    });

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("invoked");
    if (result.outcome === "invoked") {
      expect(result.modelId).toBe(MODEL_ID);
      expect(result.taskType).toBe("summarisation");
      expect(result.response.outputText).toBe("a grounded summary");
      expect(result.response.modelId).toBe(MODEL_ID);
    }
    expect(fake.calls()).toBe(1);
  });
});

describe("AiGateway Bedrock error and timeout handling (Req 16.6)", () => {
  it("aborts and returns MODEL_INVOCATION_FAILED when the provider errors", async () => {
    const cause = new Error("bedrock throttled");
    const fake = erroringProvider(cause);
    // Retry is disabled here (maxAttempts: 1) to exercise the single-attempt
    // core path; bounded retry (Req 20.3) is covered in failure-handling.test.ts.
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider: fake.provider,
      scheduler: neverScheduler,
      maxAttempts: 1
    });

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.error.code).toBe("MODEL_INVOCATION_FAILED");
      expect(result.error).toMatchObject({ timedOut: false, cause });
    }
    expect(fake.calls()).toBe(1);
  });

  it("aborts and returns MODEL_INVOCATION_FAILED when the provider does not respond in time", async () => {
    const fake = hangingProvider();
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider: fake.provider,
      timeoutMs: 30_000,
      scheduler: immediateScheduler(),
      maxAttempts: 1
    });

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.error.code).toBe("MODEL_INVOCATION_FAILED");
      expect(result.error).toMatchObject({ timedOut: true });
    }
    expect(fake.calls()).toBe(1);
    expect(fake.wasAborted()).toBe(true);
  });
});

describe("AiGateway mediation boundary (Req 16.4)", () => {
  it("rejects a direct provider invocation that does not route through the gateway", async () => {
    const fake = successProvider();
    const directContext: ModelInvocationContext = {
      // A foreign marker: this is what any non-gateway caller could supply.
      mediation: Symbol("not-the-gateway") as unknown as ModelInvocationContext["mediation"],
      signal: new AbortController().signal
    };
    const modelRequest: ModelRequest = {
      modelId: MODEL_ID,
      taskType: "summarisation",
      systemInstructions: "s",
      userContent: "u"
    };

    await expect(fake.provider.invoke(modelRequest, directContext)).rejects.toBeInstanceOf(
      DirectModelAccessError
    );
    expect(fake.calls()).toBe(0);
  });
});
