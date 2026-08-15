// services/persistence/src/in-memory-client.ts
//
// A dependency-free, in-memory `DocumentClientPort` for unit and property
// tests. It mirrors the single-table semantics the repository relies on:
// create-only and expected-version write preconditions, base-table point
// reads, and base-table / GSI queries with `begins_with` and sort ordering.
//
// It requires no AWS credentials and performs no I/O, so `npm test` runs it
// anywhere. Items are deep-cloned on write and read to prevent callers from
// mutating stored state through shared references.

import { ConditionalCheckFailedError } from "./errors.js";
import { PK, SK } from "./keys.js";
import type { Item } from "./keys.js";
import type { DocumentClientPort, GetSpec, PutSpec, QuerySpec } from "./port.js";

function clone(item: Item): Item {
  return structuredClone(item);
}

function compositeKey(pk: unknown, sk: unknown): string {
  return `${String(pk)}\u0000${String(sk)}`;
}

/** In-memory {@link DocumentClientPort} backing repository tests. */
export class InMemoryDocumentClient implements DocumentClientPort {
  private readonly items = new Map<string, Item>();

  /** Total number of stored items; convenient for test assertions. */
  get size(): number {
    return this.items.size;
  }

  /** Remove all stored items. */
  clear(): void {
    this.items.clear();
  }

  /** Snapshot of every stored item (deep-cloned), for inspection in tests. */
  all(): Item[] {
    return [...this.items.values()].map(clone);
  }

  put(spec: PutSpec): Promise<void> {
    const pk = spec.item[PK];
    const sk = spec.item[SK];
    const key = compositeKey(pk, sk);
    const existing = this.items.get(key);

    const precondition = spec.precondition;
    if (precondition !== undefined) {
      if (precondition.kind === "create-only") {
        if (existing !== undefined) {
          return Promise.reject(new ConditionalCheckFailedError());
        }
      } else {
        // expected-version: the stored item must exist and hold exactly the
        // expected version.
        const storedVersion = existing?.["version"];
        if (existing === undefined || storedVersion !== precondition.version) {
          return Promise.reject(new ConditionalCheckFailedError());
        }
      }
    }

    this.items.set(key, clone(spec.item));
    return Promise.resolve();
  }

  get(spec: GetSpec): Promise<Item | undefined> {
    const found = this.items.get(compositeKey(spec.key.PK, spec.key.SK));
    return Promise.resolve(found === undefined ? undefined : clone(found));
  }

  query(spec: QuerySpec): Promise<Item[]> {
    const matches = [...this.items.values()].filter((item) => {
      if (item[spec.partitionAttribute] !== spec.partitionValue) {
        return false;
      }
      if (spec.sortBeginsWith !== undefined && spec.sortAttribute !== undefined) {
        const sortValue = item[spec.sortAttribute];
        if (typeof sortValue !== "string" || !sortValue.startsWith(spec.sortBeginsWith)) {
          return false;
        }
      }
      return true;
    });

    if (spec.sortAttribute !== undefined) {
      const sortAttribute = spec.sortAttribute;
      matches.sort((a, b) => {
        const av = String(a[sortAttribute] ?? "");
        const bv = String(b[sortAttribute] ?? "");
        if (av < bv) return -1;
        if (av > bv) return 1;
        return 0;
      });
      if (spec.scanIndexForward === false) {
        matches.reverse();
      }
    }

    return Promise.resolve(matches.map(clone));
  }
}
