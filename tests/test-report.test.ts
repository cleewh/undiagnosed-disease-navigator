// tests/test-report.test.ts
//
// Unit tests for the test harness and per-category reporting logic
// (Task 32.1 — Requirements 31.1, 31.2, 31.6, 31.7).
//
// These tests drive the pure functions exported by scripts/test-report.mjs
// against synthetic Vitest JSON output. They confirm that:
//   - files are assigned to the correct category by file-name convention;
//   - every required category is enumerated even with zero tests (Req 31.1/2);
//   - per-category and overall pass/fail totals are counted (Req 31.2);
//   - failing tests capture expected-vs-actual (Req 31.6);
//   - safety-critical failures are detected and surfaced (Req 31.7).

import { describe, it, expect } from "vitest";
import {
  TEST_CATEGORIES,
  CATEGORY_ORDER,
  SAFETY_CRITICAL_MARKER,
  categoryForFile,
  isSafetyCritical,
  buildReport,
  formatReport
} from "../scripts/test-report.mjs";

describe("categoryForFile", () => {
  it("maps each convention infix to its category", () => {
    expect(categoryForFile("services/x/foo.property.test.ts")).toBe("property");
    expect(categoryForFile("apps/api/foo.integration.test.ts")).toBe(
      "integration"
    );
    expect(categoryForFile("apps/web/foo.e2e.test.ts")).toBe("e2e");
    expect(categoryForFile("data/generator/foo.validation.test.ts")).toBe(
      "validation"
    );
    expect(categoryForFile("apps/api/auth/foo.policy.test.ts")).toBe("policy");
    expect(categoryForFile("tests/foo.consistency.test.ts")).toBe(
      "consistency"
    );
  });

  it("defaults unrecognised test files to the unit category", () => {
    expect(categoryForFile("packages/domain/foo.test.ts")).toBe("unit");
    expect(categoryForFile("apps/web/foo.test.tsx")).toBe("unit");
    expect(categoryForFile("")).toBe("unit");
    expect(categoryForFile(undefined as unknown as string)).toBe("unit");
  });
});

describe("isSafetyCritical", () => {
  it("detects the safety-critical marker in a title", () => {
    expect(isSafetyCritical(`Ground_Truth ${SAFETY_CRITICAL_MARKER}`)).toBe(
      true
    );
    expect(isSafetyCritical("[SAFETY-CRITICAL] out-of-scope effect")).toBe(
      true
    );
    expect(isSafetyCritical("ordinary failing test")).toBe(false);
    expect(isSafetyCritical(undefined as unknown as string)).toBe(false);
  });
});

describe("buildReport", () => {
  it("enumerates every required category even when the suite is empty", () => {
    const report = buildReport({ testResults: [] });
    expect(Object.keys(report.categories).sort()).toEqual(
      [...CATEGORY_ORDER].sort()
    );
    expect(report.categoryOrder).toEqual([...CATEGORY_ORDER]);
    for (const key of CATEGORY_ORDER) {
      const c = report.categories[key];
      expect(c).toMatchObject({ total: 0, passed: 0, failed: 0 });
      expect(c.failures).toEqual([]);
    }
    expect(report.totals).toEqual({ total: 0, passed: 0, failed: 0 });
    expect(report.ok).toBe(true);
    expect(report.hasSafetyCriticalFailure).toBe(false);
  });

  it("tolerates malformed input without throwing", () => {
    expect(buildReport(undefined).totals).toEqual({
      total: 0,
      passed: 0,
      failed: 0
    });
    expect(buildReport(null).ok).toBe(true);
    expect(buildReport({}).categoryOrder).toEqual([...CATEGORY_ORDER]);
  });

  it("counts per-category and overall pass/fail totals (Req 31.2)", () => {
    const vitestJson = {
      testResults: [
        {
          name: "packages/domain/envelope.test.ts",
          assertionResults: [
            { title: "a", status: "passed" },
            { title: "b", status: "passed" },
            { title: "c", status: "failed", failureMessages: ["boom"] }
          ]
        },
        {
          name: "services/reanalysis/match.property.test.ts",
          assertionResults: [
            { title: "p1", status: "passed" },
            { title: "p2", status: "skipped" }
          ]
        },
        {
          name: "apps/api/case.integration.test.ts",
          assertionResults: [{ title: "i1", status: "passed" }]
        }
      ]
    };

    const report = buildReport(vitestJson);

    expect(report.categories.unit).toMatchObject({
      total: 3,
      passed: 2,
      failed: 1
    });
    // Skipped assertions are not counted toward pass/fail totals.
    expect(report.categories.property).toMatchObject({
      total: 1,
      passed: 1,
      failed: 0
    });
    expect(report.categories.integration).toMatchObject({
      total: 1,
      passed: 1,
      failed: 0
    });
    expect(report.totals).toEqual({ total: 5, passed: 4, failed: 1 });
    expect(report.ok).toBe(false);
    expect(report.failures).toHaveLength(1);
  });

  it("captures expected-vs-actual for failing tests (Req 31.6)", () => {
    const vitestJson = {
      testResults: [
        {
          name: "packages/domain/version.test.ts",
          assertionResults: [
            {
              title: "version increments",
              status: "failed",
              failureMessages: [
                "AssertionError: values differ\nExpected: 2\nReceived: 1\n    at ..."
              ]
            }
          ]
        }
      ]
    };

    const report = buildReport(vitestJson);
    expect(report.failures).toHaveLength(1);
    const [failure] = report.failures;
    expect(failure.category).toBe("unit");
    expect(failure.expected).toBe("2");
    expect(failure.actual).toBe("1");
    expect(failure.safetyCritical).toBe(false);
  });

  it("detects and surfaces safety-critical failures (Req 31.7)", () => {
    const vitestJson = {
      testResults: [
        {
          name: "tests/knowledge-scope.consistency.test.ts",
          assertionResults: [
            {
              title: `Ground_Truth stays inaccessible ${SAFETY_CRITICAL_MARKER}`,
              status: "failed",
              failureMessages: ["Expected: denied\nReceived: readable"]
            },
            { title: "ordinary consistency check", status: "passed" }
          ]
        }
      ]
    };

    const report = buildReport(vitestJson);
    expect(report.hasSafetyCriticalFailure).toBe(true);
    expect(report.safetyCritical).toHaveLength(1);
    expect(report.safetyCritical[0].category).toBe("consistency");
    expect(report.categories.consistency).toMatchObject({
      total: 2,
      passed: 1,
      failed: 1
    });

    const text = formatReport(report);
    expect(text).toContain("SAFETY-CRITICAL FAILURE(S) DETECTED");
    expect(text).toContain("Ground_Truth stays inaccessible");
  });
});

describe("formatReport", () => {
  it("lists every category and a PASS line for a clean run", () => {
    const report = buildReport({ testResults: [] });
    const text = formatReport(report);
    for (const category of TEST_CATEGORIES) {
      expect(text).toContain(category.key);
    }
    expect(text).toContain("PASS:");
    expect(text).not.toContain("SAFETY-CRITICAL FAILURE(S) DETECTED");
  });
});
