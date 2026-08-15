// packages/domain/src/envelope.ts
//
// Common provenance envelope and shared value types for every clinically
// relevant domain object (Requirement 23).
//
// Every clinically relevant object embeds the `Envelope` below. Creation sets
// `createdAt == modifiedAt` and `version = 1` (Req 23.4); modification updates
// `modifiedAt` to the current UTC time and increments `version` by 1 while
// preserving `createdAt` and `createdById` (Req 23.5).

import { randomUUID } from "node:crypto";

/**
 * The defined set of access-classification values (Req 23.3, 23.6).
 * An object whose classification falls outside this set is rejected by the
 * persistence guard (task 2.3).
 */
export type AccessClassification = "research" | "clinical" | "ground_truth";

/**
 * The complete, ordered set of access-classification values, exported so that
 * validation logic can check membership against a single source of truth.
 */
export const ACCESS_CLASSIFICATIONS: readonly AccessClassification[] = [
  "research",
  "clinical",
  "ground_truth"
];

/**
 * Per-entity status enums narrow this. Kept as `string` at the envelope level
 * so the shared envelope stays entity-agnostic (design: Data Models).
 */
export type ObjectStatus = string;

/**
 * Recorded origin, author, source object, and version associated with a data
 * item (Req 23.3, glossary: Provenance).
 */
export interface ProvenanceRef {
  /** Originating source object identifier. */
  sourceId: string;
  /** Version identifier of the source. */
  versionId: string;
  /** User or system actor id that produced the source. */
  createdById: string;
  /** Ingestion timestamp, ISO-8601 UTC. */
  ingestedAt: string;
}

/**
 * Discriminator covering all 32 typed domain entities (Req 23.1).
 */
export type EntityType =
  | "User"
  | "Role"
  | "Case"
  | "Patient"
  | "FamilyMember"
  | "Pedigree"
  | "Encounter"
  | "ClinicalDocument"
  | "Observation"
  | "PhenotypeCandidate"
  | "ConfirmedPhenotype"
  | "Contradiction"
  | "EvidenceGap"
  | "Biosample"
  | "GenomicTest"
  | "AnalysisRequest"
  | "AnalysisRun"
  | "Variant"
  | "Gene"
  | "Disease"
  | "Hypothesis"
  | "EvidenceItem"
  | "Task"
  | "MdtDecision"
  | "CaseDisposition"
  | "KnowledgeSource"
  | "KnowledgeSnapshot"
  | "KnowledgeUpdate"
  | "ReanalysisCandidate"
  | "ModelInvocation"
  | "AuditEvent";

/**
 * The complete list of entity-type discriminators, exported for iteration and
 * validation. Order is not significant.
 */
export const ENTITY_TYPES: readonly EntityType[] = [
  "User",
  "Role",
  "Case",
  "Patient",
  "FamilyMember",
  "Pedigree",
  "Encounter",
  "ClinicalDocument",
  "Observation",
  "PhenotypeCandidate",
  "ConfirmedPhenotype",
  "Contradiction",
  "EvidenceGap",
  "Biosample",
  "GenomicTest",
  "AnalysisRequest",
  "AnalysisRun",
  "Variant",
  "Gene",
  "Disease",
  "Hypothesis",
  "EvidenceItem",
  "Task",
  "MdtDecision",
  "CaseDisposition",
  "KnowledgeSource",
  "KnowledgeSnapshot",
  "KnowledgeUpdate",
  "ReanalysisCandidate",
  "ModelInvocation",
  "AuditEvent"
];

/**
 * Common provenance envelope embedded by every clinically relevant object
 * (Req 23.2, 23.3).
 */
export interface Envelope {
  /** Globally unique across all entity types (Req 23.2). */
  id: string;
  /** Discriminator identifying the entity type. */
  entityType: EntityType;
  /** Owning case identifier (Req 23.3). */
  caseId: string;
  /** Origin of the object (Req 23.3). */
  source: string;
  /** Positive integer starting at 1 (Req 23.3, 23.4, 23.5). */
  version: number;
  /** Object status (Req 23.3). */
  status: ObjectStatus;
  /** Provenance record (Req 23.3). */
  provenance: ProvenanceRef;
  /** Access classification from the defined set (Req 23.3, 23.6). */
  accessClassification: AccessClassification;
  /** ISO-8601 UTC timestamp with millisecond precision (Req 23.2). */
  createdAt: string;
  /** ISO-8601 UTC timestamp with millisecond precision (Req 23.2). */
  modifiedAt: string;
  /** User or system actor id that created the object (Req 23.2). */
  createdById: string;
  /** Synthetic-data indicator; always true (Req 1.7, 14.3). */
  syntheticIndicator: true;
}

/**
 * Return the current time as an ISO-8601 UTC timestamp with millisecond
 * precision (e.g. "2024-01-01T12:34:56.789Z"). `Date.prototype.toISOString`
 * always renders in UTC with millisecond precision, giving a stable format.
 */
export function utcNow(): string {
  return new Date().toISOString();
}

/**
 * Generate an identifier that is unique across every entity type (Req 23.2).
 *
 * The identifier embeds a random UUID (v4), which is globally unique on its
 * own; the optional entity-type prefix makes ids human-readable and keeps
 * distinct entity types trivially non-colliding.
 */
export function generateId(entityType?: EntityType): string {
  const uuid = randomUUID();
  return entityType ? `${entityType}-${uuid}` : uuid;
}

/**
 * Fields a caller must supply to create a new envelope. The envelope-managed
 * fields (`id`, `version`, `createdAt`, `modifiedAt`, `syntheticIndicator`)
 * are set by {@link createEnvelope} and are therefore omitted here.
 */
export interface CreateEnvelopeInput {
  entityType: EntityType;
  caseId: string;
  source: string;
  status: ObjectStatus;
  provenance: ProvenanceRef;
  accessClassification: AccessClassification;
  createdById: string;
  /** Optional explicit id; a unique id is generated when omitted. */
  id?: string;
  /** Optional explicit creation timestamp (ISO-8601 UTC, ms precision). */
  now?: string;
}

/**
 * Create a fresh provenance envelope for a new object (Req 23.4).
 *
 * Sets `version = 1` and `createdAt == modifiedAt`, marks the object as
 * synthetic, and assigns a globally unique id when one is not supplied.
 */
export function createEnvelope(input: CreateEnvelopeInput): Envelope {
  const timestamp = input.now ?? utcNow();
  return {
    id: input.id ?? generateId(input.entityType),
    entityType: input.entityType,
    caseId: input.caseId,
    source: input.source,
    version: 1,
    status: input.status,
    provenance: input.provenance,
    accessClassification: input.accessClassification,
    createdAt: timestamp,
    modifiedAt: timestamp,
    createdById: input.createdById,
    syntheticIndicator: true
  };
}

/**
 * Produce the modified form of an object that carries an envelope (Req 23.5).
 *
 * Updates `modifiedAt` to the current UTC time (or the supplied timestamp) and
 * increments `version` by 1 while preserving `createdAt`, `createdById`, and
 * every other field. Returns a new object; the input is not mutated.
 */
export function touchEnvelope<T extends Envelope>(entity: T, now?: string): T {
  return {
    ...entity,
    version: entity.version + 1,
    modifiedAt: now ?? utcNow()
  };
}
