// Unit tests for the deterministic RBAC permission engine (task 5.2, Req 21.3).
// These verify the compiled matrix matches design.md verbatim, that authorize()
// is a pure additive-roles decision, and that the denied / edge cases behave.

import { describe, it, expect } from "vitest";
import { USER_ROLES, type UserRole } from "@udn/domain";
import {
  authorize,
  permittedOperations,
  roleCan,
  isCapability,
  isOperation,
  CAPABILITIES,
  OPERATIONS,
  RBAC_MATRIX,
  type Capability,
  type Operation,
} from "./rbac.js";

/**
 * The authoritative expected matrix, transcribed independently from design.md
 * as compact CRUD codes, used to cross-check the compiled RBAC_MATRIX so a
 * transcription drift in the engine is caught here.
 */
const EXPECTED: Record<Capability, Record<UserRole, string>> = {
  viewCase: {
    ClinicalGeneticist: "R",
    Bioinformatician: "R",
    GeneticCounsellor: "R",
    MedicalSpecialist: "R",
    Researcher: "R",
    CaseCoordinator: "R",
    Administrator: "R",
  },
  intakeCase: {
    ClinicalGeneticist: "",
    Bioinformatician: "",
    GeneticCounsellor: "",
    MedicalSpecialist: "",
    Researcher: "",
    CaseCoordinator: "C",
    Administrator: "C",
  },
  requestPhenotypeExtraction: {
    ClinicalGeneticist: "C",
    Bioinformatician: "",
    GeneticCounsellor: "C",
    MedicalSpecialist: "C",
    Researcher: "",
    CaseCoordinator: "",
    Administrator: "",
  },
  reviewPhenotype: {
    ClinicalGeneticist: "CRU",
    Bioinformatician: "",
    GeneticCounsellor: "",
    MedicalSpecialist: "CRU",
    Researcher: "",
    CaseCoordinator: "",
    Administrator: "U",
  },
  resolveContradiction: {
    ClinicalGeneticist: "RU",
    Bioinformatician: "RU",
    GeneticCounsellor: "RU",
    MedicalSpecialist: "RU",
    Researcher: "",
    CaseCoordinator: "",
    Administrator: "U",
  },
  configureGapRules: {
    ClinicalGeneticist: "",
    Bioinformatician: "",
    GeneticCounsellor: "",
    MedicalSpecialist: "",
    Researcher: "",
    CaseCoordinator: "",
    Administrator: "CU",
  },
  createAnalysisRequest: {
    ClinicalGeneticist: "",
    Bioinformatician: "C",
    GeneticCounsellor: "",
    MedicalSpecialist: "",
    Researcher: "",
    CaseCoordinator: "C",
    Administrator: "",
  },
  approveAnalysisRun: {
    ClinicalGeneticist: "",
    Bioinformatician: "U",
    GeneticCounsellor: "",
    MedicalSpecialist: "U",
    Researcher: "",
    CaseCoordinator: "",
    Administrator: "U",
  },
  runPrioritisation: {
    ClinicalGeneticist: "R",
    Bioinformatician: "CR",
    GeneticCounsellor: "",
    MedicalSpecialist: "R",
    Researcher: "R",
    CaseCoordinator: "",
    Administrator: "",
  },
  manageHypothesis: {
    ClinicalGeneticist: "CRU",
    Bioinformatician: "RU",
    GeneticCounsellor: "RU",
    MedicalSpecialist: "CRU",
    Researcher: "R",
    CaseCoordinator: "",
    Administrator: "U",
  },
  mdtCollaboration: {
    ClinicalGeneticist: "CRU",
    Bioinformatician: "CRU",
    GeneticCounsellor: "CRU",
    MedicalSpecialist: "CRU",
    Researcher: "R",
    CaseCoordinator: "CRU",
    Administrator: "U",
  },
  manageDisposition: {
    ClinicalGeneticist: "CRU",
    Bioinformatician: "",
    GeneticCounsellor: "RU",
    MedicalSpecialist: "CRU",
    Researcher: "",
    CaseCoordinator: "CRU",
    Administrator: "U",
  },
  manageKnowledge: {
    ClinicalGeneticist: "",
    Bioinformatician: "",
    GeneticCounsellor: "",
    MedicalSpecialist: "",
    Researcher: "C",
    CaseCoordinator: "",
    Administrator: "CU",
  },
  approveReanalysisRun: {
    ClinicalGeneticist: "CRU",
    Bioinformatician: "RU",
    GeneticCounsellor: "RU",
    MedicalSpecialist: "CRU",
    Researcher: "",
    CaseCoordinator: "",
    Administrator: "U",
  },
  viewAudit: {
    ClinicalGeneticist: "R",
    Bioinformatician: "R",
    GeneticCounsellor: "R",
    MedicalSpecialist: "R",
    Researcher: "R",
    CaseCoordinator: "R",
    Administrator: "R",
  },
  manageUsers: {
    ClinicalGeneticist: "",
    Bioinformatician: "",
    GeneticCounsellor: "",
    MedicalSpecialist: "",
    Researcher: "",
    CaseCoordinator: "",
    Administrator: "CRUD",
  },
  accessGroundTruth: {
    ClinicalGeneticist: "",
    Bioinformatician: "",
    GeneticCounsellor: "",
    MedicalSpecialist: "",
    Researcher: "",
    CaseCoordinator: "",
    Administrator: "",
  },
};

const CODE_TO_OP: Record<string, Operation> = {
  C: "create",
  R: "read",
  U: "update",
  D: "delete",
};

function expectedOps(code: string): Set<Operation> {
  return new Set([...code].map((c) => CODE_TO_OP[c] as Operation));
}

describe("RBAC_MATRIX", () => {
  it("covers every capability for every role", () => {
    for (const capability of CAPABILITIES) {
      for (const role of USER_ROLES) {
        expect(RBAC_MATRIX[capability][role]).toBeInstanceOf(Set);
      }
    }
  });

  it("matches the design matrix cell-for-cell", () => {
    for (const capability of CAPABILITIES) {
      for (const role of USER_ROLES) {
        const actual = [...RBAC_MATRIX[capability][role]].sort();
        const expected = [...expectedOps(EXPECTED[capability][role])].sort();
        expect(actual, `${capability} / ${role}`).toEqual(expected);
      }
    }
  });
});

describe("authorize", () => {
  it("allows every role to read a case/timeline (Req 21.3)", () => {
    for (const role of USER_ROLES) {
      expect(authorize([role], "viewCase:read").allow).toBe(true);
    }
  });

  it("allows every role to view the audit viewer", () => {
    for (const role of USER_ROLES) {
      expect(authorize([role], "viewAudit:read").allow).toBe(true);
    }
  });

  it("permits a clinical geneticist to create/read/update phenotype review", () => {
    expect(authorize(["ClinicalGeneticist"], "reviewPhenotype:create").allow).toBe(true);
    expect(authorize(["ClinicalGeneticist"], "reviewPhenotype:read").allow).toBe(true);
    expect(authorize(["ClinicalGeneticist"], "reviewPhenotype:update").allow).toBe(true);
    expect(authorize(["ClinicalGeneticist"], "reviewPhenotype:delete").allow).toBe(false);
  });

  it("denies phenotype review to a bioinformatician and leaves a reason", () => {
    const decision = authorize(["Bioinformatician"], "reviewPhenotype:update");
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBeTruthy();
  });

  it("treats roles additively (union of permissions)", () => {
    // Bioinformatician cannot review phenotype, ClinicalGeneticist can.
    const decision = authorize(
      ["Bioinformatician", "ClinicalGeneticist"],
      "reviewPhenotype:create",
    );
    expect(decision.allow).toBe(true);
  });

  it("only the Administrator may manage users (CRUD)", () => {
    for (const op of OPERATIONS) {
      expect(authorize(["Administrator"], { capability: "manageUsers", operation: op }).allow).toBe(true);
    }
    for (const role of USER_ROLES.filter((r) => r !== "Administrator")) {
      expect(authorize([role], "manageUsers:read").allow).toBe(false);
    }
  });

  it("denies Ground_Truth access to every interactive role for every operation", () => {
    for (const role of USER_ROLES) {
      for (const op of OPERATIONS) {
        const decision = authorize([role], { capability: "accessGroundTruth", operation: op });
        expect(decision.allow, `${role}/${op}`).toBe(false);
      }
    }
  });

  it("denies when the caller has no roles", () => {
    expect(authorize([], "viewCase:read").allow).toBe(false);
  });

  it("denies an unknown action string", () => {
    const decision = authorize(["Administrator"], "notACapability:read" as never);
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain("Unknown action");
  });

  it("is deterministic for identical inputs", () => {
    const a = authorize(["MedicalSpecialist"], "manageHypothesis:create");
    const b = authorize(["MedicalSpecialist"], "manageHypothesis:create");
    expect(a).toEqual(b);
  });

  describe("approveAnalysisRun approver-role refinement", () => {
    it("allows the matching approver role", () => {
      expect(
        authorize(["Bioinformatician"], "approveAnalysisRun:update", {
          requiredApproverRole: "Bioinformatician",
        }).allow,
      ).toBe(true);
    });

    it("denies a non-matching approver role even with the matrix grant", () => {
      const decision = authorize(["MedicalSpecialist"], "approveAnalysisRun:update", {
        requiredApproverRole: "Bioinformatician",
      });
      expect(decision.allow).toBe(false);
    });

    it("lets an Administrator approve any workflow", () => {
      expect(
        authorize(["Administrator"], "approveAnalysisRun:update", {
          requiredApproverRole: "Bioinformatician",
        }).allow,
      ).toBe(true);
    });

    it("falls back to the plain matrix when no approver role is required", () => {
      expect(authorize(["MedicalSpecialist"], "approveAnalysisRun:update").allow).toBe(true);
    });
  });
});

describe("helpers", () => {
  it("roleCan agrees with permittedOperations", () => {
    for (const capability of CAPABILITIES) {
      for (const role of USER_ROLES) {
        const ops = permittedOperations(role, capability);
        for (const op of OPERATIONS) {
          expect(roleCan(role, capability, op)).toBe(ops.has(op));
        }
      }
    }
  });

  it("type guards recognise valid and reject invalid identifiers", () => {
    expect(isCapability("viewCase")).toBe(true);
    expect(isCapability("nope")).toBe(false);
    expect(isOperation("create")).toBe(true);
    expect(isOperation("destroy")).toBe(false);
  });
});
