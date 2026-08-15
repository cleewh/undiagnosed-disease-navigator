// services/mdt/src/errors.ts
//
// Structured error types shared across the MDT_Service (Requirement 12).
//
// Every rejected action returns one of these structured errors and leaves the
// target card/record unchanged (Req 12.7). The codes are exhaustive so callers
// can branch deterministically without string matching.

/** Why an MDT_Service action was rejected. */
export type MdtErrorCode =
  /** The caller is not an authorised MDT participant (Req 12.7). */
  | "not_authorised"
  /** A comment body was outside the permitted 1–5,000 character range (Req 12.1). */
  | "invalid_comment_length"
  /** A mentioned user id did not resolve to a registered user (Req 12.2). */
  | "unregistered_mention"
  /** A task assignee did not resolve to a registered user (Req 12.4). */
  | "unregistered_assignee"
  /** A vote or decision participant did not resolve to a registered user (Req 12.5, 12.6). */
  | "unregistered_user";

/** A structured MDT_Service failure. */
export interface MdtError {
  readonly code: MdtErrorCode;
  readonly message: string;
}

/** Build the standard unauthorised-participant error (Req 12.7). */
export function notAuthorised(userId: string, action: string): MdtError {
  return {
    code: "not_authorised",
    message: `User "${userId}" lacks authorisation to ${action}.`
  };
}
