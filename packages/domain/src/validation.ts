// packages/domain/src/validation.ts
//
// Persistence validation guard for the common provenance envelope
// (Requirement 23.6).
//
// Before any clinically relevant object is persisted, callers run it through
// `validateEnvelope`. The guard rejects an object that is missing any required
// envelope attribute defined in Requirement 23.2/23.3, or whose access
// classification is not within the defined set (`ACCESS_CLASSIFICATIONS`). It
// never mutates the candidate object or any existing storage; it simply
// reports whether the object is valid and, if not, names each missing or
// invalid attribute.

import {
  ACCESS_CLASSIFICATIONS,
  ENTITY_TYPES,
  type AccessClassification,
  type EntityType
} from "./envelope.js";

/**
 * A single validation failure, naming the offending attribute and describing
 * why it was rejected (Req 23.6).
 */
export interface ValidationError {
  /** Dotted attribute path, e.g. `provenance.sourceId`. */
  attribute: string;
  /** Human-readable reason the attribute is missing or invalid. */
  reason: string;
}

/**
 * Structured outcome of validating a candidate object against the envelope
 * contract. `valid` is true only when `errors` is empty.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * ISO-8601 UTC timestamp, e.g. `2024-01-01T12:34:56.789Z`. The envelope
 * records `createdAt`/`modifiedAt`/`provenance.ingestedAt` in UTC (Req 23.2),
 * so the trailing `Z` (or an explicit `+00:00` offset) is required. Fractional
 * seconds are optional.
 */
const ISO_8601_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * True when `value` is a non-empty string in ISO-8601 UTC form that also
 * parses to a real calendar date (rejecting e.g. month 13).
 */
function isIsoUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_8601_UTC.test(value)) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

/**
 * True when `value` is a positive integer >= 1 (Req 23.3): the version of a
 * persisted object always starts at 1 and only ever increases.
 */
function isPositiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * Validate the provenance sub-record (Req 23.3). Required sub-fields:
 * `sourceId`, `versionId`, `createdById` (non-empty strings) and `ingestedAt`
 * (ISO-8601 UTC). Missing/invalid sub-fields are reported under the
 * `provenance.` path.
 */
function validateProvenance(value: unknown, errors: ValidationError[]): void {
  if (value === undefined || value === null) {
    errors.push({
      attribute: "provenance",
      reason: "is required but was missing"
    });
    return;
  }
  if (typeof value !== "object") {
    errors.push({
      attribute: "provenance",
      reason: `must be an object but was ${typeof value}`
    });
    return;
  }

  const provenance = value as Record<string, unknown>;
  const stringFields = ["sourceId", "versionId", "createdById"] as const;
  for (const field of stringFields) {
    if (!isNonEmptyString(provenance[field])) {
      errors.push({
        attribute: `provenance.${field}`,
        reason: "is required and must be a non-empty string"
      });
    }
  }
  if (!isIsoUtcTimestamp(provenance.ingestedAt)) {
    errors.push({
      attribute: "provenance.ingestedAt",
      reason: "is required and must be an ISO-8601 UTC timestamp"
    });
  }
}

/**
 * Validate a candidate object against the full common-envelope contract
 * (Req 23.2, 23.3, 23.6).
 *
 * Returns a structured {@link ValidationResult} rather than throwing so that
 * callers (and property tests) can inspect every failure. The candidate object
 * and any existing storage are left completely unchanged.
 *
 * @param candidate the object about to be persisted; any value is accepted so
 *   that malformed input can be reported rather than crashing.
 */
export function validateEnvelope(candidate: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (candidate === undefined || candidate === null) {
    errors.push({
      attribute: "envelope",
      reason: "is required but was missing"
    });
    return { valid: false, errors };
  }
  if (typeof candidate !== "object") {
    errors.push({
      attribute: "envelope",
      reason: `must be an object but was ${typeof candidate}`
    });
    return { valid: false, errors };
  }

  const obj = candidate as Record<string, unknown>;

  // Req 23.2 / 23.3: required non-empty string identity and origin fields.
  const requiredStrings = [
    "id",
    "caseId",
    "source",
    "status",
    "createdById"
  ] as const;
  for (const field of requiredStrings) {
    if (!isNonEmptyString(obj[field])) {
      errors.push({
        attribute: field,
        reason: "is required and must be a non-empty string"
      });
    }
  }

  // Req 23.1 / 23.3: entityType must be one of the defined discriminators.
  if (!isNonEmptyString(obj.entityType)) {
    errors.push({
      attribute: "entityType",
      reason: "is required and must be a non-empty string"
    });
  } else if (!ENTITY_TYPES.includes(obj.entityType as EntityType)) {
    errors.push({
      attribute: "entityType",
      reason: `must be one of the defined entity types but was "${obj.entityType}"`
    });
  }

  // Req 23.3 / 23.4 / 23.5: version is a positive integer >= 1.
  if (!isPositiveVersion(obj.version)) {
    errors.push({
      attribute: "version",
      reason: "is required and must be a positive integer >= 1"
    });
  }

  // Req 23.2: created/modified timestamps in ISO-8601 UTC.
  if (!isIsoUtcTimestamp(obj.createdAt)) {
    errors.push({
      attribute: "createdAt",
      reason: "is required and must be an ISO-8601 UTC timestamp"
    });
  }
  if (!isIsoUtcTimestamp(obj.modifiedAt)) {
    errors.push({
      attribute: "modifiedAt",
      reason: "is required and must be an ISO-8601 UTC timestamp"
    });
  }

  // Req 23.3 / 23.6: access classification must be within the defined set.
  if (obj.accessClassification === undefined || obj.accessClassification === null) {
    errors.push({
      attribute: "accessClassification",
      reason: "is required but was missing"
    });
  } else if (
    !ACCESS_CLASSIFICATIONS.includes(
      obj.accessClassification as AccessClassification
    )
  ) {
    errors.push({
      attribute: "accessClassification",
      reason: `must be one of [${ACCESS_CLASSIFICATIONS.join(", ")}] but was "${String(
        obj.accessClassification
      )}"`
    });
  }

  // Req 23.3: provenance record and its required sub-fields.
  validateProvenance(obj.provenance, errors);

  // Req 1.7 / 14.3: synthetic-data indicator must be exactly true.
  if (obj.syntheticIndicator !== true) {
    errors.push({
      attribute: "syntheticIndicator",
      reason: "is required and must be exactly true"
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Error thrown by {@link assertValidEnvelope} when validation fails. Carries
 * the structured {@link ValidationError} list so callers that prefer
 * exceptions still receive the named missing/invalid attributes (Req 23.6).
 */
export class EnvelopeValidationError extends Error {
  readonly errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    const summary = errors
      .map((e) => `${e.attribute}: ${e.reason}`)
      .join("; ");
    super(`Envelope validation failed: ${summary}`);
    this.name = "EnvelopeValidationError";
    this.errors = errors;
  }
}

/**
 * Exception-throwing wrapper around {@link validateEnvelope} for callers that
 * prefer to fail fast. Throws {@link EnvelopeValidationError} (carrying the
 * structured errors) when the candidate is invalid; otherwise returns nothing.
 */
export function assertValidEnvelope(candidate: unknown): void {
  const result = validateEnvelope(candidate);
  if (!result.valid) {
    throw new EnvelopeValidationError(result.errors);
  }
}
