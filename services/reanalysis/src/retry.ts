// services/reanalysis/src/retry.ts
//
// Bounded retry helper shared by the event-driven identification orchestrator
// and the reanalysis-run executor (Reanalysis_Service, task 27.1).
//
// Requirements 15.5 and 15.7 both require the same shape of resilience: a
// transient failure is retried a bounded number of times (up to 3 attempts),
// and if every attempt fails the caller preserves prior state and produces an
// error indication. This module isolates that retry-and-count behaviour so the
// pure matcher core stays untouched and timing concerns (the 60-second bound)
// remain the caller/orchestrator's responsibility.
//
// The helper is intentionally dependency-free and deterministic with respect to
// its inputs: it simply invokes the supplied thunk up to `maxAttempts` times,
// returning on the first success and reporting exhaustion otherwise.

/** The default maximum number of attempts (1 initial try + up to 2 retries). */
export const MAX_REANALYSIS_ATTEMPTS = 3;

/** Outcome of a bounded-retry attempt. */
export type RetryOutcome<T> =
  | {
      /** The thunk succeeded on attempt `attempts`. */
      readonly ok: true;
      /** The value the thunk returned. */
      readonly value: T;
      /** How many attempts were made (1..maxAttempts). */
      readonly attempts: number;
    }
  | {
      /** Every attempt threw; the caller must preserve prior state. */
      readonly ok: false;
      /** How many attempts were made (equals the allowed maximum). */
      readonly attempts: number;
      /** The error thrown by the final attempt, for diagnostic reporting. */
      readonly lastError: unknown;
    };

/**
 * Invoke `run` up to `maxAttempts` times (default {@link MAX_REANALYSIS_ATTEMPTS}),
 * returning on the first success. If every attempt throws, the failure is
 * reported with the attempt count and the last error so the caller can retain
 * prior state and emit a naming error indication (Req 15.5, 15.7).
 *
 * `maxAttempts` is clamped to a minimum of 1 so at least one attempt always runs.
 */
export function attemptWithRetry<T>(
  run: () => T,
  maxAttempts: number = MAX_REANALYSIS_ATTEMPTS
): RetryOutcome<T> {
  const allowed = Math.max(1, Math.floor(maxAttempts));
  let attempts = 0;
  let lastError: unknown;

  for (let i = 0; i < allowed; i += 1) {
    attempts += 1;
    try {
      return { ok: true, value: run(), attempts };
    } catch (error) {
      lastError = error;
    }
  }

  return { ok: false, attempts, lastError };
}
