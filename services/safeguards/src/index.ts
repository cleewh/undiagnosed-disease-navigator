// services/safeguards/src/index.ts
//
// Public entry point for the Safeguards package (@udn/safeguards).
//
// This package implements the deterministic responsible-use safeguards and
// transport-security controls (task 29.1, Requirements 25.2-25.6, 26.6):
//
//   * review-gating       - patient-facing AI output requires recorded human
//                           review before release (Req 25.2, 25.3).
//   * manual-confirmation - external sharing / family contact requires an
//                           authorised user's manual confirmation and never
//                           proceeds through automation (Req 25.4).
//   * classification      - research and clinical records are never combined;
//                           every record carries exactly one classification
//                           (Req 25.5).
//   * uncertainty         - AI-derived output carries an uncertainty indicator
//                           on a >= 3-level ordered scale (Req 25.6).
//   * transport           - non-HTTPS / unencrypted transport is rejected
//                           (Req 26.6).
//
// Every guard is a pure, deterministic function. Authorisation and confirmation
// decisions are passed IN as explicit values, mirroring the Review_Service
// convention. No generative model is ever invoked.

export * from "./errors.js";
export * from "./review-gating.js";
export * from "./manual-confirmation.js";
export * from "./classification.js";
export * from "./uncertainty.js";
export * from "./transport.js";
