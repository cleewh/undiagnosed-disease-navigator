// services/intake/src/ground-truth-access.test.ts
//
// Unit tests for the Ground_Truth access-restriction guard (task 8.2,
// Requirements 3.6, 2.10, 30.6).
//
// Verifies the core safety property: read/write access to a Ground_Truth
// artifact is granted ONLY to the Evaluation_Framework identity, and every
// other principal — including all seven interactive roles and any other
// non-evaluation kind — is denied with an authorization error and receives no
// data. Also verifies the intake seam routes a referenced Ground_Truth file
// through the guard so non-evaluation callers cannot read it.

import { describe, it, expect } from "vitest";
import { USER_ROLES, type UserRole } from "@udn/domain";
import { SingleTableRepository, InMemoryDocumentClient } from "@udn/persistence";
import {
  generateCorpus,
  type CaseArtifacts,
  type GeneratedCase
} from "@udn/data-generator";

import {
  accessGroundTruth,
  authorizeGroundTruthAccess,
  evaluationFrameworkPrincipal,
  isEvaluationFramework,
  sealGroundTruth,
  GroundTruthAccessError,
  GROUND_TRUTH_ACCESS_DENIED,
  EVALUATION_FRAMEWORK_IDENTITY,
  type GroundTruthAccessMode,
  type Principal
} from "./ground-truth-access.js";
import { ingestCase, type IngestArtifact, type IngestCaseInput } from "./intake.js";

/** The Evaluation_Framework identity — the sole authorised principal. */
const evalPrincipal: Principal = evaluationFrameworkPrincipal();

/** One non-evaluation principal per interactive role (all 7). */
const rolePrincipals: Principal[] = USER_ROLES.map((role: UserRole) => ({
  id: `user-${role}`,
  kind: "InteractiveUser",
  roles: [role]
}));

/** Additional non-evaluation principals (service + anonymous). */
const otherNonEvalPrincipals: Principal[] = [
  { id: "intake-service", kind: "Service" },
  { id: "some-service", kind: "Service", roles: ["Administrator"] },
  { id: "anon", kind: "Anonymous" }
];

const allNonEvalPrincipals: Principal[] = [
  ...rolePrincipals,
  ...otherNonEvalPrincipals
];

const MODES: GroundTruthAccessMode[] = ["read", "write"];

describe("isEvaluationFramework", () => {
  it("recognises the Evaluation_Framework identity", () => {
    expect(isEvaluationFramework(evalPrincipal)).toBe(true);
    expect(evalPrincipal.kind).toBe(EVALUATION_FRAMEWORK_IDENTITY);
  });

  it("rejects every non-evaluation principal, including all 7 roles", () => {
    for (const principal of allNonEvalPrincipals) {
      expect(isEvaluationFramework(principal)).toBe(false);
    }
  });
});

describe("accessGroundTruth (Req 3.6, 2.10, 30.6)", () => {
  const payload = { caseId: "SYN-CASE-001", answer: "intended-diagnosis" };
  const sealed = sealGroundTruth("ground-truth/SYN-CASE-001", payload);

  it("returns the data for the Evaluation_Framework principal (read)", () => {
    expect(accessGroundTruth(evalPrincipal, sealed, "read")).toEqual(payload);
  });

  it("returns the data for the Evaluation_Framework principal (write)", () => {
    expect(accessGroundTruth(evalPrincipal, sealed, "write")).toEqual(payload);
  });

  it("defaults to read mode for the Evaluation_Framework principal", () => {
    expect(accessGroundTruth(evalPrincipal, sealed)).toEqual(payload);
  });

  it("denies every one of the 7 interactive roles for read and write", () => {
    for (const principal of rolePrincipals) {
      for (const mode of MODES) {
        expect(() => accessGroundTruth(principal, sealed, mode)).toThrow(
          GroundTruthAccessError
        );
      }
    }
  });

  it("denies every other non-evaluation principal for read and write", () => {
    for (const principal of otherNonEvalPrincipals) {
      for (const mode of MODES) {
        expect(() => accessGroundTruth(principal, sealed, mode)).toThrow(
          GroundTruthAccessError
        );
      }
    }
  });

  it("attaches a structured authorization error with no data leaked", () => {
    const principal = rolePrincipals[0]!;
    try {
      accessGroundTruth(principal, sealed, "write");
      expect.unreachable("expected a GroundTruthAccessError");
    } catch (err) {
      expect(err).toBeInstanceOf(GroundTruthAccessError);
      const gtErr = err as GroundTruthAccessError;
      expect(gtErr.code).toBe(GROUND_TRUTH_ACCESS_DENIED);
      expect(gtErr.mode).toBe("write");
      expect(gtErr.principalId).toBe(principal.id);
      expect(gtErr.principalKind).toBe(principal.kind);
      expect(gtErr.resource).toBe("ground-truth/SYN-CASE-001");
      // The error message must never contain the protected payload.
      expect(gtErr.message).not.toContain("intended-diagnosis");
    }
  });
});

describe("authorizeGroundTruthAccess (non-throwing decision)", () => {
  it("allows the Evaluation_Framework for read and write", () => {
    for (const mode of MODES) {
      expect(
        authorizeGroundTruthAccess(evalPrincipal, mode, "gt/1").allow
      ).toBe(true);
    }
  });

  it("denies every non-evaluation principal with a structured error", () => {
    for (const principal of allNonEvalPrincipals) {
      for (const mode of MODES) {
        const decision = authorizeGroundTruthAccess(principal, mode, "gt/1");
        expect(decision.allow).toBe(false);
        if (!decision.allow) {
          expect(decision.error).toBeInstanceOf(GroundTruthAccessError);
          expect(decision.error.code).toBe(GROUND_TRUTH_ACCESS_DENIED);
          expect(decision.error.mode).toBe(mode);
        }
      }
    }
  });
});

describe("sealed handle does not expose the payload", () => {
  it("keeps the payload off the handle's own properties", () => {
    const secret = { caseId: "SYN-CASE-002", answer: "top-secret" };
    const sealed = sealGroundTruth("ground-truth/SYN-CASE-002", secret);
    // The handle reveals only classification + resource, never the payload.
    expect(sealed.accessClassification).toBe("ground_truth");
    expect(sealed.resource).toBe("ground-truth/SYN-CASE-002");
    expect(JSON.stringify(sealed)).not.toContain("top-secret");
  });
});

// --- Intake seam integration -----------------------------------------------

function inputFromGenerated(
  generated: GeneratedCase,
  artifacts: CaseArtifacts,
  groundTruthRef?: string
): IngestCaseInput {
  const createdById = "test-intake-actor";
  const mk = (
    name: string,
    kind: IngestArtifact["kind"],
    content: unknown
  ): IngestArtifact => ({
    name,
    kind,
    content,
    sourceId: `${generated.case.caseId}-${name}`,
    versionId: "gen-v1",
    createdById
  });

  const items: IngestArtifact[] = [
    mk("fhir", "fhir", artifacts.fhir),
    mk("phenopacket", "phenopacket", artifacts.phenopacket),
    mk("pedigree", "pedigree", artifacts.pedigree),
    mk("vcf", "vcf", artifacts.vcf),
    mk("annotation", "annotation", artifacts.annotation),
    mk("qc", "qc", artifacts.qc),
    mk("candidates", "candidates", artifacts.candidates)
  ];
  if (artifacts.inheritanceResults) {
    items.push(mk("inheritance", "inheritance", artifacts.inheritanceResults));
  }

  return {
    caseId: generated.case.caseId,
    caseMetadata: {
      clinicalArea: generated.spec.clinicalArea,
      archetype: generated.spec.archetype,
      inheritanceModel: generated.spec.inheritanceModel,
      familyBased: generated.spec.familyBased
    },
    artifacts: items,
    createdById,
    ...(groundTruthRef !== undefined ? { groundTruthRef } : {})
  };
}

describe("intake seam routes Ground_Truth through the guard (Req 3.6)", () => {
  const corpus = generateCorpus({ withArtifacts: true });
  const first = corpus.cases[0]!;
  const artifacts = corpus.artifacts![first.case.caseId]!;

  it("returns a sealed Ground_Truth handle when a case references one", async () => {
    const repo = new SingleTableRepository(new InMemoryDocumentClient());
    const ref = `ground-truth/${first.case.caseId}`;
    const result = await ingestCase(repo, inputFromGenerated(first, artifacts, ref));

    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.groundTruth).toBeDefined();
    const sealed = result.groundTruth!;
    expect(sealed.accessClassification).toBe("ground_truth");
    expect(sealed.resource).toBe(ref);

    // Only the Evaluation_Framework can open the referenced Ground_Truth.
    const opened = accessGroundTruth(evalPrincipal, sealed);
    expect(opened.caseId).toBe(first.case.caseId);
    expect(opened.ref).toBe(ref);

    // Every non-evaluation principal is denied.
    for (const principal of allNonEvalPrincipals) {
      expect(() => accessGroundTruth(principal, sealed)).toThrow(
        GroundTruthAccessError
      );
    }
  });

  it("omits the Ground_Truth handle when no reference is provided", async () => {
    const repo = new SingleTableRepository(new InMemoryDocumentClient());
    const result = await ingestCase(repo, inputFromGenerated(first, artifacts));
    expect(result.status).toBe("created");
    if (result.status !== "created") return;
    expect(result.groundTruth).toBeUndefined();
  });
});
