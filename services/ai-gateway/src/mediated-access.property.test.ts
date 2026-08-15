// services/ai-gateway/src/mediated-access.property.test.ts
//
// Property-based test for gateway-mediated generative access (AI_Gateway,
// design "mediation boundary"). The AI_Gateway is the SOLE path to a generative
// model: the mediation token (GATEWAY_MEDIATION) is held only by the gateway
// and is deliberately NOT exported from the package surface, so no component
// outside the gateway can construct a mediated invocation. Any attempt to reach
// a provider directly is rejected with a DirectModelAccessError.
//
// Feature: undiagnosed-disease-navigator, Property 45: All generative access is
// mediated by the gateway
//
// Validates: Requirements 16.4

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { directAccessGuard, type GatewayMediation } from "./mediation.js";
import { DirectModelAccessError } from "./errors.js";
import { BedrockModelProvider } from "./bedrock-provider.js";
import { AiGateway } from "./gateway.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GenerativeRequest } from "./pipeline.js";

const TEST_MODEL_ID = "test.model-id.v1";

/** A provider-ready request; its content is irrelevant to the mediation guard. */
const MODEL_REQUEST: ModelRequest = {
  modelId: TEST_MODEL_ID,
  taskType: "summarisation",
  systemInstructions: "trusted system instructions",
  userContent: "<<<CASE_DATA>>>\n[source:obj-1] content\n<<<CASE_DATA>>>"
};

/** A caller-facing request on an allowed task type, so only mediation is exercised. */
const GENERATIVE_REQUEST: GenerativeRequest = {
  taskType: "summarisation",
  invokingUserId: "user-1",
  systemInstructions: "trusted system instructions",
  context: []
};

/**
 * A spy provider that proves the gateway supplied the genuine mediation token:
 * it runs the same guard a real provider runs, and only counts the call when
 * the guard passes.
 */
class SpyModelProvider implements ModelProvider {
  public calls = 0;

  async invoke(
    request: ModelRequest,
    context: ModelInvocationContext
  ): Promise<ModelResponse> {
    // Would throw DirectModelAccessError if the gateway had not passed the real
    // GATEWAY_MEDIATION token; reaching the increment proves mediation held.
    directAccessGuard(context.mediation);
    this.calls += 1;
    return { outputText: "ok", modelId: request.modelId };
  }
}

/**
 * Arbitrary non-token mediation markers: every value here is provably NOT the
 * gateway's GATEWAY_MEDIATION token, because that token is a module-private
 * symbol unreachable from outside the gateway. Includes `undefined`, empty and
 * random objects, random strings, freshly forged symbols, and a symbol whose
 * description matches the real token's (identity, not description, is checked).
 */
const nonTokenMarkerArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(undefined),
  fc.constant({}),
  fc.string(),
  fc.object(),
  fc.string().map((description) => Symbol(description)),
  fc.constant(Symbol("udn.ai-gateway.mediation"))
);

describe("Property 45: All generative access is mediated by the gateway", () => {
  // Feature: undiagnosed-disease-navigator, Property 45: All generative access
  // is mediated by the gateway
  // Validates: Requirements 16.4
  it("rejects any un-mediated provider access, while gateway-mediated access reaches the provider", async () => {
    await fc.assert(
      fc.asyncProperty(nonTokenMarkerArb, async (marker) => {
        // (a) The mediation guard rejects any marker that is not the gateway
        // token (Req 16.4).
        expect(() =>
          directAccessGuard(marker as symbol | undefined)
        ).toThrow(DirectModelAccessError);

        // (b) A real provider invoked directly (bypassing the gateway) with such
        // a context is rejected before contacting any backend (Req 16.4).
        const provider = new BedrockModelProvider(TEST_MODEL_ID);
        const directContext: ModelInvocationContext = {
          mediation: marker as GatewayMediation,
          signal: new AbortController().signal
        };
        await expect(
          provider.invoke(MODEL_REQUEST, directContext)
        ).rejects.toBeInstanceOf(DirectModelAccessError);

        // (c) Positive control: because the gateway holds the real token, an
        // invocation routed through AiGateway.invoke DOES reach the provider,
        // exactly once. No externally supplied marker can reproduce this.
        const spy = new SpyModelProvider();
        const gateway = new AiGateway({ modelId: TEST_MODEL_ID, provider: spy });
        const result = await gateway.invoke(GENERATIVE_REQUEST);

        expect(result.outcome).toBe("invoked");
        expect(spy.calls).toBe(1);
      }),
      { numRuns: 100 }
    );
  });
});
