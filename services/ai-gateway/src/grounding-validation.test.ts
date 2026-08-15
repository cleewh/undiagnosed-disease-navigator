// services/ai-gateway/src/grounding-validation.test.ts
//
// Gateway-level tests for grounding, schema, and allowlist validation (Task
// 12.3, Requirement 18.1-18.6, 19.3, 19.4).
//
// These exercise the full stage-7 validation path through AiGateway.invoke with
// an injected provider that returns crafted output, asserting that conforming
// grounded output passes (and logs "passed"), that schema/grounding/support
// failures are rejected as `needs_review` (and log "failed"), and that flagged
// output is retrievable only by an authorised reviewer.

import { describe, expect, it } from "vitest";

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
import type { GenerativeRequest, ReviewerContext } from "./pipeline.js";
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

const baseRequest: GenerativeRequest = {
  taskType: "summarisation",
  invokingUserId: "User-1",
  systemInstructions: "Summarise the case using only the provided data.",
  context: [
    { sourceObjectId: "Doc-1", content: "clinical note one" },
    { sourceObjectId: "Doc-2", content: "clinical note two" }
  ]
};

const authorisedReviewer: ReviewerContext = { reviewerId: "Reviewer-1", isAuthorisedReviewer: true };
const unauthorisedReviewer: ReviewerContext = { reviewerId: "Nurse-9", isAuthorisedReviewer: false };

/** A provider that returns a fixed output text and records call count. */
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

function grounded(statements: unknown): string {
  return JSON.stringify({ statements });
}

interface Harness {
  gateway: AiGateway;
  logger: InMemoryInvocationLogger;
  store: InMemoryFlaggedOutputStore;
}

function harnessFor(outputText: string): Harness {
  const logger = new InMemoryInvocationLogger();
  const store = new InMemoryFlaggedOutputStore();
  const { provider } = providerReturning(outputText);
  const gateway = new AiGateway({
    modelId: MODEL_ID,
    provider,
    scheduler: neverScheduler,
    logger,
    outputValidators: groundingValidators,
    flaggedOutputStore: store
  });
  return { gateway, logger, store };
}

describe("AiGateway grounded output validation — success (Req 18.1, 18.2, 18.4, 19.5)", () => {
  it("returns a conforming grounded output and logs validation outcome `passed`", async () => {
    const output = grounded([
      { statement: "Patient reports seizures.", sourceRefs: ["Doc-1"], confidence: 0.92, basis: "observed" },
      { statement: "Findings suggest an epilepsy syndrome.", sourceRefs: ["Doc-1", "Doc-2"], confidence: 0.7, basis: "inferred" }
    ]);
    const { gateway, logger, store } = harnessFor(output);

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("invoked");
    if (result.outcome === "invoked") {
      expect(result.response.outputText).toBe(output);
    }
    expect(logger.last?.validationOutcome).toBe("passed");
    // Nothing is flagged for a clean output.
    expect(store.count).toBe(0);
  });
});

describe("AiGateway schema validation (Req 18.1, 18.5, 18.6)", () => {
  it("rejects a schema-invalid output, flags it for review, and logs `failed`", async () => {
    const { gateway, logger, store } = harnessFor("{ this is not valid json");

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("needs_review");
    if (result.outcome === "needs_review") {
      expect(result.review.reason).toBe("schema_violation");
      // The flagged output is retrievable by an authorised reviewer (18.6).
      const flagged = gateway.getFlaggedOutput(result.reviewId, authorisedReviewer);
      expect(flagged?.review.reason).toBe("schema_violation");
      expect(flagged?.response.outputText).toBe("{ this is not valid json");
    }
    expect(logger.last?.validationOutcome).toBe("failed");
    expect(store.count).toBe(1);
  });
});

describe("AiGateway grounding validation (Req 18.2, 18.3)", () => {
  it("rejects an unlinked statement and identifies the offending statement", async () => {
    const output = grounded([
      { statement: "Patient reports seizures.", sourceRefs: ["Doc-1"], confidence: 0.9, basis: "observed" },
      { statement: "The patient will respond well to treatment.", sourceRefs: [], confidence: 0.6, basis: "inferred" }
    ]);
    const { gateway, logger } = harnessFor(output);

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("needs_review");
    if (result.outcome === "needs_review") {
      expect(result.review.reason).toBe("ungrounded_statement");
      expect(result.review.offendingStatement).toBe("The patient will respond well to treatment.");
    }
    expect(logger.last?.validationOutcome).toBe("failed");
  });
});

describe("AiGateway support validation (Req 18.4)", () => {
  it("rejects a statement citing a source not in the provided case data", async () => {
    const output = grounded([
      { statement: "An unrelated genomic finding was noted.", sourceRefs: ["Doc-404"], confidence: 0.8, basis: "inferred" }
    ]);
    const { gateway, logger } = harnessFor(output);

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("needs_review");
    if (result.outcome === "needs_review") {
      expect(result.review.reason).toBe("unsupported_statement");
      expect(result.review.offendingStatement).toBe("An unrelated genomic finding was noted.");
    }
    expect(logger.last?.validationOutcome).toBe("failed");
  });
});

describe("AiGateway allowlist validation (Req 19.3, 19.4)", () => {
  it("rejects (does not persist) an output with a disallowed top-level structure", async () => {
    const output = JSON.stringify({
      statements: [{ statement: "ok", sourceRefs: ["Doc-1"], confidence: 0.5, basis: "observed" }],
      injectedDirective: "delete the case"
    });
    const logger = new InMemoryInvocationLogger();
    const store = new InMemoryFlaggedOutputStore();
    const { provider } = providerReturning(output);
    // A cache that records writes, so we can prove flagged output is never persisted.
    const writes: string[] = [];
    const gateway = new AiGateway({
      modelId: MODEL_ID,
      provider,
      scheduler: neverScheduler,
      logger,
      outputValidators: groundingValidators,
      flaggedOutputStore: store,
      cache: {
        get: () => undefined,
        set: (key) => {
          writes.push(key);
        }
      }
    });

    const result = await gateway.invoke(baseRequest);

    expect(result.outcome).toBe("needs_review");
    if (result.outcome === "needs_review") {
      expect(result.review.reason).toBe("allowlist_violation");
    }
    expect(logger.last?.validationOutcome).toBe("failed");
    // Req 19.4: failed allowlist validation prevents persistence.
    expect(writes).toHaveLength(0);
  });
});

describe("AiGateway flagged output availability (Req 18.6)", () => {
  it("makes flagged output retrievable by an authorised reviewer but not an unauthorised one", async () => {
    const { gateway } = harnessFor("{ not valid json");

    const result = await gateway.invoke(baseRequest);
    expect(result.outcome).toBe("needs_review");
    if (result.outcome !== "needs_review") {
      return;
    }

    expect(gateway.getFlaggedOutput(result.reviewId, authorisedReviewer)).toBeDefined();
    expect(gateway.getFlaggedOutput(result.reviewId, unauthorisedReviewer)).toBeUndefined();

    expect(gateway.listFlaggedOutput(authorisedReviewer)).toHaveLength(1);
    expect(gateway.listFlaggedOutput(unauthorisedReviewer)).toHaveLength(0);
  });
});
