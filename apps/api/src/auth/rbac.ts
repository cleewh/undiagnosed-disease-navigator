// apps/api/src/auth/rbac.ts
//
// Deterministic RBAC permission engine for the Undiagnosed Disease Navigator
// (Auth_Service, design "Auth_Service, Cognito, and the RBAC Matrix").
//
// Task 5.2 (Req 21.3): encode the design's role/capability matrix as data and
// expose a PURE, DETERMINISTIC function that evaluates create/read/update/
// delete permission per role exactly as the matrix specifies.
//
// This module contains NO I/O, NO generative-model calls, and NO enforcement
// side effects. It answers a single question — "may these roles perform this
// operation on this capability?" — and returns a structured allow/deny result.
//
// The enforcement wrapper that denies operations, leaves target data
// unchanged, emits audit events, and filters reads (Req 21.4, 21.5) is task
// 5.3 and consumes the {@link authorize} function and {@link RBAC_MATRIX}
// exported here. The capability/operation identifiers defined below are the
// stable contract 5.3 will use.

import { type UserRole } from "@udn/domain";

/**
 * The four data operations the RBAC matrix gates (Req 21.3). These map onto
 * the C/R/U/D columns of the design matrix.
 */
export type Operation = "create" | "read" | "update" | "delete";

/** Canonical ordering of {@link Operation} values. */
export const OPERATIONS: readonly Operation[] = [
  "create",
  "read",
  "update",
  "delete",
];

/**
 * The capabilities (rows) of the design RBAC matrix. Each identifier is the
 * stable contract downstream enforcement (task 5.3) uses to name a role-gated
 * operation. Identifiers deliberately avoid the `:` character so a capability
 * and operation can be combined into a `"capability:operation"` action string.
 */
export const CAPABILITIES = [
  /** View case / timeline. */
  "viewCase",
  /** Intake / create a case. */
  "intakeCase",
  /** Request phenotype extraction (via the AI_Gateway). */
  "requestPhenotypeExtraction",
  /** Approve / reject / edit a phenotype candidate. */
  "reviewPhenotype",
  /** Resolve a contradiction. */
  "resolveContradiction",
  /** Configure evidence-gap rules. */
  "configureGapRules",
  /** Create an analysis request. */
  "createAnalysisRequest",
  /** Approve an analysis run (approver role). */
  "approveAnalysisRun",
  /** Run deterministic prioritisation. */
  "runPrioritisation",
  /** Create / update a hypothesis card. */
  "manageHypothesis",
  /** MDT comment / vote / decision / task. */
  "mdtCollaboration",
  /** Record disposition / approve summary. */
  "manageDisposition",
  /** Create a knowledge snapshot / update. */
  "manageKnowledge",
  /** Approve a reanalysis run. */
  "approveReanalysisRun",
  /** View the audit viewer. */
  "viewAudit",
  /** Manage users / roles / config. */
  "manageUsers",
  /** Access Ground_Truth (denied to every interactive role). */
  "accessGroundTruth",
] as const;

/** A capability (row) of the RBAC matrix. */
export type Capability = (typeof CAPABILITIES)[number];

/** A structured role-gated action: a capability plus an operation. */
export interface AuthorizationAction {
  readonly capability: Capability;
  readonly operation: Operation;
}

/**
 * An action expressed either structurally or as a `"capability:operation"`
 * string (e.g. `"reviewPhenotype:create"`). Both forms resolve to the same
 * matrix lookup.
 */
export type ActionInput = AuthorizationAction | `${Capability}:${Operation}`;

/**
 * Optional resource context. Reserved for finer-grained checks the design
 * attaches to approver capabilities — the matrix annotates "Approve analysis
 * run" with the specific approver role (Bioinformatician / Medical specialist)
 * that may approve a given workflow. When {@link requiredApproverRole} is
 * supplied for {@link Capability} `approveAnalysisRun`, the caller must hold
 * that exact role (or be an Administrator) in addition to the matrix grant.
 * The field is otherwise ignored, keeping the engine matrix-pure.
 */
export interface ResourceContext {
  readonly requiredApproverRole?: UserRole;
  readonly [key: string]: unknown;
}

/** Result of a pure authorization decision (Req 21.3). */
export interface AuthorizationDecision {
  readonly allow: boolean;
  /** Present only when {@link allow} is `false`; explains the denial. */
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Matrix source of truth
// ---------------------------------------------------------------------------

/**
 * Compact letter codes used in the design matrix. C=create, R=read, U=update,
 * D=delete; the empty string denotes a denied cell.
 */
const CODE_TO_OPERATION: Readonly<Record<string, Operation>> = {
  C: "create",
  R: "read",
  U: "update",
  D: "delete",
};

/**
 * The design RBAC matrix, transcribed verbatim from
 * design.md → "Auth_Service, Cognito, and the RBAC Matrix". Each cell is the
 * compact CRUD code for a (capability, role) pair; a blank string is a fully
 * denied cell. This is the single source of truth for {@link RBAC_MATRIX}.
 */
const MATRIX_SOURCE: Readonly<
  Record<Capability, Readonly<Record<UserRole, string>>>
> = {
  //                            ClinGen Bioinf  GenCoun MedSpec Resrch  CaseCo  Admin
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
  // Ground_Truth is accessible to NO interactive role; only the offline
  // Evaluation_Framework identity may read it (Req 2.10, 3.6, 30.6).
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

/** Parse a compact CRUD code (e.g. "CRU") into a frozen set of operations. */
function parseOperations(code: string): ReadonlySet<Operation> {
  const ops = new Set<Operation>();
  for (const char of code) {
    const op = CODE_TO_OPERATION[char];
    if (!op) {
      throw new Error(`rbac: invalid operation code "${char}" in "${code}"`);
    }
    ops.add(op);
  }
  return ops;
}

/**
 * The compiled RBAC matrix: for each capability and role, the immutable set of
 * operations that role is permitted to perform. This is the data form of the
 * design matrix and is exported for reuse by the enforcement wrapper (5.3),
 * property tests (5.4/5.5), and permission tests (5.6).
 */
export const RBAC_MATRIX: Readonly<
  Record<Capability, Readonly<Record<UserRole, ReadonlySet<Operation>>>>
> = Object.freeze(
  Object.fromEntries(
    (Object.keys(MATRIX_SOURCE) as Capability[]).map((capability) => {
      const roleCodes = MATRIX_SOURCE[capability];
      const compiled = Object.fromEntries(
        (Object.keys(roleCodes) as UserRole[]).map((role) => [
          role,
          parseOperations(roleCodes[role]),
        ]),
      ) as Record<UserRole, ReadonlySet<Operation>>;
      return [capability, Object.freeze(compiled)];
    }),
  ) as Record<Capability, Readonly<Record<UserRole, ReadonlySet<Operation>>>>,
);

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Type guard: is `value` one of the known capabilities? */
export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Type guard: is `value` one of the four operations? */
export function isOperation(value: string): value is Operation {
  return (OPERATIONS as readonly string[]).includes(value);
}

/**
 * The set of operations a single role may perform on a capability, per the
 * matrix. Returns an empty set for a denied cell.
 */
export function permittedOperations(
  role: UserRole,
  capability: Capability,
): ReadonlySet<Operation> {
  return RBAC_MATRIX[capability][role];
}

/**
 * `true` if the single role is permitted the operation on the capability,
 * per the matrix. Pure and deterministic.
 */
export function roleCan(
  role: UserRole,
  capability: Capability,
  operation: Operation,
): boolean {
  return permittedOperations(role, capability).has(operation);
}

/** Resolve an {@link ActionInput} to a validated {@link AuthorizationAction}. */
function resolveAction(action: ActionInput): AuthorizationAction | undefined {
  if (typeof action !== "string") {
    return isCapability(action.capability) && isOperation(action.operation)
      ? action
      : undefined;
  }
  const separator = action.indexOf(":");
  if (separator <= 0) return undefined;
  const capability = action.slice(0, separator);
  const operation = action.slice(separator + 1);
  if (!isCapability(capability) || !isOperation(operation)) return undefined;
  return { capability, operation };
}

// ---------------------------------------------------------------------------
// Authorization decision
// ---------------------------------------------------------------------------

/**
 * Decide whether any of `roles` may perform `action`, per the RBAC matrix
 * (Req 21.3). Pure and deterministic: the same inputs always yield the same
 * decision, with no I/O and no side effects.
 *
 * A caller is allowed if AT LEAST ONE of its roles grants the operation on the
 * capability (roles are additive). When no role grants it, the result is a
 * denial with a human-readable `reason`.
 *
 * `resourceContext.requiredApproverRole` refines the `approveAnalysisRun`
 * capability only: the design matrix annotates that row with the specific
 * approver role permitted for a workflow, so when a required approver role is
 * supplied the caller must additionally hold that role (Administrators, who
 * hold approval universally, always satisfy it). All other capabilities ignore
 * the resource context, keeping the engine faithful to the matrix.
 *
 * @param roles           the caller's roles (from the authorizer context)
 * @param action          a capability+operation, structured or as a string
 * @param resourceContext optional finer-grained context (see above)
 */
export function authorize(
  roles: readonly UserRole[],
  action: ActionInput,
  resourceContext?: ResourceContext,
): AuthorizationDecision {
  const resolved = resolveAction(action);
  if (!resolved) {
    return {
      allow: false,
      reason: `Unknown action: ${
        typeof action === "string"
          ? action
          : `${action.capability}:${action.operation}`
      }`,
    };
  }

  const { capability, operation } = resolved;

  if (roles.length === 0) {
    return {
      allow: false,
      reason: `No role permits ${operation} on ${capability}`,
    };
  }

  const grantingRole = roles.find((role) =>
    roleCan(role, capability, operation),
  );
  if (!grantingRole) {
    return {
      allow: false,
      reason: `Role(s) [${roles.join(
        ", ",
      )}] are not permitted to ${operation} on ${capability}`,
    };
  }

  // Approver-role refinement for analysis runs (design: "U (Bioinformatician)"
  // / "U (Medical specialist)"). Only applied when the caller does not already
  // hold Administrator (who approves any workflow).
  if (
    capability === "approveAnalysisRun" &&
    resourceContext?.requiredApproverRole !== undefined &&
    !roles.includes("Administrator") &&
    !roles.includes(resourceContext.requiredApproverRole)
  ) {
    return {
      allow: false,
      reason: `Approval requires the ${resourceContext.requiredApproverRole} approver role`,
    };
  }

  return { allow: true };
}
