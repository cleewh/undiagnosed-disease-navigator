// services/timeline/src/timeline-entry-fields.property.test.ts
//
// Property-based test for design Correctness Property 9 (task 11.4).
//
// Feature: undiagnosed-disease-navigator, Property 9: Timeline entries expose
// required fields
//
// *For any* timeline entry, the presented data includes the source document,
// author, a confidence value in the range 0 to 100, a link to the source
// object, and an AI-extracted flag (Requirements 4.2).
//
// The property is checked over reconstructed timelines built from arbitrary
// mixes of Encounters, Observations, and Conditions (including AI-extracted
// resources carrying out-of-range confidences, which the engine clamps). Every
// entry produced is asserted to expose each required Req 4.2 field with the
// correct type and, for confidence, within the inclusive [0, 100] percentage
// range and its link resolving back to a real source object (Req 4.4).

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  reconstructTimeline,
  resolveSourceObject,
  type CaseClinicalData,
  type TimelineEncounter,
  type TimelineObservation,
  type TimelineCondition
} from "./timeline.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Clinical event dates confined to a valid, parseable ISO-8601 range. The exact
// dates are irrelevant to the fields property, but keeping them valid produces
// realistic entries.
const isoDate: fc.Arbitrary<string> = fc
  .date({
    min: new Date("1970-01-01T00:00:00.000Z"),
    max: new Date("2100-01-01T00:00:00.000Z")
  })
  .map((d) => d.toISOString());

// Optional per-resource metadata. Authors may be absent (a synthetic default is
// filled in), the AI-extracted flag may be absent (defaults to false), and
// confidence deliberately includes out-of-range and NaN-adjacent values so the
// clamp-to-[0,100] behaviour is exercised.
const optionalAuthor = fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
  nil: undefined
});
const optionalFlag = fc.option(fc.boolean(), { nil: undefined });
const optionalConfidence = fc.option(fc.integer({ min: -100, max: 250 }), {
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

// A whole case: any mix of encounters, observations, and conditions. At least
// one resource across the three collections guarantees the timeline has entries
// to inspect (the empty-timeline boundary is covered by Property 8).
const caseArb: fc.Arbitrary<CaseClinicalData> = fc
  .record({
    encounters: fc.array(specArb, { maxLength: 8 }),
    observations: fc.array(specArb, { maxLength: 8 }),
    conditions: fc.array(specArb, { maxLength: 8 })
  })
  .filter(
    ({ encounters, observations, conditions }) =>
      encounters.length + observations.length + conditions.length > 0
  )
  .map(({ encounters, observations, conditions }) => ({
    encounters: encounters.map(encounterOf),
    observations: observations.map(observationOf),
    conditions: conditions.map(conditionOf)
  }));

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

describe("Feature: undiagnosed-disease-navigator, Property 9: Timeline entries expose required fields", () => {
  // Validates: Requirements 4.2
  it("exposes source document, author, confidence in [0,100], source link, and AI-extracted flag on every entry", () => {
    fc.assert(
      fc.property(caseArb, (data) => {
        const entries = reconstructTimeline(data);
        expect(entries.length).toBeGreaterThan(0);

        for (const entry of entries) {
          // Source document: a non-empty description of the originating record.
          expect(typeof entry.sourceDocument).toBe("string");
          expect(entry.sourceDocument.length).toBeGreaterThan(0);

          // Author: a non-empty attribution (synthetic default when unrecorded).
          expect(typeof entry.author).toBe("string");
          expect(entry.author.length).toBeGreaterThan(0);

          // Confidence: a finite percentage within the inclusive [0, 100] range.
          expect(typeof entry.confidence).toBe("number");
          expect(Number.isFinite(entry.confidence)).toBe(true);
          expect(entry.confidence).toBeGreaterThanOrEqual(0);
          expect(entry.confidence).toBeLessThanOrEqual(100);

          // Source link: a non-empty reference that resolves to a real object.
          expect(typeof entry.sourceObjectRef).toBe("string");
          expect(entry.sourceObjectRef.length).toBeGreaterThan(0);
          expect(resolveSourceObject(data, entry.sourceObjectRef)).toBeDefined();

          // AI-extracted flag: always present as a boolean.
          expect(typeof entry.aiExtracted).toBe("boolean");
        }
      }),
      { numRuns: 200 }
    );
  });
});
