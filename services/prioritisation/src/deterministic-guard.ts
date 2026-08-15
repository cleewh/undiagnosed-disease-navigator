// services/prioritisation/src/deterministic-guard.ts
//
// Deterministic-only execution guard (Requirement 17: 17.1–17.5).
//
// The Navigator computes a fixed set of safety-critical tasks with deterministic
// logic ONLY, never a generative model (design: "Deterministic Engines"):
//
//   variant annotation, allele frequency, inheritance, segregation,
//   phenotype similarity, workflow state, permissions, audit, diagnosis,
//   urgency, final classification, reanalysis eligibility.
//
// This guard wraps such a computation so that:
//   - it runs with NO generative model in the execution path (Req 17.1–17.4); and
//   - IF a generative-model output is detected in the task INPUT (an input that
//     must be deterministic) OR in the produced RESULT, the result is rejected,
//     the last valid deterministic state is retained UNCHANGED, and a
//     non-deterministic-result error is returned (Req 17.5).
//
// "Generative output" is recognised structurally, without any model call, via
// explicit provenance markers (see `detectGenerativeOrigin`). A clean input is
// executed; a marked input is rejected before the compute function runs.

import { NonDeterministicResultError } from "./errors.js";

// ---------------------------------------------------------------------------
// The fixed set of deterministic-only tasks (Req 17.1–17.3)
// ---------------------------------------------------------------------------

/**
 * The complete, ordered set of deterministic-only task identifiers guarded by
 * this module (Req 17.1, 17.2, 17.3). Grouped in the requirement's order:
 * annotation/frequency/inheritance/segregation/similarity (17.1), workflow
 * state/permissions/audit (17.2), diagnosis/urgency/classification/reanalysis
 * eligibility (17.3).
 */
export const DETERMINISTIC_TASKS = [
  "variant_annotation",
  "allele_frequency",
  "inheritance",
  "segregation",
  "phenotype_similarity",
  "workflow_state",
  "permissions",
  "audit",
  "diagnosis",
  "urgency",
  "final_classification",
  "reanalysis_eligibility"
] as const;

export type DeterministicTask = (typeof DETERMINISTIC_TASKS)[number];

const DETERMINISTIC_TASK_SET: ReadonlySet<string> = new Set(DETERMINISTIC_TASKS);

/** Type guard: is `task` one of the fixed deterministic-only tasks? */
export function isDeterministicTask(task: string): task is DeterministicTask {
  return DETERMINISTIC_TASK_SET.has(task);
}

// ---------------------------------------------------------------------------
// Generative-output detection
// ---------------------------------------------------------------------------

/**
 * Property key that, when truthy on any object in a value graph, marks that
 * object as originating from a generative model. Deterministic-task inputs and
 * results must never carry this marker (Req 17.4, 17.5).
 */
export const GENERATIVE_ORIGIN_MARKER = "generativeOrigin";

/**
 * Additional object shapes that indicate generative output:
 *   - `entityType === "ModelInvocation"` (a recorded generative invocation), or
 *   - a truthy `producedByModel` flag.
 * These are recognised anywhere in the value graph.
 */
function isGenerativeObject(record: Readonly<Record<string, unknown>>): boolean {
  if (record[GENERATIVE_ORIGIN_MARKER] === true) return true;
  if (record["producedByModel"] === true) return true;
  if (record["entityType"] === "ModelInvocation") return true;
  return false;
}

/**
 * Recursively scan a value for a generative-output marker (Req 17.5). Returns
 * the path to the FIRST marker found (e.g. `"input.candidates[2].generativeOrigin"`)
 * or `null` when the value is free of generative output.
 *
 * Traversal is deterministic (object keys visited in definition order) and
 * cycle-safe. Only plain objects and arrays are traversed; primitives never
 * carry a marker.
 */
export function detectGenerativeOrigin(value: unknown, rootPath = "input"): string | null {
  const seen = new WeakSet<object>();

  const walk = (current: unknown, path: string): string | null => {
    if (current === null || typeof current !== "object") {
      return null;
    }

    if (seen.has(current)) {
      return null;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        const found = walk(current[index], `${path}[${index}]`);
        if (found !== null) return found;
      }
      return null;
    }

    const record = current as Record<string, unknown>;

    if (isGenerativeObject(record)) {
      if (record[GENERATIVE_ORIGIN_MARKER] === true) return `${path}.${GENERATIVE_ORIGIN_MARKER}`;
      if (record["producedByModel"] === true) return `${path}.producedByModel`;
      return `${path}.entityType(ModelInvocation)`;
    }

    for (const [key, child] of Object.entries(record)) {
      const found = walk(child, `${path}.${key}`);
      if (found !== null) return found;
    }
    return null;
  };

  return walk(value, rootPath);
}

// ---------------------------------------------------------------------------
// Guard outcome
// ---------------------------------------------------------------------------

/** Successful deterministic execution: the compute result is adopted. */
export interface GuardSuccess<R> {
  ok: true;
  task: DeterministicTask;
  result: R;
}

/**
 * Rejected execution (Req 17.5): a generative-model output was detected. The
 * last valid deterministic state is retained UNCHANGED and the structured
 * non-deterministic-result error is returned.
 */
export interface GuardRejection<S> {
  ok: false;
  task: DeterministicTask;
  error: NonDeterministicResultError;
  /** The last valid deterministic state, retained without modification. */
  retainedState: S;
}

export type GuardOutcome<R, S> = GuardSuccess<R> | GuardRejection<S>;

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/** Parameters for {@link runDeterministicTask}. */
export interface RunDeterministicTaskParams<R, S> {
  /** Which deterministic-only task is being executed. */
  task: DeterministicTask;
  /** The task input, which must be free of generative output (Req 17.5). */
  input: unknown;
  /** The last valid deterministic state, retained on rejection (Req 17.5). */
  lastValidState: S;
  /**
   * The pure, deterministic computation. It MUST NOT invoke a generative model
   * (Req 17.4); the guard enforces that its input and output are free of
   * generative markers but cannot inspect side effects.
   */
  compute: (input: unknown) => R;
}

/**
 * Run a deterministic-only task behind the generative-output guard (Req 17.5).
 *
 * 1. Scans `input` for a generative-output marker. If found, `compute` is NOT
 *    invoked; a {@link NonDeterministicResultError} is returned and
 *    `lastValidState` is retained unchanged.
 * 2. Otherwise runs `compute(input)` and scans the result. If the result
 *    carries a generative-output marker, the result is DISCARDED, the error is
 *    returned, and `lastValidState` is retained unchanged.
 * 3. Otherwise the result is adopted and returned.
 *
 * This function never throws for a detected generative output; it returns a
 * structured {@link GuardOutcome} so callers can branch and preserve state.
 *
 * @throws {RangeError} if `task` is not a known deterministic-only task.
 */
export function runDeterministicTask<R, S>(
  params: RunDeterministicTaskParams<R, S>
): GuardOutcome<R, S> {
  const { task, input, lastValidState, compute } = params;

  if (!isDeterministicTask(task)) {
    throw new RangeError(
      `Unknown deterministic-only task "${String(task)}"; expected one of: ${DETERMINISTIC_TASKS.join(", ")}.`
    );
  }

  const inputMarker = detectGenerativeOrigin(input, "input");
  if (inputMarker !== null) {
    return {
      ok: false,
      task,
      error: new NonDeterministicResultError({
        task,
        offendingPath: inputMarker,
        location: "input"
      }),
      retainedState: lastValidState
    };
  }

  const result = compute(input);

  const resultMarker = detectGenerativeOrigin(result, "result");
  if (resultMarker !== null) {
    return {
      ok: false,
      task,
      error: new NonDeterministicResultError({
        task,
        offendingPath: resultMarker,
        location: "result"
      }),
      retainedState: lastValidState
    };
  }

  return { ok: true, task, result };
}

/**
 * Assert that a deterministic-task value is free of generative output
 * (Req 17.5), throwing {@link NonDeterministicResultError} when a marker is
 * present. Useful at boundaries where a thrown error is preferred over a
 * {@link GuardOutcome}.
 *
 * @throws {NonDeterministicResultError} when a generative-output marker is found.
 */
export function assertDeterministicInput(task: DeterministicTask, input: unknown): void {
  const marker = detectGenerativeOrigin(input, "input");
  if (marker !== null) {
    throw new NonDeterministicResultError({ task, offendingPath: marker, location: "input" });
  }
}
