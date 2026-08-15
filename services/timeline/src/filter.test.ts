// services/timeline/src/filter.test.ts
//
// Unit tests for deterministic timeline filtering (task 11.2).
//
// Covers each filter dimension in isolation and combined, confidence-range
// boundaries, AI-extracted true/false, the no-match case (matchedNone with
// retained filters), and the empty-filter passthrough (Req 4.3, 4.6). The
// filtering soundness/completeness property test is task 11.5.

import { describe, it, expect } from "vitest";

import { reconstructTimeline, type CaseClinicalData } from "./timeline.js";
import {
  filterTimeline,
  NO_MATCH_INDICATION,
  type TimelineFilters
} from "./filter.js";

// A case with a spread of sources, authors, confidences, and AI-extracted
// statuses so every filter dimension has both matching and non-matching data.
function sampleData(): CaseClinicalData {
  return {
    encounters: [
      {
        resourceType: "Encounter",
        id: "enc-1",
        period: { start: "2019-01-01T00:00:00.000Z" },
        class: { display: "ambulatory" },
        author: "Dr. Alpha"
        // confidence defaults to 100, aiExtracted defaults to false
      }
    ],
    observations: [
      {
        resourceType: "Observation",
        id: "obs-directed",
        effectiveDateTime: "2020-03-15T00:00:00.000Z",
        code: { text: "Synthetic lab result" },
        author: "Dr. Beta",
        confidence: 80,
        aiExtracted: false
      },
      {
        resourceType: "Observation",
        id: "obs-ai",
        effectiveDateTime: "2020-06-15T00:00:00.000Z",
        code: { text: "AI-extracted finding" },
        author: "Phenotype_Service",
        confidence: 55,
        aiExtracted: true
      }
    ],
    conditions: [
      {
        resourceType: "Condition",
        id: "cond-1",
        onsetDateTime: "2021-01-01T00:00:00.000Z",
        code: { text: "Synthetic presentation" },
        author: "Dr. Alpha",
        confidence: 30,
        aiExtracted: true
      }
    ]
  };
}

const ids = (result: { entries: { resourceId: string }[] }): string[] =>
  result.entries.map((e) => e.resourceId);

describe("empty filter (Req 4.3)", () => {
  it("returns all entries when no filter is applied", () => {
    const entries = reconstructTimeline(sampleData());
    const result = filterTimeline(entries);
    expect(result.entries).toEqual(entries);
    expect(result.matchedNone).toBe(false);
    expect(result.appliedFilters).toEqual({});
  });

  it("treats an empty filter object identically to an omitted filter", () => {
    const entries = reconstructTimeline(sampleData());
    expect(filterTimeline(entries, {})).toEqual(filterTimeline(entries));
  });

  it("preserves the input's relative order", () => {
    const entries = reconstructTimeline(sampleData());
    const result = filterTimeline(entries, {});
    expect(ids(result)).toEqual(entries.map((e) => e.resourceId));
  });
});

describe("filter by source (Req 4.3)", () => {
  it("matches by resource type", () => {
    const entries = reconstructTimeline(sampleData());
    const result = filterTimeline(entries, { source: "Observation" });
    expect(ids(result)).toEqual(["obs-directed", "obs-ai"]);
    expect(result.matchedNone).toBe(false);
  });

  it("matches by the human-readable source document string", () => {
    const entries = reconstructTimeline(sampleData());
    const source = entries.find((e) => e.resourceId === "obs-ai")!.sourceDocument;
    const result = filterTimeline(entries, { source });
    expect(ids(result)).toEqual(["obs-ai"]);
  });
});

describe("filter by author (Req 4.3)", () => {
  it("keeps only entries with the matching author", () => {
    const entries = reconstructTimeline(sampleData());
    const result = filterTimeline(entries, { author: "Dr. Alpha" });
    expect(ids(result).sort()).toEqual(["cond-1", "enc-1"]);
  });
});

describe("filter by AI-extracted status (Req 4.3)", () => {
  it("keeps only AI-extracted entries when true", () => {
    const entries = reconstructTimeline(sampleData());
    const result = filterTimeline(entries, { aiExtracted: true });
    expect(ids(result).sort()).toEqual(["cond-1", "obs-ai"]);
  });

  it("keeps only directly-recorded entries when false", () => {
    const entries = reconstructTimeline(sampleData());
    const result = filterTimeline(entries, { aiExtracted: false });
    expect(ids(result).sort()).toEqual(["enc-1", "obs-directed"]);
  });
});

describe("filter by confidence range (Req 4.3)", () => {
  it("applies an inclusive minimum bound", () => {
    const entries = reconstructTimeline(sampleData());
    const result = filterTimeline(entries, { minConfidence: 55 });
    // confidences: enc-1=100, obs-directed=80, obs-ai=55, cond-1=30
    expect(ids(result).sort()).toEqual(["enc-1", "obs-ai", "obs-directed"]);
  });

  it("applies an inclusive maximum bound", () => {
    const entries = reconstructTimeline(sampleData());
    const result = filterTimeline(entries, { maxConfidence: 55 });
    expect(ids(result).sort()).toEqual(["cond-1", "obs-ai"]);
  });

  it("includes entries exactly on the min and max boundaries", () => {
    const entries = reconstructTimeline(sampleData());
    const result = filterTimeline(entries, {
      minConfidence: 55,
      maxConfidence: 80
    });
    expect(ids(result).sort()).toEqual(["obs-ai", "obs-directed"]);
  });

  it("supports a single-value range (min === max)", () => {
    const entries = reconstructTimeline(sampleData());
    const result = filterTimeline(entries, {
      minConfidence: 100,
      maxConfidence: 100
    });
    expect(ids(result)).toEqual(["enc-1"]);
  });
});

describe("composable filters with AND semantics (Req 4.3)", () => {
  it("requires every applied dimension to match", () => {
    const entries = reconstructTimeline(sampleData());
    const filters: TimelineFilters = {
      source: "Observation",
      aiExtracted: true,
      minConfidence: 50
    };
    const result = filterTimeline(entries, filters);
    expect(ids(result)).toEqual(["obs-ai"]);
    expect(result.matchedNone).toBe(false);
  });

  it("preserves relative order in a combined filter result", () => {
    const entries = reconstructTimeline(sampleData());
    const result = filterTimeline(entries, { author: "Dr. Alpha" });
    // enc-1 (2019) precedes cond-1 (2021) in the ordered timeline.
    expect(ids(result)).toEqual(["enc-1", "cond-1"]);
  });
});

describe("no-match case retains filter selections (Req 4.6)", () => {
  it("returns an empty result flagged matchedNone with the applied filters retained", () => {
    const entries = reconstructTimeline(sampleData());
    const filters: TimelineFilters = {
      author: "Dr. Alpha",
      aiExtracted: true,
      minConfidence: 90
    };
    const result = filterTimeline(entries, filters);
    expect(result.entries).toEqual([]);
    expect(result.matchedNone).toBe(true);
    expect(result.appliedFilters).toEqual(filters);
  });

  it("does not flag matchedNone for an empty input with no filters applied", () => {
    const result = filterTimeline([]);
    expect(result.entries).toEqual([]);
    expect(result.matchedNone).toBe(false);
  });

  it("flags matchedNone when a filter is applied to an empty input", () => {
    const result = filterTimeline([], { source: "Observation" });
    expect(result.entries).toEqual([]);
    expect(result.matchedNone).toBe(true);
    expect(result.appliedFilters).toEqual({ source: "Observation" });
  });

  it("pairs matchedNone with a human-readable no-match indication", () => {
    const entries = reconstructTimeline(sampleData());
    const result = filterTimeline(entries, { author: "Nobody" });
    expect(result.matchedNone).toBe(true);
    // The UI shows NO_MATCH_INDICATION whenever matchedNone is true.
    expect(NO_MATCH_INDICATION.length).toBeGreaterThan(0);
  });
});

describe("purity and determinism", () => {
  it("does not mutate the input entries array", () => {
    const entries = reconstructTimeline(sampleData());
    const snapshot = JSON.stringify(entries);
    filterTimeline(entries, { aiExtracted: true });
    expect(JSON.stringify(entries)).toBe(snapshot);
  });

  it("produces identical output for identical input", () => {
    const entries = reconstructTimeline(sampleData());
    const filters: TimelineFilters = { minConfidence: 40, maxConfidence: 90 };
    expect(JSON.stringify(filterTimeline(entries, filters))).toBe(
      JSON.stringify(filterTimeline(entries, filters))
    );
  });
});
