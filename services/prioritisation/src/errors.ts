// services/prioritisation/src/errors.ts
//
// Structured errors for the deterministic Prioritisation_Service
// (Requirements 10.4, 17.5).
//
// Every rejection carries a stable, machine-readable `code` so callers can
// branch on the reason without string matching, and a human-readable message
// that names the requirement.

/** Machine-readable classification of a Prioritisation_Service rejection. */
export type PrioritisationErrorCode =
  /** A required scoring input is missing or failed validation (Req 10.4). */
  | "INVALID_PRIORITISATION_INPUT"
  /** A generative-model output was detected in a deterministic-only path (Req 17.5). */
  | "NON_DETERMINISTIC_RESULT";

/** Base class for all structured Prioritisation_Service errors. */
export abstract class PrioritisationError extends Error {
  /** Stable, machine-readable error code. */
  abstract readonly code: PrioritisationErrorCode;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Raised when the genomic results are missing a required scoring input or fail
 * input validation. Prioritisation is rejected and produces NO partial ranking
 * (Req 10.4). The error names the offending input and the item it belongs to.
 */
export class InvalidPrioritisationInputError extends PrioritisationError {
  readonly code = "INVALID_PRIORITISATION_INPUT";
  /** Name of the missing/invalid scoring input (e.g. "alleleFrequency"). */
  readonly input: string;
  /** Stable identifier of the offending item, when one is available. */
  readonly itemId: string | undefined;
  /** Zero-based position of the offending item in the input list. */
  readonly itemIndex: number | undefined;

  constructor(params: { input: string; itemId?: string; itemIndex?: number; reason: string }) {
    const where =
      params.itemId !== undefined
        ? ` for item "${params.itemId}"`
        : params.itemIndex !== undefined
          ? ` for item at index ${params.itemIndex}`
          : "";
    super(
      `Prioritisation rejected (Req 10.4): input "${params.input}"${where} is missing or invalid — ${params.reason}. No partial ranking was produced.`
    );
    this.input = params.input;
    this.itemId = params.itemId;
    this.itemIndex = params.itemIndex;
  }
}

/**
 * Raised when a generative-model output is detected in the execution path of a
 * deterministic-only task (Req 17.5). The result is rejected, the last valid
 * deterministic state is retained unchanged, and this error is returned.
 */
export class NonDeterministicResultError extends PrioritisationError {
  readonly code = "NON_DETERMINISTIC_RESULT";
  /** The deterministic-only task whose path contained generative output. */
  readonly task: string;
  /** Path to the first detected generative-output marker (e.g. "input.summary"). */
  readonly offendingPath: string;
  /** Whether the marker was found in the task input or the produced result. */
  readonly location: "input" | "result";

  constructor(params: { task: string; offendingPath: string; location: "input" | "result" }) {
    super(
      `Deterministic-only task "${params.task}" rejected (Req 17.5): a generative-model output was detected in the ${params.location} at "${params.offendingPath}". The last valid deterministic state was retained unchanged.`
    );
    this.task = params.task;
    this.offendingPath = params.offendingPath;
    this.location = params.location;
  }
}
