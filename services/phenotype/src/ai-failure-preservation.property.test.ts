// services/phenotype/src/ai-failure-preservation.property.test.ts
//
// Property-based test for Correctness Property 13 (Task 13.4, Requirements
// 5.8, 13.6, 9.9, 7.2, 8.8).
//
// Feature: undiagnosed-disease-navigator, Property 13: AI failures preserve
// existing case state.
//
// Design (Property 13): For any existing set of phenotype candidates (or
// confirmed AI outputs), an AI_Gateway timeout or failure leaves that existing
// state unchanged and returns an incomplete/failed indication.
//
// Requirement 5.8: IF the AI_Gateway is unavailable, rejects, needs review, or
// returns unparseable output THEN extraction is cancelled: an error indication
// is returned and any existing candidates are preserved unchanged. The
// cross-cutting preservation requirements (13.6, 9.9, 7.2, 8.8) require the
// same discipline wherever an AI failure could otherwise clobber prior state.
//
// The test drives the real `extractPhenotypes` pipeline with a fake gateway
// (no AWS, no Bedrock) that reproduces every way the AI_Gateway can fail: it
// throws (unreachable), returns `rejected` (with a timeout or provider error),
// or returns `needs_review` (output flagged by any validator). Across an
// arbitrary set of pre-existing candidates and any of those failure modes the
// test asserts that extraction (a) returns a failed/preserved outcome rather
// than an "extracted" one, (b) fabricates no candidates, and (c) returns the
// pre-existing candidates entirely unchanged — same count, same order, and
// deep-equal to a snapshot captured before the call — and never mutates the
// caller's input array.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ModelInvocationFailedError,
  ModelConfigMissingError,
  TaskTypeNotPermittedError,
  DirectModelAccessError
} from "@udn/ai-gateway";
import type {
  GenerativeInvocationResult,
  GenerativeRequest,
  ReviewIndication,
  ValidationFailureReason
} from "@udn/ai-gateway";
import type {
  AccessClassification,
  Assertion,
  HpoMapping,
  PhenotypeCandidate,
  PhenotypeCandidateStatus
} from "@udn/domain";

import {
  extractPhenotypes,
  type PhenotypeExtractionFailureReason,
  type PhenotypeExtractionGateway,
  type SourceDocument
} from "./extract.js";
import { createLexiconHpoResolver } from "./hpo-resolver.js";

const MODEL_ID = "anthropic.test-model";

const ASSERTIONS: readonly Assertion[] = [
  "present",
  "absent",
  "uncertain",
  "historical"
];
const CANDIDATE_STATUSES: readonly PhenotypeCandidateStatus[] = [
  "pending_review",
  "unresolved",
  "approved",
  "rejected"
];
const ACCESS_CLASSIFICATIONS: readonly AccessClassification[] = [
  "research",
  "clinical",
  "ground_truth"
];
const VALIDATION_REASONS: readonly ValidationFailureReason[] = [
  "schema_violation",
  "ungrounded_statement",
  "unsupported_statement",
  "allowlist_violation",
  "below_threshold_confidence"
];

/** Format a numeric id as a syntactically valid HPO identifier (HP:0000000). */
function hpoId(num: number): string {
  return `HP:${String(num).padStart(7, "0")}`;
}

const hpoMappingArb: fc.Arbitrary<HpoMapping> = fc.record({
  hpoId: fc.integer({ min: 0, max: 9999999 }).map(hpoId),
  confidence: fc.double({ min: 0, max: 1, noNaN: true })
});

/** An arbitrary, fully-formed pre-existing phenotype candidate. */
const candidateArb: fc.Arbitrary<PhenotypeCandidate> = fc.record({
  id: fc.uuid().map((u) => `PhenotypeCandidate-${u}`),
  caseId: fc.string({ minLength: 1, maxLength: 8 }).map((s) => `case-${s}`),
  source: fc.constantFrom("phenotype_extraction", "import", "manual"),
  version: fc.integer({ min: 1, max: 20 }),
  status: fc.constantFrom(...CANDIDATE_STATUSES),
  provenance: fc.record({
    sourceId: fc.string({ minLength: 1, maxLength: 6 }).map((s) => `doc-${s}`),
    versionId: fc.integer({ min: 1, max: 10 }).map(String),
    createdById: fc.string({ minLength: 1, maxLength: 6 }).map((s) => `user-${s}`),
    ingestedAt: fc.constant("2023-12-01T00:00:00.000Z")
  }),
  accessClassification: fc.constantFrom(...ACCESS_CLASSIFICATIONS),
  createdAt: fc.constant("2023-12-01T00:00:00.000Z"),
  modifiedAt: fc.constant("2023-12-01T00:00:00.000Z"),
  createdById: fc.string({ minLength: 1, maxLength: 6 }).map((s) => `user-${s}`),
  assertion: fc.constantFrom(...ASSERTIONS),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  hpoMappings: fc.array(hpoMappingArb, { minLength: 0, maxLength: 20 }),
  alternatives: fc.array(hpoMappingArb, { minLength: 0, maxLength: 10 }),
  sourceObjectRef: fc.string({ minLength: 1, maxLength: 6 }).map((s) => `doc-${s}`)
}).map((base) => ({
  ...base,
  entityType: "PhenotypeCandidate" as const,
  syntheticIndicator: true as const,
  aiExtracted: true as const
}));

const existingArb = fc.array(candidateArb, { minLength: 0, maxLength: 8 });

/**
 * A gateway failure mode paired with the failure reason `extractPhenotypes`
 * must classify it as. `build()` produces a fresh fake gateway reproducing that
 * failure — none of these fabricate candidates or return an "extracted"
 * outcome, so any preserved state must originate from the caller's existing
 * candidates.
 */
interface FailureMode {
  readonly expectedReason: PhenotypeExtractionFailureReason;
  build(): PhenotypeExtractionGateway;
}

const throwingModeArb: fc.Arbitrary<FailureMode> = fc
  .oneof(
    fc.constant("network down"),
    fc.constant("socket hang up"),
    fc.constant("ECONNRESET")
  )
  .map((message) => ({
    expectedReason: "gateway_unavailable" as const,
    build: (): PhenotypeExtractionGateway => ({
      invoke(): Promise<GenerativeInvocationResult> {
        return Promise.reject(new Error(message));
      }
    })
  }));

const rejectedModeArb: fc.Arbitrary<FailureMode> = fc
  .oneof(
    fc.boolean().map((timedOut) => new ModelInvocationFailedError({ timedOut })),
    fc.constant(new ModelConfigMissingError("AI_MODEL_ID")),
    fc.constant(new TaskTypeNotPermittedError("phenotype_extraction", ["x"])),
    fc.constant(new DirectModelAccessError())
  )
  .map((error) => ({
    expectedReason: "gateway_rejected" as const,
    build: (): PhenotypeExtractionGateway => ({
      invoke(): Promise<GenerativeInvocationResult> {
        return Promise.resolve({ outcome: "rejected", error });
      }
    })
  }));

const needsReviewModeArb: fc.Arbitrary<FailureMode> = fc
  .record({
    reason: fc.constantFrom(...VALIDATION_REASONS),
    detail: fc.string({ minLength: 1, maxLength: 24 }),
    // The gateway returns arbitrary flagged output text; it must never be
    // parsed into fabricated candidates when the outcome is needs_review.
    outputText: fc.string({ maxLength: 40 })
  })
  .map(({ reason, detail, outputText }) => {
    const review: ReviewIndication = { reason, detail };
    return {
      expectedReason: "gateway_needs_review" as const,
      build: (): PhenotypeExtractionGateway => ({
        invoke(): Promise<GenerativeInvocationResult> {
          return Promise.resolve({
            outcome: "needs_review",
            modelId: MODEL_ID,
            taskType: "phenotype_extraction",
            response: { outputText, modelId: MODEL_ID },
            reviewId: "review-1",
            review
          });
        }
      })
    };
  });

const failureModeArb: fc.Arbitrary<FailureMode> = fc.oneof(
  throwingModeArb,
  rejectedModeArb,
  needsReviewModeArb
);

const documentsArb = fc.array(
  fc.record({
    sourceObjectId: fc.string({ minLength: 1, maxLength: 6 }).map((s) => `doc-${s}`),
    content: fc.string({ maxLength: 40 })
  }),
  { minLength: 0, maxLength: 4 }
) as fc.Arbitrary<SourceDocument[]>;

/** A resolver is required by the pipeline but is never reached on failure. */
function resolver(): ReturnType<typeof createLexiconHpoResolver> {
  return createLexiconHpoResolver({ knownHpoIds: ["HP:0001250"], lexicon: {} });
}

describe("Feature: undiagnosed-disease-navigator, Property 13: AI failures preserve existing case state", () => {
  it("an AI_Gateway failure preserves existing candidates unchanged and returns a failed indication (Req 5.8, 13.6, 9.9, 7.2, 8.8)", async () => {
    await fc.assert(
      fc.asyncProperty(
        existingArb,
        documentsArb,
        failureModeArb,
        async (existing, documents, mode) => {
          // Snapshot the pre-existing state before the (failing) extraction so
          // we can prove nothing about it changed.
          const snapshot = structuredClone(existing) as PhenotypeCandidate[];
          const gateway = mode.build();

          const result = await extractPhenotypes("case-1", documents, gateway, {
            resolver: resolver(),
            invokingUserId: "user-1",
            existingCandidates: existing,
            now: () => "2024-01-01T00:00:00.000Z"
          });

          // The extraction did not complete: a failed/preserved outcome, never
          // an "extracted" one, and never fabricated candidates.
          expect(result.outcome).toBe("failed");
          if (result.outcome !== "failed") {
            return;
          }

          // The failure is classified to match the gateway's failure mode and
          // reports that extraction did not complete.
          expect(result.reason).toBe(mode.expectedReason);
          expect(result.detail).toMatch(/did not complete/i);

          // Existing state is preserved unchanged: same count, same order, and
          // deep-equal to the pre-call snapshot — no candidate dropped,
          // overwritten, or fabricated (Req 5.8 and the cross-cutting
          // preservation requirements).
          expect(result.candidates).toHaveLength(snapshot.length);
          expect(result.candidates).toEqual(snapshot);

          // The caller's own input array was not mutated in place either.
          expect(existing).toEqual(snapshot);
        }
      ),
      { numRuns: 200 }
    );
  });
});
