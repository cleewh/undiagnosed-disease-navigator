// services/ai-gateway/src/config.ts
//
// Static configuration for the AI_Gateway (Requirement 16.2, 16.3, 16.6).
//
// The model identifier is read from an environment variable at initialisation.
// If the variable is absent or empty, the gateway rejects ALL generative
// invocations with a configuration-missing error and invokes NO model
// (Req 16.3). Bedrock invocations are bounded by a 30-second timeout (Req 16.6).

/**
 * Name of the environment variable that holds the Amazon Bedrock model
 * identifier the gateway invokes (Req 16.2). Chosen name: `AI_MODEL_ID`.
 */
export const AI_MODEL_ID_ENV_VAR = "AI_MODEL_ID";

/**
 * Maximum time, in milliseconds, the gateway waits for a Bedrock response
 * before it aborts the invocation and returns a model-invocation-failed error
 * (Req 16.6): 30 seconds.
 */
export const BEDROCK_TIMEOUT_MS = 30_000;

/**
 * A minimal, injectable view over environment variables so the gateway can be
 * unit tested without mutating the real process environment.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Resolve the configured model identifier from an environment source (defaults
 * to `process.env`).
 *
 * Returns the trimmed model id when present and non-empty, or `undefined` when
 * the variable is absent or blank. A `undefined` result is what drives the
 * configuration-missing rejection in the gateway (Req 16.3); this function
 * itself never throws and never invokes a model.
 */
export function resolveModelId(env: EnvSource = process.env): string | undefined {
  const raw = env[AI_MODEL_ID_ENV_VAR];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
