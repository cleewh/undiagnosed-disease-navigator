// services/ai-gateway/src/context-restriction.property.test.ts
//
// Property-based test for design Correctness Property 54 (Task 12.15,
// Requirements 19.6, 19.7).
//
// Feature: undiagnosed-disease-navigator, Property 54: Model context is
// restricted to authorised data
//
// Design (Property 54): For any invoking user and requested context, the
// context provided to the model contains only the case data the user is
// authorised to access, and any excluded unauthorised portion is recorded in
// the invocation log.
//
// Requirement 19.6: WHEN the AI_Gateway constructs a model invocation, THE
// AI_Gateway SHALL restrict the context provided to the model to only the case
// data the invoking user is authorised to access.
//
// Requirement 19.7: IF the invoking user is not authorised to access any
// portion of the requested case data, THEN THE AI_Gateway SHALL exclude that
// portion from the context and record the exclusion in the invocation log.
//
// Strategy: drive the FULL AiGateway.invoke path (the same wiring production
// uses: scopeAwareContextFilter + securePromptBuilder) with a capturing
// provider that records the ModelRequest actually handed to the model, plus an
// InMemoryInvocationLogger. The generated request mixes context items the user
// IS authorised to access with items the user is NOT, and carries the caller's
// authorised scope. Each item has a unique sourceObjectId, so its rendered
// prompt label `[source:<id>]` uniquely witnesses whether that item's data
// reached the model. The property then asserts, for arbitrary partitions:
//   (a) every authorised item's data reaches the model (its label + content
//       appear in the untrusted data segment the provider received);
//   (b) no unauthorised item's data reaches the model (neither its label nor
//       its content appears anywhere in the request the provider received);
//   (c) every unauthorised item is recorded as an excluded-context reference in
//       the single invocation-log entry, with reason "not-authorised", and no
//       authorised item is recorded as excluded.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { AiGateway } from "./gateway.js";
import { directAccessGuard } from "./mediation.js";
import { InMemoryInvocationLogger } from "./invocation-logger.js";
import { ALLOWED_TASK_TYPES, type GenerativeTaskType } from "./task-types.js";
import type {
  ModelInvocationContext,
  ModelProvider,
  ModelRequest,
  ModelResponse
} from "./model-provider.js";
import type { GatewayContextItem, GenerativeRequest } from "./pipeline.js";
import type { Scheduler } from "./scheduler.js";

const MODEL_ID = "anthropic.test-model-v1";

// A scheduler whose timer never fires: the 30-second abort is never triggered,
// so the synchronous provider response is what surfaces.
const neverScheduler: Scheduler = {
  setTimeout(): unknown {
    return {};
  },
  clearTimeout(): void {
    // no-op
  }
};

/**
 * A provider that captures the exact {@link ModelRequest} it was handed (the
 * post-context-restriction, prompt-built request that reaches the model) and
 * returns a fixed, schema-valid-ish response. Capturing lets the property
 * assert precisely which case data reached the model.
 */
function capturingProvider(): {
  readonly provider: ModelProvider;
  readonly captured: () => ModelRequest | undefined;
} {
  let seen: ModelRequest | undefined;
  const provider: ModelProvider = {
    async invoke(request: ModelRequest, context: ModelInvocationContext): Promise<ModelResponse> {
      directAccessGuard(context.mediation);
      seen = request;
      return { outputText: "ok", modelId: request.modelId };
    }
  };
  return { provider, captured: () => seen };
}

const taskTypeArb: fc.Arbitrary<GenerativeTaskType> = fc.constantFrom(...ALLOWED_TASK_TYPES);

const invokingUserArb = fc.string({ minLength: 1 }).map((s) => `User-${s}`);

// Free-text noise for a context item, sanitised so it cannot forge another
// item's prompt label: stripping "[source:" and the bracket characters means a
// label `[source:<id>]` can never appear inside any item's content, so a label
// found in the built prompt is unambiguous evidence that item was included.
const noiseArb = fc
  .string({ maxLength: 40 })
  .map((s) => s.replace(/\[source:/g, "").replace(/[[\]]/g, ""));

// A raw item spec: whether the invoking user is authorised to access it, plus
// sanitised free-text noise. Unique source-object ids and a unique content
// marker are assigned deterministically by index in the property body.
const rawItemArb = fc.record({
  authorised: fc.boolean(),
  noise: noiseArb
});

describe("Feature: undiagnosed-disease-navigator, Property 54: Model context is restricted to authorised data", () => {
  // Validates: Requirements 19.6, 19.7
  it("supplies the model only the case data the invoking user is authorised to access and logs every excluded unauthorised portion", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(rawItemArb, { minLength: 1, maxLength: 8 }),
        taskTypeArb,
        invokingUserArb,
        async (rawItems, taskType, invokingUserId) => {
          // Assign unique ids and unique content markers by index. `label` is
          // the exact string securePromptBuilder emits for the item; because
          // ids are unique and item content cannot contain "[source:", a label
          // occurs in the built prompt iff that item was included.
          const items = rawItems.map((raw, index) => {
            const sourceObjectId = `Doc-${index}`;
            const marker = `[[content-${index}]]`;
            return {
              sourceObjectId,
              content: `${marker} ${raw.noise}`,
              label: `[source:${sourceObjectId}]`,
              marker,
              authorised: raw.authorised
            };
          });

          const authorisedItems = items.filter((i) => i.authorised);
          const unauthorisedItems = items.filter((i) => !i.authorised);

          const context: readonly GatewayContextItem[] = items.map((i) => ({
            sourceObjectId: i.sourceObjectId,
            content: i.content
          }));

          const request: GenerativeRequest = {
            taskType,
            invokingUserId,
            systemInstructions: "Use only the provided data.",
            context,
            authorizedScope: {
              authorizedSourceObjectIds: authorisedItems.map((i) => i.sourceObjectId)
            }
          };

          const logger = new InMemoryInvocationLogger();
          const { provider, captured } = capturingProvider();
          const gateway = new AiGateway({
            modelId: MODEL_ID,
            provider,
            scheduler: neverScheduler,
            logger
          });

          const result = await gateway.invoke(request);

          // The invocation completed, so a model was actually contacted with a
          // constructed request: the restriction claim is about real data flow.
          expect(result.outcome).toBe("invoked");
          const modelRequest = captured();
          expect(modelRequest).toBeDefined();
          if (modelRequest === undefined) {
            throw new Error("expected the provider to have been invoked");
          }

          // The complete text presented to the model for this invocation.
          const presented = `${modelRequest.systemInstructions}\n${modelRequest.userContent}`;

          // (a) Req 19.6: every authorised item's data reaches the model.
          for (const item of authorisedItems) {
            expect(modelRequest.userContent).toContain(item.label);
            expect(modelRequest.userContent).toContain(item.marker);
          }

          // (b) Req 19.6: no unauthorised item's data reaches the model, in the
          // untrusted data segment or anywhere else in the request.
          for (const item of unauthorisedItems) {
            expect(presented.includes(item.label)).toBe(false);
            expect(presented.includes(item.marker)).toBe(false);
          }

          // (c) Req 19.7: exactly one invocation-log entry, recording every
          // excluded unauthorised portion (and only those) with the
          // not-authorised reason.
          expect(logger.count).toBe(1);
          const entry = logger.last;
          expect(entry).toBeDefined();
          if (entry === undefined) {
            throw new Error("expected an invocation-log entry to be recorded");
          }

          const excludedIds = [...entry.excludedContext]
            .map((e) => e.sourceObjectId)
            .sort();
          const expectedExcludedIds = unauthorisedItems
            .map((i) => i.sourceObjectId)
            .sort();
          expect(excludedIds).toEqual(expectedExcludedIds);
          for (const excluded of entry.excludedContext) {
            expect(excluded.reason).toBe("not-authorised");
          }
          // No authorised item is ever recorded as excluded.
          const authorisedIdSet = new Set(authorisedItems.map((i) => i.sourceObjectId));
          for (const excluded of entry.excludedContext) {
            expect(authorisedIdSet.has(excluded.sourceObjectId)).toBe(false);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
