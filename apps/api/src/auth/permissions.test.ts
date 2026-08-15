// apps/api/src/auth/permissions.test.ts
//
// Permission tests for allowed and disallowed cases (task 5.6, Req 31.4).
//
// The design's testing section states: "Permission [...] tests each assert
// expected outcomes for allowed and disallowed cases (Requirement 31.4)."
// Unlike the matrix-wide property tests (5.4/5.5), these are focused,
// EXAMPLE-BASED assertions: each test names a specific role, capability, and
// operation and asserts the SPECIFIC expected allow/deny outcome drawn from the
// design RBAC matrix. Both an allowed and a disallowed case are asserted for
// each capability area so the permission contract is pinned in both directions.

import { describe, expect, it, vi } from "vitest";
import { USER_ROLES } from "@udn/domain";

import { authorize } from "./rbac.js";
import {
  enforce,
  filterAuthorisedReads,
  type AuthorisationDenialEvent,
  type ReadAccessRequirement,
} from "./enforcement.js";
import type { AuthContext } from "./authorizer.js";

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

// ---------------------------------------------------------------------------
// Case intake (Req 31.4): CaseCoordinator allowed, Researcher denied.
// ---------------------------------------------------------------------------

describe("permissions — case intake", () => {
  it("ALLOWS a CaseCoordinator to create a case (intakeCase:create)", () => {
    expect(authorize(["CaseCoordinator"], "intakeCase:create").allow).toBe(true);
  });

  it("DENIES a Researcher from creating a case (intakeCase:create)", () => {
    const decision = authorize(["Researcher"], "intakeCase:create");
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBeTruthy();
  });

  it("ALLOWS an Administrator to create a case, DENIES a ClinicalGeneticist", () => {
    expect(authorize(["Administrator"], "intakeCase:create").allow).toBe(true);
    expect(authorize(["ClinicalGeneticist"], "intakeCase:create").allow).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Phenotype review (Req 31.4): ClinicalGeneticist allowed, Bioinformatician denied.
// ---------------------------------------------------------------------------

describe("permissions — phenotype review", () => {
  it("ALLOWS a ClinicalGeneticist to create a phenotype review (reviewPhenotype:create)", () => {
    expect(
      authorize(["ClinicalGeneticist"], "reviewPhenotype:create").allow,
    ).toBe(true);
  });

  it("DENIES a Bioinformatician from creating a phenotype review (reviewPhenotype:create)", () => {
    const decision = authorize(["Bioinformatician"], "reviewPhenotype:create");
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBeTruthy();
  });

  it("ALLOWS a MedicalSpecialist to update a phenotype review, DENIES delete for everyone", () => {
    expect(
      authorize(["MedicalSpecialist"], "reviewPhenotype:update").allow,
    ).toBe(true);
    // No role holds delete on reviewPhenotype in the matrix.
    for (const role of USER_ROLES) {
      expect(
        authorize([role], "reviewPhenotype:delete").allow,
        `${role} must not delete reviewPhenotype`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// User management (Req 31.4): only the Administrator, for every operation.
// ---------------------------------------------------------------------------

describe("permissions — user management", () => {
  it("ALLOWS the Administrator to create/read/update/delete users (manageUsers CRUD)", () => {
    expect(authorize(["Administrator"], "manageUsers:create").allow).toBe(true);
    expect(authorize(["Administrator"], "manageUsers:read").allow).toBe(true);
    expect(authorize(["Administrator"], "manageUsers:update").allow).toBe(true);
    expect(authorize(["Administrator"], "manageUsers:delete").allow).toBe(true);
  });

  it("DENIES every non-Administrator role from managing users for every operation", () => {
    const others = USER_ROLES.filter((r) => r !== "Administrator");
    for (const role of others) {
      for (const op of ["create", "read", "update", "delete"] as const) {
        expect(
          authorize([role], `manageUsers:${op}`).allow,
          `${role} must not ${op} manageUsers`,
        ).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Ground_Truth (Req 31.4): denied to EVERY interactive role, every operation.
// ---------------------------------------------------------------------------

describe("permissions — Ground_Truth access", () => {
  it("DENIES accessGroundTruth to every interactive role for every operation", () => {
    for (const role of USER_ROLES) {
      for (const op of ["create", "read", "update", "delete"] as const) {
        expect(
          authorize([role], `accessGroundTruth:${op}`).allow,
          `${role} must not ${op} accessGroundTruth`,
        ).toBe(false);
      }
    }
  });

  it("DENIES accessGroundTruth even when combined with the Administrator role", () => {
    expect(
      authorize(["Administrator", "Researcher"], "accessGroundTruth:read").allow,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Enforcement side effects (Req 31.4): denied does not mutate + audits; allowed runs.
// ---------------------------------------------------------------------------

describe("permissions — enforcement side effects", () => {
  it("DENIED enforce() emits an audit denial and does NOT mutate", async () => {
    const events: AuthorisationDenialEvent[] = [];
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
      audit: (event) => void events.push(event),
      now: () => "2024-05-01T10:00:00.000Z",
    });

    expect(outcome.authorised).toBe(false);
    // Mutation never ran; target data unchanged.
    expect(perform).not.toHaveBeenCalled();
    expect(sideEffect).toBe("unchanged");
    // Exactly one denial audit event, capturing actor + attempted op + timestamp.
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.outcome).toBe("denied");
    expect(event.actorId).toBe("User-77");
    expect(event.attemptedAction).toBe("intakeCase:create");
    expect(event.at).toBe("2024-05-01T10:00:00.000Z");
  });

  it("ALLOWED enforce() runs the mutation and emits NO denial audit event", async () => {
    const events: AuthorisationDenialEvent[] = [];
    const perform = vi.fn(async () => "created-object");

    // CaseCoordinator may create a case.
    const outcome = await enforce({
      actor: actor(["CaseCoordinator"]),
      action: "intakeCase:create",
      affectedObjectId: "Case-9",
      caseId: "Case-9",
      perform,
      audit: (event) => void events.push(event),
    });

    expect(outcome.authorised).toBe(true);
    if (outcome.authorised) {
      expect(outcome.result).toBe("created-object");
    }
    expect(perform).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Filtered reads (Req 31.4): authorised records included, others excluded.
// ---------------------------------------------------------------------------

describe("permissions — filtered reads", () => {
  interface Row extends ReadAccessRequirement {
    readonly id: string;
  }

  it("EXCLUDES a Ground_Truth record and INCLUDES an unrestricted one on read", () => {
    const rows: Row[] = [
      { id: "unrestricted" },
      { id: "ground-truth", accessClassification: "ground_truth" },
    ];
    const visible = filterAuthorisedReads(["ClinicalGeneticist"], rows);
    expect(visible.map((r) => r.id)).toEqual(["unrestricted"]);
  });

  it("INCLUDES a capability-gated record for an authorised role, EXCLUDES it for a denied role", () => {
    const rows: Row[] = [{ id: "prio", requiredCapability: "runPrioritisation" }];
    // Bioinformatician may read runPrioritisation; CaseCoordinator may not.
    expect(
      filterAuthorisedReads(["Bioinformatician"], rows).map((r) => r.id),
    ).toEqual(["prio"]);
    expect(filterAuthorisedReads(["CaseCoordinator"], rows)).toEqual([]);
  });
});
