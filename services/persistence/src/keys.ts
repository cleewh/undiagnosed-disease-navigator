// services/persistence/src/keys.ts
//
// Round-trippable mapping between domain entities and their single-table
// DynamoDB item representation (design: "DynamoDB Access Pattern Summary").
//
// Base keys:
//   PK  `CASE#<caseId>`        SK  `<ENTITY>#<id>`         (all case-scoped objects)
//   PK  `SNAPSHOT#<version>`   SK  `SNAPSHOT#<version>`    (KnowledgeSnapshot)
//
// Secondary-index attributes (set only when applicable):
//   GSI1  unresolved cases     PK `STATUS#UNRESOLVED`          SK `CASE#<caseId>`
//   GSI2  references           PK `REF#<kind>#<normalizedId>`  SK `CASE#<caseId>#<ENTITY>#<id>`
//   GSI3  review queue         PK `QUEUE#<caseId>`             SK `<createdAt>#<id>`
//   GSI4  audit by object      PK `AUDITOBJ#<objectId>`        SK `<ts>#<id>`
//
// `toItem` is the inverse of `fromItem`: for any entity `e`,
// `fromItem(toItem(e))` deep-equals `e`, because `toItem` only ever *adds* the
// reserved key attributes below and `fromItem` strips exactly those.

import type {
  AuditEvent,
  Case,
  DomainEntity,
  Envelope,
  EntityType,
  KnowledgeSnapshot
} from "@udn/domain";

/** Base-table partition/sort attribute names. */
export const PK = "PK";
export const SK = "SK";

/** Global secondary index names (mirrored by the CDK table definition, task 4.1). */
export const GSI1 = "GSI1";
export const GSI2 = "GSI2";
export const GSI3 = "GSI3";
export const GSI4 = "GSI4";

/** Per-index partition/sort attribute names. */
export const GSI1PK = "GSI1PK";
export const GSI1SK = "GSI1SK";
export const GSI2PK = "GSI2PK";
export const GSI2SK = "GSI2SK";
export const GSI3PK = "GSI3PK";
export const GSI3SK = "GSI3SK";
export const GSI4PK = "GSI4PK";
export const GSI4SK = "GSI4SK";

/**
 * The complete set of storage-managed attributes injected by {@link toItem}.
 * `fromItem` removes exactly these to recover the original domain object.
 */
export const RESERVED_ATTRIBUTES: readonly string[] = [
  PK,
  SK,
  GSI1PK,
  GSI1SK,
  GSI2PK,
  GSI2SK,
  GSI3PK,
  GSI3SK,
  GSI4PK,
  GSI4SK
];

const RESERVED_SET = new Set<string>(RESERVED_ATTRIBUTES);

/** Reference-kind token per referring entity type, used to build GSI2 keys (Req 15.1). */
const REFERENCE_KIND: Partial<Record<EntityType, string>> = {
  Variant: "variant",
  Gene: "gene",
  Disease: "disease"
};

/** A persisted DynamoDB item: the entity's own fields plus reserved key attributes. */
export type Item = Record<string, unknown>;

/** The composite base-table primary key for an item. */
export interface PrimaryKey {
  PK: string;
  SK: string;
}

/** Uppercase sort-key prefix token for an entity type, e.g. `PhenotypeCandidate` -> `PHENOTYPECANDIDATE`. */
export function entityTypeToken(entityType: EntityType): string {
  return entityType.toUpperCase();
}

/**
 * Compute the base-table primary key for a case-scoped entity from its
 * discriminator, owning case, and id. Knowledge snapshots are keyed by version
 * instead and must use {@link snapshotKey}.
 */
export function caseKey(caseId: string, entityType: EntityType, id: string): PrimaryKey {
  return { PK: `CASE#${caseId}`, SK: `${entityTypeToken(entityType)}#${id}` };
}

/** Compute the base-table primary key addressing a knowledge snapshot by version (Req 14). */
export function snapshotKey(snapshotVersion: string): PrimaryKey {
  return { PK: `SNAPSHOT#${snapshotVersion}`, SK: `SNAPSHOT#${snapshotVersion}` };
}

/** GSI1 partition value for the unresolved-cases index (design: GSI1). */
export const UNRESOLVED_STATUS_PK = "STATUS#UNRESOLVED";

/** GSI2 partition value for a normalized reference of a given kind (design: GSI2). */
export function referencePk(kind: string, normalizedId: string): string {
  return `REF#${kind}#${normalizedId}`;
}

/** GSI3 partition value for a case's review queue (design: GSI3). */
export function queuePk(caseId: string): string {
  return `QUEUE#${caseId}`;
}

/** GSI4 partition value for audit events affecting a given object (design: GSI4). */
export function auditObjectPk(objectId: string): string {
  return `AUDITOBJ#${objectId}`;
}

/**
 * Compute the base-table primary key for any entity, dispatching on its
 * discriminator (snapshots are keyed by version; everything else by case).
 */
export function computeKeys(entity: Envelope): PrimaryKey {
  if (entity.entityType === "KnowledgeSnapshot") {
    return snapshotKey((entity as KnowledgeSnapshot).snapshotVersion);
  }
  return caseKey(entity.caseId, entity.entityType, entity.id);
}

/**
 * Compute the applicable secondary-index attributes for an entity per the
 * documented access patterns. Only indexes relevant to the entity are set, so
 * items stay sparse in each GSI.
 */
export function computeIndexAttributes(entity: Envelope): Record<string, string> {
  const attrs: Record<string, string> = {};

  // GSI1 — unresolved cases (design: GSI1; Req 13.4, 15.1).
  if (entity.entityType === "Case" && (entity as Case).dispositionStatus === "unresolved") {
    attrs[GSI1PK] = UNRESOLVED_STATUS_PK;
    attrs[GSI1SK] = `CASE#${entity.caseId}`;
  }

  // GSI2 — cases referencing a normalized variant/gene/disease id (design: GSI2; Req 15.1).
  const kind = REFERENCE_KIND[entity.entityType];
  const normalizedId = (entity as { normalizedId?: unknown }).normalizedId;
  if (kind !== undefined && typeof normalizedId === "string" && normalizedId.length > 0) {
    attrs[GSI2PK] = referencePk(kind, normalizedId);
    attrs[GSI2SK] = `CASE#${entity.caseId}#${entityTypeToken(entity.entityType)}#${entity.id}`;
  }

  // GSI3 — review queue, sorted by createdAt (design: GSI3; Req 15.3, 24).
  if (entity.entityType === "ReanalysisCandidate") {
    attrs[GSI3PK] = queuePk(entity.caseId);
    attrs[GSI3SK] = `${entity.createdAt}#${entity.id}`;
  }

  // GSI4 — audit events by affected object, sorted by ts (design: GSI4; Req 22).
  if (entity.entityType === "AuditEvent") {
    const audit = entity as AuditEvent;
    attrs[GSI4PK] = auditObjectPk(audit.affectedObjectId);
    attrs[GSI4SK] = `${audit.at}#${entity.id}`;
  }

  return attrs;
}

/**
 * Serialize a domain entity to its DynamoDB item form: the entity's own fields
 * plus the base key and any applicable secondary-index attributes.
 */
export function toItem(entity: Envelope): Item {
  return {
    ...entity,
    ...computeKeys(entity),
    ...computeIndexAttributes(entity)
  };
}

/**
 * Deserialize a DynamoDB item back to its domain entity by stripping the
 * storage-managed reserved attributes. Inverse of {@link toItem}.
 */
export function fromItem<T extends Envelope = DomainEntity>(item: Item): T {
  const entity: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (!RESERVED_SET.has(key)) {
      entity[key] = value;
    }
  }
  return entity as T;
}
