// services/phenotype/src/extract.test.ts
//
// Unit tests for phenotype extraction and candidate construction (Req 5.1-5.8).
// A fake AiGateway is injected throughout — no AWS, no Bedrock.

import { describe, expect, it } from "vitest";
import { ModelInvocationFailedError } from "@udn/ai-gateway";
import type {
  GenerativeInvocationResult,
  GenerativeRequest
} from "@udn/ai-gateway";
import type { PhenotypeCandidate } from "@udn/domain";

import {
  extractPhenotypes,
  MAX_ALTERNATIVES,
  MAX_HPO_MAPPINGS,
  type ExtractPhenotypesOptions,
  type PhenotypeExtractionGateway
} from "./extract.js";
import { createLexiconHpoResolver } from "./hpo-resolver.js";

const MODEL_ID = "anthropic.test-model";

/** Build a fake gateway that returns a fixed `invoked` response document. */
function invokedGateway(document: unknown): PhenotypeExtractionGateway {
  return {
    invoke(): Promise<GenerativeInvocationResult> {
      return Promise.resolve({
        outcome: "invoked",
        modelId: MODEL_ID,
        taskType: "phenotype_extraction",
        response: { outputText: JSON.stringify(document), modelId: MODEL_ID }
      });
    }
  };
}

/** A resolver seeded with a small deterministic lexicon and known-id allowlist. */
function resolver(): ReturnType<typeof createLexiconHpoResolver> {
  return createLexiconHpoResolver({
    knownHpoIds: ["HP:0001250", "HP:0001251", "HP:0004322", "HP:0000750"],
    lexicon: {
      seizures: {
        mappings: [{ hpoId: "HP:0001250", confidence: 0.9 }],
        alternatives: [
          { hpoId: "HP:0001251", confidence: 0.4 },
          { hpoId: "HP:0000750", confidence: 0.7 }
        ]
      },
      "tall stature": {
        mappings: [{ hpoId: "HP:0004322", confidence: 0.8 }]
      }
    }
  });
}

function baseOptions(
  overrides: Partial<ExtractPhenotypesOptions> = {}
): ExtractPhenotypesOptions {
  return {
    resolver: resolver(),
    invokingUserId: "user-1",
    now: () => "2024-01-01T00:00:00.000Z",
    ...overrides
  };
}

const docs = [{ sourceObjectId: "doc-1", content: "clinic note" }];

describe("extractPhenotypes — successful mapping (Req 5.2-5.6)", () => {
  it("produces pending_review, ai-extracted candidates with 1-20 HPO terms and a source link", async () => {
    const gateway = invokedGateway({
      statements: [
        {
          statement: "Seizures",
          sourceRefs: ["doc-1"],
          confidence: 0.876,
          basis: "observed"
        }
      ]
    });

    const result = await extractPhenotypes("case-1", docs, gateway, baseOptions());

    expect(result.outcome).toBe("extracted");
    if (result.outcome !== "extracted") return;
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0] as PhenotypeCandidate;

    expect(candidate.status).toBe("pending_review"); // Req 5.6
    expect(candidate.aiExtracted).toBe(true);
    expect(candidate.entityType).toBe("PhenotypeCandidate");
    expect(candidate.caseId).toBe("case-1");

    // Req 5.2: 1-20 HPO terms.
    expect(candidate.hpoMappings.length).toBeGreaterThanOrEqual(1);
    expect(candidate.hpoMappings.length).toBeLessThanOrEqual(MAX_HPO_MAPPINGS);
    expect(candidate.hpoMappings[0]?.hpoId).toBe("HP:0001250");

    // Req 5.3: assertion is exactly one of the permitted values.
    expect(["present", "absent", "uncertain", "historical"]).toContain(
      candidate.assertion
    );
    expect(candidate.assertion).toBe("present");

    // Req 5.4: confidence in [0.00, 1.00] and a link to the supporting source.
    expect(candidate.confidence).toBeGreaterThanOrEqual(0);
    expect(candidate.confidence).toBeLessThanOrEqual(1);
    expect(candidate.confidence).toBe(0.88); // clamped + rounded to 2 dp
    expect(candidate.sourceObjectRef).toBe("doc-1");
  });

  it("orders alternatives by descending confidence and caps them at 10 (Req 5.5)", async () => {
    const gateway = invokedGateway({
      statements: [
        {
          statement: "Seizures",
          sourceRefs: ["doc-1"],
          confidence: 0.9,
          basis: "observed"
        }
      ]
    });

    const result = await extractPhenotypes("case-1", docs, gateway, baseOptions());
    if (result.outcome !== "extracted") throw new Error("expected extracted");
    const candidate = result.candidates[0] as PhenotypeCandidate;

    expect(candidate.alternatives.length).toBeLessThanOrEqual(MAX_ALTERNATIVES);
    const confidences = candidate.alternatives.map((a) => a.confidence);
    const sorted = [...confidences].sort((a, b) => b - a);
    expect(confidences).toEqual(sorted);
    // Chosen mapping is not duplicated among alternatives.
    expect(candidate.alternatives.map((a) => a.hpoId)).not.toContain("HP:0001250");
    // HP:0000750 (0.7) precedes HP:0001251 (0.4).
    expect(candidate.alternatives.map((a) => a.hpoId)).toEqual([
      "HP:0000750",
      "HP:0001251"
    ]);
  });

  it("classifies negation as absent (Req 5.3)", async () => {
    const gateway = invokedGateway({
      statements: [
        {
          statement: "No seizures reported",
          sourceRefs: ["doc-1"],
          confidence: 0.6,
          basis: "observed"
        }
      ]
    });

    const result = await extractPhenotypes("case-1", docs, gateway, baseOptions());
    if (result.outcome !== "extracted") throw new Error("expected extracted");
    expect((result.candidates[0] as PhenotypeCandidate).assertion).toBe("absent");
  });

  it("never marks a produced candidate as approved (no auto-confirm, Req 5.6)", async () => {
    const gateway = invokedGateway({
      statements: [
        { statement: "Seizures", sourceRefs: ["doc-1"], confidence: 0.9, basis: "observed" },
        { statement: "tall stature", sourceRefs: ["doc-1"], confidence: 0.8, basis: "observed" }
      ]
    });

    const result = await extractPhenotypes("case-1", docs, gateway, baseOptions());
    if (result.outcome !== "extracted") throw new Error("expected extracted");
    for (const candidate of result.candidates) {
      expect(candidate.status).not.toBe("approved");
      expect(["pending_review", "unresolved"]).toContain(candidate.status);
    }
  });

  it("caps hpoMappings at 20 (Req 5.2)", async () => {
    const many = Array.from({ length: 30 }, (_v, i) => ({
      hpoId: `HP:${String(1000000 + i).padStart(7, "0")}`,
      confidence: (i + 1) / 100
    }));
    const customResolver = createLexiconHpoResolver({
      lexicon: { "complex phenotype": { mappings: many } }
    });
    const gateway = invokedGateway({
      statements: [
        {
          statement: "complex phenotype",
          sourceRefs: ["doc-1"],
          confidence: 0.9,
          basis: "observed"
        }
      ]
    });

    const result = await extractPhenotypes(
      "case-1",
      docs,
      gateway,
      baseOptions({ resolver: customResolver })
    );
    if (result.outcome !== "extracted") throw new Error("expected extracted");
    expect((result.candidates[0] as PhenotypeCandidate).hpoMappings).toHaveLength(
      MAX_HPO_MAPPINGS
    );
  });
});

describe("extractPhenotypes — unresolvable terms (Req 5.7)", () => {
  it("marks a term absent from the ontology as unresolved and retains it", async () => {
    const gateway = invokedGateway({
      statements: [
        {
          statement: "unmappable finding",
          sourceRefs: ["doc-1"],
          confidence: 0.5,
          basis: "observed"
        }
      ]
    });

    const result = await extractPhenotypes("case-1", docs, gateway, baseOptions());
    if (result.outcome !== "extracted") throw new Error("expected extracted");
    expect(result.candidates).toHaveLength(1); // retained (Req 5.7)
    const candidate = result.candidates[0] as PhenotypeCandidate;
    expect(candidate.status).toBe("unresolved");
    expect(candidate.hpoMappings).toHaveLength(0);
  });

  it("marks a term whose mapping id is invalid/unknown as unresolved", async () => {
    const customResolver = createLexiconHpoResolver({
      knownHpoIds: ["HP:0001250"],
      lexicon: {
        "odd finding": { mappings: [{ hpoId: "NOT-AN-HPO-ID", confidence: 0.9 }] },
        "unknown finding": { mappings: [{ hpoId: "HP:9999999", confidence: 0.9 }] }
      }
    });
    const gateway = invokedGateway({
      statements: [
        { statement: "odd finding", sourceRefs: ["doc-1"], confidence: 0.9, basis: "observed" },
        { statement: "unknown finding", sourceRefs: ["doc-1"], confidence: 0.9, basis: "observed" }
      ]
    });

    const result = await extractPhenotypes(
      "case-1",
      docs,
      gateway,
      baseOptions({ resolver: customResolver })
    );
    if (result.outcome !== "extracted") throw new Error("expected extracted");
    expect(result.candidates).toHaveLength(2);
    for (const candidate of result.candidates) {
      expect(candidate.status).toBe("unresolved");
      expect(candidate.hpoMappings).toHaveLength(0);
    }
  });
});

describe("extractPhenotypes — gateway failure preserves state (Req 5.8)", () => {
  const existing: readonly PhenotypeCandidate[] = [
    {
      id: "PhenotypeCandidate-existing",
      entityType: "PhenotypeCandidate",
      caseId: "case-1",
      source: "phenotype_extraction",
      version: 1,
      status: "pending_review",
      provenance: {
        sourceId: "doc-0",
        versionId: "1",
        createdById: "user-1",
        ingestedAt: "2023-12-01T00:00:00.000Z"
      },
      accessClassification: "clinical",
      createdAt: "2023-12-01T00:00:00.000Z",
      modifiedAt: "2023-12-01T00:00:00.000Z",
      createdById: "user-1",
      syntheticIndicator: true,
      assertion: "present",
      confidence: 0.9,
      hpoMappings: [{ hpoId: "HP:0001250", confidence: 0.9 }],
      alternatives: [],
      sourceObjectRef: "doc-0",
      aiExtracted: true
    }
  ];

  it("returns an error and preserves existing candidates when the gateway rejects", async () => {
    const gateway: PhenotypeExtractionGateway = {
      invoke(): Promise<GenerativeInvocationResult> {
        return Promise.resolve({
          outcome: "rejected",
          error: new ModelInvocationFailedError({ timedOut: true })
        });
      }
    };

    const result = await extractPhenotypes(
      "case-1",
      docs,
      gateway,
      baseOptions({ existingCandidates: existing })
    );

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") return;
    expect(result.reason).toBe("gateway_rejected");
    expect(result.detail).toMatch(/did not complete/i);
    expect(result.candidates).toEqual(existing); // unchanged (Req 5.8)
  });

  it("returns an error and preserves existing candidates when output needs review", async () => {
    const gateway: PhenotypeExtractionGateway = {
      invoke(): Promise<GenerativeInvocationResult> {
        return Promise.resolve({
          outcome: "needs_review",
          modelId: MODEL_ID,
          taskType: "phenotype_extraction",
          response: { outputText: "{}", modelId: MODEL_ID },
          reviewId: "review-1",
          review: { reason: "ungrounded_statement", detail: "no source ref" }
        });
      }
    };

    const result = await extractPhenotypes(
      "case-1",
      docs,
      gateway,
      baseOptions({ existingCandidates: existing })
    );

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") return;
    expect(result.reason).toBe("gateway_needs_review");
    expect(result.candidates).toEqual(existing);
  });

  it("returns an error and preserves existing candidates when the gateway throws", async () => {
    const gateway: PhenotypeExtractionGateway = {
      invoke(): Promise<GenerativeInvocationResult> {
        return Promise.reject(new Error("network down"));
      }
    };

    const result = await extractPhenotypes(
      "case-1",
      docs,
      gateway,
      baseOptions({ existingCandidates: existing })
    );

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") return;
    expect(result.reason).toBe("gateway_unavailable");
    expect(result.candidates).toEqual(existing);
  });

  it("returns an error and preserves existing candidates on unparseable output", async () => {
    const gateway = invokedGateway({ notStatements: true });

    const result = await extractPhenotypes(
      "case-1",
      docs,
      gateway,
      baseOptions({ existingCandidates: existing })
    );

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") return;
    expect(result.reason).toBe("invalid_response");
    expect(result.candidates).toEqual(existing);
  });

  it("forwards taskType 'phenotype_extraction' to the gateway", async () => {
    let seen: GenerativeRequest | undefined;
    const gateway: PhenotypeExtractionGateway = {
      invoke(request): Promise<GenerativeInvocationResult> {
        seen = request;
        return Promise.resolve({
          outcome: "invoked",
          modelId: MODEL_ID,
          taskType: "phenotype_extraction",
          response: {
            outputText: JSON.stringify({ statements: [] }),
            modelId: MODEL_ID
          }
        });
      }
    };

    await extractPhenotypes("case-1", docs, gateway, baseOptions());
    expect(seen?.taskType).toBe("phenotype_extraction");
    expect(seen?.context).toEqual([{ sourceObjectId: "doc-1", content: "clinic note" }]);
  });
});
