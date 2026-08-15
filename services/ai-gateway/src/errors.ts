// services/ai-gateway/src/errors.ts
//
// Structured AI_Gateway errors (Requirement 16.3, 16.4, 16.5, 16.6).
//
// Every generative rejection carries a stable, machine-readable `code` so
// callers can branch on the reason without string matching, and a
// human-readable message that names the requirement. Configuration-missing,
// task-not-permitted, and direct-access rejections all occur WITHOUT invoking
// any model; invocation-failed covers Bedrock errors and 30-second timeouts.

/** Machine-readable classification of an AI_Gateway rejection. */
export type AiGatewayErrorCode =
  /** Model id env var absent/empty at init; no model invoked (Req 16.3). */
  | "MODEL_CONFIG_MISSING"
  /** Requested task type is not on the allowlist; no model invoked (Req 16.5). */
  | "TASK_TYPE_NOT_PERMITTED"
  /** A model invocation was attempted without routing through the gateway (Req 16.4). */
  | "DIRECT_MODEL_ACCESS_NOT_PERMITTED"
  /** Bedrock returned an error or did not respond within 30 seconds (Req 16.6). */
  | "MODEL_INVOCATION_FAILED";

/** Base class for all structured AI_Gateway errors. */
export abstract class AiGatewayError extends Error {
  /** Stable, machine-readable error code. */
  abstract readonly code: AiGatewayErrorCode;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Raised/returned when the model identifier environment variable is absent or
 * empty at initialisation. The gateway rejects all generative invocations and
 * invokes no model (Req 16.3).
 */
export class ModelConfigMissingError extends AiGatewayError {
  readonly code = "MODEL_CONFIG_MISSING";

  constructor(envVarName: string) {
    super(
      `AI_Gateway model configuration is missing (Req 16.3): environment variable "${envVarName}" is absent or empty, so no generative model can be invoked.`
    );
  }
}

/**
 * Raised/returned when a generative request names a task type that is not on
 * the allowlist. The gateway rejects the request and invokes no model
 * (Req 16.5).
 */
export class TaskTypeNotPermittedError extends AiGatewayError {
  readonly code = "TASK_TYPE_NOT_PERMITTED";
  /** The rejected task type. */
  readonly taskType: string;

  constructor(taskType: string, allowed: readonly string[]) {
    super(
      `Generative task type "${taskType}" is not permitted (Req 16.5); permitted task types are: ${allowed.join(", ")}.`
    );
    this.taskType = taskType;
  }
}

/**
 * Raised when a model provider is invoked without routing through the
 * AI_Gateway (Req 16.4). The gateway is the sole path to Bedrock; any direct
 * invocation attempt is rejected with this error.
 */
export class DirectModelAccessError extends AiGatewayError {
  readonly code = "DIRECT_MODEL_ACCESS_NOT_PERMITTED";

  constructor() {
    super(
      "Direct model access is not permitted (Req 16.4); all generative invocations must be mediated by the AI_Gateway."
    );
  }
}

/**
 * Raised/returned when Amazon Bedrock returns an error or does not respond
 * within the 30-second timeout. The gateway aborts the invocation and returns
 * this error (Req 16.6).
 */
export class ModelInvocationFailedError extends AiGatewayError {
  readonly code = "MODEL_INVOCATION_FAILED";
  /** Whether the failure was caused by the 30-second timeout elapsing. */
  readonly timedOut: boolean;
  /** The underlying provider error, when the failure was not a timeout. */
  override readonly cause?: unknown;

  constructor(reason: { timedOut: boolean; cause?: unknown }) {
    super(
      reason.timedOut
        ? "Model invocation failed (Req 16.6): Amazon Bedrock did not respond within 30 seconds; the invocation was aborted."
        : "Model invocation failed (Req 16.6): Amazon Bedrock returned an error; the invocation was aborted."
    );
    this.timedOut = reason.timedOut;
    if (reason.cause !== undefined) {
      this.cause = reason.cause;
    }
  }
}
