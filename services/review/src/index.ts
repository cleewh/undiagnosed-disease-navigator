// services/review/src/index.ts
//
// Public entry point for the Review_Service package (@udn/review).
//
// The service manages human review and approval of AI-extracted phenotype
// candidates (Requirement 6). It confirms a phenotype ONLY on an explicit,
// authorised human approval action; it never auto-confirms.

export * from "./review.js";
