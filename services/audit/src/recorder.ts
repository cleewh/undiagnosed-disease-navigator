// services/audit/src/recorder.ts
//
// Audit event recording with bounded retry and pending-event preservation
// (Requirement 22.1, 22.2, 22.5).
//
// The recorder builds a fully-formed AuditEvent from the common provenance
// envelope helpers, then appends it through an injected AuditSink. On a
// recording failure it retries up to a bounded number of times; when all
// retries are exhausted it returns an error indication to the caller and
// preserves the pending event for later reprocessing.
//
// Task 6.2 (immutability guard + original/corrected value capture on AI
// correction) is a separate later task. This module already accepts and
// carries `originalValue`/`correctedValue` on the built event so that 6.2 can
// build on it, but it does not implement the modify/delete rejection guard.

import {
  createEnvelope,
  utcNow,
  type AuditAction,
  type AuditEvent,
  type AccessClassification,
  type ProvenanceRef
} from "@udn/domain";

import { type AuditSink, type AuditWriter, sinkFromWriter } from "./sink.js";
import { InMemoryPendingStore, type PendingAuditEventStore } from "./pending.js";

/**
 * The details of an auditable action a caller wants recorded (Req 22.1, 22.2).
 * The recorder derives the envelope-managed fields (id, version, timestamps)
 * and fills sensible defaults for the remaining envelope attributes.
 */
export interface RecordAuditEventInput {
  /** Owning case identifier for the audited object. */
  caseId: string;
  /** Identity of the actor performing the action (Req 22.2). */
  actorId: string;
  /** The action performed (Req 22.1). */
  action: AuditAction;
  /** Identifier of the object affected by the action (Req 22.2). */
  affectedObjectId: string;
  /**
   * UTC timestamp of the action, ISO-8601 with at least second precision
   * (Req 22.2). Defaults to the current UTC time (millisecond precision).
   */
  at?: string;
  /** Original value, recorded when an AI output is corrected (Req 22.4 / task 6.2). */
  originalValue?: unknown;
  /** Corrected value, recorded when an AI output is corrected (Req 22.4 / task 6.2). */
  correctedValue?: unknown;
  /** Access classification for the event; defaults to "clinical". */
  accessClassification?: AccessClassification;
  /** Recorded origin of the event; defaults to "Audit_Service". */
  source?: string;
  /** Explicit provenance; a default derived from the action is used when omitted. */
  provenance?: ProvenanceRef;
}

/**
 * Successful recording outcome.
 */
export interface RecordSuccess {
  status: "recorded";
  /** The event as recorded. */
  event: AuditEvent;
  /** Total number of sink attempts made (>= 1). */
  attempts: number;
}

/**
 * Failure outcome after all retries were exhausted (Req 22.5). The pending
 * event has been preserved in the configured store and is also returned here
 * so the initiating action can react immediately.
 */
export interface RecordFailure {
  status: "failed";
  /** The event that could not be recorded; preserved for reprocessing. */
  event: AuditEvent;
  /** Total number of sink attempts made. */
  attempts: number;
  /** The last error thrown by the sink. */
  error: Error;
}

/**
 * Result of an attempt to record an audit event.
 */
export type RecordResult = RecordSuccess | RecordFailure;

/**
 * The details of an AI-output correction a caller wants recorded (Req 22.4).
 *
 * When an AI output is corrected by a user, the audit event MUST record BOTH
 * the original value and the corrected value. This input makes both mandatory
 * (unlike {@link RecordAuditEventInput}, where they are optional), so a
 * correction can never be recorded without capturing both sides of the change.
 * The action defaults to `"modify"`, the correction action.
 */
export interface RecordCorrectionInput
  extends Omit<RecordAuditEventInput, "action" | "originalValue" | "correctedValue"> {
  /** The value before the user's correction (required, Req 22.4). */
  originalValue: unknown;
  /** The value after the user's correction (required, Req 22.4). */
  correctedValue: unknown;
  /**
   * The correction action; defaults to `"modify"`. A correction is a
   * modification, so only `"modify"` is accepted.
   */
  action?: "modify";
}

/** Configuration for an {@link AuditRecorder}. */
export interface AuditRecorderOptions {
  /**
   * Maximum number of retries after the initial attempt (Req 22.5).
   * Defaults to 3, giving up to 4 total attempts.
   */
  maxRetries?: number;
  /** Store used to preserve pending events on exhaustion. Defaults to an in-memory store. */
  pendingStore?: PendingAuditEventStore;
  /** Clock used for timestamps; injectable for tests. Defaults to {@link utcNow}. */
  now?: () => string;
}

const DEFAULT_MAX_RETRIES = 3;

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Records audit events through an append-only sink with bounded retry and
 * pending-event preservation (Req 22.1, 22.2, 22.5).
 */
export class AuditRecorder {
  readonly #sink: AuditSink;
  readonly #maxRetries: number;
  readonly #pendingStore: PendingAuditEventStore;
  readonly #now: () => string;

  constructor(sink: AuditSink | AuditWriter, options: AuditRecorderOptions = {}) {
    this.#sink = typeof sink === "function" ? sinkFromWriter(sink) : sink;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(this.#maxRetries) || this.#maxRetries < 0) {
      throw new RangeError("maxRetries must be a non-negative integer");
    }
    this.#pendingStore = options.pendingStore ?? new InMemoryPendingStore();
    this.#now = options.now ?? utcNow;
  }

  /** The store holding events awaiting reprocessing (Req 22.5). */
  get pendingStore(): PendingAuditEventStore {
    return this.#pendingStore;
  }

  /**
   * Build a complete {@link AuditEvent} from the supplied action details using
   * the shared envelope helpers. Every required field for Req 22.2 (actor,
   * action, affected object id, UTC timestamp) is captured on the event.
   */
  buildEvent(input: RecordAuditEventInput): AuditEvent {
    if (!input.actorId) {
      throw new TypeError("actorId is required to record an audit event");
    }
    if (!input.affectedObjectId) {
      throw new TypeError("affectedObjectId is required to record an audit event");
    }
    if (!input.caseId) {
      throw new TypeError("caseId is required to record an audit event");
    }

    const at = input.at ?? this.#now();
    const provenance: ProvenanceRef = input.provenance ?? {
      sourceId: input.affectedObjectId,
      versionId: "audit",
      createdById: input.actorId,
      ingestedAt: at
    };

    const envelope = createEnvelope({
      entityType: "AuditEvent",
      caseId: input.caseId,
      source: input.source ?? "Audit_Service",
      status: "recorded",
      provenance,
      accessClassification: input.accessClassification ?? "clinical",
      createdById: input.actorId,
      now: at
    });

    return {
      ...envelope,
      entityType: "AuditEvent",
      actorId: input.actorId,
      action: input.action,
      affectedObjectId: input.affectedObjectId,
      at,
      ...(input.originalValue !== undefined ? { originalValue: input.originalValue } : {}),
      ...(input.correctedValue !== undefined ? { correctedValue: input.correctedValue } : {}),
      immutable: true
    };
  }

  /**
   * Record an audit event for an auditable action (Req 22.1, 22.2, 22.5).
   *
   * Attempts to append the event to the sink. On failure it retries up to
   * `maxRetries` times. If every attempt fails, it preserves the pending event
   * for reprocessing and returns a failure result to the initiating action.
   */
  async record(input: RecordAuditEventInput): Promise<RecordResult> {
    return this.#write(this.buildEvent(input));
  }

  /**
   * Record an audit event for an AI-output correction, capturing BOTH the
   * original value and the corrected value (Req 22.4).
   *
   * This is a convenience path over {@link record} that requires both values
   * to be supplied, so a correction can never be recorded without both sides
   * of the change. The recorded action is `"modify"`.
   *
   * @throws {TypeError} if either the original or corrected value is omitted.
   */
  async recordCorrection(input: RecordCorrectionInput): Promise<RecordResult> {
    if (input.originalValue === undefined) {
      throw new TypeError(
        "originalValue is required to record an AI-output correction (Req 22.4)"
      );
    }
    if (input.correctedValue === undefined) {
      throw new TypeError(
        "correctedValue is required to record an AI-output correction (Req 22.4)"
      );
    }
    return this.record({ ...input, action: input.action ?? "modify" });
  }

  /**
   * Attempt to record an already-built event (used by {@link record} and by
   * {@link reprocessPending}). Applies the bounded-retry policy.
   */
  async #write(event: AuditEvent): Promise<RecordResult> {
    let lastError: Error | undefined;
    const totalAttempts = this.#maxRetries + 1;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      try {
        await this.#sink.write(event);
        return { status: "recorded", event, attempts: attempt };
      } catch (cause) {
        lastError = toError(cause);
      }
    }

    // All retries exhausted: preserve the pending event and report the failure
    // to the initiating action (Req 22.5).
    await this.#pendingStore.preserve(event);
    return {
      status: "failed",
      event,
      attempts: totalAttempts,
      error: lastError ?? new Error("audit recording failed")
    };
  }

  /**
   * Reprocess every event currently preserved in the pending store (Req 22.5).
   * Successfully recorded events are removed from the store; events that fail
   * again remain preserved. Returns the per-event results.
   */
  async reprocessPending(): Promise<RecordResult[]> {
    const events = await this.#pendingStore.pending();
    const results: RecordResult[] = [];
    for (const event of events) {
      const result = await this.#write(event);
      if (result.status === "recorded") {
        await this.#pendingStore.remove(event.id);
      }
      results.push(result);
    }
    return results;
  }
}
