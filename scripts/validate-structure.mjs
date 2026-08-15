#!/usr/bin/env node
// Repository structure and documentation validation (Requirement 28).
//
// Validates two things against a repository root:
//   1. Every required monorepo directory is present (Req 28.1, 28.2).
//   2. Every required documentation topic exists in docs/ and is non-empty
//      (Req 28.3, 28.4, 28.5).
//
// The core logic is exposed as the reusable, side-effect-free function
// `validateStructure({ rootDir })` returning a structured result so that a
// property test can drive it against arbitrary fixture trees. Running this
// file directly performs the validation against the repository root and exits
// non-zero when any check fails.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// Required monorepo directories (Requirement 28.1).
export const REQUIRED_DIRECTORIES = Object.freeze([
  "apps/web",
  "apps/api",
  "services",
  "packages",
  "data",
  "workflows",
  "infrastructure/cdk",
  "evaluation",
  "tests",
  "docs"
]);

// Required documentation topics (Requirement 28.3). Each topic is expected to
// resolve to a `<TOPIC>.md` file inside the docs/ directory.
export const REQUIRED_DOC_TOPICS = Object.freeze([
  "README",
  "ARCHITECTURE",
  "DATA_SOURCES",
  "DATA_MODEL",
  "SECURITY",
  "RESPONSIBLE_USE",
  "DEPLOYMENT",
  "DEMO_GUIDE",
  "EVALUATION",
  "COST_GUIDANCE",
  "LIMITATIONS"
]);

const DOCS_DIRNAME = "docs";

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Resolve a documentation topic to its file within docs/, matching
// `<TOPIC>.md` case-insensitively. Returns the absolute path or null.
function findDocFile(docsDir, topic) {
  if (!isDirectory(docsDir)) return null;
  const wanted = `${topic}.md`.toLowerCase();
  let entries;
  try {
    entries = readdirSync(docsDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.toLowerCase() === wanted) {
      const full = join(docsDir, entry);
      if (existsSync(full) && statSync(full).isFile()) return full;
    }
  }
  return null;
}

function isEmptyDoc(filePath) {
  try {
    return readFileSync(filePath, "utf8").trim().length === 0;
  } catch {
    // Unreadable content is treated as empty for validation purposes.
    return true;
  }
}

/**
 * Validate repository structure and documentation.
 *
 * @param {{ rootDir?: string }} [options]
 * @returns {{
 *   ok: boolean,
 *   rootDir: string,
 *   missingDirectories: string[],
 *   missingDocuments: string[],
 *   emptyDocuments: string[]
 * }}
 */
export function validateStructure(options = {}) {
  const rootDir = resolve(options.rootDir ?? process.cwd());

  const missingDirectories = [];
  for (const dir of REQUIRED_DIRECTORIES) {
    if (!isDirectory(join(rootDir, dir))) {
      missingDirectories.push(dir);
    }
  }

  const docsDir = join(rootDir, DOCS_DIRNAME);
  const missingDocuments = [];
  const emptyDocuments = [];
  for (const topic of REQUIRED_DOC_TOPICS) {
    const docFile = findDocFile(docsDir, topic);
    if (docFile === null) {
      missingDocuments.push(topic);
    } else if (isEmptyDoc(docFile)) {
      emptyDocuments.push(topic);
    }
  }

  const ok =
    missingDirectories.length === 0 &&
    missingDocuments.length === 0 &&
    emptyDocuments.length === 0;

  return { ok, rootDir, missingDirectories, missingDocuments, emptyDocuments };
}

// Human-readable report lines for the CLI.
function formatReport(result) {
  const lines = [];
  lines.push(`Structure and documentation validation (root: ${result.rootDir})`);
  if (result.missingDirectories.length > 0) {
    lines.push("");
    lines.push("Missing required directories (Req 28.2):");
    for (const dir of result.missingDirectories) lines.push(`  - ${dir}`);
  }
  if (result.missingDocuments.length > 0) {
    lines.push("");
    lines.push("Missing required documents (Req 28.4):");
    for (const doc of result.missingDocuments) lines.push(`  - ${doc}`);
  }
  if (result.emptyDocuments.length > 0) {
    lines.push("");
    lines.push("Empty required documents (Req 28.5):");
    for (const doc of result.emptyDocuments) lines.push(`  - ${doc}`);
  }
  lines.push("");
  lines.push(
    result.ok
      ? "PASS: all required directories and documents are present and non-empty."
      : "FAIL: structure/documentation validation found gaps (see above)."
  );
  return lines.join("\n");
}

function repoRootFromScript() {
  // scripts/validate-structure.mjs -> repository root is the parent of scripts/.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..");
}

// CLI entry: run when invoked directly (not when imported).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const rootArg = process.argv[2];
  const rootDir = rootArg ? resolve(rootArg) : repoRootFromScript();
  const result = validateStructure({ rootDir });
  console.log(formatReport(result));
  process.exit(result.ok ? 0 : 1);
}
