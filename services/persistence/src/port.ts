// services/persistence/src/port.ts
//
// The narrow persistence port the repository depends on. Abstracting the
// DynamoDB document client behind this interface keeps the repository free of
// SDK types and lets tests inject an in-memory fake, so building and running
// the test suite never requires AWS credentials.
//
// Write preconditions are expressed *semantically* here (create-only vs.
// expected-version) rather than as raw DynamoDB condition-expression strings.
// The real adapter translates them into `ConditionExpression`s; the in-memory
// fake evaluates them directly. Both raise `ConditionalCheckFailedError` on
// failure so the repository sees identical behaviour regardless of backend.

import type { Item } from "./keys.js";

/**
 * A write precondition:
 * - `create-only`   — the target key must not already exist (`attribute_not_exists(PK)`).
 * - `expected-version` — the stored item's `version` must equal `version`
 *   (`version = :expected`); used for optimistic-concurrency updates.
 * - omitted — unconditional put (not used by the repository, which always
 *   guards writes).
 */
export type WritePrecondition =
  | { readonly kind: "create-only" }
  | { readonly kind: "expected-version"; readonly version: number };

/** Arguments for a conditional put. */
export interface PutSpec {
  /** The full item to write, including `PK`/`SK` (and any GSI attributes). */
  readonly item: Item;
  /** Optional precondition; when it fails the client throws `ConditionalCheckFailedError`. */
  readonly precondition?: WritePrecondition;
}

/** Arguments for a point read on the base table. */
export interface GetSpec {
  /** The composite base-table key, `{ PK, SK }`. */
  readonly key: { readonly PK: string; readonly SK: string };
}

/**
 * Arguments for a base-table or GSI query. `partitionAttribute`/`sortAttribute`
 * are the attribute *names* (e.g. `PK`/`SK` or `GSI1PK`/`GSI1SK`).
 */
export interface QuerySpec {
  /** Index to query; omit or pass `undefined` for the base table. */
  readonly indexName?: string;
  readonly partitionAttribute: string;
  readonly partitionValue: string;
  /** Sort-attribute name; required when using `sortBeginsWith` or ordering. */
  readonly sortAttribute?: string;
  /** Restrict to items whose sort value begins with this prefix. */
  readonly sortBeginsWith?: string;
  /** Ascending sort-key order when true (default), descending when false. */
  readonly scanIndexForward?: boolean;
}

/**
 * The minimal document-client surface the repository relies on. Implemented by
 * {@link DynamoDbDocumentClientAdapter} (real AWS SDK v3) and
 * {@link InMemoryDocumentClient} (tests).
 */
export interface DocumentClientPort {
  /** Conditionally write an item; throws `ConditionalCheckFailedError` if the precondition fails. */
  put(spec: PutSpec): Promise<void>;
  /** Read a single item by base-table key; resolves to `undefined` when absent. */
  get(spec: GetSpec): Promise<Item | undefined>;
  /** Query the base table or a GSI, returning matching items in sort order. */
  query(spec: QuerySpec): Promise<Item[]>;
}
