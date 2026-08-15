// services/ai-gateway/src/unconfirmed-output.property.test.ts
//
// Property-based test for design Correctness Property 55 (Task 12.16,
// Requirements 20.1, 20.2).
//
// Feature: undiagnosed-disease-navigator, Property 55: Invalid or low-confidence
// output is never confirmed
//
// Design (Property 55): For any AI output that fails validation or whose
// confidence is below the configured threshold, it is not stored as confirmed
// and never overwrites previously confirmed output; it is retained in an
// unconfirmed state and marked for review with the recorded reason (validation
// failure or below-threshold confidence).
//
// Requirement 20.1: IF an AI output fails schema/format validation or its
// confidence score is below the configured confidence threshold, THEN THE
// AI_Gateway SHALL NOT store the output as confirmed and SHALL retain the
// output in an unconfirmed state without overwriting any previously confirmed
// output.
//
// Requirement 20.2: WHEN an AI output fails validation or its confidence score
// is below the configured confidence threshold, THE AI_Gateway SHALL mark the
// output for review and SHALL record the reason for review (validation failure
// or below-threshold confidence).
//
// In the gateway, CONFIRMATION of an output is the write into the grounded-input
// cache at stage 8 (gateway.ts): reached only AFTER every output validator —
// the grounding chain (schema, allowlist, grounding, support) and the appended
// confidence gate — has passed at stage 7. An output that fails a validator, or
// whose overall (minimum-statement) confidence is below the configured
// threshold, is flagged as `needs_review`: it is NOT written to the cache
// (never confirmed), the prior confirmed cache contents are retained unchanged,
// and the flagged output is recorded with a review reason for an authorised
// reviewer.
//
// This test drives the full stage-7/stage-8 path through AiGateway.invoke with
// an injected fake provider that returns a chosen response document, a scheduler
// that never fires (so the 30s timeout is inert), the real `groundingValidators`
// chain plus a generated `confidenceThreshold`, a recording cache seeded with a
// prior confirmed entry, and a flagged-output store. Each generated scenario is
// tagged as one of:
//   - "confirmed"      -> valid, allowlisted, grounded, supported, and every
//                         statement confidence >= threshold; the output is
//                         confirmed (persisted).
//   - "invalid"        -> fails a validator (malformed, disallowed extra keys,
//                         ungrounded, or unsupported); flagged for review with a
//                         validation-failure reason.
//   - "low_confidence" -> valid/allowlisted/grounded/supported but at least one
//                         statement confidence < threshold; flagged for review
//                         with the below-threshold-confidence reason.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { AiGateway } from "./gateway.js";
import { directAccessGuard } from "./mediation.js";
import { groundingValidators } from "./output-validation.js";
import { InMemoryFlaggedOutputStore } from "./flagged-output-store.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type {
  GenerativeRequest,
  GroundedInputCache,
  ReviewerContext,
  ValidationFailureReason
} from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";

const MODEL_ID = "anthropic.test-model-v1";

// The source objects the invoking user is authorised to access, and the context
// the gateway supplies to the model. Grounded scenarios cite only these ids so
// grounding (>=1 ref) and support (refs in provided data) pass, leaving the
// SOLE determinant of the outcome the generated failure mode / confidence.
const SOURCE_IDS = ["Doc-1", "Doc-2", "Doc-3"] as const;

// A source id NOT in the authorised context; citing it triggers the support
// validator (Req 18.4) -> a validation failure independent of confidence.
const UNKNOWN_SOURCE_ID = "Doc-UNKNOWN";

const baseRequest: GenerativeRequest = {
  taskType: "summarisation",
  invokingUserId: "User-1",
  systemInstructions: "Summarise the case using only the provided data.",
  context: SOURCE_IDS.map((id) => ({ sourceObjectId: id, content: `clinical note ${id}` })),
  authorizedScope: { authorizedSourceObjectIds: [...SOURCE_IDS] }
};

// An authorised reviewer may retrieve flagged (unconfirmed) output (Req 18.6),
// used here to prove flagged output is retained in an unconfirmed, reviewable
// state.
const AUTHORISED_REVIEWER: ReviewerContext = {
  reviewerId: "Reviewer-1",
  isAuthorisedReviewer: true
};

// The set of reasons that denote a VALIDATION failure (as opposed to the
// confidence gate). An "invalid" scenario must be flagged with one of these.
const VALIDATION_FAILURE_REASONS: readonly ValidationFailureReason[] = [
  "schema_violation",
  "ungrounded_statement",
  "unsupported_statement",
  "allowlist_violation"
];

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

// A sentinel key holding "prior confirmed output". Its namespace can never
// collide with a gateway-computed cache key (a canonical hash), so the request
// under test always misses the cache and this entry lets us assert the prior
// confirmed output is never overwritten (Req 20.1).
const PRIOR_KEY = "PRIOR#confirmed-state";
const priorResponse: ModelResponse = { outputText: "prior confirmed output", modelId: MODEL_ID };

/**
 * A grounded-input cache that records every confirmation (`set`) so the test can
 * assert whether — and with what value — the gateway confirmed an output.
 * Seeded with a prior confirmed entry so non-overwrite can be checked.
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

const nonEmptyStringArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

// A schema-conformant, grounded, supported statement whose confidence is drawn
// from `confidenceArb` (letting each scenario control confidence relative to the
// threshold).
function statementArb(confidenceArb: fc.Arbitrary<number>): fc.Arbitrary<unknown> {
  return fc.record({
    statement: nonEmptyStringArb,
    sourceRefs: fc.uniqueArray(fc.constantFrom(...SOURCE_IDS), {
      minLength: 1,
      maxLength: SOURCE_IDS.length
    }),
    confidence: confidenceArb,
    basis: fc.constantFrom("observed", "inferred")
  });
}

// Statements whose confidence is at or above the threshold (so the confidence
// gate passes and only structural validity matters).
function statementsAtOrAbove(threshold: number): fc.Arbitrary<unknown[]> {
  return fc.array(statementArb(fc.double({ min: threshold, max: 1, noNaN: true })), {
    minLength: 1,
    maxLength: 5
  });
}

type TaggedOutput =
  | { readonly kind: "confirmed"; readonly outputText: string }
  | { readonly kind: "invalid"; readonly outputText: string }
  | { readonly kind: "low_confidence"; readonly outputText: string };

// Extra top-level keys that are NOT on the response allowlist -> a valid-schema
// document that fails the allowlist validator (Req 19.3, 19.4).
const extraKeysArb = fc.dictionary(
  fc.string({ minLength: 1 }).filter((k) => k !== "statements"),
  fc.jsonValue(),
  { minKeys: 1, maxKeys: 3 }
);

// Malformed or non-object documents -> a schema violation (Req 18.5).
const malformedOutputArb = fc.constantFrom(
  "this is not valid json",
  "{ not: json",
  "[1, 2, 3]",
  "42",
  '"just a string"'
);

/** Confirmed scenario: valid, allowlisted, grounded, supported, all conf >= threshold. */
function confirmedArb(threshold: number): fc.Arbitrary<TaggedOutput> {
  return statementsAtOrAbove(threshold).map((statements) => ({
    kind: "confirmed" as const,
    outputText: JSON.stringify({ statements })
  }));
}

/** Low-confidence scenario: otherwise valid, but at least one statement below threshold. */
function lowConfidenceArb(threshold: number): fc.Arbitrary<TaggedOutput> {
  const belowThresholdStatementArb = statementArb(
    fc.double({ min: 0, max: threshold, maxExcluded: true, noNaN: true })
  );
  return fc
    .tuple(belowThresholdStatementArb, statementsAtOrAbove(threshold))
    .map(([low, rest]) => ({
      kind: "low_confidence" as const,
      outputText: JSON.stringify({ statements: [low, ...rest] })
    }));
}

/** Invalid scenario: fails a validator regardless of confidence (conf >= threshold). */
function invalidArb(threshold: number): fc.Arbitrary<TaggedOutput> {
  const confArb = fc.double({ min: threshold, max: 1, noNaN: true });

  // Schema violation: malformed / non-object JSON.
  const schemaViolationArb = malformedOutputArb.map((outputText) => ({
    kind: "invalid" as const,
    outputText
  }));

  // Allowlist violation: a valid statements document plus disallowed extra keys.
  const allowlistViolationArb = fc
    .tuple(statementsAtOrAbove(threshold), extraKeysArb)
    .map(([statements, extraKeys]) => ({
      kind: "invalid" as const,
      outputText: JSON.stringify({ statements, ...extraKeys })
    }));

  // Ungrounded: a statement linked to no source object (empty sourceRefs).
  const ungroundedStatementArb = fc.record({
    statement: nonEmptyStringArb,
    sourceRefs: fc.constant([] as string[]),
    confidence: confArb,
    basis: fc.constantFrom("observed", "inferred")
  });
  const ungroundedArb = fc
    .tuple(ungroundedStatementArb, statementsAtOrAbove(threshold))
    .map(([ungrounded, rest]) => ({
      kind: "invalid" as const,
      outputText: JSON.stringify({ statements: [ungrounded, ...rest] })
    }));

  // Unsupported: a statement citing a source not present in the provided data.
  const unsupportedStatementArb = fc.record({
    statement: nonEmptyStringArb,
    sourceRefs: fc.constant([UNKNOWN_SOURCE_ID]),
    confidence: confArb,
    basis: fc.constantFrom("observed", "inferred")
  });
  const unsupportedArb = fc
    .tuple(unsupportedStatementArb, statementsAtOrAbove(threshold))
    .map(([unsupported, rest]) => ({
      kind: "invalid" as const,
      outputText: JSON.stringify({ statements: [unsupported, ...rest] })
    }));

  return fc.oneof(schemaViolationArb, allowlistViolationArb, ungroundedArb, unsupportedArb);
}

// A threshold strictly inside (0, 1) so both "at or above" and "strictly below"
// confidence ranges are non-empty.
const thresholdArb = fc.double({ min: 0.1, max: 0.9, noNaN: true });

// Threshold chained with a tagged output scenario built against it.
const scenarioArb = thresholdArb.chain((threshold) =>
  fc
    .oneof(confirmedArb(threshold), invalidArb(threshold), lowConfidenceArb(threshold))
    .map((tagged) => ({ threshold, tagged }))
);

describe("Feature: undiagnosed-disease-navigator, Property 55: Invalid or low-confidence output is never confirmed", () => {
  // Validates: Requirements 20.1, 20.2
  it("never confirms invalid or below-threshold output: it is not persisted, prior confirmed output is preserved, and it is retained unconfirmed for review with the recorded reason", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ threshold, tagged }) => {
        const cache = new RecordingCache();
        const flaggedStore = new InMemoryFlaggedOutputStore();
        const gateway = new AiGateway({
          modelId: MODEL_ID,
          provider: providerReturning(tagged.outputText),
          scheduler: neverScheduler,
          outputValidators: groundingValidators,
          confidenceThreshold: threshold,
          cache,
          flaggedOutputStore: flaggedStore
        });

        const result = await gateway.invoke(baseRequest);

        if (tagged.kind === "confirmed") {
          // A valid, sufficiently-confident output is confirmed: exactly one
          // cache write carrying the returned output, and nothing is flagged.
          expect(result.outcome).toBe("invoked");
          expect(cache.setCalls).toHaveLength(1);
          const [confirmed] = cache.setCalls;
          expect(confirmed?.value.outputText).toBe(tagged.outputText);
          expect(flaggedStore.count).toBe(0);
          // The prior confirmed output plus the newly confirmed output.
          expect(cache.store.get(PRIOR_KEY)).toBe(priorResponse);
          expect(cache.store.size).toBe(2);
          return;
        }

        // Invalid OR low-confidence output is NEVER confirmed (Req 20.1): the
        // gateway flags it for review rather than returning an invocation.
        expect(result.outcome).toBe("needs_review");
        if (result.outcome !== "needs_review") {
          throw new Error("expected a needs_review outcome for non-confirmed output");
        }

        // It is marked for review with a RECORDED reason (Req 20.2). A
        // validation failure carries a validation reason; a low-confidence
        // failure carries the below-threshold-confidence reason.
        if (tagged.kind === "invalid") {
          expect(VALIDATION_FAILURE_REASONS).toContain(result.review.reason);
        } else {
          expect(result.review.reason).toBe("below_threshold_confidence");
        }
        expect(typeof result.reviewId).toBe("string");
        expect(result.reviewId.length).toBeGreaterThan(0);

        // It is NOT stored as confirmed (Req 20.1): no cache write ever occurs.
        expect(cache.setCalls).toHaveLength(0);

        // The previously confirmed output is retained, never overwritten
        // (Req 20.1): the sentinel entry is unchanged and it is the only entry.
        expect(cache.store.get(PRIOR_KEY)).toBe(priorResponse);
        expect(cache.store.size).toBe(1);

        // It is retained in an unconfirmed state, available for review
        // (Req 20.1, 20.2): the flagged output is recorded and retrievable by an
        // authorised reviewer, carrying the verbatim output and the same reason.
        const flagged = gateway.getFlaggedOutput(result.reviewId, AUTHORISED_REVIEWER);
        expect(flagged).toBeDefined();
        expect(flagged?.response.outputText).toBe(tagged.outputText);
        expect(flagged?.review.reason).toBe(result.review.reason);
        expect(flaggedStore.list(AUTHORISED_REVIEWER)).toHaveLength(1);
      }),
      { numRuns: 200 }
    );
  });
});
