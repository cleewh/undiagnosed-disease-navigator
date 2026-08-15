// services/ai-gateway/src/statement-grounding.property.test.ts
//
// Property-based test for design Correctness Property 49 (Task 12.10,
// Requirements 18.2, 18.3, 18.4).
//
// Feature: undiagnosed-disease-navigator, Property 49: Every AI statement is
// grounded and supported
//
// Design (Property 49): For any AI-generated output, it is accepted if and only
// if every statement links to at least one provided source object and is
// supported by the provided case data; an unlinked or unsupported statement
// causes rejection, marks the output for review, retains source data unchanged,
// and identifies the offending statement.
//
// This drives the full stage-7 validation path through AiGateway.invoke with an
// injected fake provider that returns a chosen response document, a scheduler
// that never fires (so the timeout is inert), the real `groundingValidators`
// chain, and a request whose context supplies a known set of authorised
// sourceObjectIds. The generator builds statement sets in which each statement
// is either grounded+supported (links only to provided sources), ungrounded
// (empty sourceRefs), or unsupported (cites a source outside the provided set),
// and the assertion mirrors the validator order (grounding before support).

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { AiGateway } from "./gateway.js";
import { groundingValidators } from "./output-validation.js";
import { directAccessGuard } from "./mediation.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GenerativeRequest } from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";

const MODEL_ID = "anthropic.test-model-v1";

// A scheduler whose timer never fires, so the 30s timeout stays inert and the
// injected provider's synchronous response always wins the race.
const neverScheduler: Scheduler = {
  setTimeout(): unknown {
    return {};
  },
  clearTimeout(): void {
    // no-op
  }
};

// A provider that returns a fixed, pre-chosen response document verbatim.
function providerReturning(outputText: string): ModelProvider {
  return {
    async invoke(request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      return { outputText, modelId: request.modelId };
    }
  };
}

type StatementKind = "grounded" | "ungrounded" | "unsupported";

interface StatementSpec {
  readonly kind: StatementKind;
  readonly sourceRefs: readonly string[];
  readonly confidence: number;
  readonly basis: "observed" | "inferred";
}

interface Scenario {
  readonly providedIds: readonly string[];
  readonly specs: readonly StatementSpec[];
}

// Build a scenario: a known set of authorised (provided) source ids plus a set
// of statements, each grounded+supported, ungrounded, or unsupported. The
// "unsupported" namespace ("Ext-*") is disjoint from the provided namespace
// ("Doc-*") so an unsupported cite is guaranteed to be outside the provided
// case data.
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .integer({ min: 1, max: 4 })
  .chain((providedCount) => {
    const providedIds = Array.from({ length: providedCount }, (_, i) => `Doc-${i}`);
    const providedRefArb = fc.constantFrom(...providedIds);
    const extRefArb = fc.integer({ min: 0, max: 9 }).map((j) => `Ext-${j}`);
    const confidenceArb = fc.double({ min: 0, max: 1, noNaN: true });
    const basisArb = fc.constantFrom<"observed" | "inferred">("observed", "inferred");

    const groundedSpecArb: fc.Arbitrary<StatementSpec> = fc.record({
      kind: fc.constant<StatementKind>("grounded"),
      sourceRefs: fc.uniqueArray(providedRefArb, { minLength: 1, maxLength: providedCount }),
      confidence: confidenceArb,
      basis: basisArb
    });

    const ungroundedSpecArb: fc.Arbitrary<StatementSpec> = fc.record({
      kind: fc.constant<StatementKind>("ungrounded"),
      sourceRefs: fc.constant<readonly string[]>([]),
      confidence: confidenceArb,
      basis: basisArb
    });

    // Unsupported: at least one ref outside the provided set, optionally mixed
    // with valid provided refs. Non-empty, so it passes grounding and is only
    // caught by the support validator.
    const unsupportedSpecArb: fc.Arbitrary<StatementSpec> = fc.record({
      kind: fc.constant<StatementKind>("unsupported"),
      sourceRefs: fc
        .tuple(
          fc.uniqueArray(providedRefArb, { minLength: 0, maxLength: providedCount }),
          fc.uniqueArray(extRefArb, { minLength: 1, maxLength: 3 })
        )
        .map(([prov, ext]) => [...prov, ...ext]),
      confidence: confidenceArb,
      basis: basisArb
    });

    const specArb = fc.oneof(groundedSpecArb, ungroundedSpecArb, unsupportedSpecArb);

    return fc.record({
      providedIds: fc.constant(providedIds),
      specs: fc.array(specArb, { minLength: 1, maxLength: 6 })
    });
  });

describe("Feature: undiagnosed-disease-navigator, Property 49: Every AI statement is grounded and supported", () => {
  // Validates: Requirements 18.2, 18.3, 18.4
  it("accepts output iff every statement is grounded and supported, else flags review identifying the offending statement (grounding before support)", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ providedIds, specs }) => {
        // Give each statement a unique text so the offending statement can be
        // identified unambiguously.
        const statements = specs.map((spec, index) => ({
          statement: `Statement ${index} (${spec.kind})`,
          sourceRefs: [...spec.sourceRefs],
          confidence: spec.confidence,
          basis: spec.basis
        }));
        const outputText = JSON.stringify({ statements });

        const providedSet = new Set(providedIds);
        // Mirror the validator order: grounding runs first (first empty
        // sourceRefs wins), then support (first ref outside provided set).
        const firstUngrounded = statements.find((s) => s.sourceRefs.length === 0);
        const firstUnsupported = statements.find((s) =>
          s.sourceRefs.some((ref) => !providedSet.has(ref))
        );

        const gateway = new AiGateway({
          modelId: MODEL_ID,
          provider: providerReturning(outputText),
          scheduler: neverScheduler,
          outputValidators: groundingValidators
        });

        const request: GenerativeRequest = {
          taskType: "summarisation",
          invokingUserId: "User-1",
          systemInstructions: "Summarise the case using only the provided data.",
          context: providedIds.map((id) => ({
            sourceObjectId: id,
            content: `clinical content for ${id}`
          }))
        };

        const result = await gateway.invoke(request);

        if (firstUngrounded !== undefined) {
          // Some statement is unlinked: rejected as needs_review with the
          // grounding reason, identifying the first ungrounded statement.
          expect(result.outcome).toBe("needs_review");
          if (result.outcome === "needs_review") {
            expect(result.review.reason).toBe("ungrounded_statement");
            expect(result.review.offendingStatement).toBe(firstUngrounded.statement);
          }
        } else if (firstUnsupported !== undefined) {
          // Every statement is grounded, but one cites a source outside the
          // provided case data: rejected as needs_review with the support
          // reason, identifying the first unsupported statement.
          expect(result.outcome).toBe("needs_review");
          if (result.outcome === "needs_review") {
            expect(result.review.reason).toBe("unsupported_statement");
            expect(result.review.offendingStatement).toBe(firstUnsupported.statement);
          }
        } else {
          // Every statement is grounded and supported: accepted.
          expect(result.outcome).toBe("invoked");
          if (result.outcome === "invoked") {
            expect(result.response.outputText).toBe(outputText);
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
