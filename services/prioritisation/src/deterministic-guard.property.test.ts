// services/prioritisation/src/deterministic-guard.property.test.ts
//
// Property-based test for design Correctness Property 47 (task 20.7).
//
// Feature: undiagnosed-disease-navigator, Property 47: Deterministic-only tasks
// are reproducible and free of generative output
//
// *For any* input to a deterministic-only task, repeated execution yields
// byte-for-byte identical output; and if a generative output is detected in the
// execution path, the result is rejected, the last valid deterministic state is
// retained, and a non-deterministic-result error is returned.
//
// Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { NonDeterministicResultError } from "./errors.js";
import {
  DETERMINISTIC_TASKS,
  detectGenerativeOrigin,
  runDeterministicTask,
  type DeterministicTask
} from "./deterministic-guard.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const taskArb: fc.Arbitrary<DeterministicTask> = fc.constantFrom(...DETERMINISTIC_TASKS);

/** An arbitrary, generative-marker-free JSON payload. */
const cleanPayloadArb: fc.Arbitrary<unknown> = fc
  .jsonValue()
  .filter((value) => detectGenerativeOrigin(value) === null);

/** One of the recognised generative-origin marker shapes. */
const markerArb: fc.Arbitrary<Record<string, unknown>> = fc.constantFrom(
  { generativeOrigin: true },
  { producedByModel: true },
  { entityType: "ModelInvocation" }
);

/** The last valid deterministic state, retained on rejection (Req 17.5). */
const lastValidStateArb: fc.Arbitrary<unknown> = cleanPayloadArb.map((payload) => ({
  state: payload,
  version: "last-valid"
}));

// A pure, deterministic computation that echoes its input (no model call).
function echoCompute(input: unknown): { computed: true; echo: unknown } {
  return { computed: true, echo: input };
}

// ---------------------------------------------------------------------------
// Property 47
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 47: Deterministic-only tasks are reproducible and free of generative output", () => {
  // Feature: undiagnosed-disease-navigator, Property 47: Deterministic-only
  // tasks are reproducible and free of generative output
  // Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5
  it("reproduces clean deterministic outputs byte-for-byte across runs", () => {
    fc.assert(
      fc.property(taskArb, cleanPayloadArb, lastValidStateArb, (task, payload, lastValidState) => {
        const input = { payload };

        const first = runDeterministicTask({ task, input, lastValidState, compute: echoCompute });
        const second = runDeterministicTask({ task, input, lastValidState, compute: echoCompute });

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        // Byte-for-byte identical output on every execution (Req 17.1–17.3).
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      }),
      { numRuns: 200 }
    );
  });

  it("rejects a generative INPUT without computing, returning an error and retaining last valid state", () => {
    fc.assert(
      fc.property(
        taskArb,
        cleanPayloadArb,
        markerArb,
        lastValidStateArb,
        (task, payload, marker, lastValidState) => {
          const stateSnapshot = JSON.stringify(lastValidState);
          let computed = false;

          const input = { payload, provenance: marker };
          const outcome = runDeterministicTask({
            task,
            input,
            lastValidState,
            compute: (value) => {
              computed = true;
              return echoCompute(value);
            }
          });

          // Compute never ran and the result was rejected (Req 17.4, 17.5).
          expect(computed).toBe(false);
          expect(outcome.ok).toBe(false);
          if (!outcome.ok) {
            expect(outcome.error).toBeInstanceOf(NonDeterministicResultError);
            expect(outcome.error.code).toBe("NON_DETERMINISTIC_RESULT");
            expect(outcome.error.location).toBe("input");
            expect(outcome.error.task).toBe(task);
            // Last valid deterministic state retained UNCHANGED (Req 17.5).
            expect(outcome.retainedState).toBe(lastValidState);
          }
          expect(JSON.stringify(lastValidState)).toBe(stateSnapshot);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("rejects a generative RESULT, discards it, returns an error and retains last valid state", () => {
    fc.assert(
      fc.property(
        taskArb,
        cleanPayloadArb,
        markerArb,
        lastValidStateArb,
        (task, payload, marker, lastValidState) => {
          const stateSnapshot = JSON.stringify(lastValidState);

          const input = { payload };
          const outcome = runDeterministicTask({
            task,
            input,
            lastValidState,
            // A clean input, but the computation emits a generative-marked result.
            compute: (value) => ({ echo: value, provenance: marker })
          });

          expect(outcome.ok).toBe(false);
          if (!outcome.ok) {
            expect(outcome.error).toBeInstanceOf(NonDeterministicResultError);
            expect(outcome.error.location).toBe("result");
            expect(outcome.error.task).toBe(task);
            expect(outcome.retainedState).toBe(lastValidState);
          }
          expect(JSON.stringify(lastValidState)).toBe(stateSnapshot);
        }
      ),
      { numRuns: 200 }
    );
  });
});
