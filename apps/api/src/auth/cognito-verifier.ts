// apps/api/src/auth/cognito-verifier.ts
//
// Runtime {@link TokenVerifier} backed by `aws-jwt-verify`, plus the env-wired
// default Lambda handler. This module performs the real Cognito JWKS-backed
// signature/claim verification and is intentionally kept separate from the
// pure decision logic in `authorizer.ts` so unit tests never touch the
// network.

import { CognitoJwtVerifier } from "aws-jwt-verify";
import {
  buildAuthorizerHandler,
  SESSION_INACTIVITY_TIMEOUT_SECONDS,
  type AuthorizerClaims,
  type TokenVerifier,
} from "./authorizer.js";

/**
 * Adapts `aws-jwt-verify`'s Cognito verifier to the {@link TokenVerifier}
 * interface. The underlying verifier caches the JWKS and validates the token's
 * signature, issuer, audience/client, and `token_use` on each call.
 */
export class CognitoTokenVerifier implements TokenVerifier {
  private readonly verifier: ReturnType<typeof CognitoJwtVerifier.create>;

  constructor(config: {
    userPoolId: string;
    clientId: string;
    tokenUse?: "access" | "id";
  }) {
    this.verifier = CognitoJwtVerifier.create({
      userPoolId: config.userPoolId,
      clientId: config.clientId,
      tokenUse: config.tokenUse ?? "access",
    });
  }

  async verify(token: string): Promise<AuthorizerClaims> {
    const payload = await this.verifier.verify(token);
    return payload as unknown as AuthorizerClaims;
  }
}

/** Read a required environment variable or throw a configuration error. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Lambda entrypoint. Constructs a {@link CognitoTokenVerifier} from the
 * environment (USER_POOL_ID, CLIENT_ID, optional TOKEN_USE and
 * SESSION_INACTIVITY_TIMEOUT_SECONDS) on first invocation and delegates to the
 * shared authorizer handler. Deployment-time bundling of this handler is wired
 * by the API stack (task 34.1).
 */
let cachedHandler: ReturnType<typeof buildAuthorizerHandler> | undefined;

export const handler = async (
  ...args: Parameters<ReturnType<typeof buildAuthorizerHandler>>
): ReturnType<ReturnType<typeof buildAuthorizerHandler>> => {
  if (!cachedHandler) {
    const tokenUseEnv = process.env.TOKEN_USE;
    const tokenUse = tokenUseEnv === "id" ? "id" : "access";
    const timeoutEnv = Number.parseInt(
      process.env.SESSION_INACTIVITY_TIMEOUT_SECONDS ?? "",
      10,
    );
    cachedHandler = buildAuthorizerHandler({
      verifier: new CognitoTokenVerifier({
        userPoolId: requireEnv("USER_POOL_ID"),
        clientId: requireEnv("CLIENT_ID"),
        tokenUse,
      }),
      inactivityTimeoutSeconds: Number.isFinite(timeoutEnv) && timeoutEnv > 0
        ? timeoutEnv
        : SESSION_INACTIVITY_TIMEOUT_SECONDS,
    });
  }
  return cachedHandler(...args);
};
