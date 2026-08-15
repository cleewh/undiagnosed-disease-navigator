// services/intake/src/errors.ts
//
// Structured intake validation errors (Requirement 3.2, 3.3).
//
// Intake never advances a case that fails validation: it creates no Case
// record and instead returns one or more structured errors. Two error
// shapes are distinguished:
//
//   * Schema-validation errors (Req 3.1, 3.2 and, transitively, 2.4/2.5 for the
//     Phenopacket and 2.3 for FHIR): a failing artifact field is named together
//     with the expected value/format and the actual value received.
//   * Artifact-constraint errors (Req 3.3): a required artifact is missing,
//     malformed, or exceeds the 50 MB size limit; the violated constraint and
//     the offending artifact are named.
//
// Both are represented by a single discriminated union so callers (and the web
// layer) can present them uniformly while still switching on `code`.

/** The maximum permitted size, in bytes, of any single ingested artifact (Req 3.3: 50 MB). */
export const MAX_ARTIFACT_SIZE_BYTES = 50 * 1024 * 1024;

/** Machine-readable classification of an intake failure. */
export type IntakeErrorCode =
  /** An artifact failed schema/structural validation (Req 3.1, 3.2, 2.3, 2.4, 2.5). */
  | "schema_validation"
  /** A required artifact was absent from the ingested case (Req 3.3). */
  | "artifact_missing"
  /** An artifact was present but not a well-formed object/value (Req 3.3). */
  | "artifact_malformed"
  /** An artifact exceeded the maximum permitted size (Req 3.3). */
  | "artifact_too_large";

/**
 * A single structured intake validation error.
 *
 * For `schema_validation` errors, `field`, `expected`, and `actual` are always
 * populated (Req 3.2). For artifact-constraint errors (`artifact_missing`,
 * `artifact_malformed`, `artifact_too_large`), `constraint` names the violated
 * constraint and `artifact` names the offending artifact (Req 3.3).
 */
export interface IntakeError {
  /** Machine-readable failure classification. */
  code: IntakeErrorCode;
  /** Human-readable description of the failure. */
  message: string;
  /** Name of the artifact the error relates to (e.g. "phenopacket", "vcf"). */
  artifact?: string;
  /** Dotted path of the failing field, e.g. `subject.sex` (schema errors, Req 3.2). */
  field?: string;
  /** Expected value or format for the failing field (schema errors, Req 3.2). */
  expected?: string;
  /** Actual value received for the failing field (schema errors, Req 3.2). */
  actual?: string;
  /** The violated artifact constraint (constraint errors, Req 3.3). */
  constraint?: "required" | "well_formed" | "max_size";
}

/** Build a schema-validation error naming the failing field (Req 3.2). */
export function schemaError(
  artifact: string,
  field: string,
  expected: string,
  actual: unknown
): IntakeError {
  return {
    code: "schema_validation",
    artifact,
    field,
    expected,
    actual: describeValue(actual),
    message: `Artifact "${artifact}" failed schema validation at "${field}": expected ${expected} but received ${describeValue(
      actual
    )}.`
  };
}

/** Build an artifact-constraint error (missing / malformed / too large) (Req 3.3). */
export function artifactError(
  code: Extract<
    IntakeErrorCode,
    "artifact_missing" | "artifact_malformed" | "artifact_too_large"
  >,
  artifact: string,
  message: string
): IntakeError {
  const constraint =
    code === "artifact_missing"
      ? "required"
      : code === "artifact_malformed"
        ? "well_formed"
        : "max_size";
  return { code, artifact, constraint, message };
}

/**
 * Render an arbitrary value into a short, human-readable string for the
 * `actual` field of a schema error, so the message is stable and never dumps
 * an entire nested object.
 */
export function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined (missing)";
  }
  if (typeof value === "string") {
    return value.length === 0 ? '"" (empty string)' : `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `array(length=${value.length})`;
  }
  return typeof value;
}
