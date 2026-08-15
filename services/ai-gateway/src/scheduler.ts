// services/ai-gateway/src/scheduler.ts
//
// Injectable timer abstraction for the 30-second Bedrock timeout (Req 16.6).
//
// The gateway measures the timeout through this seam rather than calling the
// global timer directly, so unit tests can drive the timeout deterministically
// (fire immediately, or never) without real waiting or global fake timers.

/** An opaque handle returned by {@link Scheduler.setTimeout}. */
export type TimerHandle = unknown;

/** A minimal scheduler the gateway uses to arm and cancel the timeout. */
export interface Scheduler {
  /** Schedule `handler` to run after `ms` milliseconds; returns a cancel handle. */
  setTimeout(handler: () => void, ms: number): TimerHandle;
  /** Cancel a previously scheduled handler. */
  clearTimeout(handle: TimerHandle): void;
}

/**
 * The default scheduler backed by the host's global timer functions. Used in
 * production; tests inject a controllable scheduler instead.
 */
export const systemScheduler: Scheduler = {
  setTimeout(handler: () => void, ms: number): TimerHandle {
    return setTimeout(handler, ms);
  },
  clearTimeout(handle: TimerHandle): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
};
