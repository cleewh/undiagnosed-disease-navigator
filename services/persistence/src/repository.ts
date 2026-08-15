// services/persistence/src/repository.ts
//
// The single-table DynamoDB repository (design: "Primary Datastore Decision:
// Amazon DynamoDB"). It provides put/get/query operations over case-scoped,
// provenance-carrying, versioned domain objects (Requirement 23), enforcing:
//
//   * Envelope validation before every write (Req 23.6) via `validateEnvelope`
//     from @udn/domain — invalid objects are rejected and never persisted.
//   * Optimistic concurrency (Req 23.4, 23.5) through conditional writes on the
//     `version` attribute: a create (version 1) must not overwrite an existing
//     item; a modify (version N) requires the stored item to currently hold
//     version N-1.
//   * A basic append-only write (`putImmutable`) for objects that must never be
//     overwritten — audit events (Req 22.3) and knowledge snapshots (Req 14.7,
//     14.8). Full modify/delete guards are layered in by task 3.2.
//
// The repository depends only on `DocumentClientPort`, so it is fully
// unit-testable with the in-memory fake and requires no AWS credentials.

import { assertValidEnvelope } from "@udn/domain";
import type { EntityType, Envelope, KnowledgeSnapshot } from "@udn/domain";

import {
  ImmutableWriteError,
  OptimisticConcurrencyError,
  ConditionalCheckFailedError
} from "./errors.js";
import {
  GSI1,
  GSI1PK,
  GSI2,
  GSI2PK,
  GSI3,
  GSI3PK,
  GSI3SK,
  GSI4,
  GSI4PK,
  GSI4SK,
  UNRESOLVED_STATUS_PK,
  auditObjectPk,
  caseKey,
  computeKeys,
  entityTypeToken,
  fromItem,
  queuePk,
  referencePk,
  snapshotKey,
  toItem
} from "./keys.js";
import type { DocumentClientPort } from "./port.js";

/**
 * Repository over the single DynamoDB table. Construct it with any
 * `DocumentClientPort`: {@link DynamoDbDocumentClientAdapter} in production or
 * {@link InMemoryDocumentClient} in tests.
 */
export class SingleTableRepository {
  private readonly client: DocumentClientPort;

  constructor(client: DocumentClientPort) {
    this.client = client;
  }

  /**
   * Persist a domain object with optimistic concurrency (Req 23.4, 23.5).
   *
   * The object is validated first (Req 23.6); an invalid object throws
   * `EnvelopeValidationError` and is never written. A version-1 object is
   * written create-only (it must not overwrite an existing item); a version-N
   * object requires the stored item to currently hold version N-1. A lost race
   * throws {@link OptimisticConcurrencyError} and leaves the stored item
   * unchanged.
   */
  async put(entity: Envelope): Promise<void> {
    assertValidEnvelope(entity);
    const keys = computeKeys(entity);
    const precondition =
      entity.version === 1
        ? ({ kind: "create-only" } as const)
        : ({ kind: "expected-version", version: entity.version - 1 } as const);

    try {
      await this.client.put({ item: toItem(entity), precondition });
    } catch (error) {
      if (error instanceof ConditionalCheckFailedError) {
        throw new OptimisticConcurrencyError(keys.PK, keys.SK, entity.version - 1);
      }
      throw error;
    }
  }

  /**
   * Append-only write for immutable objects (audit events — Req 22.3;
   * knowledge snapshots — Req 14.7, 14.8). The object is validated, then
   * written create-only; if the key already exists the write is refused with
   * {@link ImmutableWriteError} and the stored item is left unchanged.
   *
   * This is the basic append-only primitive; comprehensive immutable-write
   * guards (rejecting modify/delete of retained objects) are added in task 3.2.
   */
  async putImmutable(entity: Envelope): Promise<void> {
    assertValidEnvelope(entity);
    const keys = computeKeys(entity);
    try {
      await this.client.put({ item: toItem(entity), precondition: { kind: "create-only" } });
    } catch (error) {
      if (error instanceof ConditionalCheckFailedError) {
        throw new ImmutableWriteError(keys.PK, keys.SK);
      }
      throw error;
    }
  }

  /** Read a case-scoped object by case, entity type, and id. */
  async getById<T extends Envelope = Envelope>(
    caseId: string,
    entityType: EntityType,
    id: string
  ): Promise<T | undefined> {
    const key = caseKey(caseId, entityType, id);
    const item = await this.client.get({ key });
    return item === undefined ? undefined : fromItem<T>(item);
  }

  /** Read a knowledge snapshot by its version identifier (Req 14). */
  async getSnapshotByVersion(
    snapshotVersion: string
  ): Promise<KnowledgeSnapshot | undefined> {
    const key = snapshotKey(snapshotVersion);
    const item = await this.client.get({ key });
    return item === undefined ? undefined : fromItem<KnowledgeSnapshot>(item);
  }

  /** All objects for a case (design: PK `CASE#<caseId>`). */
  async queryCase<T extends Envelope = Envelope>(caseId: string): Promise<T[]> {
    const items = await this.client.query({
      partitionAttribute: "PK",
      partitionValue: `CASE#${caseId}`
    });
    return items.map((item) => fromItem<T>(item));
  }

  /** Objects of one type within a case (design: SK begins_with `<ENTITY>#`). */
  async queryCaseByType<T extends Envelope = Envelope>(
    caseId: string,
    entityType: EntityType
  ): Promise<T[]> {
    const items = await this.client.query({
      partitionAttribute: "PK",
      partitionValue: `CASE#${caseId}`,
      sortAttribute: "SK",
      sortBeginsWith: `${entityTypeToken(entityType)}#`
    });
    return items.map((item) => fromItem<T>(item));
  }

  /** Unresolved cases (design: GSI1 PK `STATUS#UNRESOLVED`; Req 13.4, 15.1). */
  async queryUnresolvedCases<T extends Envelope = Envelope>(): Promise<T[]> {
    const items = await this.client.query({
      indexName: GSI1,
      partitionAttribute: GSI1PK,
      partitionValue: UNRESOLVED_STATUS_PK
    });
    return items.map((item) => fromItem<T>(item));
  }

  /**
   * Objects referencing a normalized variant/gene/disease id
   * (design: GSI2 PK `REF#<kind>#<normalizedId>`; Req 15.1).
   */
  async queryByReference<T extends Envelope = Envelope>(
    kind: string,
    normalizedId: string
  ): Promise<T[]> {
    const items = await this.client.query({
      indexName: GSI2,
      partitionAttribute: GSI2PK,
      partitionValue: referencePk(kind, normalizedId)
    });
    return items.map((item) => fromItem<T>(item));
  }

  /**
   * Review-queue entries for a case, ordered oldest-first by createdAt
   * (design: GSI3 PK `QUEUE#<caseId>` sorted by createdAt; Req 15.3, 24).
   */
  async queryReviewQueue<T extends Envelope = Envelope>(caseId: string): Promise<T[]> {
    const items = await this.client.query({
      indexName: GSI3,
      partitionAttribute: GSI3PK,
      partitionValue: queuePk(caseId),
      sortAttribute: GSI3SK,
      scanIndexForward: true
    });
    return items.map((item) => fromItem<T>(item));
  }

  /**
   * Audit events affecting an object, ordered oldest-first by timestamp
   * (design: GSI4 PK `AUDITOBJ#<objectId>` sorted by ts; Req 22).
   */
  async queryAuditByObject<T extends Envelope = Envelope>(objectId: string): Promise<T[]> {
    const items = await this.client.query({
      indexName: GSI4,
      partitionAttribute: GSI4PK,
      partitionValue: auditObjectPk(objectId),
      sortAttribute: GSI4SK,
      scanIndexForward: true
    });
    return items.map((item) => fromItem<T>(item));
  }
}
