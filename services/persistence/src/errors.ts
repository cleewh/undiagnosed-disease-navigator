// services/persistence/src/errors.ts
//
// Typed error hierarchy for the single-table persistence adapter.
//
// The low-level document-client port raises `ConditionalCheckFailedError`
// whenever a DynamoDB conditional expression fails. The repository translates
// that low-level signal into a domain-meaningful error depending on the write
// intent: an optimistic-concurrency conflict on a mutable write (Req 23.4,
// 23.5) or an immutable-write violation on an append-only write (Req 22.3,
// 14.7, 14.8).

/**
 * Raised by a {@link DocumentClientPort} implementation when a write's
 * conditional expression evaluates to false. This is intentionally
 * storage-level and intent-agnostic; the repository maps it onto a more
 * specific error.
 */
export class ConditionalCheckFailedError extends Error {
  constructor(message = "DynamoDB conditional check failed") {
    super(message);
    this.name = "ConditionalCheckFailedError";
  }
}

/**
 * Raised when a versioned mutable write loses an optimistic-concurrency race:
 * the stored object no longer carries the expected previous version, so the
 * increment is refused and the stored object is left unchanged (Req 23.4,
 * 23.5).
 */
export class OptimisticConcurrencyError extends Error {
  /** Composite `PK`/`SK` of the contended item, for diagnostics. */
  readonly pk: string;
  readonly sk: string;
  /** The version the writer expected the stored object to currently hold. */
  readonly expectedVersion: number;

  constructor(pk: string, sk: string, expectedVersion: number) {
    super(
      `Optimistic concurrency conflict on ${pk} / ${sk}: expected stored version ${expectedVersion}`
    );
    this.name = "OptimisticConcurrencyError";
    this.pk = pk;
    this.sk = sk;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * Raised when an append-only write targets a key that already exists.
 * Immutable objects (audit events — Req 22.3; knowledge snapshots — Req 14.7,
 * 14.8) may be created exactly once and never overwritten.
 */
export class ImmutableWriteError extends Error {
  readonly pk: string;
  readonly sk: string;

  constructor(pk: string, sk: string) {
    super(`Immutable object already exists and cannot be overwritten: ${pk} / ${sk}`);
    this.name = "ImmutableWriteError";
    this.pk = pk;
    this.sk = sk;
  }
}
