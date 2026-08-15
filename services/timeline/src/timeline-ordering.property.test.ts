// services/timeline/src/timeline-ordering.property.test.ts
//
// Property-based test for design Correctness Property 8 (task 11.3).
//
// Feature: undiagnosed-disease-navigator, Property 8: Timeline is a sorted
// permutation of the source records
//
// *For any* set of clinical records, the reconstructed timeline is a
// permutation of those records ordered non-decreasing by clinical event date
// (oldest to most recent) (Requirements 4.1).
//
// The property is checked in two halves:
//   (a) permutation  — the multiset of `<resourceType>/<id>` references on the
//       reconstructed timeline is exactly the multiset of references in the
//       source clinical data: no record is lost, dropped, or duplicated.
//   (b) ordering      — consecutive entries are non-decreasing by parsed
//       clinical event date, so the timeline runs oldest-to-newest (Req 4.1).

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  reconstructTimeline,
  type CaseClinicalData,
  type TimelineEncounter,
  type TimelineObservation,
  type TimelineCondition
} from "./timeline.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Clinical event dates confined to a valid, parseable ISO-8601 range so the
// ordering half of the property compares well-defined instants. The range is
// intentionally wide (multiple decades) to exercise ordering across eras.
const isoDate: fc.Arbitrary<string> = fc
  .date({
    min: new Date("1970-01-01T00:00:00.000Z"),
    max: new Date("2100-01-01T00:00:00.000Z")
  })
  .map((d) => d.toISOString());

// Optional per-resource metadata. These do not affect ordering or the
// permutation, but varying them keeps the generated corpus realistic.
const optionalAuthor = fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
  nil: undefined
});
const optionalFlag = fc.option(fc.boolean(), { nil: undefined });
// Includes out-of-range values so entry construction (which clamps) is also
// exercised; confidence has no bearing on the ordering property.
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

// A raw spec pairs a clinical event date with the shared optional metadata; a
// stable, type-unique id is assigned by index when the case is assembled so
// that every source reference is distinct and unambiguous.
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
// conditions, covering the empty-timeline boundary as well as tie-sharing
// dates across resource types.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The multiset of `<resourceType>/<id>` references present in the source data. */
function sourceRefMultiset(data: CaseClinicalData): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (ref: string): void => {
    counts.set(ref, (counts.get(ref) ?? 0) + 1);
  };
  for (const e of data.encounters ?? []) bump(`Encounter/${e.id}`);
  for (const o of data.observations ?? []) bump(`Observation/${o.id}`);
  for (const c of data.conditions ?? []) bump(`Condition/${c.id}`);
  return counts;
}

/** The multiset of source-object references produced on the timeline. */
function entryRefMultiset(refs: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ref of refs) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  return counts;
}

function multisetsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, count] of a) {
    if (b.get(key) !== count) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Property 8
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 8: Timeline is a sorted permutation of the source records", () => {
  // Validates: Requirements 4.1
  it("reconstructs a permutation of the source records ordered non-decreasing by clinical event date", () => {
    fc.assert(
      fc.property(caseArb, (data) => {
        const entries = reconstructTimeline(data);

        const sourceCount =
          (data.encounters?.length ?? 0) +
          (data.observations?.length ?? 0) +
          (data.conditions?.length ?? 0);

        // (a) Permutation: same count and same multiset of source references —
        // no record lost, dropped, or duplicated.
        expect(entries).toHaveLength(sourceCount);
        const expected = sourceRefMultiset(data);
        const actual = entryRefMultiset(entries.map((e) => e.sourceObjectRef));
        expect(multisetsEqual(expected, actual)).toBe(true);
        // Every entry's identity keys agree with its source reference.
        for (const entry of entries) {
          expect(entry.sourceObjectRef).toBe(
            `${entry.resourceType}/${entry.resourceId}`
          );
        }

        // (b) Ordering: consecutive entries are non-decreasing by clinical
        // event date (oldest to most recent).
        for (let i = 1; i < entries.length; i++) {
          const prev = Date.parse(entries[i - 1]!.eventDate);
          const curr = Date.parse(entries[i]!.eventDate);
          expect(prev).toBeLessThanOrEqual(curr);
        }
      }),
      { numRuns: 200 }
    );
  });
});
