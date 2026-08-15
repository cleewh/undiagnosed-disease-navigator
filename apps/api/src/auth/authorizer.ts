// apps/api/src/auth/authorizer.ts
//
// Cognito-backed Lambda authorizer for the Undiagnosed Disease Navigator
// (Auth_Service, design "Auth_Service, Cognito, and the RBAC Matrix").
//
// Responsibilities (task 5.1):
//  - validate the Cognito JWT presented on every API call (Req 21.1, 21.2);
//  - enforce a 15-minute inactivity session timeout (Req 21.6);
//  - extract the caller's identity and role(s) and inject them into the
//    request context so downstream authorization (tasks 5.2/5.3) can enforce
//    the RBAC matrix (Req 21.1).
//
// Per-operation permission enforcement (the RBAC matrix / authorize() engine)
// is deliberately NOT implemented here; that is tasks 5.2 and 5.3. This module
// only establishes authenticated identity + roles + session validity.
//
// The JWT verification is abstracted behind {@link TokenVerifier} so the core
// decision logic ({@link authorizeToken}) is fully unit-testable with an
// injected fake and never requires a network round-trip to the Cognito JWKS
// endpoint.

import type {
  APIGatewayTokenAuthorizerEvent,
  APIGatewayAuthorizerResult,
  PolicyDocument,
} from "aws-lambda";
import { USER_ROLES, type UserRole } from "@udn/domain";

/** Inactivity window after which a session must re-authenticate (Req 21.6). */
export const SESSION_INACTIVITY_TIMEOUT_SECONDS = 15 * 60;

/**
 * The subset of verified Cognito access-token claims the authorizer relies on.
 * Additional claims may be present; they are ignored.
 */
export interface AuthorizerClaims {
  /** Cognito subject (stable unique user id). */
  readonly sub: string;
  /** Cognito username, when present. */
  readonly username?: string;
  /** Preferred username / email, when present. */
  readonly email?: string;
  /** Cognito groups; one group per role (design: 7 role groups). */
  readonly "cognito:groups"?: readonly string[];
  /** Seconds since epoch of the original authentication event. */
  readonly auth_time?: number;
  /** Seconds since epoch the token was issued. */
  readonly iat?: number;
  /** Seconds since epoch the token expires. */
  readonly exp?: number;
  /**
   * Optional sliding "last activity" marker (seconds since epoch). When
   * present it takes precedence over {@link auth_time}/{@link iat} for the
   * inactivity computation, allowing the session store to extend a session on
   * activity. Surfaced as the custom claim `custom:lastActivityAt`.
   */
  readonly lastActivityAt?: number;
  readonly [claim: string]: unknown;
}

/**
 * Verifies a raw bearer token and returns its claims, or throws if the token
 * is missing, malformed, has an invalid signature, or fails Cognito checks.
 * Implementations must not be assumed to be side-effect free.
 */
export interface TokenVerifier {
  verify(token: string): Promise<AuthorizerClaims>;
}

/** Identity + roles injected into the API Gateway request context. */
export interface AuthContext {
  readonly userId: string;
  readonly username: string;
  readonly roles: readonly UserRole[];
}

/** Reason a token was rejected, surfaced for logging/telemetry. */
export type DenyReason =
  | "missing-token"
  | "invalid-token"
  | "session-expired"
  | "session-inactive";

/** Result of the pure authorization decision. */
export type AuthorizeResult =
  | { readonly outcome: "allow"; readonly context: AuthContext }
  | { readonly outcome: "deny"; readonly reason: DenyReason };

/** Options controlling {@link authorizeToken}. */
export interface AuthorizeOptions {
  /** Current time in seconds since epoch. Injected for deterministic tests. */
  readonly nowSeconds: number;
  /** Inactivity timeout in seconds. Defaults to 15 minutes (Req 21.6). */
  readonly inactivityTimeoutSeconds?: number;
}

/**
 * Map a set of Cognito group names to the recognised {@link UserRole} values.
 * Group names that are not one of the seven roles are ignored. Order follows
 * the canonical {@link USER_ROLES} ordering and duplicates are removed.
 */
export function rolesFromGroups(
  groups: readonly string[] | undefined,
): UserRole[] {
  if (!groups || groups.length === 0) return [];
  const present = new Set(groups);
  return USER_ROLES.filter((role) => present.has(role));
}

/**
 * Core, network-free authorization decision.
 *
 * Validates the token via the injected {@link TokenVerifier}, enforces token
 * expiry and the inactivity timeout (Req 21.6), and extracts identity + roles
 * (Req 21.1). Returns a structured allow/deny result; it never throws for an
 * unauthenticated caller (verifier errors are converted to a deny).
 */
export async function authorizeToken(
  rawToken: string | undefined,
  verifier: TokenVerifier,
  options: AuthorizeOptions,
): Promise<AuthorizeResult> {
  const token = normaliseToken(rawToken);
  if (!token) {
    return { outcome: "deny", reason: "missing-token" };
  }

  let claims: AuthorizerClaims;
  try {
    claims = await verifier.verify(token);
  } catch {
    return { outcome: "deny", reason: "invalid-token" };
  }

  if (!claims.sub) {
    return { outcome: "deny", reason: "invalid-token" };
  }

  const { nowSeconds } = options;
  const inactivityTimeout =
    options.inactivityTimeoutSeconds ?? SESSION_INACTIVITY_TIMEOUT_SECONDS;

  // Absolute token expiry.
  if (typeof claims.exp === "number" && nowSeconds >= claims.exp) {
    return { outcome: "deny", reason: "session-expired" };
  }

  // 15-minute inactivity timeout (Req 21.6). Prefer an explicit sliding
  // activity marker, then fall back to the auth/issue time.
  const lastActivity =
    claims.lastActivityAt ?? claims.auth_time ?? claims.iat;
  if (
    typeof lastActivity === "number" &&
    nowSeconds - lastActivity > inactivityTimeout
  ) {
    return { outcome: "deny", reason: "session-inactive" };
  }

  const context: AuthContext = {
    userId: claims.sub,
    username: claims.username ?? claims.email ?? claims.sub,
    roles: rolesFromGroups(claims["cognito:groups"]),
  };
  return { outcome: "allow", context };
}

/** Trim and strip an optional `Bearer ` prefix from an Authorization value. */
function normaliseToken(rawToken: string | undefined): string | undefined {
  if (!rawToken) return undefined;
  const trimmed = rawToken.trim();
  if (trimmed.length === 0) return undefined;
  const withoutScheme = trimmed.replace(/^Bearer\s+/i, "").trim();
  return withoutScheme.length > 0 ? withoutScheme : undefined;
}

/** Build an API Gateway policy document allowing/denying a single method. */
function policyDocument(
  effect: "Allow" | "Deny",
  resource: string,
): PolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Action: "execute-api:Invoke",
        Effect: effect,
        Resource: resource,
      },
    ],
  };
}

/**
 * Serialise an {@link AuthContext} into the string-only value map API Gateway
 * forwards to downstream integrations. Roles are comma-joined; downstream
 * authorization (task 5.3) splits them back into a role list.
 */
export function serialiseContext(
  context: AuthContext,
): Record<string, string> {
  return {
    userId: context.userId,
    username: context.username,
    roles: context.roles.join(","),
  };
}

/**
 * Build an API Gateway TOKEN-authorizer handler around a {@link TokenVerifier}.
 *
 * On a successful decision it returns an Allow policy carrying the caller's
 * identity + roles in the context. On any deny it throws `Unauthorized`, the
 * signal API Gateway maps to a 401 response, so unauthenticated, expired, and
 * inactive sessions are all forced to re-authenticate (Req 21.1, 21.6).
 */
export function buildAuthorizerHandler(deps: {
  readonly verifier: TokenVerifier;
  readonly now?: () => number;
  readonly inactivityTimeoutSeconds?: number;
}) {
  return async (
    event: APIGatewayTokenAuthorizerEvent,
  ): Promise<APIGatewayAuthorizerResult> => {
    const nowMs = deps.now?.() ?? Date.now();
    const nowSeconds = Math.floor(nowMs / 1000);

    const result = await authorizeToken(event.authorizationToken, deps.verifier, {
      nowSeconds,
      inactivityTimeoutSeconds: deps.inactivityTimeoutSeconds,
    });

    if (result.outcome === "deny") {
      // API Gateway convention: throwing this exact message yields HTTP 401.
      throw new Error("Unauthorized");
    }

    return {
      principalId: result.context.userId,
      policyDocument: policyDocument("Allow", event.methodArn),
      context: serialiseContext(result.context),
    };
  };
}
