// services/hypothesis/src/hypothesis.ts
//
// The full Hypothesis_Service (task 21.1, Requirement 11).
//
// The Hypothesis_Service manages evidence-linked, explicitly non-diagnostic
// Hypothesis_Cards. This module implements the complete behaviour required by
// Requirement 11:
//
//   * creation links the card to AT LEAST ONE supporting evidence item, and a
//     zero-evidence creation request is rejected with no card created
//     (Req 11.1, 11.2);
//   * card text must use non-diagnostic wording; any text containing a
//     prohibited diagnostic term is rejected (Req 11.3, see ./vocabulary.ts);
//   * every card is assigned a state from the defined set
//     Proposed / Under Review / Supported / Refuted / Retired (Req 11.4);
//   * an authorised state update records the previous state, the new state, the
//     user identity, and the update timestamp in the card's transition history
//     (Req 11.5);
//   * a state update by an unauthorised user is rejected, the current state is
//     retained, and a not-authorised error is returned (Req 11.6); and
//   * every update retains the link between the card and its evidence items
//     (Req 11.7).
//
// Authorisation is passed IN as a decision (`isAuthorised`), mirroring the
// Review_Service / Contradiction_Service convention: the RBAC matrix lives in
// apps/api/src/auth, and this service consumes an authorisation decision rather
// than re-encoding role rules.
//
// Every function is pure and deterministic — for fixed inputs (including the
// timestamp and any explicit ids) the produced objects are byte-for-byte
// identical — and no generative model is ever involved. Input objects are never
// mutated; a new object is returned whenever a card changes.

import {
  HYPOTHESIS_STATES,
  createEnvelope,
  touchEnvelope,
  type AccessClassification,
  type EvidenceItem,
  type Hypothesis,
  type HypothesisState,
  type ProvenanceRef
} from "@udn/domain";

import { findProhibitedTerm } from "./vocabulary.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Origin recorded on records produced by the Hypothesis_Service. */
export const HYPOTHESIS_SOURCE = "Hypothesis_Service";

/** The initial state assigned to a freshly created card (Req 11.4). */
export const INITIAL_HYPOTHESIS_STATE: HypothesisState = "Proposed";

/** Whether `value` is a member of the defined hypothesis-state set (Req 11.4). */
export function isHypothesisState(value: string): value is HypothesisState {
  return (HYPOTHESIS_STATES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Why a Hypothesis_Service action was rejected. */
export type HypothesisErrorCode =
  /** The caller is not authorised for the action (Req 11.6). */
  | "not_authorised"
  /** No evidence item was supplied on creation (Req 11.2). */
  | "no_evidence"
  /** The card text contained a prohibited diagnostic term (Req 11.3). */
  | "prohibited_term"
  /** The requested state is not a member of the defined set (Req 11.4). */
  | "invalid_state";

/** A structured Hypothesis_Service failure. */
export interface HypothesisError {
  readonly code: HypothesisErrorCode;
  readonly message: string;
}

function notAuthorised(userId: string, action: string): HypothesisError {
  return {
    code: "not_authorised",
    message: `User "${userId}" lacks authorisation to ${action} this hypothesis card.`
  };
}

// ---------------------------------------------------------------------------
// Creation (Req 11.1, 11.2, 11.3, 11.4)
// ---------------------------------------------------------------------------

/** A single supporting evidence descriptor to link to a new card (Req 11.1). */
export interface EvidenceInput {
  /** Reference to the source object the evidence is drawn from. */
  readonly sourceObjectRef: string;
  /** The kind of evidence (e.g. "confirmed_phenotype", "variant"). */
  readonly kind: string;
  /** Access classification for the evidence item; defaults to the card's. */
  readonly accessClassification?: AccessClassification;
  /** Optional explicit id; generated when omitted. */
  readonly id?: string;
}

/** Input for a hypothesis-card creation attempt. */
export interface CreateHypothesisInput {
  /** Owning case id. */
  readonly caseId: string;
  /** Non-diagnostic card text (Req 11.3). */
  readonly text: string;
  /** Supporting evidence; at least one item is required (Req 11.1, 11.2). */
  readonly evidence: readonly EvidenceInput[];
  /** Active knowledge-snapshot version in effect (Req 14.5). */
  readonly knowledgeSnapshotVersion: string;
  /** Identity of the user creating the card. */
  readonly createdById: string;
  /** Creation timestamp, ISO-8601 UTC. */
  readonly at: string;
  /** Whether the user holds authorisation to create the card. */
  readonly isAuthorised: boolean;
  /** Initial state; defaults to {@link INITIAL_HYPOTHESIS_STATE} (Req 11.4). */
  readonly initialState?: HypothesisState;
  /** Access classification for produced records; defaults to "clinical". */
  readonly accessClassification?: AccessClassification;
  /** Origin recorded on produced envelopes; defaults to {@link HYPOTHESIS_SOURCE}. */
  readonly source?: string;
  /** Optional explicit id for the hypothesis; generated when omitted. */
  readonly hypothesisId?: string;
  /** Optional provenance; a deterministic default is derived when omitted. */
  readonly provenance?: ProvenanceRef;
}

/** A successfully created card with its evidence items. */
export interface HypothesisCard {
  /** The evidence-linked hypothesis (Req 11.1, 11.4, 11.7). */
  readonly hypothesis: Hypothesis;
  /** The evidence items the card links to, one per evidence input. */
  readonly evidenceItems: readonly EvidenceItem[];
}

/** Result of {@link createHypothesis}. */
export type CreateHypothesisResult =
  | { readonly ok: true; readonly card: HypothesisCard }
  | { readonly ok: false; readonly error: HypothesisError };

/** Build one evidence item from an evidence descriptor. */
function toEvidenceItem(
  evidence: EvidenceInput,
  input: CreateHypothesisInput
): EvidenceItem {
  const provenance: ProvenanceRef = {
    sourceId: evidence.sourceObjectRef,
    versionId: input.knowledgeSnapshotVersion,
    createdById: input.createdById,
    ingestedAt: input.at
  };

  const envelope = createEnvelope({
    ...(evidence.id !== undefined ? { id: evidence.id } : {}),
    entityType: "EvidenceItem",
    caseId: input.caseId,
    source: input.source ?? HYPOTHESIS_SOURCE,
    status: "linked",
    provenance,
    accessClassification:
      evidence.accessClassification ?? input.accessClassification ?? "clinical",
    createdById: input.createdById,
    now: input.at
  });

  return {
    ...envelope,
    entityType: "EvidenceItem",
    sourceObjectRef: evidence.sourceObjectRef,
    kind: evidence.kind
  };
}

/**
 * Create an evidence-linked Hypothesis_Card (Req 11.1, 11.2, 11.3, 11.4).
 *
 * The creation is rejected — with NO card produced — when:
 *
 *   * the caller is not authorised (`not_authorised`);
 *   * the evidence list is empty (`no_evidence`, Req 11.2);
 *   * the text contains a prohibited diagnostic term (`prohibited_term`,
 *     Req 11.3); or
 *   * the requested initial state is not in the defined set (`invalid_state`,
 *     Req 11.4).
 *
 * On success the card links to exactly one evidence item per evidence input
 * (Req 11.1), starts in the requested/initial state with an empty transition
 * history, and records the active knowledge-snapshot version (Req 14.5).
 */
export function createHypothesis(input: CreateHypothesisInput): CreateHypothesisResult {
  if (!input.isAuthorised) {
    return { ok: false, error: notAuthorised(input.createdById, "create") };
  }

  if (input.evidence.length === 0) {
    return {
      ok: false,
      error: {
        code: "no_evidence",
        message:
          "Cannot create a hypothesis card: at least one supporting evidence item is required."
      }
    };
  }

  const prohibited = findProhibitedTerm(input.text);
  if (prohibited !== undefined) {
    return {
      ok: false,
      error: {
        code: "prohibited_term",
        message: `Hypothesis card text contains a prohibited diagnostic term: "${prohibited}".`
      }
    };
  }

  const state = input.initialState ?? INITIAL_HYPOTHESIS_STATE;
  if (!isHypothesisState(state)) {
    return {
      ok: false,
      error: {
        code: "invalid_state",
        message: `"${state}" is not a valid hypothesis state.`
      }
    };
  }

  const evidenceItems = input.evidence.map((evidence) => toEvidenceItem(evidence, input));

  const provenance: ProvenanceRef =
    input.provenance ?? {
      sourceId: input.caseId,
      versionId: input.knowledgeSnapshotVersion,
      createdById: input.createdById,
      ingestedAt: input.at
    };

  const envelope = createEnvelope({
    ...(input.hypothesisId !== undefined ? { id: input.hypothesisId } : {}),
    entityType: "Hypothesis",
    caseId: input.caseId,
    source: input.source ?? HYPOTHESIS_SOURCE,
    status: state,
    provenance,
    accessClassification: input.accessClassification ?? "clinical",
    createdById: input.createdById,
    now: input.at
  });

  const hypothesis: Hypothesis = {
    ...envelope,
    entityType: "Hypothesis",
    state,
    text: input.text,
    evidenceItemIds: evidenceItems.map((item) => item.id),
    knowledgeSnapshotVersion: input.knowledgeSnapshotVersion,
    stateHistory: []
  };

  return { ok: true, card: { hypothesis, evidenceItems } };
}

// ---------------------------------------------------------------------------
// State update (Req 11.4, 11.5, 11.6, 11.7)
// ---------------------------------------------------------------------------

/** Input for a hypothesis-card state update attempt. */
export interface UpdateHypothesisStateInput {
  /** The requested new state; must be a member of the defined set (Req 11.4). */
  readonly newState: HypothesisState;
  /** Identity of the user performing the update (Req 11.5). */
  readonly userId: string;
  /** Update timestamp, ISO-8601 UTC (Req 11.5). */
  readonly at: string;
  /** Whether the user holds authorisation to update the state (Req 11.6). */
  readonly isAuthorised: boolean;
}

/** Successful state update: the card advanced to the new state. */
export interface UpdateHypothesisStateSuccess {
  readonly ok: true;
  /** The card with the new state and an appended transition history entry. */
  readonly hypothesis: Hypothesis;
}

/** Failed state update: the card is retained in its current state (Req 11.6). */
export interface UpdateHypothesisStateFailure {
  readonly ok: false;
  readonly error: HypothesisError;
  /** The card, unchanged. */
  readonly hypothesis: Hypothesis;
}

/** Result of {@link updateHypothesisState}. */
export type UpdateHypothesisStateResult =
  | UpdateHypothesisStateSuccess
  | UpdateHypothesisStateFailure;

/**
 * Update the state of a Hypothesis_Card (Req 11.4, 11.5, 11.6, 11.7).
 *
 *   * **Unauthorised** (`isAuthorised === false`) — rejected with a
 *     `not_authorised` error; the current state is retained and the card is
 *     returned unchanged (Req 11.6).
 *   * **Invalid state** — a requested state outside the defined set is rejected
 *     with an `invalid_state` error; the card is returned unchanged (Req 11.4).
 *   * **Authorised + valid** — the card transitions to the new state; a history
 *     entry recording the previous state, the new state, the user identity, and
 *     the update timestamp is appended (Req 11.5); the envelope status tracks
 *     the state; and the evidence links are retained unchanged (Req 11.7).
 *
 * The input card is never mutated.
 */
export function updateHypothesisState(
  hypothesis: Hypothesis,
  input: UpdateHypothesisStateInput
): UpdateHypothesisStateResult {
  if (!input.isAuthorised) {
    return { ok: false, hypothesis, error: notAuthorised(input.userId, "update the state of") };
  }

  if (!isHypothesisState(input.newState)) {
    return {
      ok: false,
      hypothesis,
      error: {
        code: "invalid_state",
        message: `"${input.newState}" is not a valid hypothesis state.`
      }
    };
  }

  const transition = {
    from: hypothesis.state,
    to: input.newState,
    byId: input.userId,
    at: input.at
  };

  const updated: Hypothesis = {
    ...touchEnvelope(hypothesis, input.at),
    state: input.newState,
    status: input.newState,
    // Retain the existing evidence links unchanged (Req 11.7).
    evidenceItemIds: [...hypothesis.evidenceItemIds],
    stateHistory: [...hypothesis.stateHistory, transition]
  };

  return { ok: true, hypothesis: updated };
}

// ---------------------------------------------------------------------------
// Text update (Req 11.3, 11.7)
// ---------------------------------------------------------------------------

/** Input for a hypothesis-card text update attempt. */
export interface UpdateHypothesisTextInput {
  /** The corrected non-diagnostic card text (Req 11.3). */
  readonly text: string;
  /** Identity of the user performing the update. */
  readonly userId: string;
  /** Update timestamp, ISO-8601 UTC. */
  readonly at: string;
  /** Whether the user holds authorisation to update the card (Req 11.6). */
  readonly isAuthorised: boolean;
}

/** Result of {@link updateHypothesisText}. */
export type UpdateHypothesisTextResult =
  | { readonly ok: true; readonly hypothesis: Hypothesis }
  | { readonly ok: false; readonly error: HypothesisError; readonly hypothesis: Hypothesis };

/**
 * Update the text of a Hypothesis_Card (Req 11.3, 11.6, 11.7).
 *
 * Rejected — leaving the card unchanged — when the caller is not authorised
 * (`not_authorised`, Req 11.6) or the new text contains a prohibited diagnostic
 * term (`prohibited_term`, Req 11.3). On success the text is replaced while the
 * state and the evidence links are retained unchanged (Req 11.7).
 *
 * The input card is never mutated.
 */
export function updateHypothesisText(
  hypothesis: Hypothesis,
  input: UpdateHypothesisTextInput
): UpdateHypothesisTextResult {
  if (!input.isAuthorised) {
    return { ok: false, hypothesis, error: notAuthorised(input.userId, "update") };
  }

  const prohibited = findProhibitedTerm(input.text);
  if (prohibited !== undefined) {
    return {
      ok: false,
      hypothesis,
      error: {
        code: "prohibited_term",
        message: `Hypothesis card text contains a prohibited diagnostic term: "${prohibited}".`
      }
    };
  }

  const updated: Hypothesis = {
    ...touchEnvelope(hypothesis, input.at),
    text: input.text,
    // Retain the existing evidence links unchanged (Req 11.7).
    evidenceItemIds: [...hypothesis.evidenceItemIds]
  };

  return { ok: true, hypothesis: updated };
}
