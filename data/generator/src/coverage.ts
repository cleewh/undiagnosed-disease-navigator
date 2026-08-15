// data/generator/src/coverage.ts
//
// Coverage verification for the synthetic case corpus. Encodes the categorical
// and diversity guarantees of Requirement 1 as explicit, machine-checkable
// assertions so a gap fails fast (in tests and in the CLI) rather than
// silently shipping an incomplete dataset.
//
// Requirement mapping:
//   Req 1.1 — at least 30 cases
//   Req 1.2 — every clinical area represented
//   Req 1.3 — at least two distinct values per diversity attribute
//   Req 1.4 — every inheritance model represented
//   Req 1.5 — at least one single-patient and one family-based case
//   Req 1.6 — every case archetype represented

import type { GeneratedCase } from "./generator.js";
import {
  CASE_ARCHETYPES,
  CLINICAL_AREAS,
  INHERITANCE_MODELS
} from "./taxonomy.js";

/** Minimum number of cases required at initial data load (Req 1.1). */
export const MINIMUM_CASE_COUNT = 30;

/**
 * The attributes that must exhibit at least two distinct values across the
 * library (Requirement 1.3). Each entry projects a case to its attribute value.
 */
const DIVERSITY_ATTRIBUTES: {
  name: string;
  project: (c: GeneratedCase) => string;
}[] = [
  { name: "age", project: (c) => c.spec.age },
  { name: "onset", project: (c) => c.spec.onset },
  { name: "sex", project: (c) => c.spec.sex },
  { name: "familyStructure", project: (c) => c.spec.familyStructure },
  { name: "ancestry", project: (c) => c.spec.ancestry },
  { name: "inheritanceModel", project: (c) => c.spec.inheritanceModel },
  { name: "recordCompleteness", project: (c) => c.spec.recordCompleteness },
  { name: "genomicTestHistory", project: (c) => c.spec.genomicTestHistory },
  { name: "diagnosticOutcome", project: (c) => c.spec.diagnosticOutcome }
];

/** Count occurrences of each string value produced by `project`. */
function tally(
  cases: readonly GeneratedCase[],
  project: (c: GeneratedCase) => string
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of cases) {
    const key = project(c);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** A structured, human-readable summary of the corpus coverage. */
export interface CoverageSummary {
  caseCount: number;
  clinicalAreas: Record<string, number>;
  archetypes: Record<string, number>;
  inheritanceModels: Record<string, number>;
  familyStructures: Record<string, number>;
  singlePatientCount: number;
  familyBasedCount: number;
  distinctValueCounts: Record<string, number>;
}

/** Compute a coverage summary for a generated corpus. */
export function summariseCoverage(
  cases: readonly GeneratedCase[]
): CoverageSummary {
  const distinctValueCounts: Record<string, number> = {};
  for (const attr of DIVERSITY_ATTRIBUTES) {
    distinctValueCounts[attr.name] = Object.keys(
      tally(cases, attr.project)
    ).length;
  }

  return {
    caseCount: cases.length,
    clinicalAreas: tally(cases, (c) => c.spec.clinicalArea),
    archetypes: tally(cases, (c) => c.spec.archetype),
    inheritanceModels: tally(cases, (c) => c.spec.inheritanceModel),
    familyStructures: tally(cases, (c) => c.spec.familyStructure),
    singlePatientCount: cases.filter((c) => !c.spec.familyBased).length,
    familyBasedCount: cases.filter((c) => c.spec.familyBased).length,
    distinctValueCounts
  };
}

/** Result of verifying a corpus against the Requirement 1 guarantees. */
export interface CoverageVerification {
  ok: boolean;
  problems: string[];
  summary: CoverageSummary;
}

/**
 * Verify a generated corpus against all Requirement 1 coverage guarantees.
 * Returns every problem found (rather than throwing) so callers can report the
 * complete picture.
 */
export function verifyCoverage(
  cases: readonly GeneratedCase[]
): CoverageVerification {
  const summary = summariseCoverage(cases);
  const problems: string[] = [];

  // Req 1.1
  if (summary.caseCount < MINIMUM_CASE_COUNT) {
    problems.push(
      `Req 1.1: expected at least ${MINIMUM_CASE_COUNT} cases, found ${summary.caseCount}`
    );
  }

  // Req 1.2
  for (const area of CLINICAL_AREAS) {
    if (!summary.clinicalAreas[area]) {
      problems.push(`Req 1.2: clinical area "${area}" is not represented`);
    }
  }

  // Req 1.4
  for (const model of INHERITANCE_MODELS) {
    if (!summary.inheritanceModels[model]) {
      problems.push(`Req 1.4: inheritance model "${model}" is not represented`);
    }
  }

  // Req 1.5
  if (summary.singlePatientCount < 1) {
    problems.push("Req 1.5: no single-patient case is present");
  }
  if (summary.familyBasedCount < 1) {
    problems.push("Req 1.5: no family-based case is present");
  }

  // Req 1.6
  for (const archetype of CASE_ARCHETYPES) {
    if (!summary.archetypes[archetype]) {
      problems.push(`Req 1.6: case archetype "${archetype}" is not represented`);
    }
  }

  // Req 1.3
  for (const [name, distinct] of Object.entries(summary.distinctValueCounts)) {
    if (distinct < 2) {
      problems.push(
        `Req 1.3: attribute "${name}" has ${distinct} distinct value(s), expected at least 2`
      );
    }
  }

  return { ok: problems.length === 0, problems, summary };
}
