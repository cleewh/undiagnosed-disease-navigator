#!/usr/bin/env node
// scripts/test-report.mjs
//
// Test harness and per-category reporting (Requirements 31.1, 31.2, 31.6, 31.7).
//
// This harness runs the full Vitest suite once and produces a per-category
// report that:
//   - enumerates EVERY required test category, even when a category currently
//     has zero tests, so the report shape is deterministic (Req 31.1, 31.2);
//   - reports the total number of tests run, passed, and failed per category
//     (Req 31.2);
//   - reports each failing test with its expected and actual outcome (Req 31.6);
//   - surfaces any safety-critical failure prominently (Req 31.7).
//
// Categories are derived from file-name conventions (an infix embedded in the
// test file name). The default category is `unit`:
//   *.property.test.ts     -> property     (property-based / fast-check)
//   *.integration.test.ts  -> integration  (API integration)
//   *.e2e.test.ts          -> e2e          (end-to-end user interface)
//   *.validation.test.ts   -> validation   (schema / Phenopacket / FHIR)
//   *.policy.test.ts        -> policy       (permission / workflow-state /
//                                            AI-structured-output /
//                                            prompt-injection / audit-log,
//                                            allowed-vs-disallowed)
//   *.consistency.test.ts  -> consistency  (synthetic-data consistency)
//   *.test.ts (any other)  -> unit         (default)
//
// Safety-critical convention (Req 31.7): a synthetic-data consistency test that
// detects Ground_Truth exposure or an out-of-scope Knowledge_Update effect
// marks the failure by including the marker `[safety-critical]` in its test
// title. The harness scans failing tests for this marker and reports them in a
// dedicated, prominent section.
//
// The categorisation and reporting logic is exposed as pure, side-effect-free
// functions (`categoryForFile`, `buildReport`, `formatReport`) so that a unit
// test can drive it against synthetic Vitest output. Running this file directly
// executes the real Vitest suite and prints the report.
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Every required test category, in a fixed display order (Req 31.1, 31.2).
// `infix` is the file-name marker that assigns a file to the category; `null`
// means this is the default category (`unit`).
export const TEST_CATEGORIES = Object.freeze([
  Object.freeze({
    key: "unit",
    label: "Unit",
    requirement: "31.1",
    infix: null
  }),
  Object.freeze({
    key: "integration",
    label: "API integration",
    requirement: "31.1",
    infix: ".integration.test."
  }),
  Object.freeze({
    key: "e2e",
    label: "E2E user interface",
    requirement: "31.1",
    infix: ".e2e.test."
  }),
  Object.freeze({
    key: "validation",
    label: "Schema/Phenopacket/FHIR validation",
    requirement: "31.3",
    infix: ".validation.test."
  }),
  Object.freeze({
    key: "policy",
    label: "Permission/workflow-state/AI-output/injection/audit (allowed vs disallowed)",
    requirement: "31.4",
    infix: ".policy.test."
  }),
  Object.freeze({
    key: "consistency",
    label: "Synthetic-data consistency",
    requirement: "31.5",
    infix: ".consistency.test."
  }),
  Object.freeze({
    key: "property",
    label: "Property-based",
    requirement: "31.1",
    infix: ".property.test."
  })
]);

// Fixed category ordering derived from TEST_CATEGORIES.
export const CATEGORY_ORDER = Object.freeze(TEST_CATEGORIES.map((c) => c.key));

// Marker a safety-critical consistency test embeds in its title (Req 31.7).
export const SAFETY_CRITICAL_MARKER = "[safety-critical]";

/**
 * Assign a test file to exactly one category by file-name convention.
 * Unrecognised files fall back to `unit`.
 *
 * @param {string} fileName
 * @returns {string} category key
 */
export function categoryForFile(fileName) {
  const name = String(fileName ?? "");
  for (const category of TEST_CATEGORIES) {
    if (category.infix !== null && name.includes(category.infix)) {
      return category.key;
    }
  }
  return "unit";
}

/**
 * Determine whether a failing test title marks a safety-critical failure.
 *
 * @param {string} title
 * @returns {boolean}
 */
export function isSafetyCritical(title) {
  return String(title ?? "")
    .toLowerCase()
    .includes(SAFETY_CRITICAL_MARKER);
}

// Best-effort extraction of expected/actual values from Vitest failure
// messages so failures can report expected-vs-actual (Req 31.6). Returns null
// for a field when it cannot be determined; the raw message is always retained.
function extractExpectedActual(messages) {
  const text = messages.join("\n");
  const firstLine = (re) => {
    const match = re.exec(text);
    return match && match[1] !== undefined ? match[1].trim() : null;
  };
  const expected = firstLine(/(?:^|\n)\s*(?:Expected|expected):?\s*(.+)/);
  const actual = firstLine(/(?:^|\n)\s*(?:Received|Actual|actual):?\s*(.+)/);
  return { expected, actual };
}

function emptyCategory(category) {
  return {
    key: category.key,
    label: category.label,
    requirement: category.requirement,
    total: 0,
    passed: 0,
    failed: 0,
    failures: []
  };
}

/**
 * Build a deterministic per-category report from parsed Vitest JSON output.
 *
 * The Vitest JSON reporter emits a Jest-compatible shape:
 *   { testResults: [ { name, assertionResults: [ { title, fullName, status,
 *     failureMessages } ] } ] }
 *
 * Every required category is present in the result even when it has zero
 * tests, giving a stable report shape (Req 31.1, 31.2). Skipped/pending
 * assertions are not counted toward pass/fail totals so that each category
 * total reflects only deterministic pass/fail results (Req 31.1).
 *
 * @param {unknown} vitestJson
 * @returns {{
 *   categories: Record<string, {
 *     key: string, label: string, requirement: string,
 *     total: number, passed: number, failed: number, failures: object[]
 *   }>,
 *   categoryOrder: string[],
 *   totals: { total: number, passed: number, failed: number },
 *   failures: object[],
 *   safetyCritical: object[],
 *   hasSafetyCriticalFailure: boolean,
 *   ok: boolean
 * }}
 */
export function buildReport(vitestJson) {
  const categories = {};
  for (const category of TEST_CATEGORIES) {
    categories[category.key] = emptyCategory(category);
  }

  const failures = [];
  const safetyCritical = [];

  const source =
    vitestJson && typeof vitestJson === "object" ? vitestJson : {};
  const testResults = Array.isArray(source.testResults)
    ? source.testResults
    : [];

  for (const file of testResults) {
    const fileName = (file && file.name) ?? "";
    const categoryKey = categoryForFile(fileName);
    // categoryForFile only ever returns a known key, so this is always defined.
    const bucket = categories[categoryKey];
    const assertions =
      file && Array.isArray(file.assertionResults)
        ? file.assertionResults
        : [];

    for (const assertion of assertions) {
      const status = assertion && assertion.status;
      if (status === "passed") {
        bucket.total += 1;
        bucket.passed += 1;
      } else if (status === "failed") {
        bucket.total += 1;
        bucket.failed += 1;
        const title =
          (assertion && (assertion.title ?? assertion.fullName)) ??
          "(unnamed test)";
        const messages =
          assertion && Array.isArray(assertion.failureMessages)
            ? assertion.failureMessages
            : [];
        const { expected, actual } = extractExpectedActual(messages);
        const failure = {
          category: categoryKey,
          file: fileName,
          title,
          expected,
          actual,
          messages,
          safetyCritical: isSafetyCritical(title)
        };
        bucket.failures.push(failure);
        failures.push(failure);
        if (failure.safetyCritical) {
          safetyCritical.push(failure);
        }
      }
      // Any other status (skipped/pending/todo) is intentionally not counted.
    }
  }

  const totals = CATEGORY_ORDER.reduce(
    (acc, key) => {
      const c = categories[key];
      return {
        total: acc.total + c.total,
        passed: acc.passed + c.passed,
        failed: acc.failed + c.failed
      };
    },
    { total: 0, passed: 0, failed: 0 }
  );

  return {
    categories,
    categoryOrder: [...CATEGORY_ORDER],
    totals,
    failures,
    safetyCritical,
    hasSafetyCriticalFailure: safetyCritical.length > 0,
    ok: totals.failed === 0
  };
}

/**
 * Render a human-readable report. Safety-critical failures are surfaced first
 * and prominently (Req 31.7); a per-category table follows (Req 31.2); and each
 * failing test lists its expected and actual outcome (Req 31.6).
 *
 * @param {ReturnType<typeof buildReport>} report
 * @returns {string}
 */
export function formatReport(report) {
  const lines = [];
  const pad = (s, n) => String(s).padEnd(n);
  const padNum = (n) => String(n).padStart(8);

  if (report.hasSafetyCriticalFailure) {
    lines.push("################################################################");
    lines.push("## SAFETY-CRITICAL FAILURE(S) DETECTED (Requirement 31.7)     ##");
    lines.push("################################################################");
    for (const failure of report.safetyCritical) {
      lines.push(`  ! [${failure.category}] ${failure.title}`);
      lines.push(`      file:     ${failure.file}`);
      lines.push(`      expected: ${failure.expected ?? "(see message)"}`);
      lines.push(`      actual:   ${failure.actual ?? "(see message)"}`);
    }
    lines.push("");
  }

  lines.push("Test results by category (Requirement 31.2)");
  lines.push("===========================================");
  lines.push(
    `${pad("Category", 46)}${padNum("Total")}${padNum("Passed")}${padNum("Failed")}`
  );
  for (const key of report.categoryOrder) {
    const c = report.categories[key];
    lines.push(
      `${pad(`${c.key} (Req ${c.requirement})`, 46)}${padNum(c.total)}${padNum(
        c.passed
      )}${padNum(c.failed)}`
    );
  }
  lines.push("-".repeat(46 + 8 * 3));
  lines.push(
    `${pad("ALL", 46)}${padNum(report.totals.total)}${padNum(
      report.totals.passed
    )}${padNum(report.totals.failed)}`
  );

  if (report.failures.length > 0) {
    lines.push("");
    lines.push("Failing tests (expected vs actual, Requirement 31.6)");
    lines.push("----------------------------------------------------");
    for (const failure of report.failures) {
      const flag = failure.safetyCritical ? " [SAFETY-CRITICAL]" : "";
      lines.push(`  x [${failure.category}] ${failure.title}${flag}`);
      lines.push(`      file:     ${failure.file}`);
      lines.push(`      expected: ${failure.expected ?? "(see message)"}`);
      lines.push(`      actual:   ${failure.actual ?? "(see message)"}`);
    }
  }

  lines.push("");
  lines.push(
    report.ok
      ? "PASS: all categories reported deterministic results with no failures."
      : `FAIL: ${report.totals.failed} test(s) failed across ${report.failures.length} report entr${report.failures.length === 1 ? "y" : "ies"}.`
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI entry: run the real Vitest suite and print the per-category report.
// ---------------------------------------------------------------------------

function runSuiteAndReport() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..");
  const outputFile = resolve(repoRoot, "reports/vitest-results.json");
  mkdirSync(dirname(outputFile), { recursive: true });

  const run = spawnSync(
    "npx",
    ["vitest", "run", "--reporter=json", `--outputFile=${outputFile}`],
    { stdio: ["ignore", "inherit", "inherit"], encoding: "utf8", cwd: repoRoot }
  );

  let vitestJson;
  try {
    vitestJson = JSON.parse(readFileSync(outputFile, "utf8"));
  } catch {
    console.error("Could not read Vitest JSON output at", outputFile);
    process.exit(run.status ?? 1);
    return;
  }

  const report = buildReport(vitestJson);
  console.log(`\n${formatReport(report)}`);

  // A safety-critical failure always fails the harness; otherwise fail on any
  // failed test.
  process.exit(report.ok ? 0 : 1);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  runSuiteAndReport();
}
