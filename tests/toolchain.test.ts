import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Toolchain proof test (Task 1.1). Confirms the Vitest runner and the
// fast-check property-based testing library are both wired up and buildable.
describe("toolchain", () => {
  it("runs unit tests via vitest", () => {
    expect(1 + 1).toBe(2);
  });

  it("runs property-based tests via fast-check", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        return a + b === b + a;
      }),
      { numRuns: 100 }
    );
  });
});
