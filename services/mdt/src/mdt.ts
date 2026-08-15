// services/mdt/src/mdt.ts
//
// The MDT_Service (task 23.1, Requirement 12).
//
// The MDT_Service manages multidisciplinary-team collaboration on a
// Hypothesis_Card: comments (with @mentions), follow-up tasks, votes, and the
// recorded MDT decision + case disposition. Collaboration for a card is
// aggregated in a single `MdtDecision` record (the domain shape carries the
// card's `comments`, `votes`, `participants`, `decision`, and `disposition`),
// so this module opens that record, accumulates comments/votes onto it, and
// later records the decision.
//
// This module implements the complete behaviour required by Requirement 12:
//
//   * a comment is stored with author identity and timestamp iff its body is
//     between 1 and 5,000 characters (Req 12.1);
//   * every @mention resolves to a registered user and is associated with the
//     stored comment (Req 12.2);
//   * an MDT decision + case disposition are stored together (Req 12.3);
//   * a task is assigned to exactly one registered user (Req 12.4);
//   * each user casts at most one vote per card — a repeat vote replaces the
//     prior one, so the stored vote count per user never exceeds one (Req 12.5);
//   * a recorded decision captures the decision, the participants, and the
//     timestamp (Req 12.6); and
//   * an unauthorised comment/vote/decision attempt is rejected, leaves the
//     card unchanged, and returns a not-authorised error (Req 12.7).
//
// Authorisation is passed IN as a decision (`isAuthorised`), mirroring the
// Review_Service / Hypothesis_Service convention: the RBAC matrix lives in
// apps/api/src/auth, and this service consumes an authorisation decision rather
// than re-encoding role rules.
//
// Every function is pure and deterministic — for fixed inputs (including the
// timestamp and any explicit ids) the produced objects are byte-for-byte
// identical — and no generative model is ever involved. Input objects are never
// mutated; a new object is returned whenever a record changes.

import {
  createEnvelope,
  touchEnvelope,
  type AccessClassification,
  type MdtDecision,
  type ProvenanceRef,
  type Task
} from "@udn/domain";

import { notAuthorised, type MdtError } from "./errors.js";
import type { RegisteredUserResolver } from "./registered-users.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Origin recorded on records produced by the MDT_Service. */
export const MDT_SOURCE = "MDT_Service";

/** Minimum permitted comment body length, inclusive (Req 12.1). */
export const MIN_COMMENT_LENGTH = 1;

/** Maximum permitted comment body length, inclusive (Req 12.1). */
export const MAX_COMMENT_LENGTH = 5000;

/** Envelope status for a collaboration record awaiting a decision. */
export const MDT_STATUS_OPEN = "open";

/** Envelope status for a collaboration record with a decision recorded. */
export const MDT_STATUS_DECIDED = "decided";

/** A stored comment on a Hypothesis_Card (Req 12.1, 12.2). */
export type MdtComment = MdtDecision["comments"][number];

/** A stored vote on a Hypothesis_Card (Req 12.5). */
export type MdtVote = MdtDecision["votes"][number];

/** Whether `length` is within the permitted comment range (Req 12.1). */
export function isValidCommentLength(length: number): boolean {
  return length >= MIN_COMMENT_LENGTH && length <= MAX_COMMENT_LENGTH;
}

// ---------------------------------------------------------------------------
// Opening the collaboration record for a card
// ---------------------------------------------------------------------------

/** Input for opening the MDT collaboration record for a Hypothesis_Card. */
export interface OpenMdtRecordInput {
  /** Owning case id. */
  readonly caseId: string;
  /** The Hypothesis_Card this record collaborates on. */
  readonly hypothesisId: string;
  /** Identity of the user opening the record. */
  readonly createdById: string;
  /** Creation timestamp, ISO-8601 UTC. */
  readonly at: string;
  /** Whether the user is an authorised MDT participant (Req 12.7). */
  readonly isAuthorised: boolean;
  /** Access classification for the record; defaults to "clinical". */
  readonly accessClassification?: AccessClassification;
  /** Origin recorded on the envelope; defaults to {@link MDT_SOURCE}. */
  readonly source?: string;
  /** Optional explicit id; generated when omitted. */
  readonly mdtDecisionId?: string;
  /** Optional provenance; a deterministic default is derived when omitted. */
  readonly provenance?: ProvenanceRef;
}

/** Result of {@link openMdtRecord}. */
export type OpenMdtRecordResult =
  | { readonly ok: true; readonly record: MdtDecision }
  | { readonly ok: false; readonly error: MdtError };

/**
 * Open the MDT collaboration record for a Hypothesis_Card (Req 12.7).
 *
 * The record starts with no comments, no votes, no participants, and an empty
 * decision/disposition; comments and votes are accumulated with
 * {@link addComment} / {@link castVote} and the decision is filled in later
 * with {@link recordDecision}. An unauthorised attempt is rejected and no
 * record is produced (Req 12.7).
 */
export function openMdtRecord(input: OpenMdtRecordInput): OpenMdtRecordResult {
  if (!input.isAuthorised) {
    return { ok: false, error: notAuthorised(input.createdById, "open an MDT record") };
  }

  const provenance: ProvenanceRef =
    input.provenance ?? {
      sourceId: input.hypothesisId,
      versionId: "1",
      createdById: input.createdById,
      ingestedAt: input.at
    };

  const envelope = createEnvelope({
    ...(input.mdtDecisionId !== undefined ? { id: input.mdtDecisionId } : {}),
    entityType: "MdtDecision",
    caseId: input.caseId,
    source: input.source ?? MDT_SOURCE,
    status: MDT_STATUS_OPEN,
    provenance,
    accessClassification: input.accessClassification ?? "clinical",
    createdById: input.createdById,
    now: input.at
  });

  const record: MdtDecision = {
    ...envelope,
    entityType: "MdtDecision",
    hypothesisId: input.hypothesisId,
    decision: "",
    disposition: "",
    participants: [],
    decidedAt: "",
    comments: [],
    votes: []
  };

  return { ok: true, record };
}

// ---------------------------------------------------------------------------
// Comments and mentions (Req 12.1, 12.2, 12.7)
// ---------------------------------------------------------------------------

/** Input for an attempt to add a comment to a card's MDT record. */
export interface AddCommentInput {
  /** Identity of the comment author (Req 12.1). */
  readonly authorId: string;
  /** The comment body; must be 1–5,000 characters (Req 12.1). */
  readonly body: string;
  /** Comment timestamp, ISO-8601 UTC (Req 12.1). */
  readonly at: string;
  /** User ids mentioned in the comment; each must be registered (Req 12.2). */
  readonly mentions?: readonly string[];
  /** Whether the author is an authorised MDT participant (Req 12.7). */
  readonly isAuthorised: boolean;
  /** Resolver used to verify every mention is a registered user (Req 12.2). */
  readonly isRegisteredUser: RegisteredUserResolver;
}

/** Successful comment: the record with the stored comment appended. */
export interface AddCommentSuccess {
  readonly ok: true;
  /** The record with the new comment appended (input unchanged; new object). */
  readonly record: MdtDecision;
  /** The stored comment, with resolved mentions associated (Req 12.2). */
  readonly comment: MdtComment;
}

/** Failed comment: the record is retained unchanged (Req 12.7). */
export interface AddCommentFailure {
  readonly ok: false;
  readonly error: MdtError;
  /** The record, unchanged. */
  readonly record: MdtDecision;
}

/** Result of {@link addComment}. */
export type AddCommentResult = AddCommentSuccess | AddCommentFailure;

/**
 * Add a comment to a card's MDT record (Req 12.1, 12.2, 12.7).
 *
 * The comment is stored — with author identity and timestamp — only when the
 * author is authorised, the body length is within 1–5,000 characters, and every
 * @mention resolves to a registered user. Otherwise the record is returned
 * unchanged with a structured error:
 *
 *   * **Unauthorised** — `not_authorised` (Req 12.7).
 *   * **Body too short/long** — `invalid_comment_length` (Req 12.1).
 *   * **Unregistered mention** — `unregistered_mention` (Req 12.2).
 *
 * On success the stored comment carries the (de-duplicated, order-preserved)
 * set of resolved mentions and is associated with the record (Req 12.2). The
 * input record is never mutated.
 */
export function addComment(record: MdtDecision, input: AddCommentInput): AddCommentResult {
  if (!input.isAuthorised) {
    return { ok: false, record, error: notAuthorised(input.authorId, "comment on this card") };
  }

  if (!isValidCommentLength(input.body.length)) {
    return {
      ok: false,
      record,
      error: {
        code: "invalid_comment_length",
        message: `Comment body length ${input.body.length} is outside the permitted range ${MIN_COMMENT_LENGTH}-${MAX_COMMENT_LENGTH}.`
      }
    };
  }

  const mentions = dedupePreserveOrder(input.mentions ?? []);
  for (const mentionedId of mentions) {
    if (!input.isRegisteredUser(mentionedId)) {
      return {
        ok: false,
        record,
        error: {
          code: "unregistered_mention",
          message: `Mentioned user "${mentionedId}" does not resolve to a registered user.`
        }
      };
    }
  }

  const comment: MdtComment = {
    authorId: input.authorId,
    body: input.body,
    at: input.at,
    mentions
  };

  const updated: MdtDecision = {
    ...touchEnvelope(record, input.at),
    comments: [...record.comments, comment]
  };

  return { ok: true, record: updated, comment };
}

// ---------------------------------------------------------------------------
// Votes (Req 12.5, 12.7)
// ---------------------------------------------------------------------------

/** Input for an attempt to cast a vote on a card's MDT record. */
export interface CastVoteInput {
  /** Identity of the voting user (Req 12.5). */
  readonly userId: string;
  /** The vote value (e.g. "support", "oppose", "abstain"). */
  readonly value: string;
  /** Vote timestamp, ISO-8601 UTC. */
  readonly at: string;
  /** Whether the voter is an authorised MDT participant (Req 12.7). */
  readonly isAuthorised: boolean;
  /** Resolver used to verify the voter is a registered user (Req 12.5). */
  readonly isRegisteredUser: RegisteredUserResolver;
}

/** Successful vote: the record with the vote stored (at most one per user). */
export interface CastVoteSuccess {
  readonly ok: true;
  /** The record with the vote applied (input unchanged; new object). */
  readonly record: MdtDecision;
  /** Whether this vote replaced an existing vote by the same user (Req 12.5). */
  readonly replacedPrevious: boolean;
}

/** Failed vote: the record is retained unchanged (Req 12.7). */
export interface CastVoteFailure {
  readonly ok: false;
  readonly error: MdtError;
  /** The record, unchanged. */
  readonly record: MdtDecision;
}

/** Result of {@link castVote}. */
export type CastVoteResult = CastVoteSuccess | CastVoteFailure;

/**
 * Cast a vote on a card's MDT record (Req 12.5, 12.7).
 *
 * Each user may hold at most one vote per card: a repeat vote by the same user
 * REPLACES that user's prior vote value rather than adding a second one, so the
 * stored vote count for any user on the card never exceeds one (Req 12.5).
 *
 * Rejected — leaving the record unchanged — when the caller is not authorised
 * (`not_authorised`, Req 12.7) or the voter is not a registered user
 * (`unregistered_user`, Req 12.5). The input record is never mutated.
 */
export function castVote(record: MdtDecision, input: CastVoteInput): CastVoteResult {
  if (!input.isAuthorised) {
    return { ok: false, record, error: notAuthorised(input.userId, "vote on this card") };
  }

  if (!input.isRegisteredUser(input.userId)) {
    return {
      ok: false,
      record,
      error: {
        code: "unregistered_user",
        message: `Voting user "${input.userId}" does not resolve to a registered user.`
      }
    };
  }

  const vote: MdtVote = { userId: input.userId, value: input.value };
  const existingIndex = record.votes.findIndex((v) => v.userId === input.userId);
  const replacedPrevious = existingIndex >= 0;

  const votes = replacedPrevious
    ? record.votes.map((v, index) => (index === existingIndex ? vote : v))
    : [...record.votes, vote];

  const updated: MdtDecision = {
    ...touchEnvelope(record, input.at),
    votes
  };

  return { ok: true, record: updated, replacedPrevious };
}

// ---------------------------------------------------------------------------
// Decision + disposition (Req 12.3, 12.6, 12.7)
// ---------------------------------------------------------------------------

/** Input for recording an MDT decision and case disposition onto a record. */
export interface RecordDecisionInput {
  /** The MDT decision (Req 12.3, 12.6). */
  readonly decision: string;
  /** The case disposition recorded alongside the decision (Req 12.3). */
  readonly disposition: string;
  /** The participants in the decision; each must be registered (Req 12.6). */
  readonly participants: readonly string[];
  /** Identity of the user recording the decision. */
  readonly userId: string;
  /** Decision timestamp, ISO-8601 UTC (Req 12.6). */
  readonly at: string;
  /** Whether the recorder is an authorised MDT participant (Req 12.7). */
  readonly isAuthorised: boolean;
  /** Resolver used to verify every participant is a registered user (Req 12.6). */
  readonly isRegisteredUser: RegisteredUserResolver;
}

/** Successful decision: the record with decision, disposition, and participants. */
export interface RecordDecisionSuccess {
  readonly ok: true;
  /** The record with the decision recorded (input unchanged; new object). */
  readonly record: MdtDecision;
}

/** Failed decision: the record is retained unchanged (Req 12.7). */
export interface RecordDecisionFailure {
  readonly ok: false;
  readonly error: MdtError;
  /** The record, unchanged. */
  readonly record: MdtDecision;
}

/** Result of {@link recordDecision}. */
export type RecordDecisionResult = RecordDecisionSuccess | RecordDecisionFailure;

/**
 * Record an MDT decision and case disposition onto a card's record
 * (Req 12.3, 12.6, 12.7).
 *
 * On success the record stores the decision, the disposition, the
 * (de-duplicated, order-preserved) participants, and the decision timestamp,
 * and its envelope status becomes {@link MDT_STATUS_DECIDED}. Comments and votes
 * already accumulated on the record are retained unchanged.
 *
 * Rejected — leaving the record unchanged — when the caller is not authorised
 * (`not_authorised`, Req 12.7) or any participant is not a registered user
 * (`unregistered_user`, Req 12.6). The input record is never mutated.
 */
export function recordDecision(
  record: MdtDecision,
  input: RecordDecisionInput
): RecordDecisionResult {
  if (!input.isAuthorised) {
    return { ok: false, record, error: notAuthorised(input.userId, "record a decision for this card") };
  }

  const participants = dedupePreserveOrder(input.participants);
  for (const participantId of participants) {
    if (!input.isRegisteredUser(participantId)) {
      return {
        ok: false,
        record,
        error: {
          code: "unregistered_user",
          message: `Participant "${participantId}" does not resolve to a registered user.`
        }
      };
    }
  }

  const updated: MdtDecision = {
    ...touchEnvelope(record, input.at),
    status: MDT_STATUS_DECIDED,
    decision: input.decision,
    disposition: input.disposition,
    participants,
    decidedAt: input.at,
    // Retain accumulated collaboration unchanged.
    comments: [...record.comments],
    votes: [...record.votes]
  };

  return { ok: true, record: updated };
}

// ---------------------------------------------------------------------------
// Tasks (Req 12.4, 12.7)
// ---------------------------------------------------------------------------

/** The initial state assigned to a freshly created task (Req 12.4). */
export const INITIAL_TASK_STATE: Task["state"] = "open";

/** Input for an attempt to create an MDT follow-up task. */
export interface CreateTaskInput {
  /** Owning case id. */
  readonly caseId: string;
  /** The single registered user the task is assigned to (Req 12.4). */
  readonly assigneeId: string;
  /** A description of the follow-up work. */
  readonly description: string;
  /** Identity of the user creating the task. */
  readonly createdById: string;
  /** Creation timestamp, ISO-8601 UTC. */
  readonly at: string;
  /** Whether the creator is an authorised MDT participant (Req 12.7). */
  readonly isAuthorised: boolean;
  /** Resolver used to verify the assignee is a registered user (Req 12.4). */
  readonly isRegisteredUser: RegisteredUserResolver;
  /** Access classification for the task; defaults to "clinical". */
  readonly accessClassification?: AccessClassification;
  /** Origin recorded on the envelope; defaults to {@link MDT_SOURCE}. */
  readonly source?: string;
  /** Optional explicit id; generated when omitted. */
  readonly taskId?: string;
  /** Optional provenance; a deterministic default is derived when omitted. */
  readonly provenance?: ProvenanceRef;
}

/** Result of {@link createTask}. */
export type CreateTaskResult =
  | { readonly ok: true; readonly task: Task }
  | { readonly ok: false; readonly error: MdtError };

/**
 * Create an MDT follow-up task assigned to exactly one registered user
 * (Req 12.4, 12.7).
 *
 * The `Task` domain shape carries a single `assigneeId`, so a task is
 * structurally assigned to exactly one user; this function additionally
 * rejects creation unless that assignee resolves to a registered user.
 *
 * Rejected — with NO task produced — when the caller is not authorised
 * (`not_authorised`, Req 12.7) or the assignee is not registered
 * (`unregistered_assignee`, Req 12.4).
 */
export function createTask(input: CreateTaskInput): CreateTaskResult {
  if (!input.isAuthorised) {
    return { ok: false, error: notAuthorised(input.createdById, "create a task") };
  }

  if (!input.isRegisteredUser(input.assigneeId)) {
    return {
      ok: false,
      error: {
        code: "unregistered_assignee",
        message: `Task assignee "${input.assigneeId}" does not resolve to a registered user.`
      }
    };
  }

  const provenance: ProvenanceRef =
    input.provenance ?? {
      sourceId: input.caseId,
      versionId: "1",
      createdById: input.createdById,
      ingestedAt: input.at
    };

  const envelope = createEnvelope({
    ...(input.taskId !== undefined ? { id: input.taskId } : {}),
    entityType: "Task",
    caseId: input.caseId,
    source: input.source ?? MDT_SOURCE,
    status: INITIAL_TASK_STATE,
    provenance,
    accessClassification: input.accessClassification ?? "clinical",
    createdById: input.createdById,
    now: input.at
  });

  const task: Task = {
    ...envelope,
    entityType: "Task",
    assigneeId: input.assigneeId,
    description: input.description,
    state: INITIAL_TASK_STATE
  };

  return { ok: true, task };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Return the input ids with duplicates removed, preserving first-seen order. */
function dedupePreserveOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}
