// apps/api/src/auth/enforcement.test.ts
//
// Unit tests for the RBAC enforcement wrapper (task 5.3, Req 21.4, 21.5).
//
// Coverage:
//   * allowed operations run the mutation and return its result;
//   * denied operations do NOT run the mutation (target data unchanged),
//     return a not-authorised indication, and emit an audit event capturing
//     the actor identity, attempted operation, and timestamp (Req 21.4);
//   * the denial audit sink also works when an AuditRecorder is supplied;
//   * reads are filtered to only the records the role may access (Req 21.5).

import { describe, expect, it, vi } from "vitest";
import { AuditRecorder, type RecordResult } from "@udn/audit";
import type { AuditEvent } from "@udn/domain";

import type { AuthContext } from "./authorizer.js";
import {
  enforce,
  filterAuthorisedReads,
  isReadAuthorised,
  operationToAuditAction,
  type AuthorisationDenialEvent,
  type ReadAccessRequirement,
} from "./enforcement.js";

/** Build an AuthContext for a set of roles. */
function actor(
  roles: AuthContext["roles"],
  overrides: Partial<AuthContext> = {},
): AuthContext {
  return {
    userId: overrides.userId ?? "User-1",
    username: overrides.username ?? "alice",
    roles,
  };
}

/** A denial sink that captures every event it receives. */
function capturingSink(): {
  sink: (event: AuthorisationDenialEvent) => void;
  events: AuthorisationDenialEvent[];
} {
  const events: AuthorisationDenialEvent[] = [];
  return { sink: (event) => void events.push(event), events };
}

describe("enforce — allowed operations", () => {
  it("runs the mutation and returns its result when the role is permitted", async () => {
    const { sink, events } = capturingSink();
    const perform = vi.fn(async () => "created-object");

    // Case coordinator may create a case (intakeCase:create).
    const outcome = await enforce({
      actor: actor(["CaseCoordinator"]),
      action: "intakeCase:create",
      affectedObjectId: "Case-9",
      caseId: "Case-9",
      perform,
      audit: sink,
    });

    expect(outcome.authorised).toBe(true);
    if (outcome.authorised) {
      expect(outcome.result).toBe("created-object");
    }
    expect(perform).toHaveBeenCalledTimes(1);
    // No denial audit event on an allowed operation.
    expect(events).toHaveLength(0);
  });

  it("accepts the structured action form", async () => {
    const { sink } = capturingSink();
    const outcome = await enforce({
      actor: actor(["ClinicalGeneticist"]),
      action: { capability: "reviewPhenotype", operation: "update" },
      affectedObjectId: "Phenotype-1",
      caseId: "Case-1",
      perform: async () => 42,
      audit: sink,
    });

    expect(outcome.authorised).toBe(true);
    if (outcome.authorised) {
      expect(outcome.result).toBe(42);
    }
  });
});

describe("enforce — denied operations (Req 21.4)", () => {
  it("denies, leaves target data unchanged, and returns a not-authorised result", async () => {
    const { sink, events } = capturingSink();
    let sideEffect = "unchanged";
    const perform = vi.fn(() => {
      sideEffect = "MUTATED";
      return "should-not-happen";
    });

    // Researcher may NOT create a case.
    const outcome = await enforce({
      actor: actor(["Researcher"], { userId: "User-77", username: "rob" }),
      action: "intakeCase:create",
      affectedObjectId: "Case-9",
      caseId: "Case-9",
      perform,
      audit: sink,
      now: () => "2024-05-01T10:00:00.000Z",
    });

    // Mutation never ran; target data is unchanged (Req 21.4).
    expect(perform).not.toHaveBeenCalled();
    expect(sideEffect).toBe("unchanged");

    // Structured not-authorised indication.
    expect(outcome.authorised).toBe(false);
    if (!outcome.authorised) {
      expect(outcome.reason).toMatch(/not permitted/i);
    }

    // Exactly one audit event capturing actor, attempted operation, timestamp.
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.actorId).toBe("User-77");
    expect(event.actorUsername).toBe("rob");
    expect(event.attemptedAction).toBe("intakeCase:create");
    expect(event.attemptedCapability).toBe("intakeCase");
    expect(event.attemptedOperation).toBe("create");
    expect(event.affectedObjectId).toBe("Case-9");
    expect(event.at).toBe("2024-05-01T10:00:00.000Z");
    expect(event.outcome).toBe("denied");
  });

  it("treats an unknown action as a denial and records it", async () => {
    const { sink, events } = capturingSink();
    const perform = vi.fn();

    const outcome = await enforce({
      actor: actor(["Administrator"]),
      action: "notARealCapability:create" as never,
      affectedObjectId: "Obj-1",
      caseId: "Case-1",
      perform,
      audit: sink,
    });

    expect(outcome.authorised).toBe(false);
    expect(perform).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
  });

  it("records the denial through an injected AuditRecorder", async () => {
    const written: AuditEvent[] = [];
    const results: RecordResult[] = [];
    const recorder = new AuditRecorder(async (event) => {
      written.push(event);
    });
    const recordSpy = vi.spyOn(recorder, "record");

    const outcome = await enforce({
      actor: actor(["Researcher"], { userId: "User-5" }),
      action: "manageHypothesis:update",
      affectedObjectId: "Hyp-1",
      caseId: "Case-3",
      perform: async () => "nope",
      audit: recorder,
      now: () => "2024-06-01T00:00:00.000Z",
    });

    expect(outcome.authorised).toBe(false);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(1);
    const event = written[0]!;
    expect(event.entityType).toBe("AuditEvent");
    expect(event.actorId).toBe("User-5");
    expect(event.affectedObjectId).toBe("Hyp-1");
    expect(event.caseId).toBe("Case-3");
    // update maps to the "modify" audit action.
    expect(event.action).toBe("modify");
    expect(event.at).toBe("2024-06-01T00:00:00.000Z");
    void results;
  });
});

describe("operationToAuditAction", () => {
  it("maps CRUD operations to the domain audit vocabulary", () => {
    expect(operationToAuditAction("create")).toBe("create");
    expect(operationToAuditAction("read")).toBe("modify");
    expect(operationToAuditAction("update")).toBe("modify");
    expect(operationToAuditAction("delete")).toBe("delete");
  });
});

describe("isReadAuthorised (Req 21.5)", () => {
  it("permits an unrestricted record", () => {
    expect(isReadAuthorised(["Researcher"], {})).toBe(true);
  });

  it("excludes ground_truth records for every interactive role", () => {
    const requirement: ReadAccessRequirement = {
      accessClassification: "ground_truth",
    };
    expect(isReadAuthorised(["Administrator"], requirement)).toBe(false);
    expect(isReadAuthorised(["Researcher"], requirement)).toBe(false);
    expect(isReadAuthorised(["ClinicalGeneticist"], requirement)).toBe(false);
  });

  it("gates a record behind read permission for its required capability", () => {
    // Only certain roles may read runPrioritisation; Case coordinator may not.
    expect(
      isReadAuthorised(["Bioinformatician"], {
        requiredCapability: "runPrioritisation",
      }),
    ).toBe(true);
    expect(
      isReadAuthorised(["CaseCoordinator"], {
        requiredCapability: "runPrioritisation",
      }),
    ).toBe(false);
  });
});

describe("filterAuthorisedReads (Req 21.5)", () => {
  interface Record_ extends ReadAccessRequirement {
    readonly id: string;
  }

  it("returns only authorised records and excludes all others, preserving order", () => {
    const records: Record_[] = [
      { id: "a", requiredCapability: "runPrioritisation" },
      { id: "b", accessClassification: "ground_truth" },
      { id: "c" },
      { id: "d", requiredCapability: "intakeCase" },
    ];

    // Bioinformatician: may read prioritisation (a), never ground_truth (b),
    // unrestricted (c) yes, but cannot read intakeCase (d).
    const visible = filterAuthorisedReads(["Bioinformatician"], records);
    expect(visible.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("supports a selector for records that do not carry the fields directly", () => {
    const rows = [
      { key: "x", classification: "ground_truth" as const },
      { key: "y", classification: "clinical" as const },
    ];

    const visible = filterAuthorisedReads(
      ["Administrator"],
      rows,
      (row) => ({ accessClassification: row.classification }),
    );
    expect(visible.map((r) => r.key)).toEqual(["y"]);
  });

  it("returns an empty array when no record is authorised", () => {
    const records: Record_[] = [
      { id: "a", accessClassification: "ground_truth" },
      { id: "b", requiredCapability: "manageUsers" },
    ];
    // Researcher cannot read either.
    expect(filterAuthorisedReads(["Researcher"], records)).toEqual([]);
  });
});
