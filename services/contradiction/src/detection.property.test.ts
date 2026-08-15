// services/contradiction/src/detection.property.test.ts
//
// Property-based test for exact contradiction detection (Contradiction_Service,
// task 15.2).
//
// Feature: undiagnosed-disease-navigator, Property 18: Contradiction detection
// is exact
//
// Validates: Requirements 7.1, 7.3, 7.4
//
// Property 18 (design): for any set of confirmed and candidate evidence items,
// the detected contradictions are exactly those groups asserting mutually
// exclusive values for the same attribute of the same case entity; each created
// record has unresolved status and links at least two conflicting source
// objects.
//
// This test drives `detectContradictions` with randomly generated evidence and
// compares its output against an INDEPENDENT oracle derived straight from the
// acceptance criteria: a contradiction exists for a (caseEntityId, attribute)
// group exactly when the group carries two or more mutually exclusive values
// (distinct canonical value keys, per Req 7.1) contributed by two or more
// distinct source objects (so the minimum two conflicting sources of Req 7.4
// can be linked). The comparison establishes exactness in both directions: no
// false positives (nothing detected that the oracle does not expect) and no
// false negatives (everything the oracle expects is detected).

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  detectContradictions,
  entityAttributeOf,
  type ContradictionEvidenceItem,
  type EvidenceValue,
  type DetectContradictionsOptions
} from "./detection.js";

const OPTIONS: DetectContradictionsOptions = {
  caseId: "case-1",
  createdById: "system",
  source: "Contradiction_Service",
  now: "2024-01-01T00:00:00.000Z"
};

/**
 * Independent canonical key for a value, mirroring the acceptance-criteria
 * notion of "mutually exclusive values" (Req 7.1): strings are trimmed so
 * "present" and " present " denote the same assertion, and the runtime type is
 * folded in so the number 5 and the string "5" are distinct assertions. Two
 * values are mutually exclusive exactly when their canonical keys differ.
 */
function oracleValueKey(value: EvidenceValue): string {
  const normalised = typeof value === "string" ? value.trim() : String(value);
  return `${typeof value}:${normalised}`;
}

/**
 * Oracle: the set of composite entity/attribute keys that SHOULD yield a
 * contradiction, plus, per key, the distinct conflicting source refs. Derived
 * only from the acceptance criteria, independent of the implementation.
 */
interface ExpectedContradiction {
  entityAttribute: string;
  sources: string[];
}

function expectedContradictions(
  items: readonly ContradictionEvidenceItem[]
): Map<string, ExpectedContradiction> {
  interface Acc {
    caseEntityId: string;
    attribute: string;
    valueKeys: Set<string>;
    sources: Set<string>;
  }
  const groups = new Map<string, Acc>();
  for (const item of items) {
    const key = `${item.caseEntityId}\u0000${item.attribute}`;
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        caseEntityId: item.caseEntityId,
        attribute: item.attribute,
        valueKeys: new Set<string>(),
        sources: new Set<string>()
      };
      groups.set(key, acc);
    }
    acc.valueKeys.add(oracleValueKey(item.value));
    acc.sources.add(item.sourceRef);
  }

  const expected = new Map<string, ExpectedContradiction>();
  for (const acc of groups.values()) {
    // Mutually exclusive values (>= 2 distinct keys) from >= 2 distinct sources.
    if (acc.valueKeys.size >= 2 && acc.sources.size >= 2) {
      const entityAttribute = entityAttributeOf(acc.caseEntityId, acc.attribute);
      expected.set(entityAttribute, {
        entityAttribute,
        sources: [...acc.sources].sort()
      });
    }
  }
  return expected;
}

// ---------------------------------------------------------------------------
// Smart generators
// ---------------------------------------------------------------------------
//
// Draw from small pools so that collisions on (entity, attribute) and on
// sources/values are frequent. This concentrates generated inputs on the
// interesting region of the space where agreements, single-source multi-value
// groups, and genuine multi-source conflicts all arise, rather than scattering
// unique tuples that never interact.

const entityArb = fc.constantFrom("patient-1", "patient-2", "phenotype-1");
const attributeArb = fc.constantFrom(
  "phenotype:HP:0001250",
  "onsetAge",
  "sex",
  "familyHistory"
);
const sourceArb = fc.constantFrom(
  "Observation/obs-1",
  "ClinicalDocument/doc-9",
  "Observation/onset-a",
  "narrative",
  "lab"
);

// Values span strings (including whitespace variants to exercise trimming),
// numbers, booleans, and a numeric string to exercise type-based distinction.
const valueArb: fc.Arbitrary<EvidenceValue> = fc.oneof(
  fc.constantFrom<EvidenceValue>(
    "present",
    " present ",
    "absent",
    "female",
    "male",
    "5",
    3,
    5,
    7,
    true,
    false
  ),
  fc.integer({ min: 0, max: 4 }),
  fc.string({ maxLength: 4 })
);

const evidenceItemArb: fc.Arbitrary<ContradictionEvidenceItem> = fc.record({
  sourceRef: sourceArb,
  caseEntityId: entityArb,
  attribute: attributeArb,
  value: valueArb,
  status: fc.constantFrom<"confirmed" | "candidate">("confirmed", "candidate")
});

const evidenceItemsArb: fc.Arbitrary<ContradictionEvidenceItem[]> = fc.array(
  evidenceItemArb,
  { maxLength: 12 }
);

describe("Property 18: Contradiction detection is exact", () => {
  // Feature: undiagnosed-disease-navigator, Property 18: Contradiction
  // detection is exact
  // Validates: Requirements 7.1, 7.3, 7.4
  it("detects a contradiction exactly for each mutually-exclusive multi-source group (no false positives or negatives), each record unresolved and linking >= 2 sources", () => {
    fc.assert(
      fc.property(evidenceItemsArb, (items) => {
        const expected = expectedContradictions(items);
        const records = detectContradictions(items, OPTIONS);

        // Exactness of the DETECTED SET: one record per expected group and no
        // others. Equal counts plus every detected key being expected implies
        // a bijection (no false positives, no false negatives) (Property 18).
        expect(records).toHaveLength(expected.size);

        const detectedKeys = records.map((r) => r.entityAttribute);
        // No duplicate records for the same entity/attribute group.
        expect(new Set(detectedKeys).size).toBe(detectedKeys.length);

        for (const record of records) {
          const match = expected.get(record.entityAttribute);
          // No false positive: every detected group is one the oracle expects.
          expect(match).toBeDefined();
          if (!match) continue;

          // Each created record is unresolved and never auto-resolved (Req 7.3).
          expect(record.status).toBe("unresolved");
          expect(record.entityType).toBe("Contradiction");
          expect(record.resolution).toBeUndefined();

          // Links every distinct conflicting source, minimum two (Req 7.4),
          // sorted and de-duplicated, exactly matching the oracle.
          expect(record.conflictingSourceRefs.length).toBeGreaterThanOrEqual(2);
          expect(record.conflictingSourceRefs).toEqual(match.sources);
          expect(new Set(record.conflictingSourceRefs).size).toBe(
            record.conflictingSourceRefs.length
          );
        }

        // No false negative: every expected group is present in the output.
        for (const key of expected.keys()) {
          expect(detectedKeys).toContain(key);
        }
      }),
      { numRuns: 200 }
    );
  });
});
