// services/ai-gateway/src/flagged-output-store.ts
//
// Flagged-output retention for the AI_Gateway (Task 12.3, Requirement 18.6).
//
// When output validation rejects a model response, the gateway records the
// flagged output and its review indication here so that an AUTHORISED REVIEWER
// can later retrieve it (18.6). Retrieval is gated: a principal that is not an
// authorised reviewer receives nothing, so flagged output is never exposed to
// an unauthorised caller.
//
// This module provides an in-memory store suitable for unit tests and local
// development. Production wiring can supply any FlaggedOutputStore (e.g. one
// backed by the persistence layer / ModelInvocation records) through the
// gateway options; the gateway depends only on the interface.

import type { FlaggedOutput, FlaggedOutputStore, ReviewerContext } from "./pipeline.js";

/**
 * A {@link FlaggedOutputStore} that retains flagged outputs in memory (Req
 * 18.6). Ids are assigned sequentially. Both {@link retrieve} and {@link list}
 * return data only to an authorised reviewer; every other principal receives
 * `undefined`/an empty list, so flagged output is never disclosed to an
 * unauthorised caller.
 */
export class InMemoryFlaggedOutputStore implements FlaggedOutputStore {
  readonly #entries = new Map<string, FlaggedOutput>();
  #sequence = 0;

  /** Record a flagged output and return the id it can be retrieved by (Req 18.6). */
  record(flagged: Omit<FlaggedOutput, "id">): string {
    this.#sequence += 1;
    const id = `review-${this.#sequence}`;
    this.#entries.set(id, { id, ...flagged });
    return id;
  }

  /** Retrieve a flagged output by id, only for an authorised reviewer (Req 18.6). */
  retrieve(id: string, reviewer: ReviewerContext): FlaggedOutput | undefined {
    if (!reviewer.isAuthorisedReviewer) {
      return undefined;
    }
    return this.#entries.get(id);
  }

  /** List all flagged outputs, only for an authorised reviewer (Req 18.6). */
  list(reviewer: ReviewerContext): readonly FlaggedOutput[] {
    if (!reviewer.isAuthorisedReviewer) {
      return [];
    }
    return [...this.#entries.values()];
  }

  /** Number of flagged outputs recorded so far (test/diagnostic aid). */
  get count(): number {
    return this.#entries.size;
  }
}
