// services/ai-gateway/src/model-provider.ts
//
// Model provider abstraction (Requirement 16.1).
//
// A `ModelProvider` is the narrow seam between the AI_Gateway pipeline and a
// concrete model backend (Amazon Bedrock in production, a fake in tests). The
// gateway is the only caller: every `invoke` receives a mediation context that
// the provider verifies (Req 16.4) plus an abort signal the gateway uses to
// enforce the 30-second timeout (Req 16.6).
//
// Keeping this interface minimal lets task 12.1 stay focused while later tasks
// layer prompt construction (12.2), grounding/schema validation (12.3), failure
// handling (12.4), and caching (12.5) on top of it in the gateway, not here.

import type { GatewayMediation } from "./mediation.js";
import type { GenerativeTaskType } from "./task-types.js";

/**
 * A fully constructed, provider-ready model request.
 *
 * The gateway builds this from a caller's {@link GenerativeRequest} via the
 * prompt-builder seam. System instructions and untrusted content are kept in
 * separate fields so the prompt-injection defence in task 12.2 (Req 19.2) can
 * present document content strictly as data.
 */
export interface ModelRequest {
  /** The resolved Bedrock model identifier to invoke (Req 16.1, 16.2). */
  readonly modelId: string;
  /** The permitted generative task type (Req 16.5). */
  readonly taskType: GenerativeTaskType;
  /** Trusted system instructions segment (never derived from case documents). */
  readonly systemInstructions: string;
  /** Untrusted content segment, presented to the model only as data. */
  readonly userContent: string;
}

/** A raw model response as returned by a provider, before gateway validation. */
export interface ModelResponse {
  /** The model's generated text output. */
  readonly outputText: string;
  /** The model identifier that produced the response. */
  readonly modelId: string;
}

/**
 * Per-invocation context supplied by the gateway to a provider.
 *
 * Carries the mediation marker that proves the call routed through the gateway
 * (Req 16.4) and the abort signal the gateway triggers on timeout (Req 16.6).
 */
export interface ModelInvocationContext {
  /** Mediation marker proving the call is gateway-mediated (Req 16.4). */
  readonly mediation: GatewayMediation;
  /** Abort signal the gateway aborts on the 30-second timeout (Req 16.6). */
  readonly signal: AbortSignal;
}

/**
 * The abstraction the AI_Gateway invokes to reach a generative model
 * (Req 16.1). Implementations MUST call `directAccessGuard(context.mediation)`
 * before contacting any backend and MUST honour `context.signal` so the gateway
 * can abort on timeout.
 */
export interface ModelProvider {
  /**
   * Invoke the underlying model. Rejects if the call is not gateway-mediated
   * (Req 16.4) and should reject/settle promptly when `context.signal` aborts
   * (Req 16.6).
   */
  invoke(request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse>;
}
