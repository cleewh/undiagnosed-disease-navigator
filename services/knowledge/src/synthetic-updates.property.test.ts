// services/knowledge/src/synthetic-updates.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 38: Knowledge updates are synthetic-labelled
//
// Validates: Requirements 14.2, 14.3
//
// Property 38 (design.md): *For any* Knowledge_Update, its metadata carries the
// synthetic indicator and its display includes a visible synthetic marker.
//
// This test exercises the deterministic generator that produces the batch of
// simulated Knowledge_Update records. It asserts the count bound (Req 14.2)
// and the synthetic indicator carried by every generated record (Req 14.3):
//   - for any count within the inclusive range [5, 50], generation succeeds and
//     yields exactly `count` records, each with syntheticIndicator === true;
//   - for any count outside [5, 50], generation is rejected with
//     count_out_of_range and produces no records.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  generateKnowledgeUpdates,
  MIN_KNOWLEDGE_UPDATES,
  MAX_KNOWLEDGE_UPDATES
} from "./index.js";

const NOW = "2024-01-01T00:00:00.000Z";

describe("Feature: undiagnosed-disease-navigator, Property 38: Knowledge updates are synthetic-labelled", () => {
  it("yields exactly `count` synthetic-labelled updates for any count in [5, 50]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_KNOWLEDGE_UPDATES, max: MAX_KNOWLEDGE_UPDATES }),
        fc.string({ minLength: 1, maxLength: 16 }),
        (count, createdById) => {
          const result = generateKnowledgeUpdates({ count, createdById, at: NOW });

          // Req 14.2: in-range counts succeed with exactly `count` records.
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          expect(result.updates).toHaveLength(count);

          // Req 14.3: every generated record carries the synthetic indicator.
          for (const update of result.updates) {
            expect(update.syntheticIndicator).toBe(true);
            expect(update.entityType).toBe("KnowledgeUpdate");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects any count outside [5, 50] and produces no records", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: -1000, max: 1000 })
          .filter(
            (n) => n < MIN_KNOWLEDGE_UPDATES || n > MAX_KNOWLEDGE_UPDATES
          ),
        fc.string({ minLength: 1, maxLength: 16 }),
        (count, createdById) => {
          const result = generateKnowledgeUpdates({ count, createdById, at: NOW });

          // Req 14.2: out-of-range counts are rejected with no records.
          expect(result.ok).toBe(false);
          if (result.ok) return;

          expect(result.error.code).toBe("count_out_of_range");
          expect("updates" in result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
