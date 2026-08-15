// tests/structure-validation.property.test.ts
//
// Feature: undiagnosed-disease-navigator, Property 67: Structure and documentation validation detects gaps
//
// Validates: Requirements 28.1, 28.2, 28.3, 28.4, 28.5
//
// Property 67 (design.md): *For any* required monorepo directory that is
// absent, structure validation fails and identifies the missing directory;
// and *for any* required documentation topic that is missing or exists but is
// empty, documentation validation fails and identifies the affected document.
//
// Strategy: build a temporary repository tree in the OS temp dir, generate a
// random subset of required directories to omit and, independently, assign
// each required documentation topic one of {present, missing, empty}. We then
// materialise the tree, run validateStructure({ rootDir }), and assert that the
// reported missingDirectories / missingDocuments / emptyDocuments sets exactly
// match the omitted / missing / empty sets, and that `ok` is true iff nothing
// was omitted, missing, or empty. The temp dir is removed after every run.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateStructure,
  REQUIRED_DIRECTORIES,
  REQUIRED_DOC_TOPICS
} from "../scripts/validate-structure.mjs";

// The docs/ directory is itself a required directory AND the container the
// documentation checks read from. To keep the directory-omission and
// documentation checks independent (so both assertions can be exact), we never
// omit docs/: it is always materialised and its presence is exercised by the
// documentation-topic dimension instead.
const OMITTABLE_DIRECTORIES: string[] = REQUIRED_DIRECTORIES.filter(
  (dir) => dir !== "docs"
);

type DocState = "present" | "missing" | "empty";

const docStateArb: fc.Arbitrary<DocState> = fc.constantFrom(
  "present",
  "missing",
  "empty"
);

// A per-topic assignment of document state, e.g. { README: "present", ... }.
const docStatesArb: fc.Arbitrary<Record<string, DocState>> = fc.record(
  Object.fromEntries(
    REQUIRED_DOC_TOPICS.map((topic) => [topic, docStateArb])
  )
) as fc.Arbitrary<Record<string, DocState>>;

// A random subset of the omittable directories to leave OUT of the tree.
const omittedDirsArb: fc.Arbitrary<string[]> = fc.subarray([
  ...OMITTABLE_DIRECTORIES
]);

function materialiseTree(
  rootDir: string,
  omittedDirs: string[],
  docStates: Record<string, DocState>
): void {
  const omitted = new Set(omittedDirs);

  // Create every required directory except the ones we deliberately omit.
  // docs/ is never in `omitted`, so it is always created here.
  for (const dir of REQUIRED_DIRECTORIES) {
    if (!omitted.has(dir)) {
      mkdirSync(join(rootDir, dir), { recursive: true });
    }
  }

  // Materialise documentation topics inside docs/ according to their state.
  const docsDir = join(rootDir, "docs");
  for (const topic of REQUIRED_DOC_TOPICS) {
    const state = docStates[topic];
    const filePath = join(docsDir, `${topic}.md`);
    if (state === "present") {
      writeFileSync(filePath, `# ${topic}\n\nSynthetic content for ${topic}.\n`);
    } else if (state === "empty") {
      // Whitespace-only content is treated as empty (validator trims).
      writeFileSync(filePath, "   \n\t\n");
    }
    // state === "missing": write nothing.
  }
}

describe("Property 67: Structure and documentation validation detects gaps", () => {
  it("reports exactly the omitted directories, missing documents, and empty documents", () => {
    fc.assert(
      fc.property(omittedDirsArb, docStatesArb, (omittedDirs, docStates) => {
        const rootDir = mkdtempSync(join(tmpdir(), "udn-structure-"));
        try {
          materialiseTree(rootDir, omittedDirs, docStates);

          const result = validateStructure({ rootDir });

          const expectedMissingDocs = REQUIRED_DOC_TOPICS.filter(
            (topic) => docStates[topic] === "missing"
          );
          const expectedEmptyDocs = REQUIRED_DOC_TOPICS.filter(
            (topic) => docStates[topic] === "empty"
          );

          // Missing directories are identified exactly (Req 28.1, 28.2).
          expect([...result.missingDirectories].sort()).toEqual(
            [...omittedDirs].sort()
          );

          // Missing documents are identified exactly (Req 28.3, 28.4).
          expect([...result.missingDocuments].sort()).toEqual(
            [...expectedMissingDocs].sort()
          );

          // Empty documents are identified exactly (Req 28.5).
          expect([...result.emptyDocuments].sort()).toEqual(
            [...expectedEmptyDocs].sort()
          );

          // ok is true iff there were no gaps of any kind.
          const expectedOk =
            omittedDirs.length === 0 &&
            expectedMissingDocs.length === 0 &&
            expectedEmptyDocs.length === 0;
          expect(result.ok).toBe(expectedOk);
        } finally {
          rmSync(rootDir, { recursive: true, force: true });
        }
      }),
      { numRuns: 200 }
    );
  });
});
