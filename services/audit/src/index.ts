// services/audit/src/index.ts
//
// Public entry point for the Audit_Service package (@udn/audit).
//
// Implements audit event recording with bounded retry and pending-event
// preservation (Requirement 22.1, 22.2, 22.5), the immutability guard that
// rejects modify/delete of retained events (Req 22.3), and AI-correction value
// capture recording both original and corrected values (Req 22.4).

export * from "./sink.js";
export * from "./pending.js";
export * from "./recorder.js";
export * from "./guard.js";
