// services/intake/src/index.ts
//
// Public entry point for the Intake_Service package (@udn/intake).
//
// Implements the intake validation + Case-creation pipeline (Requirement 3):
// structural Phenopacket/FHIR validation, artifact constraints (presence,
// well-formedness, 50 MB limit), structured rejection with no Case record,
// and, on success, Case creation in the initial intake status with all
// artifacts retained unmodified and provenance recorded for each.

export * from "./errors.js";
export * from "./validation.js";
export * from "./ground-truth-access.js";
export * from "./intake.js";
