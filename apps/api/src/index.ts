// apps/api — Node.js Lambda handlers for the Undiagnosed Disease Navigator.
// Scaffolding placeholder; handlers are added in later tasks.
export const API_PACKAGE = "@udn/api";

// Auth_Service: Cognito-backed Lambda authorizer (task 5.1, Req 21.1/21.2/21.6).
export * from "./auth/authorizer.js";
export * from "./auth/cognito-verifier.js";

// Auth_Service: deterministic RBAC matrix + permission engine (task 5.2, Req 21.3).
export * from "./auth/rbac.js";

// Auth_Service: RBAC enforcement wrapper + read filtering (task 5.3, Req 21.4/21.5).
export * from "./auth/enforcement.js";
