// services/hypothesis/src/index.ts
//
// Public entry point for the Hypothesis_Service package (@udn/hypothesis).
//
// The service manages evidence-linked, explicitly non-diagnostic
// Hypothesis_Cards (Requirement 11): it requires at least one evidence item on
// creation, enforces non-diagnostic vocabulary, assigns states from the defined
// set, records state-transition history, retains evidence links on update, and
// rejects unauthorised state changes.

export * from "./vocabulary.js";
export * from "./hypothesis.js";
