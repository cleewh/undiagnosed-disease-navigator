// tests/category-completion.test.ts
//
// Task 32.3 — unit-category completion test (Requirement 31.1, 31.2).
//
// This is a UNIT test (default `.test.ts`, no category infix, so the harness in
// scripts/test-report.mjs categorises it as `unit`). It verifies that the test
// harness ENUMERATES every required test category and produces a deterministic
// per-category pass/fail total, and that the category file-name convention maps
// the real test files (including the two added in tasks 32.2/32.3) to their
// intended categories.
//
// Requirement 31.1 requires unit, API-integration, and E2E categories (each
// with a deterministic pass/fail result); the harness additionally tracks
// validation, policy, consistency, and property categories. This test drives
// the harness's pure functions over a small synthetic input so it stays
// deterministic and hermetic — it does not run the real suite.

import { describe, it, expect } from "vitest";
import {
  TEST_CATEGORIES,
  CATEGORY_ORDER,
  categoryForFile,
  buildReport
} from "../scripts/test-report.mjs";

// The three categories Requirement 31.1 names explicitly.
const REQUIRED_31_1_CATEGORIES = ["unit", "integration", "e2e"] as const;

// A small synthetic Vitest JSON with at least one file per required category,
// mixing passing and failing assertions so per-category totals are exercised.
const SYNTHETIC_VITEST_JSON = {
  testResults: [
    {
      name: "packages/domain/example.test.ts", // -> unit
      assertionResults: [
        { title: "unit passes", status: "passed" },
        { title: "unit also passes", status: "passed" }
      ]
    },
    {
      name: "tests/api-integration.integration.test.ts", // -> integration
      assertionResults: [{ title: "integration passes", status: "passed" }]
    },
    {
      name: "apps/web/app.e2e.test.tsx", // -> e2e
      assertionResults: [{ title: "e2e passes", status: "passed" }]
    },
    {
      name: "services/intake/schema.validation.test.ts", // -> validation
      assertionResults: [{ title: "validation passes", status: "passed" }]
    },
    {
      name: "apps/api/auth/rbac.policy.test.ts", // -> policy
      assertionResults: [
        { title: "allowed case passes", status: "passed" },
        { title: "disallowed case fails", status: "failed", failureMessages: ["Expected: deny\nReceived: allow"] }
      ]
    },
    {
      name: "tests/synthetic-data.consistency.test.ts", // -> consistency
      assertionResults: [{ title: "consistency passes", status: "passed" }]
    },
    {
      name: "services/reanalysis/match.property.test.ts", // -> property
      assertionResults: [
        { title: "property holds", status: "passed" },
        { title: "skipped property", status: "skipped" }
      ]
    }
  ]
};

describe("test-category completion (Req 31.1, 31.2)", () => {
  it("maps the added test files to their intended categories", () => {
    expect(categoryForFile("tests/api-integration.integration.test.ts")).toBe(
      "integration"
    );
    expect(categoryForFile("tests/synthetic-data.consistency.test.ts")).toBe(
      "consistency"
    );
    // No category infix -> default unit category.
    expect(categoryForFile("tests/category-completion.test.ts")).toBe("unit");
  });

  it("enumerates EVERY required category even before counting any tests", () => {
    const empty = buildReport({ testResults: [] });
    expect(Object.keys(empty.categories).sort()).toEqual([...CATEGORY_ORDER].sort());
    for (const category of TEST_CATEGORIES) {
      const bucket = empty.categories[category.key];
      expect(bucket).toBeDefined();
      expect(bucket.total).toBe(0);
      expect(bucket.passed).toBe(0);
      expect(bucket.failed).toBe(0);
    }
  });

  it("reports a deterministic per-category pass/fail total for a mixed run", () => {
    const report = buildReport(SYNTHETIC_VITEST_JSON);

    // Every required category is represented in this synthetic run.
    for (const key of CATEGORY_ORDER) {
      expect(report.categories[key].total).toBeGreaterThan(0);
    }

    // The three Requirement 31.1 categories each carry a deterministic result.
    for (const key of REQUIRED_31_1_CATEGORIES) {
      const bucket = report.categories[key];
      expect(bucket.total).toBe(bucket.passed + bucket.failed);
    }

    // Spot-check specific counts (skipped assertions are not counted).
    expect(report.categories.unit).toMatchObject({ total: 2, passed: 2, failed: 0 });
    expect(report.categories.integration).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(report.categories.e2e).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(report.categories.policy).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(report.categories.property).toMatchObject({ total: 1, passed: 1, failed: 0 });

    // Overall totals sum across the categories and flag the single failure.
    expect(report.totals).toEqual({ total: 9, passed: 8, failed: 1 });
    expect(report.ok).toBe(false);
    expect(report.failures).toHaveLength(1);
  });

  it("is a pure function: the same input yields an equal report", () => {
    const a = buildReport(SYNTHETIC_VITEST_JSON);
    const b = buildReport(SYNTHETIC_VITEST_JSON);
    expect(b).toEqual(a);
  });
});
