// services/contradiction/src/detection.test.ts
//
// Unit tests for deterministic contradiction detection and resolution (task
// 15.1). Covers: mutually-exclusive present/absent -> one unresolved
// contradiction linking both sources (Req 7.1, 7.3, 7.4); differing onset ages
// -> a contradiction (Req 7.1); agreeing evidence -> none (Req 7.1); byte-for-
// byte determinism; authorised resolution records all fields and sets resolved
// (Req 7.6); unauthorised resolution is rejected and leaves the record
// unchanged (Req 7.7); and the optional retry wrapper (Req 7.2 support).

import { describe, it, expect } from "vitest";

import {
  detectContradictions,
  resolveContradiction,
  evaluateWithRetry,
  valuesConflict,
  entityAttributeOf,
  EVALUATION_INCOMPLETE_INDICATION,
  type ContradictionEvidenceItem,
  type DetectContradictionsOptions
} from "./detection.js";

const OPTIONS: DetectContradictionsOptions = {
  caseId: "case-1",
  createdById: "system",
  source: "Contradiction_Service",
  now: "2024-01-01T00:00:00.000Z"
};

describe("valuesConflict predicate (Req 7.1)", () => {
  it("treats distinct values as mutually exclusive", () => {
    expect(valuesConflict("present", "absent")).toBe(true);
    expect(valuesConflict(3, 7)).toBe(true);
  });

  it("treats equal values (trimmed strings) as non-conflicting", () => {
    expect(valuesConflict("present", " present ")).toBe(false);
    expect(valuesConflict(5, 5)).toBe(false);
  });

  it("distinguishes values by type (5 vs \"5\")", () => {
    expect(valuesConflict(5, "5")).toBe(true);
  });
});

describe("detectContradictions present/absent (Req 7.1, 7.3, 7.4)", () => {
  const items: ContradictionEvidenceItem[] = [
    {
      sourceRef: "Observation/obs-1",
      caseEntityId: "patient-1",
      attribute: "phenotype:HP:0001250",
      value: "present",
      status: "confirmed"
    },
    {
      sourceRef: "ClinicalDocument/doc-9",
      caseEntityId: "patient-1",
      attribute: "phenotype:HP:0001250",
      value: "absent",
      status: "candidate"
    }
  ];

  it("creates exactly one unresolved contradiction", () => {
    const records = detectContradictions(items, OPTIONS);
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.status).toBe("unresolved");
    expect(record.entityType).toBe("Contradiction");
    expect(record.resolution).toBeUndefined();
  });

  it("links both conflicting source objects (>= 2), sorted", () => {
    const record = detectContradictions(items, OPTIONS)[0]!;
    expect(record.conflictingSourceRefs).toEqual([
      "ClinicalDocument/doc-9",
      "Observation/obs-1"
    ]);
    expect(record.conflictingSourceRefs.length).toBeGreaterThanOrEqual(2);
  });

  it("records the entity and attribute in conflict", () => {
    const record = detectContradictions(items, OPTIONS)[0]!;
    expect(record.entityAttribute).toBe(
      entityAttributeOf("patient-1", "phenotype:HP:0001250")
    );
    expect(record.caseId).toBe("case-1");
  });

  it("evaluates both confirmed and candidate evidence", () => {
    // The conflict above spans a confirmed and a candidate item; swapping the
    // statuses must still produce the contradiction.
    const swapped = items.map((i) => ({
      ...i,
      status: i.status === "confirmed" ? ("candidate" as const) : ("confirmed" as const)
    }));
    expect(detectContradictions(swapped, OPTIONS)).toHaveLength(1);
  });
});

describe("detectContradictions differing onset ages (Req 7.1)", () => {
  it("flags two sources asserting different onset ages", () => {
    const items: ContradictionEvidenceItem[] = [
      { sourceRef: "Observation/onset-a", caseEntityId: "patient-1", attribute: "onsetAge", value: 3 },
      { sourceRef: "Observation/onset-b", caseEntityId: "patient-1", attribute: "onsetAge", value: 7 }
    ];
    const records = detectContradictions(items, OPTIONS);
    expect(records).toHaveLength(1);
    expect(records[0]!.entityAttribute).toBe(entityAttributeOf("patient-1", "onsetAge"));
    expect(records[0]!.conflictingSourceRefs).toEqual([
      "Observation/onset-a",
      "Observation/onset-b"
    ]);
  });

  it("links every distinct source when three or more disagree", () => {
    const items: ContradictionEvidenceItem[] = [
      { sourceRef: "s-c", caseEntityId: "patient-1", attribute: "onsetAge", value: 5 },
      { sourceRef: "s-a", caseEntityId: "patient-1", attribute: "onsetAge", value: 6 },
      { sourceRef: "s-b", caseEntityId: "patient-1", attribute: "onsetAge", value: 7 }
    ];
    const record = detectContradictions(items, OPTIONS)[0]!;
    expect(record.conflictingSourceRefs).toEqual(["s-a", "s-b", "s-c"]);
  });
});

describe("detectContradictions no conflict (Req 7.1)", () => {
  it("returns none when all agree on a value", () => {
    const items: ContradictionEvidenceItem[] = [
      { sourceRef: "s-1", caseEntityId: "patient-1", attribute: "sex", value: "female" },
      { sourceRef: "s-2", caseEntityId: "patient-1", attribute: "sex", value: "female" }
    ];
    expect(detectContradictions(items, OPTIONS)).toEqual([]);
  });

  it("returns none across different attributes / entities", () => {
    const items: ContradictionEvidenceItem[] = [
      { sourceRef: "s-1", caseEntityId: "patient-1", attribute: "onsetAge", value: 3 },
      { sourceRef: "s-2", caseEntityId: "patient-1", attribute: "sex", value: "male" },
      { sourceRef: "s-3", caseEntityId: "patient-2", attribute: "onsetAge", value: 7 }
    ];
    expect(detectContradictions(items, OPTIONS)).toEqual([]);
  });

  it("returns none for an empty input", () => {
    expect(detectContradictions([], OPTIONS)).toEqual([]);
  });

  it("does not flag a single source asserting two values (cannot link 2 sources)", () => {
    const items: ContradictionEvidenceItem[] = [
      { sourceRef: "same-source", caseEntityId: "patient-1", attribute: "phenotype:HP:1", value: "present" },
      { sourceRef: "same-source", caseEntityId: "patient-1", attribute: "phenotype:HP:1", value: "absent" }
    ];
    expect(detectContradictions(items, OPTIONS)).toEqual([]);
  });
});

describe("determinism (same input -> same output)", () => {
  const items: ContradictionEvidenceItem[] = [
    { sourceRef: "s-z", caseEntityId: "patient-2", attribute: "familyHistory", value: "positive" },
    { sourceRef: "s-a", caseEntityId: "patient-2", attribute: "familyHistory", value: "negative" },
    { sourceRef: "lab", caseEntityId: "patient-1", attribute: "labValue", value: "high" },
    { sourceRef: "narrative", caseEntityId: "patient-1", attribute: "labValue", value: "normal" }
  ];

  it("produces byte-identical output for identical input", () => {
    const a = JSON.stringify(detectContradictions(items, OPTIONS));
    const b = JSON.stringify(detectContradictions(items, OPTIONS));
    expect(a).toBe(b);
  });

  it("is independent of input ordering", () => {
    const shuffled = [...items].reverse();
    expect(JSON.stringify(detectContradictions(shuffled, OPTIONS))).toBe(
      JSON.stringify(detectContradictions(items, OPTIONS))
    );
  });

  it("emits multiple records in a stable sorted order", () => {
    const records = detectContradictions(items, OPTIONS);
    expect(records).toHaveLength(2);
    const keys = records.map((r) => r.entityAttribute);
    expect(keys).toEqual([...keys].sort());
  });
});

describe("resolveContradiction authorised (Req 7.6)", () => {
  it("records outcome, rationale, reviewer, timestamp and sets resolved", () => {
    const record = detectContradictions(
      [
        { sourceRef: "a", caseEntityId: "p", attribute: "x", value: "present" },
        { sourceRef: "b", caseEntityId: "p", attribute: "x", value: "absent" }
      ],
      OPTIONS
    )[0]!;

    const result = resolveContradiction(record, {
      outcome: "kept_present",
      rationale: "Confirmed on repeat examination.",
      reviewerId: "reviewer-1",
      at: "2024-02-02T10:00:00.000Z",
      isAuthorised: true
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.status).toBe("resolved");
    expect(result.record.resolution).toEqual({
      outcome: "kept_present",
      rationale: "Confirmed on repeat examination.",
      byId: "reviewer-1",
      at: "2024-02-02T10:00:00.000Z"
    });
    // Envelope version bumped and modifiedAt updated (Req 23.5).
    expect(result.record.version).toBe(record.version + 1);
    expect(result.record.modifiedAt).toBe("2024-02-02T10:00:00.000Z");
    // The input record is not mutated.
    expect(record.status).toBe("unresolved");
    expect(record.resolution).toBeUndefined();
  });
});

describe("resolveContradiction unauthorised (Req 7.7)", () => {
  it("rejects, retains the record unresolved, and returns an authorisation error", () => {
    const record = detectContradictions(
      [
        { sourceRef: "a", caseEntityId: "p", attribute: "x", value: "present" },
        { sourceRef: "b", caseEntityId: "p", attribute: "x", value: "absent" }
      ],
      OPTIONS
    )[0]!;

    const result = resolveContradiction(record, {
      outcome: "kept_present",
      rationale: "attempted",
      reviewerId: "intruder",
      at: "2024-02-02T10:00:00.000Z",
      isAuthorised: false
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_authorised");
    expect(result.error.reviewerId).toBe("intruder");
    // Record retained unchanged in its unresolved status.
    expect(result.record).toBe(record);
    expect(result.record.status).toBe("unresolved");
    expect(result.record.resolution).toBeUndefined();
  });
});

describe("evaluateWithRetry (Req 7.2 support)", () => {
  it("returns detected contradictions when evaluation completes", () => {
    const items: ContradictionEvidenceItem[] = [
      { sourceRef: "a", caseEntityId: "p", attribute: "x", value: "present" },
      { sourceRef: "b", caseEntityId: "p", attribute: "x", value: "absent" }
    ];
    const result = evaluateWithRetry(() => detectContradictions(items, OPTIONS));
    expect(result.status).toBe("completed");
    expect(result.attempts).toBe(1);
    expect(result.contradictions).toHaveLength(1);
    expect(result.indication).toBeUndefined();
  });

  it("retries up to 3 times and retains prior records on repeated failure", () => {
    const prior = detectContradictions(
      [
        { sourceRef: "a", caseEntityId: "p", attribute: "x", value: "present" },
        { sourceRef: "b", caseEntityId: "p", attribute: "x", value: "absent" }
      ],
      OPTIONS
    );
    let calls = 0;
    const result = evaluateWithRetry(
      () => {
        calls++;
        throw new Error("evaluation failed");
      },
      prior
    );
    expect(calls).toBe(3);
    expect(result.status).toBe("incomplete");
    expect(result.attempts).toBe(3);
    expect(result.contradictions).toEqual(prior);
    expect(result.indication).toBe(EVALUATION_INCOMPLETE_INDICATION);
  });

  it("recovers if a later attempt succeeds", () => {
    let calls = 0;
    const result = evaluateWithRetry(() => {
      calls++;
      if (calls < 2) throw new Error("transient");
      return [];
    });
    expect(result.status).toBe("completed");
    expect(result.attempts).toBe(2);
  });
});
