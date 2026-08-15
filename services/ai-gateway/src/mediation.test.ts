// services/ai-gateway/src/mediation.test.ts
//
// Unit tests for the gateway mediation boundary (Requirement 16.4).

import { describe, expect, it } from "vitest";

import { DirectModelAccessError } from "./errors.js";
import { directAccessGuard, GATEWAY_MEDIATION } from "./mediation.js";

describe("directAccessGuard", () => {
  it("permits an invocation carrying the gateway mediation token (Req 16.4)", () => {
    expect(() => directAccessGuard(GATEWAY_MEDIATION)).not.toThrow();
  });

  it("rejects an invocation with no mediation token (Req 16.4)", () => {
    expect(() => directAccessGuard(undefined)).toThrow(DirectModelAccessError);
  });

  it("rejects an invocation carrying a forged/foreign symbol (Req 16.4)", () => {
    const forged = Symbol("not-the-gateway");
    expect(() => directAccessGuard(forged)).toThrow(DirectModelAccessError);
  });
});
