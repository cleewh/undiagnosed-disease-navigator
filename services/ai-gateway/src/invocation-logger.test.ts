// services/ai-gateway/src/invocation-logger.test.ts
//
// Unit tests for invocation logging through the gateway (Task 12.2, Req 19.5, 19.7).

import { describe, expect, it } from "vitest";

import { AiGateway } from "./gateway.js";
import { InMemoryInvocationLogger } from "./invocation-logger.js";
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

const neverScheduler: Scheduler = {
  setTimeout(): unknown {
    return {};
  },
  clearTimeout(): void {
    // no-op
  }
};

function successProvider(): ModelProvider {
  return {
    async invoke(request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      return { outputText: "grounded summary", modelId: request.modelId };
    }
  };
}

const baseRequest: GenerativeRequest = {
  taskType: "summarisation",
  invokingUserId: "User-1",
  systemInstructions: "Summarise the case using only the provided data.",
  context: [{ sourceObjectId: "Doc-1", content: "clinical note text" }]
};

describe("InMemoryInvocationLogger", () => {
  it("appends entries and exposes an ordered read-only snapshot", () => {
    const logger = new InMemoryInvocationLogger();
    logger.record({
      modelId: MODEL_ID,
      invokingUserId: "User-1",
      taskType: "summarisation",
      at: "2024-01-01T00:00:00.000Z",
      outcome: "invoked",
      validationOutcome: "not_validated",
      excludedContext: []
    });

    expect(logger.count).toBe(1);
    expect(logger.last?.invokingUserId).toBe("User-1");
    expect(logger.entries).toHaveLength(1);
  });
});

describe("AiGateway invocation logging (Req 19.5)", () => {
  it("records a log entry with model id, user id, timestamp and validation outcome on every invocation", async () => {
    const logger = new InMemoryInvocationLogger();
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider: successProvider(),
      scheduler: neverScheduler,
      logger,
      now: () => "2024-01-01T12:00:00.000Z"
    });

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("invoked");
    expect(logger.count).toBe(1);
    const entry = logger.last;
    expect(entry).toMatchObject({
      modelId: MODEL_ID,
      invokingUserId: "User-1",
      taskType: "summarisation",
      at: "2024-01-01T12:00:00.000Z",
      outcome: "invoked",
      validationOutcome: "not_validated"
    });
  });

  it("records a log entry even when the request is rejected before a model is invoked", async () => {
    const logger = new InMemoryInvocationLogger();
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider: successProvider(),
      scheduler: neverScheduler,
      logger
    });

    const result = await gateway.invoke({ ...baseRequest, taskType: "diagnosis" });

    expect(result.outcome).toBe("rejected");
    expect(logger.count).toBe(1);
    expect(logger.last).toMatchObject({
      outcome: "rejected",
      validationOutcome: "not_applicable",
      excludedContext: []
    });
  });

  it("excludes unauthorised context and records the exclusion in the log entry (Req 19.6, 19.7)", async () => {
    const logger = new InMemoryInvocationLogger();
    let seen: ModelRequest | undefined;
    const provider: ModelProvider = {
      async invoke(request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
        directAccessGuard(context.mediation);
        seen = request;
        return { outputText: "summary", modelId: request.modelId };
      }
    };
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider,
      scheduler: neverScheduler,
      logger
    });

    const result = await gateway.invoke({
      ...baseRequest,
      context: [
        { sourceObjectId: "Doc-1", content: "authorised note" },
        { sourceObjectId: "Doc-2", content: "unauthorised secret note" }
      ],
      authorizedScope: { authorizedSourceObjectIds: ["Doc-1"] }
    });

    expect(result.outcome).toBe("invoked");
    // The unauthorised content never reached the model.
    expect(seen?.userContent).toContain("authorised note");
    expect(seen?.userContent).not.toContain("unauthorised secret note");
    // The exclusion is recorded in the invocation log (Req 19.7).
    expect(logger.last?.excludedContext).toEqual([
      { sourceObjectId: "Doc-2", reason: "not-authorised" }
    ]);
  });
});
