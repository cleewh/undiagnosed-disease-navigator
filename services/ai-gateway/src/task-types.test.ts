// services/ai-gateway/src/task-types.test.ts
//
// Unit tests for the generative task-type allowlist (Requirement 16.5).

import { describe, expect, it } from "vitest";

import { ALLOWED_TASK_TYPES, isAllowedTaskType } from "./task-types.js";

describe("isAllowedTaskType", () => {
  it("permits exactly phenotype extraction, summarisation, and explanation drafting (Req 16.5)", () => {
    expect(ALLOWED_TASK_TYPES).toEqual([
      "phenotype_extraction",
      "summarisation",
      "explanation_drafting"
    ]);
    for (const taskType of ALLOWED_TASK_TYPES) {
      expect(isAllowedTaskType(taskType)).toBe(true);
    }
  });

  it("rejects any task type outside the allowlist (Req 16.5)", () => {
    for (const taskType of [
      "diagnosis",
      "variant_annotation",
      "classification",
      "",
      "PHENOTYPE_EXTRACTION"
    ]) {
      expect(isAllowedTaskType(taskType)).toBe(false);
    }
  });
});
