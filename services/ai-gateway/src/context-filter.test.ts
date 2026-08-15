// services/ai-gateway/src/context-filter.test.ts
//
// Unit tests for context restriction (Task 12.2, Requirement 19.6, 19.7).

import { describe, expect, it } from "vitest";

import { scopeAwareContextFilter } from "./context-filter.js";
import type { GenerativeRequest } from "./pipeline.js";

function requestWith(
  context: GenerativeRequest["context"],
  authorizedSourceObjectIds?: readonly string[]
): GenerativeRequest {
  return {
    taskType: "summarisation",
    invokingUserId: "User-1",
    systemInstructions: "Summarise the case.",
    context,
    ...(authorizedSourceObjectIds === undefined
      ? {}
      : { authorizedScope: { authorizedSourceObjectIds } })
  };
}

describe("scopeAwareContextFilter (Req 19.6, 19.7)", () => {
  it("restricts context to only the source objects the user is authorised to access", () => {
    const request = requestWith(
      [
        { sourceObjectId: "Doc-1", content: "authorised note" },
        { sourceObjectId: "Doc-2", content: "unauthorised note" },
        { sourceObjectId: "Doc-3", content: "authorised note 3" }
      ],
      ["Doc-1", "Doc-3"]
    );

    const result = scopeAwareContextFilter.filter(request);

    expect(result.included.map((i) => i.sourceObjectId)).toEqual(["Doc-1", "Doc-3"]);
  });

  it("excludes unauthorised portions and records each exclusion (Req 19.7)", () => {
    const request = requestWith(
      [
        { sourceObjectId: "Doc-1", content: "authorised note" },
        { sourceObjectId: "Doc-2", content: "unauthorised note" }
      ],
      ["Doc-1"]
    );

    const result = scopeAwareContextFilter.filter(request);

    expect(result.excluded).toEqual([{ sourceObjectId: "Doc-2", reason: "not-authorised" }]);
    // The excluded content never appears in the retained context.
    expect(result.included.some((i) => i.content === "unauthorised note")).toBe(false);
  });

  it("excludes all context when the authorised scope is empty", () => {
    const request = requestWith(
      [
        { sourceObjectId: "Doc-1", content: "note" },
        { sourceObjectId: "Doc-2", content: "note" }
      ],
      []
    );

    const result = scopeAwareContextFilter.filter(request);

    expect(result.included).toEqual([]);
    expect(result.excluded.map((e) => e.sourceObjectId)).toEqual(["Doc-1", "Doc-2"]);
  });

  it("passes context through unchanged when no scope is supplied", () => {
    const context = [
      { sourceObjectId: "Doc-1", content: "note" },
      { sourceObjectId: "Doc-2", content: "note" }
    ];
    const result = scopeAwareContextFilter.filter(requestWith(context));

    expect(result.included).toEqual(context);
    expect(result.excluded).toEqual([]);
  });
});
