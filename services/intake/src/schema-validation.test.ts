// services/intake/src/schema-validation.test.ts
//
// Example-based schema/Phenopacket/FHIR validation tests (task 7.8,
// Requirement 31.3). These assert BOTH directions of the validators:
//
//   * pass-for-conformant  — every artifact produced by the synthetic case
//     generator (`@udn/data-generator` `generateCorpus({ withArtifacts: true })`)
//     validates with zero errors, and
//   * fail-for-non-conformant — hand-built malformed artifacts are rejected with
//     one or more structured `IntakeError`s that name the offending field.
//
// Intake's structural validators are the schema gate for Req 3.1/3.2, so these
// examples pin down that conformant fixtures are accepted while realistic
// malformations (missing id, missing subject, invalid enum, empty feature list,
// unknown resourceType, missing Patient, incomplete Observation) are refused.

import { describe, it, expect } from "vitest";
import { generateCorpus } from "@udn/data-generator";

import { validateFhir, validatePhenopacket } from "./validation.js";

// A single deterministic corpus with per-case artifacts, shared by both suites.
const corpus = generateCorpus({ withArtifacts: true });
const artifactEntries = Object.entries(corpus.artifacts ?? {});

describe("schema validation — conformant generator fixtures pass (Req 31.3)", () => {
  it("produces at least one case with artifacts to validate", () => {
    expect(artifactEntries.length).toBeGreaterThan(0);
  });

  it.each(artifactEntries)(
    "%s: generated phenopacket validates with zero errors",
    (_caseId, artifacts) => {
      expect(validatePhenopacket(artifacts.phenopacket)).toEqual([]);
    }
  );

  it.each(artifactEntries)(
    "%s: generated fhir record validates with zero errors",
    (_caseId, artifacts) => {
      expect(validateFhir(artifacts.fhir)).toEqual([]);
    }
  );
});

describe("Phenopacket validation — non-conformant inputs fail (Req 31.3)", () => {
  // A conformant base we mutate into individual malformations.
  const base = {
    id: "case-x-phenopacket",
    subject: { id: "case-x-subject", sex: "MALE" },
    phenotypicFeatures: [
      { type: { id: "HP:0001250", label: "Seizure" }, excluded: false }
    ],
    metaData: { phenopacketSchemaVersion: "2.0" }
  };

  it("sanity: the unmutated base is conformant", () => {
    expect(validatePhenopacket(base)).toEqual([]);
  });

  it("rejects a phenopacket missing id, naming the id field", () => {
    const { id: _omit, ...withoutId } = base;
    const errors = validatePhenopacket(withoutId);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.field === "id")).toBe(true);
  });

  it("rejects a phenopacket missing subject, naming the subject field", () => {
    const { subject: _omit, ...withoutSubject } = base;
    const errors = validatePhenopacket(withoutSubject);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.field === "subject")).toBe(true);
  });

  it("rejects an invalid subject.sex outside the GA4GH enum", () => {
    const errors = validatePhenopacket({
      ...base,
      subject: { id: "case-x-subject", sex: "M" }
    });
    expect(errors.length).toBeGreaterThan(0);
    const err = errors.find((e) => e.field === "subject.sex");
    expect(err).toBeDefined();
    expect(err?.code).toBe("schema_validation");
    expect(err?.expected).toContain("MALE");
  });

  it("rejects an empty phenotypicFeatures array", () => {
    const errors = validatePhenopacket({ ...base, phenotypicFeatures: [] });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.field === "phenotypicFeatures")).toBe(true);
  });

  it("rejects a feature missing type.id, naming the feature path", () => {
    const errors = validatePhenopacket({
      ...base,
      phenotypicFeatures: [{ type: { label: "no id" } }]
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => e.field === "phenotypicFeatures[0].type.id")
    ).toBe(true);
  });
});

describe("FHIR validation — non-conformant inputs fail (Req 31.3)", () => {
  // A conformant grouped FHIR record we mutate into individual malformations.
  const base = {
    patient: { resourceType: "Patient", id: "p1", gender: "female" },
    encounters: [
      {
        resourceType: "Encounter",
        id: "e1",
        status: "finished",
        subject: { reference: "Patient/p1" }
      }
    ],
    observations: [
      {
        resourceType: "Observation",
        id: "o1",
        status: "final",
        code: { text: "finding" },
        subject: { reference: "Patient/p1" }
      }
    ],
    conditions: []
  };

  it("sanity: the unmutated base is conformant", () => {
    expect(validateFhir(base)).toEqual([]);
  });

  it("rejects an unknown resourceType, naming the resourceType field", () => {
    const errors = validateFhir({
      patient: { resourceType: "Widget", id: "p1" }
    });
    expect(errors.length).toBeGreaterThan(0);
    const err = errors.find((e) => e.field === "patient.resourceType");
    expect(err).toBeDefined();
    expect(err?.expected).toContain("Patient");
  });

  it("rejects a record missing a Patient resource", () => {
    const { patient: _omit, ...withoutPatient } = base;
    const errors = validateFhir(withoutPatient);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.field === "Patient")).toBe(true);
  });

  it("rejects an Observation missing required fields", () => {
    const errors = validateFhir({
      patient: { resourceType: "Patient", id: "p1" },
      observations: [{ resourceType: "Observation", id: "o1" }]
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some((e) => (e.field ?? "").startsWith("observations[0]"))
    ).toBe(true);
  });

  it("rejects an entirely empty record with no resources", () => {
    const errors = validateFhir({});
    expect(errors.length).toBeGreaterThan(0);
  });
});
