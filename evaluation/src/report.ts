// evaluation/src/report.ts
//
// Evaluation report rendering (Requirement 30.8).
//
// When scoring completes, the framework produces an evaluation report in both
// JSON and HTML, each containing every computed metric. Both renderers are pure
// functions of the {@link EvaluationReport}, so identical input yields identical
// output.

import type { EvaluationReport } from "./evaluate.js";
import { NOT_RANKED, type Rank } from "./metrics.js";

/** Render the evaluation report as deterministic, pretty-printed JSON (Req 30.8). */
export function renderJsonReport(report: EvaluationReport): string {
  return JSON.stringify(report, null, 2);
}

/** Escape a string for safe inclusion in HTML text/attribute content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format a ratio metric to four decimal places. */
function formatMetric(value: number): string {
  return value.toFixed(4);
}

/** Format a rank value for display. */
function formatRank(rank: Rank): string {
  return rank === NOT_RANKED ? "not-ranked" : String(rank);
}

function metricRow(label: string, value: number): string {
  return `<tr><td>${escapeHtml(label)}</td><td>${formatMetric(value)}</td></tr>`;
}

function metricTable(title: string, rows: readonly string[]): string {
  return [
    `<section><h2>${escapeHtml(title)}</h2>`,
    "<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>",
    ...rows,
    "</tbody></table></section>"
  ].join("\n");
}

function phenotypeSection(report: EvaluationReport): string {
  const m = report.phenotype;
  return metricTable("Phenotype extraction (Req 30.1)", [
    metricRow("precision", m.precision),
    metricRow("recall", m.recall),
    metricRow("f1", m.f1),
    metricRow("assertion accuracy", m.assertionAccuracy),
    metricRow("onset accuracy", m.onsetAccuracy),
    metricRow("HPO-mapping accuracy", m.hpoMappingAccuracy),
    metricRow("unsupported-term rate", m.unsupportedTermRate)
  ]);
}

function prioritisationSection(report: EvaluationReport): string {
  const m = report.prioritisation;
  const rankRows = m.perCase
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.caseId)}</td><td>${formatRank(
          r.causalVariantRank
        )}</td><td>${formatRank(r.causalGeneRank)}</td></tr>`
    )
    .join("\n");
  const aggregate = metricTable("Variant prioritisation (Req 30.2)", [
    metricRow("top-5 recall", m.top5Recall),
    metricRow("top-10 recall", m.top10Recall),
    metricRow("inheritance-filter accuracy", m.inheritanceFilterAccuracy)
  ]);
  const perCase = [
    "<section><h3>Per-case ranks</h3>",
    "<table><thead><tr><th>Case</th><th>Causal variant rank</th><th>Causal gene rank</th></tr></thead><tbody>",
    rankRows,
    "</tbody></table></section>"
  ].join("\n");
  return `${aggregate}\n${perCase}`;
}

function reanalysisSection(report: EvaluationReport): string {
  const m = report.reanalysis;
  return metricTable("Reanalysis matching (Req 30.3)", [
    metricRow("retrieval correctness", m.retrievalCorrectness),
    metricRow("false-positive rate", m.falsePositiveRate),
    metricRow("explanation completeness", m.explanationCompleteness),
    metricRow("evidence linkage", m.evidenceLinkage),
    metricRow("ranking-change accuracy", m.rankingChangeAccuracy)
  ]);
}

function groundingSection(report: EvaluationReport): string {
  const m = report.grounding;
  return metricTable("AI grounding (Req 30.4)", [
    metricRow("valid-source-reference rate", m.validSourceReferenceRate),
    metricRow("unsupported-claim rate", m.unsupportedClaimRate),
    metricRow("incorrect-source-link rate", m.incorrectSourceLinkRate),
    metricRow("missing-uncertainty rate", m.missingUncertaintyRate),
    metricRow("output-validation failure rate", m.outputValidationFailureRate)
  ]);
}

function safetySection(report: EvaluationReport): string {
  const rows = report.safety
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.id)}</td><td>${
          c.passed ? "PASS" : "FAIL"
        }</td><td>${escapeHtml(c.detail)}</td></tr>`
    )
    .join("\n");
  return [
    "<section><h2>Workflow-safety checks (Req 30.5)</h2>",
    "<table><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>",
    rows,
    "</tbody></table></section>"
  ].join("\n");
}

function exclusionsSection(report: EvaluationReport): string {
  if (report.exclusions.length === 0) {
    return "<section><h2>Exclusions (Req 30.7)</h2><p>No entries were excluded.</p></section>";
  }
  const rows = report.exclusions
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.metricFamily)}</td><td>${escapeHtml(
          e.caseId ?? "-"
        )}</td><td>${escapeHtml(e.reason)}</td><td>${escapeHtml(
          e.detail
        )}</td></tr>`
    )
    .join("\n");
  return [
    "<section><h2>Exclusions (Req 30.7)</h2>",
    "<table><thead><tr><th>Metric family</th><th>Case</th><th>Reason</th><th>Detail</th></tr></thead><tbody>",
    rows,
    "</tbody></table></section>"
  ].join("\n");
}

/**
 * Render the evaluation report as a self-contained HTML document containing
 * every computed metric, the safety checks, and the exclusion log (Req 30.8).
 */
export function renderHtmlReport(report: EvaluationReport): string {
  const sections = [
    phenotypeSection(report),
    prioritisationSection(report),
    reanalysisSection(report),
    groundingSection(report),
    safetySection(report),
    exclusionsSection(report)
  ].join("\n");

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    "<title>Evaluation Report</title>",
    "</head>",
    "<body>",
    "<h1>Evaluation Report</h1>",
    `<p>Generated at ${escapeHtml(report.generatedAt)}</p>`,
    sections,
    "</body>",
    "</html>"
  ].join("\n");
}

/** Both rendered report formats (Req 30.8). */
export interface RenderedReports {
  json: string;
  html: string;
}

/** Render both the JSON and HTML reports for a completed evaluation (Req 30.8). */
export function renderReports(report: EvaluationReport): RenderedReports {
  return {
    json: renderJsonReport(report),
    html: renderHtmlReport(report)
  };
}
