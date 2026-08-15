// services/phenotype/src/extraction-timing.test.ts
//
// Extraction timing integration test (Task 13.5, Requirement 5.1).
//
// Requirement 5.1: WHEN phenotype extraction is requested for a case, THE
// Phenotype_Service SHALL produce phenotype candidates via the AI_Gateway
// within 60 seconds.
//
// This is an EXAMPLE-BASED integration test (not a property test). It drives
// the real `extractPhenotypes` pipeline end-to-end over a representative case
// with a deterministic fake gateway (no AWS, no Bedrock) and a deterministic
// in-memory HPO resolver, then asserts the whole extraction completes well
// within the 60-second budget. The 60s bound is a service-level obligation; a
// hermetic run should finish in milliseconds, so a comfortable pass here also
// leaves headroom for the gateway's own invocation timeout in production.

import { describe, expect, it } from "vitest";
import type {
  GenerativeInvocationResult,
  GenerativeRequest
} from "@udn/ai-gateway";
import type { HpoMapping } from "@udn/domain";

import {
  extractPhenotypes,
  type PhenotypeExtractionGateway,
  type SourceDocument
} from "./extract.js";
import {
  createLexiconHpoResolver,
  type HpoLexiconEntry
} from "./hpo-resolver.js";

const MODEL_ID = "anthropic.test-model";

/** The 60-second service budget for phenotype extraction (Req 5.1). */
const EXTRACTION_BUDGET_MS = 60_000;

/** Format a numeric id as a syntactically valid HPO identifier (HP:0000000). */
function hpoId(num: number): string {
  return `HP:${String(num).padStart(7, "0")}`;
}

/** A fake gateway that returns the supplied grounded document as `invoked`. */
function gatewayReturning(document: unknown): PhenotypeExtractionGateway {
  return {
    invoke(_request: GenerativeRequest): Promise<GenerativeInvocationResult> {
      return Promise.resolve({
        outcome: "invoked",
        modelId: MODEL_ID,
        taskType: "phenotype_extraction",
        response: { outputText: JSON.stringify(document), modelId: MODEL_ID }
      });
    }
  };
}

/**
 * Build a representative case: `count` grounded statements, each mapping to a
 * few valid, known HPO terms and linking to its own supporting source object.
 * Returns the source documents, the seeded resolver, and the fake gateway.
 */
function buildRepresentativeCase(count: number): {
  documents: SourceDocument[];
  resolver: ReturnType<typeof createLexiconHpoResolver>;
  gateway: PhenotypeExtractionGateway;
} {
  const lexicon: Record<string, HpoLexiconEntry> = {};
  const knownHpoIds = new Set<string>();
  const documents: SourceDocument[] = [];
  const statements: unknown[] = [];

  for (let index = 0; index < count; index += 1) {
    const statementText = `finding-${index}`;
    const sourceRef = `doc-${index}`;

    // Three valid HPO mappings plus two alternatives per statement.
    const mappings: HpoMapping[] = [0, 1, 2].map((offset) => {
      const id = hpoId(index * 10 + offset);
      knownHpoIds.add(id);
      return { hpoId: id, confidence: 0.9 - offset * 0.1 };
    });
    const alternatives: HpoMapping[] = [3, 4].map((offset) => {
      const id = hpoId(index * 10 + offset);
      knownHpoIds.add(id);
      return { hpoId: id, confidence: 0.5 - (offset - 3) * 0.1 };
    });

    lexicon[statementText] = { mappings, alternatives };
    documents.push({
      sourceObjectId: sourceRef,
      content: `Clinical note ${index}: patient presents with ${statementText}.`
    });
    statements.push({
      statement: statementText,
      sourceRefs: [sourceRef],
      confidence: 0.8,
      basis: "observed"
    });
  }

  const resolver = createLexiconHpoResolver({ knownHpoIds, lexicon });
  const gateway = gatewayReturning({ statements });
  return { documents, resolver, gateway };
}

describe("Phenotype extraction timing (Req 5.1)", () => {
  it("completes extraction for a representative case within the 60-second budget", async () => {
    const { documents, resolver, gateway } = buildRepresentativeCase(25);

    const start = performance.now();
    const result = await extractPhenotypes("case-timing", documents, gateway, {
      resolver,
      invokingUserId: "user-1",
      now: () => "2024-01-01T00:00:00.000Z"
    });
    const elapsedMs = performance.now() - start;

    // Extraction must actually complete (produce candidates), not merely be fast.
    expect(result.outcome).toBe("extracted");
    if (result.outcome === "extracted") {
      expect(result.candidates).toHaveLength(documents.length);
      for (const candidate of result.candidates) {
        expect(candidate.status).toBe("pending_review");
      }
    }

    // Req 5.1: the whole extraction completes within 60 seconds.
    expect(elapsedMs).toBeLessThan(EXTRACTION_BUDGET_MS);
  });

  it("stays within the budget on a minimal single-statement case", async () => {
    const { documents, resolver, gateway } = buildRepresentativeCase(1);

    const start = Date.now();
    const result = await extractPhenotypes("case-timing-min", documents, gateway, {
      resolver,
      invokingUserId: "user-1",
      now: () => "2024-01-01T00:00:00.000Z"
    });
    const elapsedMs = Date.now() - start;

    expect(result.outcome).toBe("extracted");
    expect(elapsedMs).toBeLessThan(EXTRACTION_BUDGET_MS);
  });
});
