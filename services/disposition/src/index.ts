// services/disposition/src/index.ts
//
// Public entry point for the Disposition_Service package (@udn/disposition).
//
// The service records case dispositions, classifies cases as Unresolved_Case
// unless resolved by a confirmed diagnosis or a closed non-genetic explanation,
// generates grounded draft case summaries via the AI_Gateway (the sole Bedrock
// path), and finalises those summaries only on explicit human approval
// (Requirement 13). Deterministic logic never calls a generative model.

export * from "./disposition.js";
export * from "./summary.js";
