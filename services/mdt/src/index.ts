// services/mdt/src/index.ts
//
// Public entry point for the MDT_Service package (@udn/mdt).
//
// The service manages multidisciplinary-team collaboration on a Hypothesis_Card
// (Requirement 12): comments with @mentions, follow-up tasks, votes, and the
// recorded MDT decision + case disposition. Every action is authorised via an
// injected decision and leaves cards unchanged when rejected.

export * from "./errors.js";
export * from "./registered-users.js";
export * from "./mdt.js";
