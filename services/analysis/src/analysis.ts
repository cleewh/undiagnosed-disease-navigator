// services/analysis/src/analysis.ts
//
// Analysis request, approval gate, and genomic run fulfilment (Analysis_Service,
// task 19.1, Requirement 9; plus the Demo_Mode/Workflow_Mode genomic operation
// modes of Requirements 27.6, 32.1, 32.5).
//
// This module is pure, deterministic orchestration and contains NO generative
// model in any execution path (design: "Deterministic Engines"; the AI_Gateway
// is the sole Bedrock path). For fixed inputs (request, actor identity,
// timestamp, envelope options) every function returns byte-for-byte identical
// output, and no input object is ever mutated — a new object is returned when a
// value changes.
//
// The workflow follows the design state machine
// (Draft -> WorkflowSelected -> PendingApproval -> Approved -> Running -> Completed/Failed):
//
//   * `submitAnalysisRequest` — requires a genomic-analysis workflow selection;
//     a submission with no workflow is rejected and creates no request and no
//     run (Req 9.1, 9.2).
//   * `describeAnalysisRequest` — surfaces the input artifacts, tool/reference
//     versions, estimated cost, and required approver role for display (Req 9.3).
//   * `approveAnalysisRequest` — requires explicit approval from a caller holding
//     the required approver role before a run may start (Req 9.4). Authorisation
//     is passed IN as a decision (`isAuthorised`), mirroring the
//     Contradiction_Service / Review_Service convention: the RBAC matrix stays
//     in apps/api and this service consumes a decision rather than re-encoding
//     role rules. The request's own `requiredApproverRole` is domain data and is
//     matched here.
//   * `startAnalysisRun` — starts a run ONLY for an approved request (Req 9.5).
//     In Demo_Mode it fulfils the request from precomputed synthetic results
//     WITHOUT initiating a genomic-compute run (Req 9.6, 27.6, 32.1, 32.5); in
//     Workflow_Mode it executes the approved workflow (Req 9.7). A completed run
//     records its outputs with provenance including the tool and reference
//     versions (Req 9.8). A run that fails before completion retains the pre-run
//     state, returns an error, and records the failure (Req 9.9).

import {
  createEnvelope,
  touchEnvelope,
  type AccessClassification,
  type AnalysisRequest,
  type AnalysisRun,
  type GenomicMode,
  type ProvenanceRef,
  type UserRole
} from "@udn/domain";

// ---------------------------------------------------------------------------
// Shared constants and errors
// ---------------------------------------------------------------------------

/** Origin recorded on records produced by the Analysis_Service. */
export const ANALYSIS_SOURCE = "Analysis_Service";

/** Why an analysis action was rejected. */
export type AnalysisErrorCode =
  /** A submission supplied no genomic-analysis workflow selection (Req 9.2). */
  | "workflow_required"
  /** The approver is not an authorised approver (Req 9.4). */
  | "not_authorised"
  /** The approver does not hold the request's required approver role (Req 9.4). */
  | "wrong_approver_role"
  /** An action was attempted against a request in an incompatible state. */
  | "invalid_state"
  /** A run was attempted while the request status was not "approved" (Req 9.5). */
  | "not_approved"
  /** Demo_Mode fulfilment was attempted without precomputed results (Req 9.6). */
  | "precomputed_missing"
  /** Workflow_Mode fulfilment was attempted without a workflow executor (Req 9.7). */
  | "executor_missing"
  /** The genomic run failed before completion (Req 9.9). */
  | "run_failed";

/** A structured analysis-action failure. */
export interface AnalysisError {
  readonly code: AnalysisErrorCode;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Tool/reference version provenance encoding (Req 9.8)
// ---------------------------------------------------------------------------

/** Sort the entries of a version map for a stable, reproducible encoding. */
function sortedEntries(versions: Record<string, string>): [string, string][] {
  return Object.entries(versions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Encode the tool and reference versions into a single stable descriptor used
 * as the `versionId` of a run's provenance, so the recorded run provenance
 * itself carries the tool and reference versions (Req 9.8). The encoding is
 * deterministic: entries are sorted by key, so equal maps always encode to the
 * same string regardless of insertion order.
 */
export function encodeToolReferenceVersions(
  toolVersions: Record<string, string>,
  referenceVersions: Record<string, string>
): string {
  const tools = sortedEntries(toolVersions)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  const refs = sortedEntries(referenceVersions)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return `tools:{${tools}};refs:{${refs}}`;
}

// ---------------------------------------------------------------------------
// Request submission (Req 9.1, 9.2, 9.3)
// ---------------------------------------------------------------------------

/** Input for submitting a new analysis request. */
export interface SubmitAnalysisRequestInput {
  /** Owning case id (envelope, Req 23.3). */
  readonly caseId: string;
  /** Actor id recorded as the creator of the request (envelope). */
  readonly createdById: string;
  /** ISO-8601 UTC timestamp stamped as createdAt/modifiedAt. */
  readonly now: string;
  /**
   * The selected genomic-analysis workflow. REQUIRED: an undefined or blank
   * value is rejected with a `workflow_required` error and creates no request
   * (Req 9.1, 9.2).
   */
  readonly workflowId?: string;
  /** Input artifacts shown on display (Req 9.3). */
  readonly inputArtifactRefs: readonly string[];
  /** Tool versions shown on display and recorded on the run (Req 9.3, 9.8). */
  readonly toolVersions: Record<string, string>;
  /** Reference versions shown on display and recorded on the run (Req 9.3, 9.8). */
  readonly referenceVersions: Record<string, string>;
  /** Estimated cost shown on display (Req 9.3). */
  readonly estimatedCost: number;
  /** Required approver role shown on display and enforced on approval (Req 9.3, 9.4). */
  readonly requiredApproverRole: UserRole;
  /** Genomic operation mode governing fulfilment (Req 9.6, 9.7). */
  readonly genomicMode: GenomicMode;
  /** Active knowledge snapshot version (Req 14.5). */
  readonly knowledgeSnapshotVersion: string;
  /** Origin for the request envelope; defaults to {@link ANALYSIS_SOURCE}. */
  readonly source?: string;
  /** Access classification for the request; defaults to "clinical". */
  readonly accessClassification?: AccessClassification;
  /** Optional provenance; a deterministic default is derived when omitted. */
  readonly provenance?: ProvenanceRef;
  /** Optional explicit id for the request; generated when omitted. */
  readonly id?: string;
}

/** Result of {@link submitAnalysisRequest}. */
export type SubmitAnalysisRequestResult =
  | { readonly ok: true; readonly request: AnalysisRequest }
  | { readonly ok: false; readonly error: AnalysisError };

/** Whether a workflow selection is present and non-blank. */
function hasWorkflowSelection(workflowId: string | undefined): workflowId is string {
  return typeof workflowId === "string" && workflowId.trim() !== "";
}

/**
 * Submit a new analysis request (Req 9.1, 9.2).
 *
 * A workflow selection is mandatory. When one is supplied, a `AnalysisRequest`
 * is created in the "pending_approval" state, ready for the approval gate. When
 * it is absent or blank the submission is rejected with a `workflow_required`
 * error and NO request (and therefore no run) is created (Req 9.2).
 */
export function submitAnalysisRequest(
  input: SubmitAnalysisRequestInput
): SubmitAnalysisRequestResult {
  if (!hasWorkflowSelection(input.workflowId)) {
    return {
      ok: false,
      error: {
        code: "workflow_required",
        message:
          "An analysis request requires selection of a genomic-analysis workflow; no request was created."
      }
    };
  }

  const provenance: ProvenanceRef =
    input.provenance ?? {
      sourceId: input.source ?? ANALYSIS_SOURCE,
      versionId: "1",
      createdById: input.createdById,
      ingestedAt: input.now
    };

  const envelope = createEnvelope({
    ...(input.id !== undefined ? { id: input.id } : {}),
    entityType: "AnalysisRequest",
    caseId: input.caseId,
    source: input.source ?? ANALYSIS_SOURCE,
    status: "pending_approval",
    provenance,
    accessClassification: input.accessClassification ?? "clinical",
    createdById: input.createdById,
    now: input.now
  });

  const request: AnalysisRequest = {
    ...envelope,
    entityType: "AnalysisRequest",
    status: "pending_approval",
    workflowId: input.workflowId,
    inputArtifactRefs: [...input.inputArtifactRefs],
    toolVersions: { ...input.toolVersions },
    referenceVersions: { ...input.referenceVersions },
    estimatedCost: input.estimatedCost,
    requiredApproverRole: input.requiredApproverRole,
    genomicMode: input.genomicMode,
    knowledgeSnapshotVersion: input.knowledgeSnapshotVersion
  };

  return { ok: true, request };
}

// ---------------------------------------------------------------------------
// Request display (Req 9.3)
// ---------------------------------------------------------------------------

/** The information surfaced when an analysis request is displayed (Req 9.3). */
export interface AnalysisRequestDisplay {
  /** The input artifacts (Req 9.3). */
  readonly inputArtifactRefs: string[];
  /** The tool versions (Req 9.3). */
  readonly toolVersions: Record<string, string>;
  /** The reference versions (Req 9.3). */
  readonly referenceVersions: Record<string, string>;
  /** The estimated cost (Req 9.3). */
  readonly estimatedCost: number;
  /** The required approver role (Req 9.3). */
  readonly requiredApproverRole: UserRole;
}

/**
 * Produce the display view of an analysis request (Req 9.3): the input
 * artifacts, the tool and reference versions, the estimated cost, and the
 * required approver role. Returns copies so the source request is never
 * exposed to mutation.
 */
export function describeAnalysisRequest(request: AnalysisRequest): AnalysisRequestDisplay {
  return {
    inputArtifactRefs: [...request.inputArtifactRefs],
    toolVersions: { ...request.toolVersions },
    referenceVersions: { ...request.referenceVersions },
    estimatedCost: request.estimatedCost,
    requiredApproverRole: request.requiredApproverRole
  };
}

// ---------------------------------------------------------------------------
// Approval gate (Req 9.4, 9.5)
// ---------------------------------------------------------------------------

/** Input for an attempt to approve an analysis request. */
export interface ApproveAnalysisRequestInput {
  /** Identity of the approving user (Req 9.4). */
  readonly approverId: string;
  /**
   * The role held by the approving user. It MUST equal the request's
   * `requiredApproverRole` for approval to proceed (Req 9.4).
   */
  readonly approverRole: UserRole;
  /** Approval timestamp, ISO-8601 UTC (Req 9.4). */
  readonly at: string;
  /**
   * Whether the caller holds approval authorisation, supplied by the RBAC
   * enforcement layer (mirrors the Contradiction_Service / Review_Service
   * convention). A falsy value rejects the approval and leaves the request
   * unchanged (Req 9.4).
   */
  readonly isAuthorised: boolean;
}

/** Result of {@link approveAnalysisRequest}. */
export type ApproveAnalysisRequestResult =
  | { readonly ok: true; readonly request: AnalysisRequest }
  | { readonly ok: false; readonly error: AnalysisError; readonly request: AnalysisRequest };

/**
 * Approve an analysis request through the required-role approval gate
 * (Req 9.4, 9.5).
 *
 * Approval proceeds ONLY when all hold:
 *   * the request is awaiting approval (status "pending_approval"); otherwise an
 *     `invalid_state` error is returned and the request is left unchanged;
 *   * the caller is authorised (`isAuthorised === true`); otherwise a
 *     `not_authorised` error is returned and the request is left unchanged;
 *   * the caller's role equals the request's `requiredApproverRole`; otherwise a
 *     `wrong_approver_role` error is returned and the request is left unchanged.
 *
 * On success the request transitions to "approved", recording the approver
 * identity and approval timestamp; the envelope version/modifiedAt are bumped.
 * The input request is never mutated.
 */
export function approveAnalysisRequest(
  request: AnalysisRequest,
  input: ApproveAnalysisRequestInput
): ApproveAnalysisRequestResult {
  if (request.status !== "pending_approval") {
    return {
      ok: false,
      request,
      error: {
        code: "invalid_state",
        message: `Analysis request "${request.id}" cannot be approved from status "${request.status}"; it must be "pending_approval".`
      }
    };
  }

  if (!input.isAuthorised) {
    return {
      ok: false,
      request,
      error: {
        code: "not_authorised",
        message: `User "${input.approverId}" is not authorised to approve analysis request "${request.id}".`
      }
    };
  }

  if (input.approverRole !== request.requiredApproverRole) {
    return {
      ok: false,
      request,
      error: {
        code: "wrong_approver_role",
        message: `Analysis request "${request.id}" requires approver role "${request.requiredApproverRole}"; user "${input.approverId}" holds "${input.approverRole}".`
      }
    };
  }

  const approved: AnalysisRequest = {
    ...touchEnvelope(request, input.at),
    status: "approved",
    approvedById: input.approverId,
    approvedAt: input.at
  };

  return { ok: true, request: approved };
}

// ---------------------------------------------------------------------------
// Run fulfilment (Req 9.5, 9.6, 9.7, 9.8, 9.9, 27.6, 32.1, 32.5)
// ---------------------------------------------------------------------------

/**
 * A workflow executor for Workflow_Mode. Returns the produced output artifact
 * references; throwing signals a run failure (Req 9.9). Kept synchronous and
 * deterministic so the orchestration core stays free of timing and generative
 * dependencies; real HealthOmics wiring is a caller concern.
 */
export type WorkflowExecutor = () => readonly string[];

/** Input for an attempt to start (fulfil) an analysis run. */
export interface StartAnalysisRunInput {
  /** ISO-8601 UTC timestamp stamped on the produced run. */
  readonly now: string;
  /** Actor id recorded as the creator of the run (envelope). */
  readonly createdById: string;
  /**
   * Precomputed synthetic output artifact references, REQUIRED in Demo_Mode.
   * Fulfilment returns these without initiating a genomic-compute run
   * (Req 9.6, 27.6, 32.1, 32.5).
   */
  readonly demoResultRefs?: readonly string[];
  /**
   * Workflow executor, REQUIRED in Workflow_Mode. Executed to produce the run
   * outputs; a thrown error is treated as a run failure (Req 9.7, 9.9).
   */
  readonly executeWorkflow?: WorkflowExecutor;
  /** Origin for the run envelope; defaults to {@link ANALYSIS_SOURCE}. */
  readonly source?: string;
  /** Access classification for the run; defaults to the request's. */
  readonly accessClassification?: AccessClassification;
  /** Optional explicit id for the run; generated when omitted. */
  readonly runId?: string;
}

/** Successful run fulfilment. */
export interface StartAnalysisRunSuccess {
  readonly ok: true;
  /** The completed run, with outputs and provenance recorded (Req 9.8). */
  readonly run: AnalysisRun;
  /**
   * Whether a genomic-compute workflow was initiated. `false` in Demo_Mode —
   * precomputed results are returned without initiating a run (Req 9.6, 27.6,
   * 32.1, 32.5); `true` in Workflow_Mode (Req 9.7).
   */
  readonly workflowInitiated: boolean;
  /** The request, unchanged (still "approved"). */
  readonly request: AnalysisRequest;
}

/** Failed run fulfilment: the pre-run state is retained (Req 9.5, 9.9). */
export interface StartAnalysisRunFailure {
  readonly ok: false;
  readonly error: AnalysisError;
  /** The request, unchanged — the pre-run state is preserved (Req 9.9). */
  readonly request: AnalysisRequest;
  /**
   * A recorded failed run, present when a run started but failed before
   * completion (Req 9.9). Absent when the run never started (e.g. the request
   * was not approved, or fulfilment inputs were missing).
   */
  readonly failedRun?: AnalysisRun;
}

/** Result of {@link startAnalysisRun}. */
export type StartAnalysisRunResult = StartAnalysisRunSuccess | StartAnalysisRunFailure;

/** Build the run provenance, embedding the tool and reference versions (Req 9.8). */
function runProvenance(request: AnalysisRequest, input: StartAnalysisRunInput): ProvenanceRef {
  return {
    sourceId: request.id,
    versionId: encodeToolReferenceVersions(request.toolVersions, request.referenceVersions),
    createdById: input.createdById,
    ingestedAt: input.now
  };
}

/** Construct an `AnalysisRun` record for the given request, status, and outputs. */
function buildRun(
  request: AnalysisRequest,
  input: StartAnalysisRunInput,
  status: AnalysisRun["status"],
  outputRefs: readonly string[]
): AnalysisRun {
  const provenance = runProvenance(request, input);
  const envelope = createEnvelope({
    ...(input.runId !== undefined ? { id: input.runId } : {}),
    entityType: "AnalysisRun",
    caseId: request.caseId,
    source: input.source ?? ANALYSIS_SOURCE,
    status,
    provenance,
    accessClassification: input.accessClassification ?? request.accessClassification,
    createdById: input.createdById,
    now: input.now
  });

  return {
    ...envelope,
    entityType: "AnalysisRun",
    requestId: request.id,
    status,
    outputRefs: [...outputRefs],
    provenance
  };
}

/**
 * Start (fulfil) an analysis run for an approved request (Req 9.5–9.9).
 *
 * The run starts ONLY when the request status is "approved"; any other status
 * yields a `not_approved` error, starts no run, and leaves the request
 * unchanged (Req 9.5).
 *
 * Fulfilment depends on the request's genomic operation mode:
 *   * **Demo_Mode** — the request is fulfilled from the supplied precomputed
 *     synthetic results WITHOUT initiating a genomic-compute run
 *     (`workflowInitiated: false`); the recorded run is "completed" with those
 *     outputs (Req 9.6, 27.6, 32.1, 32.5). Missing precomputed results yield a
 *     `precomputed_missing` error and no run.
 *   * **Workflow_Mode** — the approved workflow is executed
 *     (`workflowInitiated: true`); on success the recorded run is "completed"
 *     with the produced outputs (Req 9.7). A missing executor yields an
 *     `executor_missing` error and no run. If the executor throws, the run
 *     failed before completion: the pre-run state is retained, a `run_failed`
 *     error is returned, and a "failed" run is recorded (Req 9.9).
 *
 * A completed run records its outputs with provenance that includes the tool
 * and reference versions (Req 9.8). The input request is never mutated.
 */
export function startAnalysisRun(
  request: AnalysisRequest,
  input: StartAnalysisRunInput
): StartAnalysisRunResult {
  // Req 9.5: a run starts only for an approved request.
  if (request.status !== "approved") {
    return {
      ok: false,
      request,
      error: {
        code: "not_approved",
        message: `Analysis run cannot start: request "${request.id}" has status "${request.status}", not "approved".`
      }
    };
  }

  if (request.genomicMode === "Demo_Mode") {
    // Req 9.6, 27.6, 32.1, 32.5: fulfil from precomputed results, no run initiated.
    if (input.demoResultRefs === undefined) {
      return {
        ok: false,
        request,
        error: {
          code: "precomputed_missing",
          message: `Demo_Mode fulfilment of request "${request.id}" requires precomputed synthetic results.`
        }
      };
    }
    const run = buildRun(request, input, "completed", input.demoResultRefs);
    return { ok: true, run, workflowInitiated: false, request };
  }

  // Workflow_Mode (Req 9.7): execute the approved workflow.
  if (input.executeWorkflow === undefined) {
    return {
      ok: false,
      request,
      error: {
        code: "executor_missing",
        message: `Workflow_Mode fulfilment of request "${request.id}" requires a workflow executor.`
      }
    };
  }

  let outputRefs: readonly string[];
  try {
    outputRefs = input.executeWorkflow();
  } catch (cause) {
    // Req 9.9: retain the pre-run state, return an error, and record the failure.
    const failedRun = buildRun(request, input, "failed", []);
    const reason = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      request,
      failedRun,
      error: {
        code: "run_failed",
        message: `Analysis run for request "${request.id}" did not complete: ${reason}`
      }
    };
  }

  const run = buildRun(request, input, "completed", outputRefs);
  return { ok: true, run, workflowInitiated: true, request };
}
