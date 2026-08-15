// services/ai-gateway/src/response-schema.ts
//
// The AI response schema (Task 12.3, Requirement 18.1, 18.5; design "AI
// response schema").
//
// Every generative task returns its output as a JSON document describing a set
// of GROUNDED STATEMENTS. Each statement carries the assertion text, one or
// more source references (the ids of the source objects it is drawn from), a
// confidence in [0, 1], and whether the statement was directly OBSERVED in the
// case data or INFERRED from it. Schema validation (18.1, 18.5) checks the
// STRUCTURE of this document; grounding (18.2, 18.3) and support (18.4) are
// checked separately by dedicated validators because they compare against the
// provided case context, not just the shape of the output.

/** Whether a grounded statement is directly observed in, or inferred from, the case data. */
export type StatementBasis = "observed" | "inferred";

/** The permitted top-level keys of an AI response document (allowlist, Req 19.3). */
export const AI_RESPONSE_ALLOWED_KEYS = ["statements"] as const;

/**
 * A single grounded statement produced by a generative task (design "AI
 * response schema"). `sourceRefs` names the source objects the statement is
 * drawn from; grounding validation (18.3) requires at least one, and support
 * validation (18.4) requires every id to be part of the provided case data.
 */
export interface GroundedStatement {
  /** The natural-language assertion the model produced. */
  readonly statement: string;
  /** Ids of the source objects this statement is linked to (grounding, Req 18.2). */
  readonly sourceRefs: readonly string[];
  /** Model-reported confidence in the statement, in the inclusive range [0, 1]. */
  readonly confidence: number;
  /** Whether the statement is directly observed in, or inferred from, the case data. */
  readonly basis: StatementBasis;
}

/**
 * The defined response schema for every generative task (Req 18.1). The output
 * is a document with a `statements` array of {@link GroundedStatement}s and no
 * other top-level structure.
 */
export interface AiResponse {
  /** The grounded statements the task produced. */
  readonly statements: readonly GroundedStatement[];
}

/** Successful parse of a model output against the AI response schema. */
export interface AiResponseParseOk {
  readonly ok: true;
  readonly value: AiResponse;
  /** Top-level keys present in the raw document (used by allowlist validation). */
  readonly topLevelKeys: readonly string[];
}

/** Failed parse of a model output against the AI response schema. */
export interface AiResponseParseError {
  readonly ok: false;
  /** Human-readable description of the schema violation (Req 18.5). */
  readonly detail: string;
}

/** Result of {@link parseAiResponse}: a conforming value or a schema violation. */
export type AiResponseParseResult = AiResponseParseOk | AiResponseParseError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse and structurally validate a model's `outputText` against the AI
 * response schema (Req 18.1, 18.5).
 *
 * This checks STRUCTURE only: the text must be a JSON object with a
 * `statements` array whose every element carries a non-empty `statement`
 * string, a `sourceRefs` array of strings, a numeric `confidence` in [0, 1],
 * and a `basis` of `"observed"` or `"inferred"`. It intentionally does NOT
 * check grounding (non-empty `sourceRefs`) or support (refs drawn from the
 * provided context); those are separate concerns validated elsewhere so each
 * failure mode can be reported precisely.
 *
 * On any structural violation it returns `{ ok: false, detail }` identifying
 * the problem; it never throws.
 */
export function parseAiResponse(outputText: string): AiResponseParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(outputText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `output is not valid JSON: ${message}` };
  }

  if (!isRecord(raw)) {
    return { ok: false, detail: "output must be a JSON object with a `statements` array" };
  }

  const topLevelKeys = Object.keys(raw);

  if (!Array.isArray(raw["statements"])) {
    return { ok: false, detail: "`statements` must be an array" };
  }

  const statements: GroundedStatement[] = [];
  const rawStatements = raw["statements"] as readonly unknown[];
  for (let index = 0; index < rawStatements.length; index += 1) {
    const entry = rawStatements[index];
    if (!isRecord(entry)) {
      return { ok: false, detail: `statement[${index}] must be an object` };
    }

    const statement = entry["statement"];
    if (typeof statement !== "string" || statement.trim().length === 0) {
      return { ok: false, detail: `statement[${index}].statement must be a non-empty string` };
    }

    const sourceRefs = entry["sourceRefs"];
    if (
      !Array.isArray(sourceRefs) ||
      !sourceRefs.every((ref): ref is string => typeof ref === "string")
    ) {
      return { ok: false, detail: `statement[${index}].sourceRefs must be an array of strings` };
    }

    const confidence = entry["confidence"];
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return {
        ok: false,
        detail: `statement[${index}].confidence must be a number in [0, 1]`
      };
    }

    const basis = entry["basis"];
    if (basis !== "observed" && basis !== "inferred") {
      return {
        ok: false,
        detail: `statement[${index}].basis must be "observed" or "inferred"`
      };
    }

    statements.push({
      statement,
      sourceRefs: [...sourceRefs],
      confidence,
      basis
    });
  }

  return { ok: true, value: { statements }, topLevelKeys };
}
