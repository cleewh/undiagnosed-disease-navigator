// services/vertical-slice/src/knowledge-update.ts
//
// Simulated Knowledge_Update publish (vertical-slice stage 6).
//
// The full Knowledge_Service is task 26; the slice needs only to CONSTRUCT a
// synthetic-labelled `KnowledgeUpdate` from `@udn/domain` so the downstream
// reanalysis stage has a trigger to match against (task 17.2). Every produced
// update carries the mandatory synthetic indicator (Req 14.3), a `pending`
// processing status (Req 15), and the variant/gene/phenotype/disease delta used
// by the deterministic reanalysis matcher (Req 15.1).
//
// This is a DETERMINISTIC construction step — no generative model is involved.
// The publish is rejected when the delta is entirely empty, because an update
// that references nothing could never return an unresolved case to the queue
// (Req 33.2); this gives the slice a meaningful stage-failure path.

import {
  createEnvelope,
  type AccessClassification,
  type KnowledgeUpdate,
  type ProvenanceRef
} from "@udn/domain";

/** Origin recorded on updates produced by the slice publish stage. */
export const KNOWLEDGE_UPDATE_SOURCE = "VerticalSlice_KnowledgeUpdate";

/** Case id used for global (non-case-scoped) knowledge updates. */
export const GLOBAL_CASE_ID = "GLOBAL";

/** The variant/gene/phenotype/disease references a Knowledge_Update touches. */
export interface KnowledgeUpdateDelta {
  readonly variants: readonly string[];
  readonly genes: readonly string[];
  readonly phenotypes: readonly string[];
  readonly diseases: readonly string[];
}

/** Why publishing a simulated Knowledge_Update failed. */
export type PublishKnowledgeUpdateErrorCode =
  /** The delta referenced no variant, gene, phenotype, or disease. */
  | "empty_delta";

/** A structured publish failure. */
export interface PublishKnowledgeUpdateError {
  readonly code: PublishKnowledgeUpdateErrorCode;
  readonly message: string;
}

/** Inputs to {@link publishKnowledgeUpdate}. */
export interface PublishKnowledgeUpdateInput {
  /** The references the update touches (Req 15.1). */
  readonly delta: KnowledgeUpdateDelta;
  /** Actor id publishing the update. */
  readonly createdById: string;
  /** Publish timestamp, ISO-8601 UTC. */
  readonly now: string;
  /** Optional explicit update id; generated when omitted. */
  readonly id?: string;
  /** Owning case id; defaults to {@link GLOBAL_CASE_ID}. */
  readonly caseId?: string;
  /** Access classification; defaults to "research". */
  readonly accessClassification?: AccessClassification;
  /** Origin recorded on the envelope; defaults to {@link KNOWLEDGE_UPDATE_SOURCE}. */
  readonly source?: string;
  /** Optional provenance; a deterministic default is derived when omitted. */
  readonly provenance?: ProvenanceRef;
}

/** Result of {@link publishKnowledgeUpdate}. */
export type PublishKnowledgeUpdateResult =
  | { readonly ok: true; readonly update: KnowledgeUpdate }
  | { readonly ok: false; readonly error: PublishKnowledgeUpdateError };

/** True when the delta references nothing at all. */
function isEmptyDelta(delta: KnowledgeUpdateDelta): boolean {
  return (
    delta.variants.length === 0 &&
    delta.genes.length === 0 &&
    delta.phenotypes.length === 0 &&
    delta.diseases.length === 0
  );
}

/**
 * Publish a simulated, synthetic-labelled Knowledge_Update (vertical-slice
 * stage 6; Req 14.3, 15.1).
 *
 * Rejects an entirely empty delta (`empty_delta`); on success returns a
 * `pending` update carrying the synthetic indicator and the delta. Pure and
 * deterministic for fixed inputs; no generative model is involved.
 */
export function publishKnowledgeUpdate(
  input: PublishKnowledgeUpdateInput
): PublishKnowledgeUpdateResult {
  if (isEmptyDelta(input.delta)) {
    return {
      ok: false,
      error: {
        code: "empty_delta",
        message:
          "Cannot publish a Knowledge_Update: the delta references no variant, gene, phenotype, or disease."
      }
    };
  }

  const provenance: ProvenanceRef =
    input.provenance ?? {
      sourceId: input.source ?? KNOWLEDGE_UPDATE_SOURCE,
      versionId: "1",
      createdById: input.createdById,
      ingestedAt: input.now
    };

  const envelope = createEnvelope({
    ...(input.id !== undefined ? { id: input.id } : {}),
    entityType: "KnowledgeUpdate",
    caseId: input.caseId ?? GLOBAL_CASE_ID,
    source: input.source ?? KNOWLEDGE_UPDATE_SOURCE,
    status: "pending",
    provenance,
    accessClassification: input.accessClassification ?? "research",
    createdById: input.createdById,
    now: input.now
  });

  const update: KnowledgeUpdate = {
    ...envelope,
    entityType: "KnowledgeUpdate",
    syntheticIndicator: true,
    delta: {
      variants: [...input.delta.variants],
      genes: [...input.delta.genes],
      phenotypes: [...input.delta.phenotypes],
      diseases: [...input.delta.diseases]
    },
    status: "pending"
  };

  return { ok: true, update };
}
