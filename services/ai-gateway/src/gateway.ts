// services/ai-gateway/src/gateway.ts
//
// AI_Gateway core (Requirement 16.1, 16.2, 16.3, 16.5, 16.6).
//
// The gateway is the SOLE path to Amazon Bedrock. This module implements the
// core request pipeline: task-type allowlist check (16.5), model-configuration
// check (16.2, 16.3), gateway-mediated provider invocation (16.1, 16.4), and a
// 30-second timeout/abort with error handling (16.6). Every other
// responsibility is delegated to an injectable seam with a no-op default (see
// pipeline.ts), so tasks 12.2-12.5 extend the pipeline without touching this
// core.

import { BedrockModelProvider } from "./bedrock-provider.js";
import {
  AI_MODEL_ID_ENV_VAR,
  BEDROCK_TIMEOUT_MS,
  resolveModelId,
  type EnvSource
} from "./config.js";
import {
  ModelConfigMissingError,
  ModelInvocationFailedError,
  TaskTypeNotPermittedError
} from "./errors.js";
import { scopeAwareContextFilter } from "./context-filter.js";
import {
  confidenceGateValidator,
  DEFAULT_MAX_INVOCATION_ATTEMPTS
} from "./failure-handling.js";
import { canonicalGroundedInputKey } from "./grounded-input-cache.js";
import { InMemoryFlaggedOutputStore } from "./flagged-output-store.js";
import { InMemoryInvocationLogger } from "./invocation-logger.js";
import { GATEWAY_MEDIATION } from "./mediation.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "./model-provider.js";
import {
  noGroundedInputCache,
  type ContextFilter,
  type ExcludedContextRef,
  type FlaggedOutput,
  type FlaggedOutputStore,
  type GenerativeInvocationResult,
  type GenerativeRequest,
  type GroundedInputCache,
  type InvocationLogger,
  type OutputValidator,
  type PromptBuilder,
  type ReviewerContext,
  type ReviewIndication,
  type ValidationOutcome
} from "./pipeline.js";
import { securePromptBuilder } from "./prompt-builder.js";
import { systemScheduler, type Scheduler } from "./scheduler.js";
import { ALLOWED_TASK_TYPES, isAllowedTaskType } from "./task-types.js";

/** Construction options for the {@link AiGateway}. */
export interface AiGatewayOptions {
  /** Resolved Bedrock model id, or `undefined` when unconfigured (Req 16.2, 16.3). */
  readonly modelId: string | undefined;
  /** The model backend to invoke; required whenever `modelId` is set (Req 16.1). */
  readonly provider?: ModelProvider | undefined;
  /** Timeout before the invocation is aborted; defaults to 30 seconds (Req 16.6). */
  readonly timeoutMs?: number;
  /** Injectable timer used to arm the timeout; defaults to the global scheduler. */
  readonly scheduler?: Scheduler;
  /** Clock for log timestamps; defaults to `new Date().toISOString()`. */
  readonly now?: () => string;
  /** 12.2 seam: restrict context to authorised data (default: passthrough). */
  readonly contextFilter?: ContextFilter;
  /** 12.2 seam: build delimited prompt segments (default: minimal builder). */
  readonly promptBuilder?: PromptBuilder;
  /** 12.2 seam: invocation logging (default: no-op). */
  readonly logger?: InvocationLogger;
  /** 12.3/12.4 seam: output validators run after invocation (default: none). */
  readonly outputValidators?: readonly OutputValidator[];
  /** 12.3 seam: retention of flagged output for authorised reviewers (Req 18.6). */
  readonly flaggedOutputStore?: FlaggedOutputStore;
  /** 12.5 seam: grounded-input cache (default: never hits). */
  readonly cache?: GroundedInputCache;
  /**
   * 12.4 confidence gating (Req 20.1, 20.2). When set, output whose overall
   * confidence (the minimum statement confidence) falls below this threshold is
   * marked for review as `below_threshold_confidence` rather than returned as an
   * invocation. Must be in [0, 1]. When omitted, no confidence gating applies.
   */
  readonly confidenceThreshold?: number;
  /**
   * 12.4 bounded retry (Req 20.3, 20.4). Maximum number of provider invocation
   * attempts before the gateway gives up and returns an error indication;
   * defaults to {@link DEFAULT_MAX_INVOCATION_ATTEMPTS} (3). Must be a positive
   * integer.
   */
  readonly maxAttempts?: number;
}

/** Overrides accepted by {@link AiGateway.fromEnv}. */
export interface AiGatewayFromEnvOptions
  extends Omit<AiGatewayOptions, "modelId" | "provider"> {
  /** Environment source to read the model id from; defaults to `process.env`. */
  readonly env?: EnvSource;
  /** Optional pre-built provider (e.g. a Bedrock client with custom config). */
  readonly provider?: ModelProvider;
}

/**
 * The AI_Gateway. Construct directly for tests (inject a fake provider) or via
 * {@link AiGateway.fromEnv} for production (reads `AI_MODEL_ID` and wires a
 * {@link BedrockModelProvider}).
 */
export class AiGateway {
  readonly #modelId: string | undefined;
  readonly #provider: ModelProvider | undefined;
  readonly #timeoutMs: number;
  readonly #scheduler: Scheduler;
  readonly #now: () => string;
  readonly #contextFilter: ContextFilter;
  readonly #promptBuilder: PromptBuilder;
  readonly #logger: InvocationLogger;
  readonly #outputValidators: readonly OutputValidator[];
  readonly #flaggedOutputStore: FlaggedOutputStore;
  readonly #cache: GroundedInputCache;
  readonly #maxAttempts: number;

  constructor(options: AiGatewayOptions) {
    if (options.modelId !== undefined && options.provider === undefined) {
      // A configured model id with no provider is a wiring error: the gateway
      // could never invoke the model it claims to have.
      throw new TypeError(
        "AiGateway configured with a model id but no ModelProvider; supply a provider."
      );
    }
    const timeoutMs = options.timeoutMs ?? BEDROCK_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError("AiGateway timeoutMs must be a positive, finite number.");
    }
    this.#modelId = options.modelId;
    this.#provider = options.provider;
    this.#timeoutMs = timeoutMs;
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#contextFilter = options.contextFilter ?? scopeAwareContextFilter;
    this.#promptBuilder = options.promptBuilder ?? securePromptBuilder;
    this.#logger = options.logger ?? new InMemoryInvocationLogger();
    // 12.4 confidence gating (Req 20.1, 20.2): when a threshold is configured,
    // append a confidence gate AFTER the caller's validators, so schema and
    // grounding failures are reported with their own reasons first and the
    // confidence gate applies to structurally valid output. The gate flows
    // through the same stage-7 needs_review path as the other validators.
    const configuredValidators = options.outputValidators ?? [];
    this.#outputValidators =
      options.confidenceThreshold === undefined
        ? configuredValidators
        : [...configuredValidators, confidenceGateValidator(options.confidenceThreshold)];
    this.#flaggedOutputStore = options.flaggedOutputStore ?? new InMemoryFlaggedOutputStore();
    this.#cache = options.cache ?? noGroundedInputCache;
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_INVOCATION_ATTEMPTS;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError("AiGateway maxAttempts must be a positive integer.");
    }
    this.#maxAttempts = maxAttempts;
  }

  /**
   * Build a gateway from the environment (Req 16.2). Reads `AI_MODEL_ID`; when
   * it is absent or empty, the gateway is still constructed but rejects every
   * generative invocation with a configuration-missing error and invokes no
   * model (Req 16.3).
   */
  static fromEnv(options: AiGatewayFromEnvOptions = {}): AiGateway {
    const env = options.env ?? process.env;
    const modelId = resolveModelId(env);
    const provider =
      options.provider ??
      (modelId === undefined ? undefined : new BedrockModelProvider(modelId));
    const { env: _env, provider: _provider, ...rest } = options;
    void _env;
    void _provider;
    return new AiGateway({ modelId, provider, ...rest });
  }

  /** Whether a model identifier is configured (Req 16.2, 16.3). */
  get isModelConfigured(): boolean {
    return this.#modelId !== undefined;
  }

  /**
   * Mediate a generative model invocation (Req 16.1). Rejects, without invoking
   * any model, when the task type is not on the allowlist (Req 16.5) or the
   * model id is unconfigured (Req 16.3); aborts and reports failure when Bedrock
   * errors or does not respond within the timeout (Req 16.6).
   */
  async invoke(request: GenerativeRequest): Promise<GenerativeInvocationResult> {
    // Stage 1 - task-type allowlist (Req 16.5). No model is invoked on failure.
    if (!isAllowedTaskType(request.taskType)) {
      const error = new TaskTypeNotPermittedError(request.taskType, ALLOWED_TASK_TYPES);
      this.#log(request, "rejected", "not_applicable", []);
      return { outcome: "rejected", error };
    }
    const taskType = request.taskType;

    // Stage 2 - model configuration (Req 16.2, 16.3). No model is invoked on failure.
    if (this.#modelId === undefined || this.#provider === undefined) {
      const error = new ModelConfigMissingError(AI_MODEL_ID_ENV_VAR);
      this.#log(request, "rejected", "not_applicable", []);
      return { outcome: "rejected", error };
    }
    const modelId = this.#modelId;
    const provider = this.#provider;

    // Stage 3 - context restriction (12.2, Req 19.6/19.7). Any portion the
    // invoking user is not authorised to access is excluded and recorded.
    const filtered = this.#contextFilter.filter(request);
    const context = filtered.included;
    const excludedContext = filtered.excluded;

    // Stage 4 - prompt construction (12.2, Req 19.1/19.2). System instructions
    // and untrusted case content are placed in separate, delimited segments.
    const modelRequest = this.#promptBuilder.build(request, context, modelId, taskType);

    // Stage 5 - grounded-input cache seam (12.5, Req 32.2/32.3). The key is a
    // canonical hash of the task type, model id, AUTHORISED context (each
    // included item's sourceObjectId + content), and prompt template version, so
    // an identical grounded input hits regardless of insignificant ordering.
    const cacheKey = canonicalGroundedInputKey({
      taskType,
      modelId,
      context,
      promptTemplateVersion: request.promptTemplateVersion
    });
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined) {
      this.#log(request, "invoked", "not_validated", excludedContext);
      return { outcome: "invoked", modelId, taskType, response: cached };
    }

    // Stage 6 - invoke the provider with the 30-second timeout/abort (Req 16.1,
    // 16.6) under bounded retry (Req 20.3). A failed attempt (provider error or
    // timeout) is retried up to `#maxAttempts` times; each failure is logged
    // with a reason and timestamp (Req 20.5). If every attempt fails, the
    // gateway gives up and returns an error indication (Req 20.4).
    let response: ModelResponse | undefined;
    let lastFailure: ModelInvocationFailedError | undefined;
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        response = await this.#invokeWithTimeout(provider, modelRequest);
        break;
      } catch (error) {
        const failed =
          error instanceof ModelInvocationFailedError
            ? error
            : new ModelInvocationFailedError({ timedOut: false, cause: error });
        lastFailure = failed;
        // Req 20.5: log each failed attempt with a reason and timestamp.
        this.#log(
          request,
          "rejected",
          "not_applicable",
          excludedContext,
          failed.timedOut ? "invocation_timeout" : "provider_error"
        );
      }
    }
    if (response === undefined) {
      // Req 20.4: the configured maximum number of attempts was exhausted
      // without success; present an error indication reporting the invocation
      // could not be completed. No model output exists, so nothing is stored
      // and no workflow state can advance (Req 20.6).
      return {
        outcome: "rejected",
        error: lastFailure ?? new ModelInvocationFailedError({ timedOut: false })
      };
    }

    // Stage 7 - output validation seam (12.3, Req 18, 19.3/19.4). Validators run
    // in order against the AUTHORISED context that was supplied to the model.
    // The first rejection wins: the entire output is rejected and NOT persisted
    // (no cache write), the prior state is retained, the flagged output and its
    // review indication are recorded for an authorised reviewer (18.6), the
    // invocation is logged with validation outcome "failed" (19.4, 19.5), and a
    // `needs_review` result is returned distinct from a successful invocation.
    for (const validator of this.#outputValidators) {
      const result = await validator.validate(response, request, context);
      if (result.status === "rejected") {
        const review: ReviewIndication = {
          reason: result.reason,
          detail: result.detail,
          ...(result.offendingStatement !== undefined
            ? { offendingStatement: result.offendingStatement }
            : {})
        };
        const reviewId = this.#flaggedOutputStore.record({
          response,
          review,
          invokingUserId: request.invokingUserId,
          taskType,
          at: this.#now()
        });
        this.#log(request, "invoked", "failed", excludedContext);
        return { outcome: "needs_review", modelId, taskType, response, reviewId, review };
      }
    }
    // Every configured validator passed (including the 12.4 confidence gate,
    // when a threshold is configured). With no validators configured the output
    // is not validated at this stage.
    const validationOutcome: ValidationOutcome =
      this.#outputValidators.length > 0 ? "passed" : "not_validated";

    // Stage 8 - store in the cache seam (12.5). Only reached for validated
    // output, so flagged output is never persisted to the cache (Req 19.4).
    this.#cache.set(cacheKey, response);

    // Stage 9 - invocation logging (12.2, Req 19.5, 19.7).
    this.#log(request, "invoked", validationOutcome, excludedContext);

    return { outcome: "invoked", modelId, taskType, response };
  }

  /**
   * Retrieve a flagged output by its review id, on behalf of a reviewer
   * (Req 18.6). Returns the flagged output and its review indication only when
   * the reviewer is authorised; an unauthorised principal receives `undefined`,
   * so flagged output is never disclosed outside the review boundary.
   */
  getFlaggedOutput(reviewId: string, reviewer: ReviewerContext): FlaggedOutput | undefined {
    return this.#flaggedOutputStore.retrieve(reviewId, reviewer);
  }

  /**
   * List every flagged output awaiting review, on behalf of a reviewer
   * (Req 18.6). Returns the entries only when the reviewer is authorised; an
   * unauthorised principal receives an empty list.
   */
  listFlaggedOutput(reviewer: ReviewerContext): readonly FlaggedOutput[] {
    return this.#flaggedOutputStore.list(reviewer);
  }

  /**
   * Invoke the provider under a bounded timeout (Req 16.6). Arms an abort signal
   * and a timeout via the injected scheduler; whichever settles first wins. On
   * timeout the provider is aborted and a timed-out failure is raised; a
   * provider error is wrapped as a non-timeout failure.
   */
  async #invokeWithTimeout(
    provider: ModelProvider,
    request: ModelRequest
  ): Promise<ModelResponse> {
    const controller = new AbortController();
    let timer: ReturnType<Scheduler["setTimeout"]> | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = this.#scheduler.setTimeout(() => {
        // Reject with the timeout error FIRST so the race settles as a timeout,
        // then abort the provider. Aborting first would synchronously reject the
        // provider's promise and let its (non-timeout) error win the race.
        reject(new ModelInvocationFailedError({ timedOut: true }));
        controller.abort();
      }, this.#timeoutMs);
    });

    try {
      return await Promise.race([
        provider.invoke(request, { mediation: GATEWAY_MEDIATION, signal: controller.signal }),
        timeout
      ]);
    } finally {
      if (timer !== undefined) {
        this.#scheduler.clearTimeout(timer);
      }
    }
  }

  /**
   * Emit an invocation log entry through the logging seam (Req 19.5, 19.7,
   * 20.5). Each entry carries the model id, invoking user id, timestamp,
   * validation outcome, any authorisation-excluded context, and - for a failed
   * invocation attempt - a failure reason (Req 20.5). A request rejected before
   * a model is contacted produces one entry; a failed invocation under retry
   * produces one entry per failed attempt.
   */
  #log(
    request: GenerativeRequest,
    outcome: "invoked" | "rejected",
    validationOutcome: ValidationOutcome,
    excludedContext: readonly ExcludedContextRef[],
    failureReason?: string
  ): void {
    this.#logger.record({
      modelId: this.#modelId,
      invokingUserId: request.invokingUserId,
      taskType: request.taskType,
      at: this.#now(),
      outcome,
      validationOutcome,
      excludedContext,
      ...(failureReason !== undefined ? { failureReason } : {})
    });
  }
}
