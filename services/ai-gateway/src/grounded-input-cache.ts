// services/ai-gateway/src/grounded-input-cache.ts
//
// Grounded-input cache for the AI_Gateway (Task 12.5, Requirement 32.2, 32.3).
//
// Cost control: when a grounded input identical to a previously cached one is
// submitted, the gateway returns the cached AI result instead of invoking the
// provider again (Req 32.2). On a cache miss it computes (invokes), stores, and
// returns the result (Req 32.3). The gateway only reaches the cache STORE step
// (stage 8) for validated/confirmed output, so needs_review/failed output is
// never persisted here (Req 19.4).
//
// A cache entry is keyed by a canonical hash of the grounded input:
//   - the task type,
//   - the resolved model id,
//   - the AUTHORISED context (the post-restriction context items, each
//     contributing its sourceObjectId + content), and
//   - the prompt template version.
//
// The key is canonical: the authorised context items are sorted by
// (sourceObjectId, content) before hashing, so a grounded input that differs
// only by the insignificant ordering of its authorised context maps to the same
// key. Any difference in task type, model id, authorised context content, or
// prompt template version produces a different key (Req 32.2).

import { createHash } from "node:crypto";

import type { ModelResponse } from "./model-provider.js";
import type { GatewayContextItem, GroundedInputCache } from "./pipeline.js";

/**
 * The logical components of a grounded input that determine its cache identity
 * (Req 32.2). The `context` here is the AUTHORISED context — the items that
 * survived context restriction and were actually presented to the model.
 */
export interface GroundedInputKeyComponents {
  /** The permitted generative task type. */
  readonly taskType: string;
  /** The resolved model identifier the grounded input targets. */
  readonly modelId: string;
  /** The authorised context items supplied to the model (sourceObjectId + content). */
  readonly context: readonly GatewayContextItem[];
  /** The prompt template version, or `undefined` when unspecified. */
  readonly promptTemplateVersion?: string | undefined;
}

/**
 * Compute the canonical cache key for a grounded input (Req 32.2).
 *
 * The authorised context contributes each included item's `sourceObjectId` and
 * `content`; the items are sorted into a canonical order first, so a grounded
 * input that differs only by the ordering of otherwise-identical authorised
 * context yields the same key. The canonical description is hashed (SHA-256) to
 * a fixed-length, stable, opaque key. Two grounded inputs produce the same key
 * if and only if they agree on task type, model id, authorised context (as an
 * order-independent multiset of sourceObjectId+content), and prompt template
 * version.
 */
export function canonicalGroundedInputKey(components: GroundedInputKeyComponents): string {
  const canonicalContext = components.context
    .map((item) => ({ sourceObjectId: item.sourceObjectId, content: item.content }))
    .sort((a, b) => {
      if (a.sourceObjectId !== b.sourceObjectId) {
        return a.sourceObjectId < b.sourceObjectId ? -1 : 1;
      }
      if (a.content !== b.content) {
        return a.content < b.content ? -1 : 1;
      }
      return 0;
    });

  const canonicalDescription = JSON.stringify({
    taskType: components.taskType,
    modelId: components.modelId,
    context: canonicalContext,
    promptTemplateVersion: components.promptTemplateVersion ?? null
  });

  return createHash("sha256").update(canonicalDescription).digest("hex");
}

/**
 * An in-memory {@link GroundedInputCache} (Req 32.2, 32.3). A cache hit returns
 * the stored {@link ModelResponse} verbatim so the provider is not re-invoked;
 * a miss returns `undefined`, prompting the gateway to compute, store (only for
 * validated output), and return.
 *
 * Suitable for unit tests and local development. Production wiring can supply
 * any {@link GroundedInputCache} implementation (e.g. one backed by a shared
 * store) through the gateway options; the gateway depends only on the interface.
 */
export class InMemoryGroundedInputCache implements GroundedInputCache {
  readonly #entries = new Map<string, ModelResponse>();

  /** Return the cached response for `key`, or `undefined` on a miss (Req 32.2, 32.3). */
  get(key: string): ModelResponse | undefined {
    return this.#entries.get(key);
  }

  /** Store `value` under `key` so a later identical grounded input hits (Req 32.3). */
  set(key: string, value: ModelResponse): void {
    this.#entries.set(key, value);
  }

  /** Number of cached entries (test/diagnostic aid). */
  get size(): number {
    return this.#entries.size;
  }

  /** Discard all cached entries. */
  clear(): void {
    this.#entries.clear();
  }
}
