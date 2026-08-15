// Unit tests for the Cognito Lambda authorizer decision logic (task 5.1).
// These verify JWT validation delegation, the 15-minute inactivity timeout
// (Req 21.6), and identity/role extraction (Req 21.1) without any network I/O.

import { describe, it, expect } from "vitest";
import type { APIGatewayTokenAuthorizerEvent } from "aws-lambda";
import {
  authorizeToken,
  buildAuthorizerHandler,
  rolesFromGroups,
  serialiseContext,
  SESSION_INACTIVITY_TIMEOUT_SECONDS,
  type AuthorizerClaims,
  type TokenVerifier,
} from "./authorizer.js";

const NOW = 1_700_000_000; // fixed reference time in seconds

/** A verifier that returns the given claims for any non-throwing token. */
function fakeVerifier(claims: AuthorizerClaims): TokenVerifier {
  return { verify: async () => claims };
}

/** A verifier that always rejects (simulates an invalid signature). */
const rejectingVerifier: TokenVerifier = {
  verify: async () => {
    throw new Error("invalid signature");
  },
};

function baseClaims(overrides: Partial<AuthorizerClaims> = {}): AuthorizerClaims {
  return {
    sub: "user-123",
    username: "dr.who",
    "cognito:groups": ["ClinicalGeneticist"],
    auth_time: NOW,
    iat: NOW,
    exp: NOW + 3600,
    ...overrides,
  };
}

describe("rolesFromGroups", () => {
  it("maps recognised Cognito groups to UserRole values", () => {
    expect(rolesFromGroups(["ClinicalGeneticist", "Researcher"])).toEqual([
      "ClinicalGeneticist",
      "Researcher",
    ]);
  });

  it("ignores unrecognised groups and removes duplicates", () => {
    expect(
      rolesFromGroups(["Administrator", "not-a-role", "Administrator"]),
    ).toEqual(["Administrator"]);
  });

  it("returns an empty list for missing or empty groups", () => {
    expect(rolesFromGroups(undefined)).toEqual([]);
    expect(rolesFromGroups([])).toEqual([]);
  });

  it("returns roles in canonical order regardless of input order", () => {
    expect(rolesFromGroups(["Researcher", "Bioinformatician"])).toEqual([
      "Bioinformatician",
      "Researcher",
    ]);
  });
});

describe("authorizeToken", () => {
  it("denies when no token is present", async () => {
    const result = await authorizeToken(undefined, fakeVerifier(baseClaims()), {
      nowSeconds: NOW,
    });
    expect(result).toEqual({ outcome: "deny", reason: "missing-token" });
  });

  it("denies when the token value is blank", async () => {
    const result = await authorizeToken("   ", fakeVerifier(baseClaims()), {
      nowSeconds: NOW,
    });
    expect(result).toEqual({ outcome: "deny", reason: "missing-token" });
  });

  it("denies when the verifier rejects the token", async () => {
    const result = await authorizeToken("bad.jwt", rejectingVerifier, {
      nowSeconds: NOW,
    });
    expect(result).toEqual({ outcome: "deny", reason: "invalid-token" });
  });

  it("denies a token whose claims lack a subject", async () => {
    const result = await authorizeToken(
      "t",
      fakeVerifier(baseClaims({ sub: "" })),
      { nowSeconds: NOW },
    );
    expect(result).toEqual({ outcome: "deny", reason: "invalid-token" });
  });

  it("allows a valid, active token and extracts identity + roles", async () => {
    const result = await authorizeToken("t", fakeVerifier(baseClaims()), {
      nowSeconds: NOW + 60,
    });
    expect(result).toEqual({
      outcome: "allow",
      context: {
        userId: "user-123",
        username: "dr.who",
        roles: ["ClinicalGeneticist"],
      },
    });
  });

  it("strips a Bearer scheme prefix from the token", async () => {
    const result = await authorizeToken(
      "Bearer abc.def.ghi",
      fakeVerifier(baseClaims()),
      { nowSeconds: NOW },
    );
    expect(result.outcome).toBe("allow");
  });

  it("falls back to email then sub for the username", async () => {
    const emailOnly = await authorizeToken(
      "t",
      fakeVerifier(baseClaims({ username: undefined, email: "e@x.org" })),
      { nowSeconds: NOW },
    );
    expect(emailOnly.outcome === "allow" && emailOnly.context.username).toBe(
      "e@x.org",
    );

    const subOnly = await authorizeToken(
      "t",
      fakeVerifier(baseClaims({ username: undefined, email: undefined })),
      { nowSeconds: NOW },
    );
    expect(subOnly.outcome === "allow" && subOnly.context.username).toBe(
      "user-123",
    );
  });

  it("allows an authenticated caller with no recognised role (empty roles)", async () => {
    const result = await authorizeToken(
      "t",
      fakeVerifier(baseClaims({ "cognito:groups": ["no-such-group"] })),
      { nowSeconds: NOW },
    );
    expect(result.outcome === "allow" && result.context.roles).toEqual([]);
  });

  describe("session validity (Req 21.6)", () => {
    it("denies an expired token", async () => {
      const result = await authorizeToken(
        "t",
        fakeVerifier(baseClaims({ exp: NOW })),
        { nowSeconds: NOW },
      );
      expect(result).toEqual({ outcome: "deny", reason: "session-expired" });
    });

    it("denies a session inactive beyond 15 minutes", async () => {
      const result = await authorizeToken(
        "t",
        fakeVerifier(baseClaims({ exp: NOW + 100_000 })),
        { nowSeconds: NOW + SESSION_INACTIVITY_TIMEOUT_SECONDS + 1 },
      );
      expect(result).toEqual({ outcome: "deny", reason: "session-inactive" });
    });

    it("allows a session exactly at the inactivity boundary", async () => {
      const result = await authorizeToken(
        "t",
        fakeVerifier(baseClaims({ exp: NOW + 100_000 })),
        { nowSeconds: NOW + SESSION_INACTIVITY_TIMEOUT_SECONDS },
      );
      expect(result.outcome).toBe("allow");
    });

    it("prefers the sliding lastActivityAt marker over auth_time", async () => {
      // auth_time is old, but recent activity keeps the session alive.
      const result = await authorizeToken(
        "t",
        fakeVerifier(
          baseClaims({
            auth_time: NOW - 100_000,
            iat: NOW - 100_000,
            exp: NOW + 100_000,
            lastActivityAt: NOW,
          }),
        ),
        { nowSeconds: NOW + 60 },
      );
      expect(result.outcome).toBe("allow");
    });

    it("honours a custom inactivity timeout", async () => {
      const result = await authorizeToken(
        "t",
        fakeVerifier(baseClaims({ exp: NOW + 100_000 })),
        { nowSeconds: NOW + 61, inactivityTimeoutSeconds: 60 },
      );
      expect(result).toEqual({ outcome: "deny", reason: "session-inactive" });
    });
  });
});

describe("serialiseContext", () => {
  it("comma-joins roles into string-only context values", () => {
    expect(
      serialiseContext({
        userId: "u1",
        username: "n",
        roles: ["Administrator", "Researcher"],
      }),
    ).toEqual({ userId: "u1", username: "n", roles: "Administrator,Researcher" });
  });
});

describe("buildAuthorizerHandler", () => {
  const methodArn =
    "arn:aws:execute-api:us-east-1:123456789012:abc/prod/GET/cases";

  function event(token: string): APIGatewayTokenAuthorizerEvent {
    return {
      type: "TOKEN",
      authorizationToken: token,
      methodArn,
    };
  }

  it("returns an Allow policy with injected identity/roles on success", async () => {
    const handler = buildAuthorizerHandler({
      verifier: fakeVerifier(baseClaims()),
      now: () => NOW * 1000,
    });
    const result = await handler(event("good.jwt"));
    expect(result.principalId).toBe("user-123");
    expect(result.policyDocument.Statement[0]).toMatchObject({
      Effect: "Allow",
      Resource: methodArn,
    });
    expect(result.context).toEqual({
      userId: "user-123",
      username: "dr.who",
      roles: "ClinicalGeneticist",
    });
  });

  it("throws Unauthorized when the token is invalid", async () => {
    const handler = buildAuthorizerHandler({
      verifier: rejectingVerifier,
      now: () => NOW * 1000,
    });
    await expect(handler(event("bad"))).rejects.toThrow("Unauthorized");
  });

  it("throws Unauthorized when the session is inactive", async () => {
    const handler = buildAuthorizerHandler({
      verifier: fakeVerifier(baseClaims({ exp: NOW + 100_000 })),
      now: () => (NOW + SESSION_INACTIVITY_TIMEOUT_SECONDS + 5) * 1000,
    });
    await expect(handler(event("stale"))).rejects.toThrow("Unauthorized");
  });
});
