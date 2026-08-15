// services/vertical-slice/src/index.ts
//
// Public entry point for the vertical-slice package (@udn/vertical-slice).
//
// Delivers the seven-stage MVP vertical slice (Requirement 33) by composing the
// existing service packages under halt-on-failure orchestration: synthetic case
// intake -> clinical timeline -> AI phenotype extraction -> clinician
// confirmation -> minimal hypothesis card -> simulated knowledge-update publish
// -> reanalysis notification. See `slice.ts` for the orchestration and the
// halt-on-failure / state-preservation model (Req 33.3).

export * from "./hypothesis-card.js";
export * from "./knowledge-update.js";
export * from "./slice.js";
