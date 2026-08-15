// services/ai-gateway/src/bedrock-provider.ts
//
// Amazon Bedrock model provider (Requirement 16.1, 16.2, 16.4, 16.6).
//
// This is the production `ModelProvider`. It invokes a model exclusively
// through Amazon Bedrock (Req 16.1) using the SDK v3 Converse API, reads the
// model identifier from an environment variable at initialisation (Req 16.2),
// rejects any direct (non-gateway) invocation via the mediation guard
// (Req 16.4), and forwards the gateway's abort signal to the SDK so the
// 30-second timeout aborts the in-flight request (Req 16.6).
//
// It is never exercised by unit tests (which inject a fake provider), so it
// requires AWS credentials only at runtime, never at build or test time.

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandOutput
} from "@aws-sdk/client-bedrock-runtime";

import { AI_MODEL_ID_ENV_VAR, resolveModelId, type EnvSource } from "./config.js";
import { directAccessGuard } from "./mediation.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";

/** Extract and concatenate the text blocks from a Converse response. */
function extractOutputText(output: ConverseCommandOutput): string {
  const content: readonly ContentBlock[] = output.output?.message?.content ?? [];
  const parts: string[] = [];
  for (const block of content) {
    const text = (block as { text?: string }).text;
    if (typeof text === "string") {
      parts.push(text);
    }
  }
  return parts.join("");
}

/**
 * `ModelProvider` backed by a live Amazon Bedrock runtime client (Req 16.1).
 *
 * The model identifier is fixed at construction; use {@link fromEnv} to read it
 * from `AI_MODEL_ID`. Construction never contacts AWS.
 */
export class BedrockModelProvider implements ModelProvider {
  readonly #client: BedrockRuntimeClient;
  readonly #modelId: string;

  constructor(modelId: string, client?: BedrockRuntimeClient) {
    if (modelId.trim().length === 0) {
      throw new TypeError("BedrockModelProvider requires a non-empty model id.");
    }
    this.#modelId = modelId;
    this.#client = client ?? new BedrockRuntimeClient({});
  }

  /**
   * Construct a provider from the environment, reading the model identifier
   * from `AI_MODEL_ID` (Req 16.2). Returns `undefined` when the variable is
   * absent or empty, so the caller can drive the configuration-missing
   * rejection without invoking a model (Req 16.3).
   */
  static fromEnv(
    env: EnvSource = process.env,
    client?: BedrockRuntimeClient
  ): BedrockModelProvider | undefined {
    const modelId = resolveModelId(env);
    if (modelId === undefined) {
      return undefined;
    }
    return new BedrockModelProvider(modelId, client);
  }

  /** The environment variable this provider reads its model id from (Req 16.2). */
  static get envVarName(): string {
    return AI_MODEL_ID_ENV_VAR;
  }

  /** The resolved model identifier this provider invokes. */
  get modelId(): string {
    return this.#modelId;
  }

  /**
   * Invoke the configured Bedrock model (Req 16.1). Rejects immediately if the
   * call is not gateway-mediated (Req 16.4). The gateway's abort signal is
   * forwarded to the SDK, so a timeout aborts the in-flight request (Req 16.6);
   * any SDK error propagates to the gateway, which maps it to a
   * model-invocation-failed error.
   */
  async invoke(
    request: ModelRequest,
    context: ModelInvocationContext
  ): Promise<ModelResponse> {
    directAccessGuard(context.mediation);

    const command = new ConverseCommand({
      modelId: this.#modelId,
      system: [{ text: request.systemInstructions }],
      messages: [{ role: "user", content: [{ text: request.userContent }] }]
    });

    const output = await this.#client.send(command, { abortSignal: context.signal });

    return {
      outputText: extractOutputText(output),
      modelId: this.#modelId
    };
  }
}
