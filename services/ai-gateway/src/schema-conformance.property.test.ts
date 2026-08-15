// services/ai-gateway/src/schema-conformance.property.test.ts
//
// Property-based test for Correctness Property 48 (Task 12.9, Requirements
// 18.1, 18.5).
//
// Feature: undiagnosed-disease-navigator, Property 48: AI output conforms to
// schema before return.
//
// Design (Property 48): For any generative task output, the AI_Gateway returns
// it if and only if it conforms to the defined response schema; a
// non-conforming output is rejected in its entirety, the prior state is
// retained, the output is marked for review, and a schema-violation indication
// is returned.
//
// This exercises the full stage-7 validation path through AiGateway.invoke with
// an injected fake provider that returns a generated outputText, a
// never-scheduler (so the timeout never fires), the real groundingValidators
// bundle, and a context that authorises the sourceRefs used — so grounding and
// support pass for conformant outputs and the ONLY variable is schema
// conformance.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { AiGateway } from "./gateway.js";
import { directAccessGuard } from "./mediation.js";
import { groundingValidators } from "./output-validation.js";
import { parseAiResponse } from "./response-schema.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GenerativeRequest } from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";

const MODEL_ID = "anthropic.test-model-v1";

// The set of source objects the invoking user is authorised to access, and the
// context the gateway supplies to the model. Conformant outputs cite only these
// ids so grounding (>=1 ref) and support (refs in provided data) both pass and
// the sole determinant of the outcome is schema conformance.
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

function gatewayFor(outputText: string): AiGateway {
  return new AiGateway({
    modelId: MODEL_ID,
    provider: providerReturning(outputText),
    scheduler: neverScheduler,
    outputValidators: groundingValidators
  });
}

// A schema-conformant statement: non-empty statement text, at least one
// authorised sourceRef (so grounding + support pass), confidence in [0, 1], and
// a valid basis.
const conformantStatementArb = fc.record({
  statement: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  sourceRefs: fc.uniqueArray(fc.constantFrom(...SOURCE_IDS), { minLength: 1, maxLength: SOURCE_IDS.length }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  basis: fc.constantFrom("observed", "inferred")
});

// A conformant output: valid AiResponse JSON with grounded, supported
// statements (at least one statement so the document is non-trivial).
const conformantOutputArb = fc
  .array(conformantStatementArb, { minLength: 1, maxLength: 5 })
  .map((statements) => JSON.stringify({ statements }));

// Non-conformant outputs: outputs that do NOT satisfy the response schema.
// Each generator targets a distinct structural violation.
const notJsonArb = fc
  .string()
  .filter((s) => {
    try {
      JSON.parse(s);
      return false;
    } catch {
      return true;
    }
  });

const missingStatementsArb = fc
  .dictionary(
    fc.string().filter((k) => k !== "statements"),
    fc.jsonValue()
  )
  .map((obj) => JSON.stringify(obj));

const statementsWrongTypeArb = fc
  .oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.record({ statements: fc.jsonValue() })
  )
  .map((v) =>
    typeof v === "object" && v !== null && "statements" in (v as Record<string, unknown>)
      ? // statements present but not an array (jsonValue may occasionally be an
        // array, so coerce non-arrays here and fall back to a plain wrong type).
        JSON.stringify({ statements: 42 })
      : JSON.stringify({ statements: v })
  );

// A statement array where one entry has a wrong field type / missing field.
const wrongFieldTypesArb = fc
  .oneof(
    fc.constant([{ statement: "", sourceRefs: ["Doc-1"], confidence: 0.5, basis: "observed" }]),
    fc.constant([{ statement: "ok", sourceRefs: "Doc-1", confidence: 0.5, basis: "observed" }]),
    fc.constant([{ statement: "ok", sourceRefs: ["Doc-1"], confidence: 2, basis: "observed" }]),
    fc.constant([{ statement: "ok", sourceRefs: ["Doc-1"], confidence: 0.5, basis: "guessed" }]),
    fc.constant([{ statement: "ok", sourceRefs: [1, 2], confidence: 0.5, basis: "observed" }]),
    fc.constant([{ sourceRefs: ["Doc-1"], confidence: 0.5, basis: "observed" }]),
    fc.constant(["not-an-object"])
  )
  .map((statements) => JSON.stringify({ statements }));

const nonConformantOutputArb = fc.oneof(
  notJsonArb,
  missingStatementsArb,
  statementsWrongTypeArb,
  wrongFieldTypesArb
);

// Tag each generated output with whether it is schema-conformant, so the
// property can assert the biconditional against a single oracle: parseAiResponse.
const taggedOutputArb = fc.oneof(
  conformantOutputArb.map((outputText) => ({ outputText, conformant: true as const })),
  nonConformantOutputArb.map((outputText) => ({ outputText, conformant: false as const }))
);

describe("Feature: undiagnosed-disease-navigator, Property 48: AI output conforms to schema before return", () => {
  it("returns output iff it conforms to the schema; otherwise rejects it entirely as needs_review with a schema_violation", async () => {
    await fc.assert(
      fc.asyncProperty(taggedOutputArb, async ({ outputText, conformant }) => {
        // Oracle: the schema parser decides conformance. This also guards
        // against a generator accidentally emitting a conformant document in the
        // non-conformant branch.
        const isSchemaConformant = parseAiResponse(outputText).ok;

        const gateway = gatewayFor(outputText);
        const result = await gateway.invoke(baseRequest);

        if (isSchemaConformant) {
          expect(conformant).toBe(true);
          // Conformant (and, by construction, grounded + supported) output is
          // returned verbatim as a successful invocation.
          expect(result.outcome).toBe("invoked");
          if (result.outcome === "invoked") {
            expect(result.response.outputText).toBe(outputText);
          }
        } else {
          // Non-conformant output is rejected in its entirety and marked for
          // review with a schema-violation indication; it is NOT returned as an
          // invocation.
          expect(result.outcome).toBe("needs_review");
          if (result.outcome === "needs_review") {
            expect(result.review.reason).toBe("schema_violation");
            // The flagged output is retained for review, not returned as invoked.
            expect(result.reviewId).toBeTruthy();
          }
        }
      }),
      { numRuns: 200 }
    );
  });
});
