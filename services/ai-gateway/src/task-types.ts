// services/ai-gateway/src/task-types.ts
//
// Generative task-type allowlist (Requirement 16.5).
//
// The AI_Gateway restricts generative invocations to a fixed allowlist:
// phenotype extraction, summarisation, and drafting of explanations/reports.
// Any other task type is rejected without invoking a model (Req 16.5). This
// module is the single source of truth for those identifiers so later stages
// (grounding, logging, caching) can reference the same closed set.

/**
 * The closed set of permitted generative task types (Req 16.5):
 *
 * - `phenotype_extraction`  — AI phenotype candidate extraction (Requirement 5).
 * - `summarisation`         — draft case summary generation (Requirement 13).
 * - `explanation_drafting`  — drafting of explanations and reports.
 */
export const ALLOWED_TASK_TYPES = [
  "phenotype_extraction",
  "summarisation",
  "explanation_drafting"
] as const;

/** A task type that the gateway is permitted to invoke a model for (Req 16.5). */
export type GenerativeTaskType = (typeof ALLOWED_TASK_TYPES)[number];

/**
 * Narrow an arbitrary task-type string to the permitted allowlist (Req 16.5).
 *
 * Returns `true` (and narrows the type) only when `taskType` is one of the
 * allowed identifiers; every other value returns `false`, which drives the
 * task-not-permitted rejection in the gateway without invoking any model.
 */
export function isAllowedTaskType(taskType: string): taskType is GenerativeTaskType {
  return (ALLOWED_TASK_TYPES as readonly string[]).includes(taskType);
}
