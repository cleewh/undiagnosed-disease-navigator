// infrastructure/cdk/test/artifact-prefixes.property.test.ts
//
// Property-based test for the canonical per-artifact-type S3 prefixes
// (Requirement 26.8).
//
// Feature: undiagnosed-disease-navigator, Property 66: Artifacts are stored
// under type-specific prefixes

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  ARTIFACT_PREFIXES,
  ARTIFACT_TYPES,
  artifactKey,
  type ArtifactType,
} from "../lib/artifact-prefixes";

/**
 * Synthetic case identifiers. `artifactKey` trims leading/trailing slashes
 * from the caseId, so we draw non-empty strings with slashes removed. This
 * keeps the trimmed caseId identical to the drawn value, allowing a clean
 * "the key contains the caseId" assertion while still exercising a broad
 * character space.
 */
const caseIdArb = fc
  .string({ minLength: 1 })
  .map((s) => s.replace(/\//g, "x"));

/** Optional object name/suffix within the case folder. */
const nameArb = fc.oneof(fc.constant(undefined), fc.string());

describe("Property 66: Artifacts are stored under type-specific prefixes", () => {
  // Feature: undiagnosed-disease-navigator, Property 66: Artifacts are stored
  // under type-specific prefixes
  // Validates: Requirements 26.8
  it("places every artifact key under its own dedicated prefix segment and no other type's prefix", () => {
    // Precondition: the dedicated prefixes are pairwise distinct, so a key can
    // belong to at most one artifact type by prefix.
    const prefixes = ARTIFACT_TYPES.map((t) => ARTIFACT_PREFIXES[t]);
    expect(new Set(prefixes).size).toBe(prefixes.length);

    fc.assert(
      fc.property(
        fc.constantFrom<ArtifactType>(...ARTIFACT_TYPES),
        caseIdArb,
        nameArb,
        (type, caseId, name) => {
          const key = artifactKey(type, caseId, name);
          const expectedPrefix = ARTIFACT_PREFIXES[type];

          // The key begins with the dedicated prefix for its type.
          expect(key.startsWith(expectedPrefix)).toBe(true);

          // Guard against the edge case that one prefix could be a string
          // prefix of another: compare the key's first path segment (including
          // its trailing slash) against the type's prefix segment. This is an
          // exact, mutually-exclusive check rather than a loose startsWith.
          const segments = key.split("/");
          const firstSegment = `${segments[0] ?? ""}/`;
          expect(firstSegment).toBe(expectedPrefix);

          // The first segment matches no OTHER artifact type's prefix.
          for (const other of ARTIFACT_TYPES) {
            if (other === type) continue;
            expect(firstSegment).not.toBe(ARTIFACT_PREFIXES[other]);
          }

          // The key carries the owning case identifier.
          expect(key.includes(caseId)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
