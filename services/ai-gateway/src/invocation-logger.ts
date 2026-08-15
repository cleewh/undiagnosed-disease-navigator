// services/ai-gateway/src/invocation-logger.ts
//
// Invocation logging for the AI_Gateway (Task 12.2, Requirement 19.5, 19.7).
//
// Every model invocation the gateway attempts produces exactly one log entry
// containing the model identifier, the invoking user identifier, the invocation
// timestamp, and the validation outcome (19.5), plus any context that was
// excluded for authorisation reasons (19.7).
//
// This module provides an in-memory logger suitable for unit tests and local
// development. Production wiring can supply any {@link InvocationLogger}
// implementation (e.g. one that writes to the audit store) through the gateway
// options; the gateway depends only on the interface.

import type { InvocationLogEntry, InvocationLogger } from "./pipeline.js";

/**
 * An {@link InvocationLogger} that retains every recorded entry in memory
 * (Req 19.5). Entries are appended in the order they are recorded and exposed
 * as a read-only snapshot via {@link entries}.
 */
export class InMemoryInvocationLogger implements InvocationLogger {
  readonly #entries: InvocationLogEntry[] = [];

  /** Record a single invocation log entry (Req 19.5, 19.7). */
  record(entry: InvocationLogEntry): void {
    this.#entries.push(entry);
  }

  /** A read-only snapshot of all recorded entries, oldest first. */
  get entries(): readonly InvocationLogEntry[] {
    return [...this.#entries];
  }

  /** The most recently recorded entry, or `undefined` if none exist. */
  get last(): InvocationLogEntry | undefined {
    return this.#entries[this.#entries.length - 1];
  }

  /** Number of entries recorded so far. */
  get count(): number {
    return this.#entries.length;
  }

  /** Discard all recorded entries. */
  clear(): void {
    this.#entries.length = 0;
  }
}
