// services/intake/src/validation.ts
//
// Lightweight, deterministic, dependency-free structural validators for the
// two schema-bearing intake artifacts (Requirement 3.1, and transitively 2.4/
// 2.5 for the GA4GH Phenopacket and 2.3 for FHIR R4).
//
// These validators intentionally avoid pulling a heavy external JSON-schema or
// FHIR library: they check the structural invariants the workflow relies on
// (required fields, `resourceType`, the Phenopacket subject/phenotypicFeatures
// shape) and return the SAME structured `IntakeError` list used everywhere
// else, so a failure names the failing field with its expected and actual
// values (Req 3.2). Validation is pure and O(n) in the artifact size, so it
// completes well within the 30-second per-case bound (Req 3.1).

import { schemaError, type IntakeError } from "./errors.js";

/** The Phenopacket subject sex enum accepted on intake (GA4GH Sex subset). */
const PHENOPACKET_SEX = ["FEMALE", "MALE", "UNKNOWN_SEX"] as const;

/** FHIR resource types this structural checker understands. */
const KNOWN_FHIR_RESOURCE_TYPES = [
  "Patient",
  "Encounter",
  "Observation",
  "Condition"
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Validate a candidate GA4GH Phenopacket against a structural schema check
 * (Req 2.4, 2.5, 3.1). Returns an empty array when the Phenopacket is
 * structurally valid; otherwise one {@link IntakeError} per failing field
 * (Req 3.2).
 *
 * Checked invariants:
 *   - top-level object with a non-empty `id`;
 *   - `subject` object with a non-empty `subject.id` and a `subject.sex` drawn
 *     from the GA4GH sex enum;
 *   - `phenotypicFeatures` is a non-empty array, and every feature carries a
 *     `type.id` (an ontology-class identifier).
 */
export function validatePhenopacket(candidate: unknown): IntakeError[] {
  const errors: IntakeError[] = [];
  const artifact = "phenopacket";

  if (!isObject(candidate)) {
    errors.push(
      schemaError(artifact, "phenopacket", "a JSON object", candidate)
    );
    return errors;
  }

  if (!isNonEmptyString(candidate.id)) {
    errors.push(schemaError(artifact, "id", "a non-empty string", candidate.id));
  }

  const subject = candidate.subject;
  if (!isObject(subject)) {
    errors.push(schemaError(artifact, "subject", "a JSON object", subject));
  } else {
    if (!isNonEmptyString(subject.id)) {
      errors.push(
        schemaError(artifact, "subject.id", "a non-empty string", subject.id)
      );
    }
    if (
      typeof subject.sex !== "string" ||
      !(PHENOPACKET_SEX as readonly string[]).includes(subject.sex)
    ) {
      errors.push(
        schemaError(
          artifact,
          "subject.sex",
          `one of [${PHENOPACKET_SEX.join(", ")}]`,
          subject.sex
        )
      );
    }
  }

  const features = candidate.phenotypicFeatures;
  if (!Array.isArray(features)) {
    errors.push(
      schemaError(artifact, "phenotypicFeatures", "an array", features)
    );
  } else if (features.length === 0) {
    errors.push(
      schemaError(
        artifact,
        "phenotypicFeatures",
        "a non-empty array (>= 1 feature)",
        features
      )
    );
  } else {
    features.forEach((feature, index) => {
      const path = `phenotypicFeatures[${index}].type.id`;
      const type = isObject(feature) ? feature.type : undefined;
      const typeId = isObject(type) ? type.id : undefined;
      if (!isNonEmptyString(typeId)) {
        errors.push(
          schemaError(artifact, path, "a non-empty ontology-class id", typeId)
        );
      }
    });
  }

  return errors;
}

/** Collect every FHIR resource carried by an intake `fhir` artifact. */
function collectFhirResources(
  candidate: Record<string, unknown>
): { path: string; resource: unknown }[] {
  const resources: { path: string; resource: unknown }[] = [];

  // Support a FHIR R4 Bundle ({ resourceType: "Bundle", entry: [{ resource }] })
  // as well as the generator's grouped record shape ({ patient, encounters,
  // observations, conditions }).
  if (candidate.resourceType === "Bundle") {
    const entry = candidate.entry;
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => {
        const resource = isObject(item) ? item.resource : undefined;
        resources.push({ path: `entry[${index}].resource`, resource });
      });
    }
    return resources;
  }

  if (candidate.patient !== undefined) {
    resources.push({ path: "patient", resource: candidate.patient });
  }
  for (const key of ["encounters", "observations", "conditions"] as const) {
    const list = candidate[key];
    if (Array.isArray(list)) {
      list.forEach((resource, index) => {
        resources.push({ path: `${key}[${index}]`, resource });
      });
    }
  }
  return resources;
}

/** Required non-`resourceType` fields per known FHIR resource type. */
const FHIR_REQUIRED_FIELDS: Record<string, readonly string[]> = {
  Patient: ["id"],
  Encounter: ["id", "status", "subject"],
  Observation: ["id", "status", "code", "subject"],
  Condition: ["id", "code", "subject"]
};

/** Validate a single FHIR resource's structural required fields. */
function validateFhirResource(
  path: string,
  resource: unknown,
  errors: IntakeError[]
): void {
  const artifact = "fhir";
  if (!isObject(resource)) {
    errors.push(schemaError(artifact, path, "a FHIR resource object", resource));
    return;
  }

  const resourceType = resource.resourceType;
  if (
    typeof resourceType !== "string" ||
    !(KNOWN_FHIR_RESOURCE_TYPES as readonly string[]).includes(resourceType)
  ) {
    errors.push(
      schemaError(
        artifact,
        `${path}.resourceType`,
        `one of [${KNOWN_FHIR_RESOURCE_TYPES.join(", ")}]`,
        resourceType
      )
    );
    return;
  }

  for (const field of FHIR_REQUIRED_FIELDS[resourceType] ?? []) {
    const value = resource[field];
    const present =
      field === "subject"
        ? isObject(value) && isNonEmptyString(value.reference)
        : field === "code"
          ? isObject(value)
          : isNonEmptyString(value);
    if (!present) {
      const expected =
        field === "subject"
          ? "an object with a non-empty `reference`"
          : field === "code"
            ? "a CodeableConcept object"
            : "a non-empty string";
      errors.push(
        schemaError(artifact, `${path}.${field}`, expected, value)
      );
    }
  }
}

/**
 * Validate a case's FHIR R4 clinical record against structural checks (Req 2.3,
 * 3.1). Accepts either a FHIR Bundle or the generator's grouped record shape
 * (`{ patient, encounters, observations, conditions }`). Returns one
 * {@link IntakeError} per failing resource/field (Req 3.2); an empty array
 * means the record is structurally valid.
 *
 * Requires a `Patient` resource and validates every resource's `resourceType`
 * and required fields.
 */
export function validateFhir(candidate: unknown): IntakeError[] {
  const errors: IntakeError[] = [];
  const artifact = "fhir";

  if (!isObject(candidate)) {
    errors.push(schemaError(artifact, "fhir", "a JSON object", candidate));
    return errors;
  }

  const resources = collectFhirResources(candidate);
  if (resources.length === 0) {
    errors.push(
      schemaError(
        artifact,
        "resources",
        "at least one FHIR resource (Patient required)",
        resources
      )
    );
    return errors;
  }

  for (const { path, resource } of resources) {
    validateFhirResource(path, resource, errors);
  }

  const hasPatient = resources.some(
    ({ resource }) => isObject(resource) && resource.resourceType === "Patient"
  );
  if (!hasPatient) {
    errors.push(
      schemaError(
        artifact,
        "Patient",
        "exactly one FHIR Patient resource",
        "none present"
      )
    );
  }

  return errors;
}
