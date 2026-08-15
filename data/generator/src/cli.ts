// data/generator/src/cli.ts
//
// Runnable entry point for the synthetic case generator. Generates the corpus
// from a fixed seed, prints a coverage report, and exits non-zero if any
// Requirement 1 guarantee is unmet.
//
// Usage:
//   node dist/cli.js [--seed <number>] [--json]
//
//   --seed <number>  Override the default deterministic seed.
//   --json           Print the full generated corpus as JSON instead of a
//                    human-readable coverage report.

import { generateCases, generateCorpus, DEFAULT_SEED } from "./generator.js";
import { verifyCoverage } from "./coverage.js";
import { assertLabelledCorpus } from "./labelling.js";

interface CliArgs {
  seed: number;
  json: boolean;
  groundTruth: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let seed = DEFAULT_SEED;
  let json = false;
  let groundTruth = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--seed") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value)) {
        throw new Error("--seed requires a numeric value");
      }
      seed = value >>> 0;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--ground-truth") {
      groundTruth = true;
    }
  }
  return { seed, json, groundTruth };
}

function main(): void {
  const { seed, json, groundTruth } = parseArgs(process.argv.slice(2));
  const cases = generateCases({ seed });

  // Enforce synthetic labelling and identifier safety before emitting anything
  // (Req 1.7, 1.9, 2.1); fail fast if a record slipped through unlabeled.
  assertLabelledCorpus(cases);

  if (groundTruth) {
    // Emit the hidden Ground_Truth map SEPARATELY from the case-facing data
    // (Req 2.10, 30.6). This is the collection the isolated Ground_Truth store
    // (Evaluation_Framework only) would consume.
    process.stdout.write(
      `${JSON.stringify(generateCorpus({ seed }).groundTruth, null, 2)}\n`
    );
    return;
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(cases, null, 2)}\n`);
    return;
  }

  const { ok, problems, summary } = verifyCoverage(cases);

  const lines: string[] = [];
  lines.push("Synthetic case dataset generator");
  lines.push(`  seed:        0x${seed.toString(16).padStart(8, "0")}`);
  lines.push(`  cases:       ${summary.caseCount}`);
  lines.push(`  single/fam:  ${summary.singlePatientCount} single, ${summary.familyBasedCount} family-based`);
  lines.push("  clinical areas:");
  for (const [area, n] of Object.entries(summary.clinicalAreas).sort()) {
    lines.push(`    - ${area}: ${n}`);
  }
  lines.push("  inheritance models:");
  for (const [model, n] of Object.entries(summary.inheritanceModels).sort()) {
    lines.push(`    - ${model}: ${n}`);
  }
  lines.push("  archetypes:");
  for (const [archetype, n] of Object.entries(summary.archetypes).sort()) {
    lines.push(`    - ${archetype}: ${n}`);
  }
  lines.push("  distinct values per diversity attribute:");
  for (const [name, n] of Object.entries(summary.distinctValueCounts).sort()) {
    lines.push(`    - ${name}: ${n}`);
  }
  lines.push(ok ? "  coverage: OK (all Requirement 1 guarantees met)" : "  coverage: FAILED");
  if (!ok) {
    for (const problem of problems) {
      lines.push(`    ! ${problem}`);
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  if (!ok) {
    process.exitCode = 1;
  }
}

main();
