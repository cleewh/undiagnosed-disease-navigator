// services/timeline/src/timeline-filtering.property.test.ts
//
// Property-based test for design Correctness Property 10 (task 11.5).
//
// Feature: undiagnosed-disease-navigator, Property 10: Timeline filtering is
// sound and complete
//
// *For any* set of records and any filter combination (source, author,
// confidence range, AI-extracted status), the returned entries are exactly the
// subset of records satisfying the filter predicate — no non-matching entry is
// included and no matching entry is omitted (Requirements 4.3).
//
// The property is checked over reconstructed timelines built from arbitrary
// mixes of Encounters, Observations, and Conditions, filtered by arbitrary
// filter combinations. To exercise real matches (not just the trivially-empty
// case), filter values are drawn both randomly and from the actual entries of
// each generated timeline, so source/author/confidence/AI-extracted dimensions
// hit and miss across runs.
//
// A reference predicate — declared independently of the production
// `matchesFilters` — defines the specification of "satisfies the filter". The
// property asserts:
//   (a) soundness     — every returned entry satisfies the reference predicate;
//   (b) completeness   — every full-timeline entry satisfying the reference
//       predicate is present in the returned entries;
//   (c) exact subset   — the returned entries equal, in the same relative
//       order, exactly the entries the reference predicate keeps.

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  filterTimeline,
  type TimelineFilters
} from "./filter.js";
import {
  reconstructTimeline,
  type CaseClinicalData,
  type TimelineEntry,
  type TimelineEncounter,
  type TimelineObservation,
  type TimelineCondition
} from "./timeline.js";

// ---------------------------------------------------------------------------
// Reference specification of "satisfies the filter"
// ---------------------------------------------------------------------------

// Declared independently of the production predicate so the test pins the
// intended semantics: AND across supplied dimensions, source matches either the
// human-readable source document or the resource type, confidence bounds are
// inclusive, and an omitted dimension imposes no restriction.
function referenceMatches(entry: TimelineEntry, filters: TimelineFilters): boolean {
  if (
    filters.source !== undefined &&
    entry.sourceDocument !== filters.source &&
    entry.resourceType !== filters.source
  ) {
    return false;
  }
  if (filters.author !== undefined && entry.author !== filters.author) {
    return false;
  }
  if (filters.minConfidence !== undefined && entry.confidence < filters.minConfidence) {
    return false;
  }
  if (filters.maxConfidence !== undefined && entry.confidence > filters.maxConfidence) {
    return false;
  }
  if (filters.aiExtracted !== undefined && entry.aiExtracted !== filters.aiExtracted) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Clinical event dates confined to a valid, parseable ISO-8601 range. Dates do
// not affect the filtering property but keep the generated entries realistic.
const isoDate: fc.Arbitrary<string> = fc
  .date({
    min: new Date("1970-01-01T00:00:00.000Z"),
    max: new Date("2100-01-01T00:00:00.000Z")
  })
  .map((d) => d.toISOString());

// A small author pool keeps the chance of an author-filter match meaningful
// while still varying across runs.
const optionalAuthor = fc.option(
  fc.constantFrom("Dr. Alpha", "Dr. Beta", "Dr. Gamma", "Dr. Delta"),
  { nil: undefined }
);
const optionalFlag = fc.option(fc.boolean(), { nil: undefined });
// Includes out-of-range values so entry construction (which clamps to [0,100])
// is exercised; only the clamped confidence is what filtering sees.
const optionalConfidence = fc.option(fc.integer({ min: -50, max: 200 }), {
  nil: undefined
});

interface CommonSpec {
  author: string | undefined;
  aiExtracted: boolean | undefined;
  confidence: number | undefined;
}

const commonSpec = fc.record<CommonSpec>({
  author: optionalAuthor,
  aiExtracted: optionalFlag,
  confidence: optionalConfidence
});

const specArb = fc.record({ date: isoDate, common: commonSpec });
type Spec = { date: string; common: CommonSpec };

function encounterOf(spec: Spec, index: number): TimelineEncounter {
  return {
    resourceType: "Encounter",
    id: `enc-${index}`,
    period: { start: spec.date },
    ...spec.common
  };
}

function observationOf(spec: Spec, index: number): TimelineObservation {
  return {
    resourceType: "Observation",
    id: `obs-${index}`,
    effectiveDateTime: spec.date,
    ...spec.common
  };
}

function conditionOf(spec: Spec, index: number): TimelineCondition {
  return {
    resourceType: "Condition",
    id: `cond-${index}`,
    onsetDateTime: spec.date,
    ...spec.common
  };
}

// A whole case: any mix (including none) of encounters, observations, and
// conditions, covering the empty-timeline boundary as well.
const caseArb: fc.Arbitrary<CaseClinicalData> = fc
  .record({
    encounters: fc.array(specArb, { maxLength: 8 }),
    observations: fc.array(specArb, { maxLength: 8 }),
    conditions: fc.array(specArb, { maxLength: 8 })
  })
  .map(({ encounters, observations, conditions }) => ({
    encounters: encounters.map(encounterOf),
    observations: observations.map(observationOf),
    conditions: conditions.map(conditionOf)
  }));

// Build a filter arbitrary for a specific reconstructed timeline. Values are
// drawn both from the timeline's own entries (so filters actually match) and
// from unrelated random values (so non-matching and empty-result cases are also
// exercised). Every dimension is independently optional.
function filtersFor(entries: readonly TimelineEntry[]): fc.Arbitrary<TimelineFilters> {
  const sourcePool = [
    ...new Set([
      ...entries.map((e) => e.sourceDocument),
      ...entries.map((e) => e.resourceType),
      "Encounter",
      "Observation",
      "Condition",
      "unmatched-source"
    ])
  ];
  const authorPool = [
    ...new Set([
      ...entries.map((e) => e.author),
      "Dr. Alpha",
      "unmatched-author"
    ])
  ];

  const sourceArb = fc.option(fc.constantFrom(...sourcePool), { nil: undefined });
  const authorArb = fc.option(fc.constantFrom(...authorPool), { nil: undefined });
  const minArb = fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined });
  const maxArb = fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined });
  const aiArb = fc.option(fc.boolean(), { nil: undefined });

  return fc
    .record({
      source: sourceArb,
      author: authorArb,
      minConfidence: minArb,
      maxConfidence: maxArb,
      aiExtracted: aiArb
    })
    .map((raw) => {
      // Copy only the defined dimensions so the filter combination is clean and
      // an omitted dimension genuinely imposes no restriction.
      const filters: TimelineFilters = {};
      if (raw.source !== undefined) filters.source = raw.source;
      if (raw.author !== undefined) filters.author = raw.author;
      if (raw.minConfidence !== undefined) filters.minConfidence = raw.minConfidence;
      if (raw.maxConfidence !== undefined) filters.maxConfidence = raw.maxConfidence;
      if (raw.aiExtracted !== undefined) filters.aiExtracted = raw.aiExtracted;
      return filters;
    });
}

// A case paired with a filter combination tailored to its own entries.
const caseAndFiltersArb: fc.Arbitrary<{
  data: CaseClinicalData;
  filters: TimelineFilters;
}> = caseArb.chain((data) => {
  const entries = reconstructTimeline(data);
  return filtersFor(entries).map((filters) => ({ data, filters }));
});

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 10: Timeline filtering is sound and complete", () => {
  // Validates: Requirements 4.3
  it("returns exactly the subset of entries satisfying the filter predicate (sound and complete)", () => {
    fc.assert(
      fc.property(caseAndFiltersArb, ({ data, filters }) => {
        const full = reconstructTimeline(data);
        const result = filterTimeline(full, filters);

        const expected = full.filter((entry) => referenceMatches(entry, filters));

        // (a) Soundness: every returned entry satisfies the filter predicate.
        for (const entry of result.entries) {
          expect(referenceMatches(entry, filters)).toBe(true);
        }

        // (b) Completeness: every full-timeline entry that satisfies the
        // predicate is present in the returned entries.
        const returnedIds = new Set(result.entries.map((e) => e.entryId));
        for (const entry of expected) {
          expect(returnedIds.has(entry.entryId)).toBe(true);
        }

        // (c) Exact subset, order-preserving: the returned entries equal exactly
        // the entries the reference predicate keeps, in the same relative order.
        expect(result.entries.map((e) => e.entryId)).toEqual(
          expected.map((e) => e.entryId)
        );

        // The no-match indication is consistent with an applied-yet-empty result.
        const anyDimensionApplied =
          filters.source !== undefined ||
          filters.author !== undefined ||
          filters.minConfidence !== undefined ||
          filters.maxConfidence !== undefined ||
          filters.aiExtracted !== undefined;
        expect(result.matchedNone).toBe(
          anyDimensionApplied && expected.length === 0
        );
      }),
      { numRuns: 200 }
    );
  });
});
