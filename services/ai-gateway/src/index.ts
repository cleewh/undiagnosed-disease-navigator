// services/ai-gateway/src/index.ts
//
// Public entry point for the AI_Gateway package (@udn/ai-gateway).
//
// The AI_Gateway is the SOLE path to Amazon Bedrock (Requirement 16.4): no
// other component may call a model provider directly. Accordingly this surface
// exports the gateway as the single entry point, the model-provider seam, the
// Bedrock provider (for dependency injection/wiring only), and the structured
// errors and task-type allowlist.
//
// It deliberately does NOT export the internal `GATEWAY_MEDIATION` token from
// mediation.ts. Because the mediation marker cannot be obtained from outside
// this package, any attempt to invoke a provider without routing through the
// gateway fails `directAccessGuard` with a DirectModelAccessError (Req 16.4).
// The `directAccessGuard` function and its type ARE exported so the boundary is
// documented and testable.

export * from "./config.js";
export * from "./task-types.js";
export * from "./errors.js";
export * from "./model-provider.js";
export * from "./pipeline.js";
export * from "./context-filter.js";
export * from "./prompt-builder.js";
export * from "./response-schema.js";
export * from "./output-validation.js";
export * from "./failure-handling.js";
export * from "./flagged-output-store.js";
export * from "./grounded-input-cache.js";
export * from "./invocation-logger.js";
export * from "./scheduler.js";
export * from "./bedrock-provider.js";
export * from "./gateway.js";

// Export the guard and its type, but NOT the GATEWAY_MEDIATION token, so the
// gateway remains the only holder of the mediation capability (Req 16.4).
export { directAccessGuard, type GatewayMediation } from "./mediation.js";
