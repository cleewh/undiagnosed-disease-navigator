// services/knowledge/src/updates.ts
//
// Simulated Knowledge_Update generation (Knowledge_Service, task 26.1,
// Requirement 14.2, 14.3, 14.4).
//
// This module deterministically produces between 5 and 50 simulated
// Knowledge_Update records (Req 14.2). Every generated update carries a
// synthetic indicator in its metadata (Req 14.3) — the envelope's
// `syntheticIndicator` is fixed to the literal `true`, satisfying both the
// domain contract and the visible-indicator requirement at the UI layer
// (Req 14.4). Generation contains NO generative-model calls and is fully
// deterministic: the same inputs always produce byte-for-byte identical
// records, and deltas are derived from a seeded, index-based scheme.

import {
  createEnvelope,
  type AccessClassification,
  type KnowledgeUpdate,
  type KnowledgeUpdateStatus,
  type ProvenanceRef
} from "@udn/domain";

import { GLOBAL_CASE_ID, KNOWLEDGE_SOURCE } from "./snapshots.js";

/** Inclusive lower bound on the number of simulated updates (Req 14.2). */
export const MIN_KNOWLEDGE_UPDATES = 5;
/** Inclusive upper bound on the number of simulated updates (Req 14.2). */
export const MAX_KNOWLEDGE_UPDATES = 50;

/** Input for generating a batch of simulated Knowledge_Update records. */
export interface GenerateUpdatesInput {
  /** How many updates to generate; must be within [5, 50] (Req 14.2). */
  readonly count: number;
  /** Identity of the actor recording the updates (envelope). */
  readonly createdById: string;
  /** Creation timestamp, ISO-8601 UTC. */
  readonly at: string;
  /** Owning case id for the envelope; defaults to {@link GLOBAL_CASE_ID}. */
  readonly caseId?: string;
  /** Origin for the update envelopes; defaults to {@link KNOWLEDGE_SOURCE}. */
  readonly source?: string;
  /** Access classification for the updates; defaults to "research". */
  readonly accessClassification?: AccessClassification;
  /** Initial processing status for each update; defaults to "pending". */
  readonly status?: KnowledgeUpdateStatus;
}

/** Why an update-generation request was rejected. */
export type UpdateGenerationErrorCode =
  /** The requested count falls outside the inclusive [5, 50] bound (Req 14.2). */
  "count_out_of_range";

/** A structured update-generation failure. */
export interface UpdateGenerationError {
  readonly code: UpdateGenerationErrorCode;
  readonly message: string;
}

/** Result of {@link generateKnowledgeUpdates}. */
export type GenerateUpdatesResult =
  | { readonly ok: true; readonly updates: KnowledgeUpdate[] }
  | { readonly ok: false; readonly error: UpdateGenerationError };

/**
 * Deterministically derive a synthetic delta for the update at `index`.
 *
 * The scheme is a fixed, index-based rotation so that different updates carry
 * different (but reproducible) variant/gene/phenotype/disease references. Every
 * update references at least one identifier, so it can plausibly intersect a
 * case feature vector during reanalysis matching.
 */
function deltaForIndex(index: number): KnowledgeUpdate["delta"] {
  const seq = index + 1;
  return {
    variants: [`SYN-VAR-${seq}`],
    genes: [`SYN-GENE-${seq}`],
    phenotypes: [`HP:${String(seq).padStart(7, "0")}`],
    diseases: [`SYN-DISEASE-${seq}`]
  };
}

/**
 * Build a single simulated Knowledge_Update record at `index` (Req 14.2, 14.3).
 * Pure: the id is content-derived from the index so repeated generation yields
 * identical records.
 */
function buildUpdate(index: number, input: GenerateUpdatesInput): KnowledgeUpdate {
  const seq = index + 1;
  const caseId = input.caseId ?? GLOBAL_CASE_ID;

  const provenance: ProvenanceRef = {
    sourceId: `synthetic-knowledge-update-${seq}`,
    versionId: "1",
    createdById: input.createdById,
    ingestedAt: input.at
  };

  const envelope = createEnvelope({
    id: `KnowledgeUpdate-synthetic-${seq}`,
    entityType: "KnowledgeUpdate",
    caseId,
    source: input.source ?? KNOWLEDGE_SOURCE,
    status: input.status ?? "pending",
    provenance,
    accessClassification: input.accessClassification ?? "research",
    createdById: input.createdById,
    now: input.at
  });

  return {
    ...envelope,
    entityType: "KnowledgeUpdate",
    // Req 14.3/14.4: synthetic indicator fixed to the literal `true`.
    syntheticIndicator: true,
    delta: deltaForIndex(index),
    status: input.status ?? "pending"
  };
}

/**
 * Generate a batch of simulated, synthetic-labelled Knowledge_Update records
 * (Req 14.2, 14.3, 14.4).
 *
 * Rejects a `count` outside the inclusive range [5, 50] with
 * `count_out_of_range` and produces no records (Req 14.2). On success returns
 * exactly `count` records, each carrying `syntheticIndicator: true` (Req 14.3),
 * in stable index order. Deterministic — no generative-model calls.
 */
export function generateKnowledgeUpdates(
  input: GenerateUpdatesInput
): GenerateUpdatesResult {
  const { count } = input;

  if (
    !Number.isInteger(count) ||
    count < MIN_KNOWLEDGE_UPDATES ||
    count > MAX_KNOWLEDGE_UPDATES
  ) {
    return {
      ok: false,
      error: {
        code: "count_out_of_range",
        message: `Knowledge_Update count must be an integer within [${MIN_KNOWLEDGE_UPDATES}, ${MAX_KNOWLEDGE_UPDATES}]; received ${count}.`
      }
    };
  }

  const updates: KnowledgeUpdate[] = [];
  for (let index = 0; index < count; index += 1) {
    updates.push(buildUpdate(index, input));
  }

  return { ok: true, updates };
}
