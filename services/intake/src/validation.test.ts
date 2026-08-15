// services/intake/src/validation.test.ts
//
// Unit tests for the structural Phenopacket and FHIR validators (task 8.1,
// Requirements 2.3, 2.4, 2.5, 3.1, 3.2). These exercise the validators in
// isolation with hand-built minimal artifacts and confirm that failures name
// the failing field with an expected value/format and the actual value.

import { describe, it, expect } from "vitest";

import { validateFhir, validatePhenopacket } from "./validation.js";

const validPhenopacket = {
  id: "case-1-phenopacket",
  subject: { id: "case-1-subject", sex: "FEMALE" },
  phenotypicFeatures: [
    { type: { id: "HP:0001250", label: "Seizure" }, excluded: false }
  ],
  metaData: { phenopacketSchemaVersion: "2.0" }
};

const validFhir = {
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

describe("validatePhenopacket", () => {
  it("accepts a well-formed Phenopacket", () => {
    expect(validatePhenopacket(validPhenopacket)).toEqual([]);
  });

  it("reports subject.sex outside the GA4GH enum with expected/actual (Req 3.2)", () => {
    const errors = validatePhenopacket({
      ...validPhenopacket,
      subject: { id: "s", sex: "M" }
    });
    const err = errors.find((e) => e.field === "subject.sex");
    expect(err).toBeDefined();
    expect(err?.code).toBe("schema_validation");
    expect(err?.expected).toContain("MALE");
    expect(err?.actual).toBe('"M"');
  });

  it("reports an empty phenotypicFeatures array (Req 2.4)", () => {
    const errors = validatePhenopacket({
      ...validPhenopacket,
      phenotypicFeatures: []
    });
    expect(errors.some((e) => e.field === "phenotypicFeatures")).toBe(true);
  });

  it("reports a feature missing type.id", () => {
    const errors = validatePhenopacket({
      ...validPhenopacket,
      phenotypicFeatures: [{ type: { label: "no id" } }]
    });
    expect(
      errors.some((e) => e.field === "phenotypicFeatures[0].type.id")
    ).toBe(true);
  });

  it("reports a non-object Phenopacket", () => {
    const errors = validatePhenopacket("not-an-object");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("phenopacket");
  });
});

describe("validateFhir", () => {
  it("accepts a well-formed grouped FHIR record", () => {
    expect(validateFhir(validFhir)).toEqual([]);
  });

  it("accepts a FHIR Bundle shape", () => {
    const bundle = {
      resourceType: "Bundle",
      entry: [
        { resource: { resourceType: "Patient", id: "p1" } },
        {
          resource: {
            resourceType: "Encounter",
            id: "e1",
            status: "finished",
            subject: { reference: "Patient/p1" }
          }
        }
      ]
    };
    expect(validateFhir(bundle)).toEqual([]);
  });

  it("reports an unknown/missing resourceType with expected/actual (Req 3.2)", () => {
    const errors = validateFhir({
      patient: { resourceType: "Widget", id: "p1" }
    });
    const err = errors.find((e) => e.field === "patient.resourceType");
    expect(err).toBeDefined();
    expect(err?.expected).toContain("Patient");
    expect(err?.actual).toBe('"Widget"');
  });

  it("reports a missing Patient resource", () => {
    const errors = validateFhir({
      encounters: [
        {
          resourceType: "Encounter",
          id: "e1",
          status: "finished",
          subject: { reference: "Patient/p1" }
        }
      ]
    });
    expect(errors.some((e) => e.field === "Patient")).toBe(true);
  });

  it("reports an Observation missing required fields", () => {
    const errors = validateFhir({
      patient: { resourceType: "Patient", id: "p1" },
      observations: [{ resourceType: "Observation", id: "o1" }]
    });
    expect(errors.some((e) => (e.field ?? "").startsWith("observations[0]"))).toBe(
      true
    );
  });
});
