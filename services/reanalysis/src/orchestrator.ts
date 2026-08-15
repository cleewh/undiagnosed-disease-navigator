// services/reanalysis/src/orchestrator.ts
//
// Event-driven reanalysis identification (Reanalysis_Service, task 27.1,
// Requirements 15.1, 15.2, 15.3, 15.5, 15.8, 15.9).
//
// This is the entry point invoked when a Knowledge_Update is published on the
// EventBridge domain bus (event category "knowledge-update"; design "Domain
// Event Flow"). On such an event the service runs the DETERMINISTIC matcher
// over the unresolved-case feature vectors, creates a Reanalysis_Candidate for
// every affected case (recording matched relevance and linked to the triggering
// update), and enqueues those cases on the review queue (Req 15.1–15.3, 15.8,
// 15.9). It composes the existing `matchUnresolvedCases` matcher and never
// calls a generative model.
//
// Identification is expected to complete within 60 seconds (Req 15.1 — a
// runtime/timing concern of the caller). If identification fails, the update is
// retained in a PENDING state, identification is retried up to 3 times, and an
// error indication naming the failed Knowledge_Update is produced (Req 15.5).
// The retry-and-count mechanics live in {@link attemptWithRetry}; the pure
// matcher core is untouched.
//
// A convenience simulator (`simulateKnowledgeUpdateEvents`) composes the
// Knowledge_Service (`generateKnowledgeUpdates`) to produce a batch of publish
// events for demos and the reanalysis inbox, keeping the event shape in one
// place.

import type { KnowledgeUpdate, ReanalysisCandidate } from "@udn/domain";
import { generateKnowledgeUpdates } from "@udn/knowledge";
import {
  matchUnresolvedCases,
  type CaseFeatureVector,
  type MatchOptions,
  type ReviewQueueEntry
} from "./matcher.js";
import { attemptWithRetry, MAX_REANALYSIS_ATTEMPTS } from "./retry.js";

/** The EventBridge domain event category for published knowledge updates. */
export const KNOWLEDGE_UPDATE_EVENT = "knowledge-update";

/**
 * A published-knowledge-update domain event (design "Domain Event Flow"). The
 * `type` is fixed to {@link KNOWLEDGE_UPDATE_EVENT}; `publishedAt` records when
 * the event was placed on the bus.
 */
export interface KnowledgeUpdatePublishedEvent {
  readonly type: typeof KNOWLEDGE_UPDATE_EVENT;
  /** The Knowledge_Update carried by the event. */
  readonly update: KnowledgeUpdate;
  /** ISO-8601 UTC time the event was published. */
  readonly publishedAt: string;
}

/** Wrap a Knowledge_Update as a publish event for the domain bus. */
export function knowledgeUpdatePublishedEvent(
  update: KnowledgeUpdate,
  publishedAt: string
): KnowledgeUpdatePublishedEvent {
  return { type: KNOWLEDGE_UPDATE_EVENT, update, publishedAt };
}

/** Options for handling a published-knowledge-update event. */
export interface HandleKnowledgeUpdateOptions extends MatchOptions {
  /** Maximum identification attempts before the update is left pending (Req 15.5). Defaults to 3. */
  readonly maxAttempts?: number;
  /**
   * Optional identification override, primarily for tests that simulate a
   * transient identification failure. Defaults to composing the deterministic
   * `matchUnresolvedCases` matcher over the supplied feature vectors.
   */
  readonly identify?: () => { candidates: ReanalysisCandidate[]; reviewQueue: ReviewQueueEntry[] };
}

/** Successful identification for a published Knowledge_Update. */
export interface KnowledgeUpdateHandledSuccess {
  readonly status: "completed";
  /** The Knowledge_Update the event carried. */
  readonly update: KnowledgeUpdate;
  /** Candidates created for affected cases, in stable case-id order (Req 15.2, 15.8, 15.9). */
  readonly candidates: ReanalysisCandidate[];
  /** Review-queue entries for the affected cases, oldest-first (Req 15.3). */
  readonly reviewQueue: ReviewQueueEntry[];
  /** How many identification attempts were made (1..maxAttempts). */
  readonly attempts: number;
}

/** Error indication produced when identification does not complete (Req 15.5). */
export interface KnowledgeUpdatePendingError {
  readonly code: "identification_failed";
  readonly message: string;
  /** The Knowledge_Update that failed identification (Req 15.5). */
  readonly knowledgeUpdateId: string;
}

/** Failed identification: the Knowledge_Update is retained pending (Req 15.5). */
export interface KnowledgeUpdateHandledPending {
  readonly status: "pending";
  /** The Knowledge_Update, retained in a pending state (Req 15.5). */
  readonly update: KnowledgeUpdate;
  /** How many identification attempts were made (equals maxAttempts). */
  readonly attempts: number;
  /** Error indication naming the failed Knowledge_Update (Req 15.5). */
  readonly error: KnowledgeUpdatePendingError;
}

/** Result of {@link handleKnowledgeUpdatePublished}. */
export type KnowledgeUpdateHandledResult =
  | KnowledgeUpdateHandledSuccess
  | KnowledgeUpdateHandledPending;

/**
 * Handle a published-knowledge-update event: identify affected Unresolved_Cases,
 * create Reanalysis_Candidates, and enqueue them (Req 15.1, 15.2, 15.3, 15.8,
 * 15.9).
 *
 * The deterministic matcher is run over the supplied unresolved-case feature
 * vectors (composing `matchUnresolvedCases`); each affected case yields a
 * candidate recording matched relevance and linked to the triggering update,
 * and the corresponding review-queue entries are returned. Cases whose feature
 * vector does not intersect the update contribute no candidate (Req 15.9).
 *
 * Identification is wrapped in bounded retry (up to `maxAttempts`, default 3).
 * If every attempt fails, the update is reported as PENDING with an error
 * indication naming it (Req 15.5); the caller retains the update for a later
 * attempt and leaves case state untouched.
 */
export function handleKnowledgeUpdatePublished(
  event: KnowledgeUpdatePublishedEvent,
  features: readonly CaseFeatureVector[],
  options: HandleKnowledgeUpdateOptions
): KnowledgeUpdateHandledResult {
  const maxAttempts = options.maxAttempts ?? MAX_REANALYSIS_ATTEMPTS;
  const identify =
    options.identify ??
    (() => matchUnresolvedCases(features, event.update, options));

  const outcome = attemptWithRetry(identify, maxAttempts);

  if (!outcome.ok) {
    return {
      status: "pending",
      update: event.update,
      attempts: outcome.attempts,
      error: {
        code: "identification_failed",
        knowledgeUpdateId: event.update.id,
        message: `Reanalysis identification did not complete for Knowledge_Update "${event.update.id}" after ${outcome.attempts} attempt(s); the update is retained pending.`
      }
    };
  }

  return {
    status: "completed",
    update: event.update,
    candidates: outcome.value.candidates,
    reviewQueue: outcome.value.reviewQueue,
    attempts: outcome.attempts
  };
}

/** Input for simulating a batch of knowledge-update publish events. */
export interface SimulateKnowledgeUpdateEventsInput {
  /** How many synthetic updates to generate; must be within [5, 50] (Req 14.2). */
  readonly count: number;
  /** Identity of the actor recording the updates (envelope). */
  readonly createdById: string;
  /** Creation/publish timestamp, ISO-8601 UTC. */
  readonly at: string;
}

/** Result of {@link simulateKnowledgeUpdateEvents}. */
export type SimulateKnowledgeUpdateEventsResult =
  | { readonly ok: true; readonly events: KnowledgeUpdatePublishedEvent[] }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/**
 * Produce a batch of published-knowledge-update events from the Knowledge_Service
 * (composing `generateKnowledgeUpdates`) for demos and the reanalysis inbox.
 *
 * Deterministic and free of generative-model calls: it wraps each generated
 * synthetic Knowledge_Update as a publish event stamped with `at`. Propagates
 * the Knowledge_Service's range validation ([5, 50]) as a structured error.
 */
export function simulateKnowledgeUpdateEvents(
  input: SimulateKnowledgeUpdateEventsInput
): SimulateKnowledgeUpdateEventsResult {
  const generated = generateKnowledgeUpdates({
    count: input.count,
    createdById: input.createdById,
    at: input.at
  });

  if (!generated.ok) {
    return { ok: false, error: generated.error };
  }

  const events = generated.updates.map((update) =>
    knowledgeUpdatePublishedEvent(update, input.at)
  );
  return { ok: true, events };
}
