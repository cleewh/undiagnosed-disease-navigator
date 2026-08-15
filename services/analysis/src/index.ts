// services/analysis/src/index.ts
//
// Public entry point for the Analysis_Service package (@udn/analysis).
//
// The service manages analysis requests, the required-role approval gate, and
// genomic run fulfilment in Demo_Mode (precomputed synthetic results) and
// Workflow_Mode (approved workflow execution). It is deterministic orchestration
// and never invokes a generative model.

export * from "./analysis.js";
