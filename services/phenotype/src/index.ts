// services/phenotype/src/index.ts
//
// Public entry point for the Phenotype_Service package (@udn/phenotype).
//
// The service turns grounded AI_Gateway output into review-ready
// `PhenotypeCandidate` records (Requirement 5). It never confirms a candidate;
// human approval is the Review_Service's responsibility (Requirement 6).

export * from "./hpo-resolver.js";
export * from "./assertion.js";
export * from "./extract.js";
