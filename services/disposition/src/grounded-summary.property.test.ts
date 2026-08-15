// services/disposition/src/grounded-summary.property.test.ts
//
// Property-based test for grounded, human-gated draft case summaries
// (Disposition_Service, task 24.3, design "Property 36").
//
// Feature: undiagnosed-disease-navigator, Property 36: Draft summaries are
// grounded and gated by human approval
//
// Validates: Requirements 13.2, 13.7, 13.3, 13.5
//
// A fake DraftSummaryGateway returns generated grounded statements verbatim; no
// AWS or Bedrock is involved. The property pins four guarantees:
//   * every sourced statement links to EXACTLY ONE known source (Req 13.2);
//   * a statement with no linkable/known source is flagged unsourced (Req 13.7);
//   * generation always yields a DRAFT summary (final: false) (Req 13.3);
//   * finalisation happens IFF an authorised reviewer supplies an explicit
//     approval action — unauthorised or non-approval never finalises (Req 13.5).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { GenerativeInvocationResult } from "@udn/ai-gateway";
import type { Case, CaseDisposition } from "@udn/domain";

import { approveDraftSummary, recordDisposition } from "./disposition.js";
import {
  generateDraftSummary,
  type DraftSummaryGateway,
  type SummarySourceDocument
} from "./summary.js";

const MODEL_ID = "anthropic.test-model";
const AT = "2024-01-01T00:00:00.000Z";
const APPROVED_AT = "2024-01-02T00:00:00.000Z";

/** The pool of KNOWN source object ids available to a case (Req 13.2/13.7). */
const KNOWN_SOURCE_IDS: readonly string[] = ["doc-1", "doc-2", "doc-3"];
/** Ids that are NOT known sources: any statement linked only to these is unsourced. */
const UNKNOWN_SOURCE_IDS: readonly string[] = ["ghost-1", "ghost-2"];
const ALL_SOURCE_IDS: readonly string[] = [...KNOWN_SOURCE_IDS, ...UNKNOWN_SOURCE_IDS];
const KNOWN_SET: ReadonlySet<string> = new Set<string>(KNOWN_SOURCE_IDS);

const SOURCE_DOCS: readonly SummarySourceDocument[] = KNOWN_SOURCE_IDS.map((id) => ({
  sourceObjectId: id,
  content: `synthetic content for ${id}`
}));

/** A single grounded statement as produced by the model (see response-schema). */
interface GeneratedStatement {
  readonly statement: string;
  readonly sourceRefs: readonly string[];
  readonly confidence: number;
  readonly basis: "observed" | "inferred";
}

const statementArb: fc.Arbitrary<GeneratedStatement> = fc.record({
  // Prefixed so the text is always non-empty and non-whitespace (schema-valid).
  statement: fc.string({ maxLength: 24 }).map((s) => `S:${s}`),
  sourceRefs: fc.array(fc.constantFrom(...ALL_SOURCE_IDS), { maxLength: 5 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  basis: fc.constantFrom("observed" as const, "inferred" as const)
});

/** Build a fake gateway returning the generated statements as an `invoked` result. */
function invokedGateway(statements: readonly GeneratedStatement[]): DraftSummaryGateway {
  const outputText = JSON.stringify({ statements });
  return {
    invoke(): Promise<GenerativeInvocationResult> {
      return Promise.resolve({
        outcome: "invoked",
        modelId: MODEL_ID,
        taskType: "summarisation",
        response: { outputText, modelId: MODEL_ID }
      });
    }
  };
}

function baseCase(): Case {
  return {
    id: "Case-1",
    entityType: "Case",
    caseId: "Case-1",
    source: "Intake_Service",
    version: 3,
    status: "in_review",
    provenance: {
      sourceId: "intake-0",
      versionId: "1",
      createdById: "coordinator-1",
      ingestedAt: "2023-12-01T00:00:00.000Z"
    },
    accessClassification: "clinical",
    createdAt: "2023-12-01T00:00:00.000Z",
    modifiedAt: "2023-12-15T00:00:00.000Z",
    createdById: "coordinator-1",
    syntheticIndicator: true,
    clinicalArea: "neuromuscular",
    archetype: "unsolved_case",
    inheritanceModel: "uncertain",
    familyBased: false,
    dispositionStatus: "in_review"
  };
}

/** A freshly recorded, summary-free disposition to attach a draft summary to. */
function freshDisposition(): CaseDisposition {
  const result = recordDisposition(baseCase(), {
    dispositionState: "unresolved",
    recordedById: "coordinator-1",
    at: AT,
    isAuthorised: true
  });
  if (!result.ok) throw new Error("expected disposition recording to succeed");
  return result.disposition;
}

/** Oracle: the single expected source link — the first ref that is a known source. */
function expectedSourceRef(statement: GeneratedStatement): string | undefined {
  return statement.sourceRefs.find((ref) => KNOWN_SET.has(ref));
}

describe("Property 36: Draft summaries are grounded and gated by human approval", () => {
  // Feature: undiagnosed-disease-navigator, Property 36: Draft summaries are
  // grounded and gated by human approval
  // Validates: Requirements 13.2, 13.7, 13.3, 13.5
  it("links each statement to exactly one known source, flags unsourced, and finalises only on authorised approval", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(statementArb, { maxLength: 8 }),
        fc.boolean(),
        fc.boolean(),
        async (statements, isAuthorised, approve) => {
          const disposition = freshDisposition();

          const result = await generateDraftSummary(
            disposition,
            SOURCE_DOCS,
            invokedGateway(statements),
            {
              invokingUserId: "coordinator-1",
              knownSourceObjectIds: KNOWN_SOURCE_IDS,
              now: () => AT
            }
          );

          expect(result.outcome).toBe("drafted");
          if (result.outcome !== "drafted") return;

          const summary = result.disposition.draftSummary;
          expect(summary).toBeDefined();
          if (summary === undefined) return;

          // Req 13.3: a freshly generated summary is always in DRAFT status.
          expect(summary.final).toBe(false);

          // One produced statement per generated statement, order preserved.
          expect(summary.statements).toHaveLength(statements.length);

          for (let i = 0; i < statements.length; i += 1) {
            const generated = statements[i];
            const produced = summary.statements[i];
            expect(generated).toBeDefined();
            expect(produced).toBeDefined();
            if (generated === undefined || produced === undefined) continue;

            const expectedRef = expectedSourceRef(generated);
            if (expectedRef === undefined) {
              // Req 13.7: no linkable/known source -> flagged unsourced, no ref.
              expect(produced.unsourced).toBe(true);
              expect(produced.sourceObjectRef).toBeUndefined();
            } else {
              // Req 13.2: linked to EXACTLY ONE known source object.
              expect(produced.unsourced).toBe(false);
              expect(produced.sourceObjectRef).toBe(expectedRef);
              expect(typeof produced.sourceObjectRef).toBe("string");
              expect(KNOWN_SET.has(produced.sourceObjectRef ?? "")).toBe(true);
            }
          }

          // Req 13.5 / 13.3: finalisation is gated by an authorised, explicit
          // human approval. Any other combination leaves the summary in draft.
          const approval = approveDraftSummary(result.disposition, {
            reviewerId: isAuthorised ? "specialist-1" : "intruder",
            at: APPROVED_AT,
            isAuthorised,
            approve
          });

          const shouldFinalise = isAuthorised && approve;
          expect(approval.ok).toBe(shouldFinalise);

          if (approval.ok) {
            // Authorised + explicit approval -> marked final (Req 13.5).
            expect(approval.disposition.draftSummary?.final).toBe(true);
          } else {
            // Gated: unauthorised or no explicit approval never finalises;
            // the summary is retained in draft (Req 13.3, 13.5).
            expect(approval.disposition.draftSummary?.final).toBe(false);
          }

          // The pre-approval draft is never mutated by the approval attempt.
          expect(result.disposition.draftSummary?.final).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});
