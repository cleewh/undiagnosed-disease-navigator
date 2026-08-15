// evaluation/src/index.ts
//
// Public entry point for the Evaluation_Framework (@udn/evaluation).
//
// The Evaluation_Framework is the offline component that scores submitted
// system outputs against hidden Ground_Truth, runs workflow-safety checks,
// excludes malformed entries, and produces HTML and JSON reports
// (Requirement 30). It is the ONLY privileged reader of Ground_Truth
// (Req 2.10, 3.6, 30.6) and invokes no generative model.

export * from "./ground-truth.js";
export * from "./metrics.js";
export * from "./exclusion.js";
export * from "./phenotype.js";
export * from "./prioritisation.js";
export * from "./reanalysis.js";
export * from "./grounding.js";
export * from "./safety.js";
export * from "./evaluate.js";
export * from "./report.js";
