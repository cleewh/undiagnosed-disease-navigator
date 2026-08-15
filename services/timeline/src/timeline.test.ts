// services/timeline/src/timeline.test.ts
//
// Unit tests for deterministic timeline reconstruction (task 11.1).
//
// Covers: chronological ordering oldest-to-newest (Req 4.1), the
// `(timestamp, resourceType, resourceId)` tie-break and byte-identical
// determinism (Req 4.1, 4.4), per-entry required fields (Req 4.2), the empty
// case (Req 4.5), navigation to the linked source object (Req 4.4), and
// graceful handling of an unresolvable source reference (Req 4.7). The
// exhaustive ordering property test is task 11.3.

import { describe, it, expect } from "vitest";
import { generateCorpus, type CaseArtifacts } from "@udn/data-generator";

import {
  reconstructTimeline,
  buildTimeline,
  selectEntry,
  resolveSourceObject,
  EMPTY_TIMELINE_INDICATION,
  type CaseClinicalData,
  type TimelineEncounter,
  type TimelineObservation,
  type TimelineCondition
} from "./timeline.js";

// A small hand-built case with intentionally out-of-order and tie-sharing
// events so ordering and the tie-break are both exercised.
function sampleData(): CaseClinicalData {
  const encounters: TimelineEncounter[] = [
    {
      resourceType: "Encounter",
      id: "enc-late",
      period: { start: "2022-06-01T00:00:00.000Z" },
      class: { display: "ambulatory" }
    },
    {
      resourceType: "Encounter",
      id: "enc-early",
      period: { start: "2019-01-01T00:00:00.000Z" },
      class: { display: "ambulatory" }
    }
  ];
  const observations: TimelineObservation[] = [
    {
      resourceType: "Observation",
      id: "obs-tie-b",
      // Shares its instant with the condition below to force a tie-break.
      effectiveDateTime: "2020-03-15T00:00:00.000Z",
      code: { text: "Synthetic lab result" }
    },
    {
      resourceType: "Observation",
      id: "obs-tie-a",
      effectiveDateTime: "2020-03-15T00:00:00.000Z",
      code: { text: "Synthetic imaging" }
    }
  ];
  const conditions: TimelineCondition[] = [
    {
      resourceType: "Condition",
      id: "cond-tie",
      onsetDateTime: "2020-03-15T00:00:00.000Z",
      code: { text: "Synthetic presentation" }
    }
  ];
  return { encounters, observations, conditions };
}

describe("reconstructTimeline ordering (Req 4.1)", () => {
  it("orders entries oldest-to-newest by clinical event date", () => {
    const entries = reconstructTimeline(sampleData());
    const dates = entries.map((e) => e.eventDate);
    const sorted = [...dates].sort((a, b) => Date.parse(a) - Date.parse(b));
    expect(dates).toEqual(sorted);
    expect(entries[0]?.resourceId).toBe("enc-early");
    expect(entries.at(-1)?.resourceId).toBe("enc-late");
  });

  it("is a permutation of the source records (no loss, no duplication)", () => {
    const data = sampleData();
    const entries = reconstructTimeline(data);
    const expectedCount =
      (data.encounters?.length ?? 0) +
      (data.observations?.length ?? 0) +
      (data.conditions?.length ?? 0);
    expect(entries).toHaveLength(expectedCount);
    const refs = new Set(entries.map((e) => e.sourceObjectRef));
    expect(refs.size).toBe(expectedCount);
  });
});

describe("reconstructTimeline tie-break (timestamp, resourceType, resourceId)", () => {
  it("breaks equal timestamps by resourceType then resourceId", () => {
    const entries = reconstructTimeline(sampleData());
    // The three events at 2020-03-15 must appear in the fixed tie-break order:
    // Condition < Observation by resourceType, then Observation ids ascending.
    const tied = entries
      .filter((e) => e.eventDate === "2020-03-15T00:00:00.000Z")
      .map((e) => `${e.resourceType}/${e.resourceId}`);
    expect(tied).toEqual([
      "Condition/cond-tie",
      "Observation/obs-tie-a",
      "Observation/obs-tie-b"
    ]);
  });

  it("produces byte-identical output for identical input", () => {
    const a = JSON.stringify(reconstructTimeline(sampleData()));
    const b = JSON.stringify(reconstructTimeline(sampleData()));
    expect(a).toBe(b);
  });

  it("is order-independent of the input arrays", () => {
    const data = sampleData();
    const shuffled: CaseClinicalData = {
      encounters: [...(data.encounters ?? [])].reverse(),
      observations: [...(data.observations ?? [])].reverse(),
      conditions: data.conditions
    };
    expect(JSON.stringify(reconstructTimeline(shuffled))).toBe(
      JSON.stringify(reconstructTimeline(data))
    );
  });
});

describe("timeline entry required fields (Req 4.2)", () => {
  it("exposes source document, author, confidence 0-100, source link, and AI-extracted flag", () => {
    const entries = reconstructTimeline(sampleData());
    for (const entry of entries) {
      expect(typeof entry.sourceDocument).toBe("string");
      expect(entry.sourceDocument.length).toBeGreaterThan(0);
      expect(typeof entry.author).toBe("string");
      expect(entry.author.length).toBeGreaterThan(0);
      expect(entry.confidence).toBeGreaterThanOrEqual(0);
      expect(entry.confidence).toBeLessThanOrEqual(100);
      expect(entry.sourceObjectRef).toBe(
        `${entry.resourceType}/${entry.resourceId}`
      );
      expect(typeof entry.aiExtracted).toBe("boolean");
    }
  });

  it("defaults structured FHIR data to confidence 100 and aiExtracted false", () => {
    const [entry] = reconstructTimeline(sampleData());
    expect(entry?.confidence).toBe(100);
    expect(entry?.aiExtracted).toBe(false);
  });

  it("honours overridden author, confidence, and AI-extracted flag and clamps confidence", () => {
    const data: CaseClinicalData = {
      observations: [
        {
          resourceType: "Observation",
          id: "obs-ai",
          effectiveDateTime: "2021-01-01T00:00:00.000Z",
          code: { text: "AI-extracted finding" },
          author: "Phenotype_Service",
          aiExtracted: true,
          confidence: 250
        }
      ]
    };
    const [entry] = reconstructTimeline(data);
    expect(entry?.author).toBe("Phenotype_Service");
    expect(entry?.aiExtracted).toBe(true);
    expect(entry?.confidence).toBe(100);
  });
});

describe("empty timeline (Req 4.5)", () => {
  it("returns an empty array for a case with no clinical records", () => {
    expect(reconstructTimeline({})).toEqual([]);
  });

  it("reports the empty-state indication via buildTimeline", () => {
    const result = buildTimeline({});
    expect(result.isEmpty).toBe(true);
    expect(result.entries).toEqual([]);
    expect(result.indication).toBe(EMPTY_TIMELINE_INDICATION);
  });

  it("does not report empty when records exist", () => {
    const result = buildTimeline(sampleData());
    expect(result.isEmpty).toBe(false);
    expect(result.indication).toBeUndefined();
    expect(result.entries.length).toBeGreaterThan(0);
  });
});

describe("navigation to the linked source object (Req 4.4, 4.7)", () => {
  it("selectEntry returns the source-object reference", () => {
    const [entry] = reconstructTimeline(sampleData());
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(selectEntry(entry)).toBe(entry.sourceObjectRef);
  });

  it("resolves a valid reference back to its originating resource", () => {
    const data = sampleData();
    const [entry] = reconstructTimeline(data);
    if (!entry) throw new Error("expected an entry");
    const resolved = resolveSourceObject(data, entry.sourceObjectRef);
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe(entry.resourceId);
    expect(resolved?.resourceType).toBe(entry.resourceType);
  });

  it("returns undefined for an unresolvable reference (Req 4.7)", () => {
    expect(resolveSourceObject(sampleData(), "Encounter/does-not-exist")).toBeUndefined();
    expect(resolveSourceObject({}, "Observation/anything")).toBeUndefined();
  });
});

describe("works on real synthetic FHIR records from @udn/data-generator", () => {
  it("reconstructs an ordered, fully-populated timeline for a generated case", () => {
    const corpus = generateCorpus({ withArtifacts: true });
    const generated = corpus.cases[0]!;
    const bundle: CaseArtifacts = corpus.artifacts![generated.case.caseId]!;

    // The generator's FhirRecord is structurally compatible with
    // CaseClinicalData; pass it directly.
    const entries = reconstructTimeline(bundle.fhir);

    const expectedCount =
      bundle.fhir.encounters.length +
      bundle.fhir.observations.length +
      bundle.fhir.conditions.length;
    expect(entries).toHaveLength(expectedCount);

    // Non-decreasing by clinical event date (Req 4.1).
    for (let i = 1; i < entries.length; i++) {
      const prev = Date.parse(entries[i - 1]!.eventDate);
      const curr = Date.parse(entries[i]!.eventDate);
      expect(prev).toBeLessThanOrEqual(curr);
    }

    // Every entry carries the required fields (Req 4.2).
    for (const entry of entries) {
      expect(entry.sourceDocument.length).toBeGreaterThan(0);
      expect(entry.author.length).toBeGreaterThan(0);
      expect(entry.confidence).toBe(100);
      expect(entry.aiExtracted).toBe(false);
      expect(resolveSourceObject(bundle.fhir, entry.sourceObjectRef)).toBeDefined();
    }

    // Deterministic: same generated input -> byte-identical output.
    expect(JSON.stringify(reconstructTimeline(bundle.fhir))).toBe(
      JSON.stringify(entries)
    );
  });
});
