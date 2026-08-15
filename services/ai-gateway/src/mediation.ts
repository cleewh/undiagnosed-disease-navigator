// services/ai-gateway/src/mediation.ts
//
// Gateway mediation boundary (Requirement 16.4).
//
// The AI_Gateway is the SOLE path to Amazon Bedrock. To make "only the gateway
// invokes the provider" an enforceable, testable guarantee rather than a
// convention, every `ModelProvider.invoke` call must carry a mediation marker
// that only the gateway holds.
//
// The marker is a module-private symbol. The gateway imports it and passes it
// on every invocation; the provider verifies it via `directAccessGuard`. The
// symbol is deliberately NOT re-exported from the package entry point
// (`index.ts`), so no component outside this package can obtain it — any direct
// invocation attempt therefore fails the guard with a DirectModelAccessError
// (Req 16.4). In-package tests may import this module directly to exercise both
// the mediated and the direct-access paths (Property 45).

import { DirectModelAccessError } from "./errors.js";

/**
 * The mediation marker the gateway attaches to every provider invocation.
 *
 * Only code with access to this symbol (the gateway) can construct a mediated
 * invocation context. It is intentionally unexported from the public package
 * surface; treat it as an internal capability token.
 */
export const GATEWAY_MEDIATION: unique symbol = Symbol("udn.ai-gateway.mediation");

/** The type of the gateway mediation marker. */
export type GatewayMediation = typeof GATEWAY_MEDIATION;

/**
 * Reject any provider invocation that is not mediated by the AI_Gateway
 * (Req 16.4).
 *
 * A model provider calls this at the top of `invoke`. When `marker` is the
 * gateway's mediation token the call proceeds; otherwise it throws a
 * {@link DirectModelAccessError}, so a component attempting to reach the model
 * directly (without the gateway) is rejected.
 *
 * @throws {DirectModelAccessError} when `marker` is not the gateway token.
 */
export function directAccessGuard(marker: symbol | undefined): asserts marker is GatewayMediation {
  if (marker !== GATEWAY_MEDIATION) {
    throw new DirectModelAccessError();
  }
}
