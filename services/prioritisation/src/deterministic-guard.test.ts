// services/prioritisation/src/deterministic-guard.test.ts
//
// Compile-sanity and behavioural unit tests for the deterministic-only
// execution guard (task 20.2). The property test (20.7) is implemented
// separately.

import { describe, it, expect } from "vitest";
import { NonDeterministicResultError } from "./errors.js";
import {
  DETERMINISTIC_TASKS,
  assertDeterministicInput,
  detectGenerativeOrigin,
  isDeterministicTask,
  runDeterministicTask
} from "./deterministic-guard.js";

describe("DETERMINISTIC_TASKS coverage (Req 17.1–17.3)", () => {
  it("includes every deterministic-only task named in the requirement", () => {
    expect([...DETERMINISTIC_TASKS]).toEqual([
      "variant_annotation",
      "allele_frequency",
      "inheritance",
      "segregation",
      "phenotype_similarity",
      "workflow_state",
      "permissions",
      "audit",
      "diagnosis",
      "urgency",
      "final_classification",
      "reanalysis_eligibility"
    ]);
    expect(isDeterministicTask("inheritance")).toBe(true);
    expect(isDeterministicTask("phenotype_extraction")).toBe(false);
  });
});

describe("detectGenerativeOrigin", () => {
  it("returns null for clean, deterministic values", () => {
    expect(detectGenerativeOrigin({ a: 1, b: [{ c: "x" }], d: null })).toBeNull();
  });

  it("finds a generativeOrigin marker and reports its path", () => {
    const path = detectGenerativeOrigin({ candidates: [{ ok: true }, { generativeOrigin: true }] });
    expect(path).toBe("input.candidates[1].generativeOrigin");
  });

  it("detects an embedded ModelInvocation entity", () => {
    const path = detectGenerativeOrigin({ trace: { entityType: "ModelInvocation" } });
    expect(path).toBe("input.trace.entityType(ModelInvocation)");
  });

  it("detects a producedByModel flag", () => {
    expect(detectGenerativeOrigin({ producedByModel: true })).toBe("input.producedByModel");
  });

  it("is cycle-safe", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic["self"] = cyclic;
    expect(detectGenerativeOrigin(cyclic)).toBeNull();
  });
});

describe("runDeterministicTask (Req 17.4, 17.5)", () => {
  it("runs the computation on a clean input and adopts the result", () => {
    const outcome = runDeterministicTask({
      task: "inheritance",
      input: { genotype: "0/1", pedigree: ["mother", "father"] },
      lastValidState: { fit: "unknown" },
      compute: () => ({ fit: "de_novo" })
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toEqual({ fit: "de_novo" });
    }
  });

  it("rejects a generative INPUT without running compute and retains last valid state (Req 17.5)", () => {
    let computed = false;
    const lastValid = { classification: "Unresolved_Case" };

    const outcome = runDeterministicTask({
      task: "final_classification",
      input: { note: { generativeOrigin: true, text: "looks pathogenic" } },
      lastValidState: lastValid,
      compute: () => {
        computed = true;
        return { classification: "Resolved" };
      }
    });

    expect(computed).toBe(false);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(NonDeterministicResultError);
      expect(outcome.error.location).toBe("input");
      expect(outcome.retainedState).toBe(lastValid);
    }
  });

  it("rejects a generative RESULT, discards it, and retains last valid state (Req 17.5)", () => {
    const lastValid = { urgency: "routine" };

    const outcome = runDeterministicTask({
      task: "urgency",
      input: { flags: ["none"] },
      lastValidState: lastValid,
      compute: () => ({ urgency: "urgent", producedByModel: true })
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.location).toBe("result");
      expect(outcome.retainedState).toBe(lastValid);
    }
  });

  it("throws for an unknown deterministic task", () => {
    expect(() =>
      runDeterministicTask({
        // @ts-expect-error intentionally invalid task
        task: "not_a_task",
        input: {},
        lastValidState: null,
        compute: () => null
      })
    ).toThrow(RangeError);
  });
});

describe("assertDeterministicInput", () => {
  it("passes clean input and throws on generative input", () => {
    expect(() => assertDeterministicInput("permissions", { role: "clinician" })).not.toThrow();
    expect(() => assertDeterministicInput("permissions", { generativeOrigin: true })).toThrow(
      NonDeterministicResultError
    );
  });
});
