// services/vertical-slice/src/slice.ts
//
// Seven-stage vertical-slice orchestration with halt-on-failure (task 17.2,
// Requirement 33).
//
// `runVerticalSlice` composes the EXISTING service packages into the end-to-end
// slice the MVP delivers first (Req 33.1):
//
//   1. intake                  -> @udn/intake     `ingestCase`
//   2. timeline                -> @udn/timeline   `buildTimeline`
//   3. phenotype extraction    -> @udn/phenotype  `extractPhenotypes` (via AI_Gateway)
//   4. clinician confirmation  -> @udn/review     `approvePhenotype`
//   5. minimal hypothesis card -> ./hypothesis-card `buildHypothesisCard`
//   6. knowledge-update publish-> ./knowledge-update `publishKnowledgeUpdate`
//   7. reanalysis notification -> @udn/reanalysis `matchCase`
//
// HALT-ON-FAILURE + STATE PRESERVATION (Req 33.3): the stages run strictly in
// order and the slice threads an accumulating, immutable `SliceState`. Each
// stage appends its output to the state ONLY on success. The moment any stage
// fails, the slice stops immediately, runs no later stage, and returns a
// `SliceFailure` that names the failed stage and carries `stateBefore` — the
// state exactly as it stood before the failed stage ran. Because state is only
// extended on success and never mutated in place, prior stages' outputs are
// preserved intact and no partial advance occurs.
//
// The AI-dependent stage (phenotype extraction) is reached ONLY through the
// injected `PhenotypeExtractionGateway` (the AI_Gateway seam), so the slice is
// fully testable with a fake gateway and never requires AWS/Bedrock. Every
// other stage is deterministic and calls no generative model.

import type {
  Case,
  ConfirmedPhenotype,
  Hypothesis,
  EvidenceItem,
  KnowledgeUpdate,
  PhenotypeCandidate,
  ReanalysisCandidate
} from "@udn/domain";
import {
  ingestCase,
  type CaseRepositoryPort,
  type IngestCaseInput,
  type RetainedArtifact
} from "@udn/intake";
import { buildTimeline, type CaseClinicalData, type TimelineResult } from "@udn/timeline";
import {
  extractPhenotypes,
  type ExtractPhenotypesOptions,
  type PhenotypeExtractionGateway,
  type SourceDocument
} from "@udn/phenotype";
import { approvePhenotype } from "@udn/review";
import {
  matchCase,
  reviewQueueEntryOf,
  type CaseFeatureVector,
  type MatchOptions,
  type ReviewQueueEntry
} from "@udn/reanalysis";

import { buildHypothesisCard } from "./hypothesis-card.js";
import { publishKnowledgeUpdate, type KnowledgeUpdateDelta } from "./knowledge-update.js";

// ---------------------------------------------------------------------------
// Stage identity
// ---------------------------------------------------------------------------

/** The seven vertical-slice stages, in execution order (Req 33.1). */
export type SliceStageName =
  | "intake"
  | "timeline"
  | "phenotype_extraction"
  | "clinician_confirmation"
  | "hypothesis_card"
  | "knowledge_update_publish"
  | "reanalysis_notification";

/** The seven stages in their fixed execution order (Req 33.1). */
export const SLICE_STAGES: readonly SliceStageName[] = [
  "intake",
  "timeline",
  "phenotype_extraction",
  "clinician_confirmation",
  "hypothesis_card",
  "knowledge_update_publish",
  "reanalysis_notification"
];

// ---------------------------------------------------------------------------
// Threaded slice state (extended only on stage success)
// ---------------------------------------------------------------------------

/**
 * The immutable state threaded through the slice. Each field is populated by
 * exactly one stage, and only after that stage succeeds. A `SliceFailure`
 * returns the state as it stood BEFORE the failed stage, so every field present
 * corresponds to a completed stage whose output is preserved intact (Req 33.3).
 */
export interface SliceState {
  /** Stage 1 — the created Case record. */
  readonly case?: Case;
  /** Stage 1 — artifacts retained unmodified with provenance. */
  readonly retainedArtifacts?: readonly RetainedArtifact[];
  /** Stage 2 — the reconstructed diagnostic timeline. */
  readonly timeline?: TimelineResult;
  /** Stage 3 — AI-extracted phenotype candidates (pending review). */
  readonly candidates?: readonly PhenotypeCandidate[];
  /** Stage 4 — confirmed phenotypes produced by clinician approval. */
  readonly confirmedPhenotypes?: readonly ConfirmedPhenotype[];
  /** Stage 4 — the candidates transitioned to "approved". */
  readonly approvedCandidates?: readonly PhenotypeCandidate[];
  /** Stage 5 — the minimal hypothesis card. */
  readonly hypothesis?: Hypothesis;
  /** Stage 5 — evidence items linked to the card. */
  readonly evidenceItems?: readonly EvidenceItem[];
  /** Stage 6 — the published simulated Knowledge_Update. */
  readonly knowledgeUpdate?: KnowledgeUpdate;
  /** Stage 7 — the reanalysis candidate, or `null` when nothing matched. */
  readonly reanalysisCandidate?: ReanalysisCandidate | null;
  /** Stage 7 — the review-queue notification entries (Req 33.2). */
  readonly reviewQueue?: readonly ReviewQueueEntry[];
}

// ---------------------------------------------------------------------------
// Per-stage internal outcome
// ---------------------------------------------------------------------------

/**
 * The outcome of running a single stage. On success it carries the fields to
 * merge into the threaded state; on failure it carries the halt reason.
 */
type StageOutcome =
  | { readonly ok: true; readonly patch: SliceState }
  | { readonly ok: false; readonly detail: string; readonly cause?: unknown };

// ---------------------------------------------------------------------------
// Slice input
// ---------------------------------------------------------------------------

/** Inputs for the clinician-confirmation stage (Req 6). */
export interface SliceConfirmationInput {
  /** Identity of the confirming reviewer (Req 6.2). */
  readonly reviewerId: string;
  /** Approval timestamp, ISO-8601 UTC (Req 6.2). */
  readonly at: string;
  /** Whether the reviewer holds review authorisation (Req 6.1, 6.6). */
  readonly isAuthorised: boolean;
}

/** Inputs for the minimal hypothesis-card stage (Req 11 analogue). */
export interface SliceHypothesisInput {
  /** Non-diagnostic card text (Req 11.3 analogue). */
  readonly text: string;
  /** Active knowledge-snapshot version in effect (Req 14.5). */
  readonly knowledgeSnapshotVersion: string;
  /** Actor id creating the card. */
  readonly createdById: string;
}

/** Inputs for the simulated knowledge-update publish stage (Req 14.3, 15.1). */
export interface SliceKnowledgeUpdateInput {
  /** The references the update touches (Req 15.1). */
  readonly delta: KnowledgeUpdateDelta;
  /** Actor id publishing the update. */
  readonly createdById: string;
  /** Optional explicit update id; generated when omitted. */
  readonly id?: string;
}

/** Inputs for the reanalysis-notification stage (Req 15). */
export interface SliceReanalysisInput {
  /** The unresolved case's deterministic feature vector (Req 15.1). */
  readonly featureVector: CaseFeatureVector;
  /** Envelope options for a produced Reanalysis_Candidate. */
  readonly matchOptions: MatchOptions;
}

/** Complete input to {@link runVerticalSlice}. */
export interface VerticalSliceInput {
  /** Persistence port used by the intake stage. */
  readonly repository: CaseRepositoryPort;
  /** Stage 1 — intake pipeline input. */
  readonly intake: IngestCaseInput;
  /** Stage 2 — clinical data for timeline reconstruction. */
  readonly clinicalData: CaseClinicalData;
  /** Stage 3 — the AI_Gateway seam (fake in tests; no AWS/Bedrock required). */
  readonly gateway: PhenotypeExtractionGateway;
  /** Stage 3 — untrusted source documents presented to the model. */
  readonly sourceDocuments: readonly SourceDocument[];
  /** Stage 3 — phenotype-extraction options (resolver, invoking user, ...). */
  readonly extractionOptions: ExtractPhenotypesOptions;
  /** Stage 4 — clinician-confirmation input. */
  readonly confirmation: SliceConfirmationInput;
  /** Stage 5 — hypothesis-card input. */
  readonly hypothesis: SliceHypothesisInput;
  /** Stage 6 — knowledge-update publish input. */
  readonly knowledgeUpdate: SliceKnowledgeUpdateInput;
  /** Stage 7 — reanalysis-notification input. */
  readonly reanalysis: SliceReanalysisInput;
}

// ---------------------------------------------------------------------------
// Slice result
// ---------------------------------------------------------------------------

/** All seven stages completed successfully (Req 33.1, 33.2). */
export interface SliceSuccess {
  readonly ok: true;
  /** Fully populated slice state. */
  readonly state: SliceState;
  /** The stages that ran, in order — all seven. */
  readonly completedStages: readonly SliceStageName[];
}

/**
 * A stage failed; the slice halted (Req 33.3). `stateBefore` is the state as it
 * stood before the failed stage ran, so prior stages' outputs are preserved and
 * no later stage executed.
 */
export interface SliceFailure {
  readonly ok: false;
  /** The stage that failed. */
  readonly failedStage: SliceStageName;
  /** Human-readable failure indication (Req 33.3). */
  readonly detail: string;
  /** Underlying cause when available. */
  readonly cause?: unknown;
  /** State prior to the failed stage — prior outputs intact (Req 33.3). */
  readonly stateBefore: SliceState;
  /** The stages that completed before the failure, in order. */
  readonly completedStages: readonly SliceStageName[];
}

/** Result of {@link runVerticalSlice}. */
export type SliceResult = SliceSuccess | SliceFailure;

// ---------------------------------------------------------------------------
// Individual stages
// ---------------------------------------------------------------------------

/** Stage 1 — synthetic case intake (Req 3, 33.1). */
async function runIntake(input: VerticalSliceInput): Promise<StageOutcome> {
  const result = await ingestCase(input.repository, input.intake);
  if (result.status === "rejected") {
    const detail = result.errors.map((error) => error.message).join("; ");
    return {
      ok: false,
      detail: `Intake rejected the case: ${detail}`,
      cause: result.errors
    };
  }
  return {
    ok: true,
    patch: { case: result.case, retainedArtifacts: result.artifacts }
  };
}

/** Stage 2 — diagnostic timeline reconstruction (Req 4, 33.1). */
function runTimeline(input: VerticalSliceInput): StageOutcome {
  const timeline = buildTimeline(input.clinicalData);
  // An empty timeline is a valid state (Req 4.5), NOT a stage failure.
  return { ok: true, patch: { timeline } };
}

/** Stage 3 — AI phenotype extraction via the AI_Gateway (Req 5, 33.1). */
async function runPhenotypeExtraction(input: VerticalSliceInput): Promise<StageOutcome> {
  const result = await extractPhenotypes(
    input.intake.caseId,
    input.sourceDocuments,
    input.gateway,
    input.extractionOptions
  );
  if (result.outcome === "failed") {
    return { ok: false, detail: result.detail, cause: result.cause };
  }
  return { ok: true, patch: { candidates: result.candidates } };
}

/** Stage 4 — clinician confirmation of extracted phenotypes (Req 6, 33.1). */
function runClinicianConfirmation(
  input: VerticalSliceInput,
  state: SliceState
): StageOutcome {
  const candidates = state.candidates ?? [];
  const pending = candidates.filter((candidate) => candidate.status === "pending_review");

  // Nothing to confirm means the slice cannot produce hypothesis evidence.
  if (pending.length === 0) {
    return {
      ok: false,
      detail:
        "Clinician confirmation could not proceed: no phenotype candidates are pending review."
    };
  }

  const confirmedPhenotypes: ConfirmedPhenotype[] = [];
  const approvedCandidates: PhenotypeCandidate[] = [];

  for (const candidate of pending) {
    const outcome = approvePhenotype(candidate, {
      reviewerId: input.confirmation.reviewerId,
      at: input.confirmation.at,
      isAuthorised: input.confirmation.isAuthorised,
      approve: true
    });
    if (!outcome.ok) {
      // Unauthorised (or unapproved) confirmation halts the slice; candidate
      // state is left unchanged by the Review_Service (Req 6.6, 33.3).
      return { ok: false, detail: outcome.error.message, cause: outcome.error };
    }
    confirmedPhenotypes.push(outcome.confirmed);
    approvedCandidates.push(outcome.candidate);
  }

  return { ok: true, patch: { confirmedPhenotypes, approvedCandidates } };
}

/** Stage 5 — minimal, evidence-linked hypothesis card (Req 11 analogue, 33.1). */
function runHypothesisCard(input: VerticalSliceInput, state: SliceState): StageOutcome {
  const confirmedPhenotypes = state.confirmedPhenotypes ?? [];
  const result = buildHypothesisCard({
    caseId: input.intake.caseId,
    text: input.hypothesis.text,
    confirmedPhenotypes,
    knowledgeSnapshotVersion: input.hypothesis.knowledgeSnapshotVersion,
    createdById: input.hypothesis.createdById,
    now: input.confirmation.at
  });
  if (!result.ok) {
    return { ok: false, detail: result.error.message, cause: result.error };
  }
  return {
    ok: true,
    patch: {
      hypothesis: result.card.hypothesis,
      evidenceItems: result.card.evidenceItems
    }
  };
}

/** Stage 6 — simulated Knowledge_Update publish (Req 14.3, 15.1, 33.1). */
function runKnowledgeUpdatePublish(input: VerticalSliceInput): StageOutcome {
  const result = publishKnowledgeUpdate({
    delta: input.knowledgeUpdate.delta,
    createdById: input.knowledgeUpdate.createdById,
    now: input.reanalysis.matchOptions.now,
    ...(input.knowledgeUpdate.id !== undefined ? { id: input.knowledgeUpdate.id } : {})
  });
  if (!result.ok) {
    return { ok: false, detail: result.error.message, cause: result.error };
  }
  return { ok: true, patch: { knowledgeUpdate: result.update } };
}

/** Stage 7 — reanalysis notification / review-queue entry (Req 15, 33.2). */
function runReanalysisNotification(
  input: VerticalSliceInput,
  state: SliceState
): StageOutcome {
  const update = state.knowledgeUpdate;
  if (update === undefined) {
    // Unreachable in normal ordering; guarded for total type-safety.
    return {
      ok: false,
      detail: "Reanalysis could not run: no Knowledge_Update was published."
    };
  }

  const match = matchCase(input.reanalysis.featureVector, update, input.reanalysis.matchOptions);
  const reviewQueue =
    match.candidate !== null ? [reviewQueueEntryOf(match.candidate)] : [];

  return {
    ok: true,
    patch: { reanalysisCandidate: match.candidate, reviewQueue }
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Run the seven-stage vertical slice end to end with halt-on-failure
 * orchestration (Req 33.1, 33.2, 33.3).
 *
 * Stages run strictly in the order defined by {@link SLICE_STAGES}. The slice
 * threads an immutable {@link SliceState} that is extended ONLY when a stage
 * succeeds. On the first stage failure the slice halts immediately, runs no
 * later stage, and returns a {@link SliceFailure} naming the failed stage and
 * carrying `stateBefore` — the state exactly as it stood before that stage ran,
 * preserving every prior stage's output (Req 33.3). When all seven stages
 * succeed a {@link SliceSuccess} carries the fully populated state, including
 * the review-queue entry that returns an affected unresolved case to the queue
 * (Req 33.2).
 *
 * Any unexpected throw from a stage is caught and converted into a
 * {@link SliceFailure} for the stage that threw, so a failure never partially
 * advances the slice.
 */
export async function runVerticalSlice(input: VerticalSliceInput): Promise<SliceResult> {
  let state: SliceState = {};
  const completedStages: SliceStageName[] = [];

  for (const stage of SLICE_STAGES) {
    // Snapshot of the state BEFORE this stage runs — returned untouched on
    // failure so no partial advance leaks into the caller (Req 33.3).
    const stateBefore = state;

    let outcome: StageOutcome;
    try {
      outcome = await runStage(stage, input, stateBefore);
    } catch (cause) {
      return {
        ok: false,
        failedStage: stage,
        detail: `Stage "${stage}" failed unexpectedly: ${describeCause(cause)}`,
        cause,
        stateBefore,
        completedStages: [...completedStages]
      };
    }

    if (!outcome.ok) {
      return {
        ok: false,
        failedStage: stage,
        detail: outcome.detail,
        ...(outcome.cause !== undefined ? { cause: outcome.cause } : {}),
        stateBefore,
        completedStages: [...completedStages]
      };
    }

    // Extend the state only on success; never mutate the prior snapshot.
    state = { ...stateBefore, ...outcome.patch };
    completedStages.push(stage);
  }

  return { ok: true, state, completedStages: [...completedStages] };
}

/** Dispatch a single stage by name. */
function runStage(
  stage: SliceStageName,
  input: VerticalSliceInput,
  state: SliceState
): StageOutcome | Promise<StageOutcome> {
  switch (stage) {
    case "intake":
      return runIntake(input);
    case "timeline":
      return runTimeline(input);
    case "phenotype_extraction":
      return runPhenotypeExtraction(input);
    case "clinician_confirmation":
      return runClinicianConfirmation(input, state);
    case "hypothesis_card":
      return runHypothesisCard(input, state);
    case "knowledge_update_publish":
      return runKnowledgeUpdatePublish(input);
    case "reanalysis_notification":
      return runReanalysisNotification(input, state);
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

/** Best-effort human-readable description of a thrown cause. */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
