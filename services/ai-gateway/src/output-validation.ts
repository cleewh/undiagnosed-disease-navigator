// services/ai-gateway/src/output-validation.ts
//
// Output validators for the AI_Gateway (Task 12.3, Requirement 18.1-18.5,
// 19.3, 19.4).
//
// These are the concrete {@link OutputValidator}s the gateway runs at stage 7,
// after a model returns a response and before the gateway returns/persists it.
// Each validator addresses one acceptance criterion and, on failure, returns a
// rejection with a review indication that identifies the offending statement
// where applicable. The gateway stops at the first rejection, so the validators
// are ordered from coarsest to finest:
//
//   1. schemaOutputValidator     -> response conforms to the schema (18.1, 18.5)
//   2. allowlistOutputValidator  -> response matches an allowlisted structure (19.3, 19.4)
//   3. groundingOutputValidator  -> every statement links to >=1 source (18.2, 18.3)
//   4. supportOutputValidator    -> every cited source is in the provided data (18.4)
//
// {@link groundingValidators} bundles them in that order for wiring into the
// gateway via `outputValidators`.

import type {
  GatewayContextItem,
  GenerativeRequest,
  OutputValidationResult,
  OutputValidator
} from "./pipeline.js";
import type { ModelResponse } from "./model-provider.js";
import { AI_RESPONSE_ALLOWED_KEYS, parseAiResponse } from "./response-schema.js";

const VALID: OutputValidationResult = { status: "valid" };

/**
 * Schema validator (Req 18.1, 18.5). Rejects the ENTIRE output when it does not
 * conform to the defined AI response schema, returning a schema-violation
 * indication so the caller can retain prior state and flag for review.
 */
export const schemaOutputValidator: OutputValidator = {
  validate(response: ModelResponse): OutputValidationResult {
    const parsed = parseAiResponse(response.outputText);
    if (!parsed.ok) {
      return {
        status: "rejected",
        reason: "schema_violation",
        detail: `output does not conform to the response schema: ${parsed.detail}`
      };
    }
    return VALID;
  }
};

/**
 * Allowlist validator (Req 19.3, 19.4). Even when the output parses, it is only
 * permitted if its top-level structure matches the allowlist of permitted
 * response structures — i.e. it carries exactly the allowed top-level keys and
 * no unexpected ones (an injected extra field is rejected before persistence).
 */
export const allowlistOutputValidator: OutputValidator = {
  validate(response: ModelResponse): OutputValidationResult {
    const parsed = parseAiResponse(response.outputText);
    if (!parsed.ok) {
      // Defensive: the schema validator runs first, but if this validator is
      // used alone, a non-parsing output is not an allowlisted structure.
      return {
        status: "rejected",
        reason: "allowlist_violation",
        detail: `output does not match an allowlisted response structure: ${parsed.detail}`
      };
    }
    const allowed = new Set<string>(AI_RESPONSE_ALLOWED_KEYS);
    const unexpected = parsed.topLevelKeys.filter((key) => !allowed.has(key));
    if (unexpected.length > 0) {
      return {
        status: "rejected",
        reason: "allowlist_violation",
        detail: `output contains disallowed top-level fields not on the response allowlist: ${unexpected.join(", ")}`
      };
    }
    return VALID;
  }
};

/**
 * Grounding validator (Req 18.2, 18.3). Rejects the output if ANY statement is
 * not linked to at least one source object, identifying the unlinked statement
 * so the caller can retain source data unchanged and flag for review.
 */
export const groundingOutputValidator: OutputValidator = {
  validate(response: ModelResponse): OutputValidationResult {
    const parsed = parseAiResponse(response.outputText);
    if (!parsed.ok) {
      return {
        status: "rejected",
        reason: "schema_violation",
        detail: `output does not conform to the response schema: ${parsed.detail}`
      };
    }
    for (const statement of parsed.value.statements) {
      if (statement.sourceRefs.length === 0) {
        return {
          status: "rejected",
          reason: "ungrounded_statement",
          detail: "statement is not linked to any source object",
          offendingStatement: statement.statement
        };
      }
    }
    return VALID;
  }
};

/**
 * Support validator (Req 18.4). Rejects the output if any statement cites a
 * source that is not among the source objects in the provided case data,
 * identifying the unsupported statement. "Provided case data" is the authorised
 * context the gateway actually supplied to the model.
 */
export const supportOutputValidator: OutputValidator = {
  validate(
    response: ModelResponse,
    _request: GenerativeRequest,
    context: readonly GatewayContextItem[]
  ): OutputValidationResult {
    const parsed = parseAiResponse(response.outputText);
    if (!parsed.ok) {
      return {
        status: "rejected",
        reason: "schema_violation",
        detail: `output does not conform to the response schema: ${parsed.detail}`
      };
    }
    const providedSources = new Set(context.map((item) => item.sourceObjectId));
    for (const statement of parsed.value.statements) {
      const unsupported = statement.sourceRefs.find((ref) => !providedSources.has(ref));
      if (unsupported !== undefined) {
        return {
          status: "rejected",
          reason: "unsupported_statement",
          detail: `statement cites source "${unsupported}" which is not in the provided case data`,
          offendingStatement: statement.statement
        };
      }
    }
    return VALID;
  }
};

/**
 * The full task-12.3 validator chain in evaluation order (Req 18.1-18.5, 19.3,
 * 19.4): schema, then allowlist, then grounding, then support. Wire this into
 * the gateway via the `outputValidators` option.
 */
export const groundingValidators: readonly OutputValidator[] = [
  schemaOutputValidator,
  allowlistOutputValidator,
  groundingOutputValidator,
  supportOutputValidator
];
