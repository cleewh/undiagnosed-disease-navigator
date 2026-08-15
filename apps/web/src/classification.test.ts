import { describe, it, expect } from "vitest";
import {
  assertSingleClassification,
  isConsistentClassification,
  MixedClassificationError,
  type Classification
} from "./classification.js";

describe("classification mixing prevention (Req 25.5)", () => {
  it("treats an empty collection as consistent", () => {
    expect(isConsistentClassification([])).toBe(true);
    expect(assertSingleClassification([])).toBeUndefined();
  });

  it("accepts a uniform collection", () => {
    const values: Classification[] = ["research", "research"];
    expect(isConsistentClassification(values)).toBe(true);
    expect(assertSingleClassification(values)).toBe("research");
  });

  it("rejects combining research and clinical records", () => {
    const values: Classification[] = ["research", "clinical"];
    expect(isConsistentClassification(values)).toBe(false);
    expect(() => assertSingleClassification(values)).toThrow(MixedClassificationError);
  });
});
