// services/ai-gateway/src/allowlist-before-persistence.property.test.ts
//
// Property-based test for design Correctness Property 52 (Task 12.13,
// Requirements 19.3, 19.4).
//
// Feature: undiagnosed-disease-navigator, Property 52: Allowlist validation
// precedes persistence
//
// Design (Property 52): For any model output, it is persisted if and only if it
// matches an allowlisted response structure; a failing output is not persisted,
// the prior persisted state is retained, and the failure is recorded in the
// invocation log.
//
// In the gateway, PERSISTENCE of an accepted grounded output is the write into
// the grounded-input cache at stage 8 (gateway.ts): that write is reached only
// AFTER every output validator — including the allowlist validator — has passed
// at stage 7. The design note on stage 8 states this explicitly: "Only reached
// for validated output, so flagged output is never persisted to the cache
// (Req 19.4)." This test proves that ordering: allowlist validation runs before
// any persistence, so an allowlist-failing output is never written to the
// cache, the prior cache contents are retained unchanged, and the failure is
// logged with validation outcome "failed".
//
// The test drives the full stage-7/stage-8 path through AiGateway.invoke with an
// injected fake provider that returns a chosen response document, a scheduler
// that never fires (so the 30s timeout is inert), the real `groundingValidators`
// chain, a recording cache that observes every persistence, and an in-memory
// invocation logger. Generated outputs are otherwise valid (schema-conformant,
// grounded, and supported) so the SOLE determinant of the outcome is whether
// the output matches an allowlisted top-level structure.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { AiGateway } from "./gateway.js";
import { directAccessGuard } from "./mediation.js";
import { groundingValidators } from "./output-validation.js";
import { AI_RESPONSE_ALLOWED_KEYS, parseAiResponse } from "./response-schema.js";
import { InMemoryInvocationLogger } from "./invocation-logger.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GenerativeRequest, GroundedInputCache } from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";

const MODEL_ID = "anthropic.test-model-v1";

// The source objects the invoking user is authorised to access, and the context
// the gateway supplies to the model. Generated statements cite only these ids so
// grounding (>=1 ref) and support (refs in provided data) always pass and the
// only variable left is allowlist conformance.
const SOURCE_IDS = ["Doc-1", "Doc-2", "Doc-3"] as const;

const baseRequest: GenerativeRequest = {
  taskType: "summarisation",
  invokingUserId: "User-1",
  systemInstructions: "Summarise the case using only the provided data.",
  context: SOURCE_IDS.map((id) => ({ sourceObjectId: id, content: `clinical note ${id}` })),
  authorizedScope: { authorizedSourceObjectIds: [...SOURCE_IDS] }
};

// A scheduler whose timer never fires: the 30-second abort is never triggered,
// so the fake provider's synchronous response always wins the race.
const neverScheduler: Scheduler = {
  setTimeout(): unknown {
    return {};
  },
  clearTimeout(): void {
    // no-op
  }
};

/** A fake provider returning a fixed outputText once the mediation guard passes. */
function providerReturning(outputText: string): ModelProvider {
  return {
    async invoke(request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      return { outputText, modelId: request.modelId };
    }
  };
}

// A sentinel key holding "prior persisted state". It uses a namespace that can
// never collide with a gateway-computed cache key (a canonical hash), so a
// cache miss is guaranteed for the request under test and the sentinel lets us
// assert the prior persisted state is retained unchanged across a failing
// invocation.
const PRIOR_KEY = "PRIOR#persisted-state";
const priorResponse: ModelResponse = { outputText: "prior persisted output", modelId: MODEL_ID };

/**
 * A grounded-input cache that records every persistence (`set`) so the test can
 * assert whether — and in what order relative to validation — the gateway
 * persisted an output. Seeded with a prior entry so retention can be checked.
 */
class RecordingCache implements GroundedInputCache {
  readonly store = new Map<string, ModelResponse>();
  readonly setCalls: Array<{ key: string; value: ModelResponse }> = [];

  constructor() {
    this.store.set(PRIOR_KEY, priorResponse);
  }

  get(key: string): ModelResponse | undefined {
    return this.store.get(key);
  }

  set(key: string, value: ModelResponse): void {
    this.setCalls.push({ key, value });
    this.store.set(key, value);
  }
}

/** Oracle: an output matches an allowlisted structure iff it parses and carries only allowed top-level keys. */
function matchesAllowlist(outputText: string): boolean {
  const parsed = parseAiResponse(outputText);
  if (!parsed.ok) {
    return false;
  }
  const allowed = new Set<string>(AI_RESPONSE_ALLOWED_KEYS);
  return parsed.topLevelKeys.every((key) => allowed.has(key));
}

// A schema-conformant, grounded, and supported statement: non-empty text, at
// least one authorised sourceRef, confidence in [0, 1], and a valid basis.
const statementArb = fc.record({
  statement: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  sourceRefs: fc.uniqueArray(fc.constantFrom(...SOURCE_IDS), {
    minLength: 1,
    maxLength: SOURCE_IDS.length
  }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  basis: fc.constantFrom("observed", "inferred")
});

const statementsArb = fc.array(statementArb, { minLength: 1, maxLength: 5 });

// One or more extra top-level keys that are NOT on the response allowlist. Any
// document carrying these is a valid-schema document (extra keys parse fine) yet
// fails the allowlist validator.
const extraKeysArb = fc.dictionary(
  fc.string({ minLength: 1 }).filter((k) => k !== "statements"),
  fc.jsonValue(),
  { minKeys: 1, maxKeys: 3 }
);

// Allowlisted output: exactly the permitted `statements` top-level structure.
const allowlistedOutputArb = statementsArb.map((statements) => JSON.stringify({ statements }));

// Non-allowlisted output: a valid `statements` document plus extra disallowed
// top-level fields, so schema/grounding/support all pass and ONLY the allowlist
// check rejects it.
const nonAllowlistedOutputArb = fc
  .tuple(statementsArb, extraKeysArb)
  .map(([statements, extraKeys]) => JSON.stringify({ statements, ...extraKeys }));

const taggedOutputArb = fc.oneof(allowlistedOutputArb, nonAllowlistedOutputArb);

describe("Feature: undiagnosed-disease-navigator, Property 52: Allowlist validation precedes persistence", () => {
  // Validates: Requirements 19.3, 19.4
  it("persists output iff it matches an allowlisted structure; an allowlist-failing output is never persisted, the prior persisted state is retained, and the failure is logged", async () => {
    await fc.assert(
      fc.asyncProperty(taggedOutputArb, async (outputText) => {
        // Oracle decides allowlist conformance from the output alone; the
        // generators keep every other validator (schema, grounding, support)
        // passing so allowlist is the sole determinant.
        const isAllowlisted = matchesAllowlist(outputText);

        const cache = new RecordingCache();
        const logger = new InMemoryInvocationLogger();
        const gateway = new AiGateway({
          modelId: MODEL_ID,
          provider: providerReturning(outputText),
          scheduler: neverScheduler,
          outputValidators: groundingValidators,
          cache,
          logger
        });

        const result = await gateway.invoke(baseRequest);

        if (isAllowlisted) {
          // Passing the allowlist (and every other validator) means the output
          // is accepted and THEN persisted: exactly one cache write, carrying
          // the returned output, in addition to the retained prior entry.
          expect(result.outcome).toBe("invoked");
          expect(cache.setCalls).toHaveLength(1);
          const [persisted] = cache.setCalls;
          expect(persisted?.value.outputText).toBe(outputText);
          // The invocation log records a passed validation outcome.
          expect(logger.last?.validationOutcome).toBe("passed");
          expect(logger.last?.outcome).toBe("invoked");
        } else {
          // Failing the allowlist rejects the output for review. Because
          // validation precedes persistence, NO cache write ever occurs: the
          // failing output is not persisted.
          expect(result.outcome).toBe("needs_review");
          if (result.outcome === "needs_review") {
            expect(result.review.reason).toBe("allowlist_violation");
          }
          expect(cache.setCalls).toHaveLength(0);
          // The invocation log records the failure (Req 19.4).
          expect(logger.last?.validationOutcome).toBe("failed");
          expect(logger.last?.outcome).toBe("invoked");
        }

        // In every case the prior persisted state is retained unchanged: the
        // sentinel entry is still present with its original value, and the only
        // possible new entry is the one written for an accepted (allowlisted)
        // output.
        expect(cache.store.get(PRIOR_KEY)).toBe(priorResponse);
        expect(cache.store.size).toBe(isAllowlisted ? 2 : 1);
      }),
      { numRuns: 200 }
    );
  });
});
