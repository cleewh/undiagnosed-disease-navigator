// data/generator/src/generator.ts
//
// Seeded, reproducible synthetic-case generator (task 7.1).
//
// Produces at least 30 typed `Case` records (Requirement 1.1) that:
//   - span all required clinical areas (Req 1.2),
//   - vary across all required diversity attributes (Req 1.3),
//   - represent all inheritance models (Req 1.4),
//   - include single-patient and family-based cases (Req 1.5), and
//   - represent all case archetypes (Req 1.6).
//
// The categorical identity of each case comes from the curated blueprints
// (blueprints.ts); the diverse decorating attributes are assigned from the
// controlled vocabularies (taxonomy.ts) using a seeded PRNG (prng.ts) with a
// coverage guarantee so every vocabulary value appears at least once.
//
// This task deliberately stops at the diverse `Case` set plus the minimal
// metadata (`CaseGenerationSpec`, a minimal `Patient`) needed to describe each
// case. It is structured so that:
//   - task 7.2 can add synthetic labelling / identifier-safety / Ground_Truth, and
//   - task 7.3 can compose per-case FHIR / Phenopacket / pedigree / genomic artifacts.

import {
  createEnvelope,
  type Case,
  type CaseDispositionStatus,
  type InheritanceModel,
  type Patient,
  type ProvenanceRef
} from "@udn/domain";
import { composeCaseArtifacts, type CaseArtifacts } from "./artifacts.js";
import { CASE_BLUEPRINTS, type CaseBlueprint } from "./blueprints.js";
import { syntheticIdentifier } from "./identifiers.js";
import { buildGroundTruth, type GroundTruth } from "./ground-truth.js";
import { createRng, type Rng } from "./prng.js";
import {
  AGE_BUCKETS,
  ANCESTRIES,
  GENOMIC_TEST_HISTORIES,
  ONSET_CATEGORIES,
  RECORD_COMPLETENESS,
  SEXES,
  outcomeForArchetype,
  type AgeBucket,
  type Ancestry,
  type CaseArchetype,
  type ClinicalArea,
  type DiagnosticOutcome,
  type FamilyStructure,
  type GenomicTestHistory,
  type OnsetCategory,
  type RecordCompleteness,
  type Sex
} from "./taxonomy.js";

/** Version of the generation logic; recorded in each case's provenance. */
export const GENERATOR_VERSION = "1.0.0";

/** Default seed used when a caller does not supply one (stable 32-bit constant). */
export const DEFAULT_SEED = 0x5eedca5e >>> 0;

/** Source label recorded on every generated object. */
const GENERATOR_SOURCE = "synthetic-case-generator";

/** System actor id recorded as the creator of every generated object. */
const GENERATOR_ACTOR = "system:data-generator";

/**
 * Fixed base instant for deterministic timestamps. Using a constant (rather
 * than the wall clock) keeps the corpus byte-for-byte reproducible.
 * 2020-01-01T00:00:00.000Z.
 */
const BASE_TIME_MS = Date.UTC(2020, 0, 1, 0, 0, 0, 0);

/** Newly generated cases enter at the initial intake state (Req 3.4). */
const INITIAL_DISPOSITION: CaseDispositionStatus = "intake";

/**
 * The full set of selected attributes describing a single synthetic case.
 * This is the "minimal related metadata" produced by task 7.1; tasks 7.2/7.3
 * consume it to build Ground_Truth and per-case artifacts.
 */
export interface CaseGenerationSpec {
  clinicalArea: ClinicalArea;
  archetype: CaseArchetype;
  inheritanceModel: InheritanceModel;
  familyStructure: FamilyStructure;
  /** Derived: true unless the family structure is a single patient (Req 1.5). */
  familyBased: boolean;
  age: AgeBucket;
  onset: OnsetCategory;
  sex: Sex;
  ancestry: Ancestry;
  recordCompleteness: RecordCompleteness;
  genomicTestHistory: GenomicTestHistory;
  /** Intended outcome; feeds Ground_Truth generation in task 7.2. */
  diagnosticOutcome: DiagnosticOutcome;
  /** Human-readable, clearly-synthetic case label. */
  title: string;
}

/**
 * A generated case: the typed `Case` entity, a minimal `Patient` profile that
 * carries the patient-level diversity attributes, and the selection spec.
 */
export interface GeneratedCase {
  case: Case;
  patient: Patient;
  spec: CaseGenerationSpec;
}

/** Options controlling generation. */
export interface GenerateOptions {
  /** Seed for the deterministic PRNG. Defaults to {@link DEFAULT_SEED}. */
  seed?: number;
}

/** Options controlling corpus generation. */
export interface GenerateCorpusOptions extends GenerateOptions {
  /**
   * When true, {@link generateCorpus} additionally composes the per-case
   * artifact bundles (FHIR / Phenopacket / pedigree / genomic artifacts) and
   * attaches them under {@link GeneratedCorpus.artifacts} (task 7.3). Defaults
   * to false so existing callers are unaffected.
   */
  withArtifacts?: boolean;
}

/**
 * Assign one value per case from `options` such that every option appears at
 * least once (coverage), then shuffle deterministically with the seeded PRNG.
 *
 * Coverage is guaranteed whenever `count >= options.length` by seeding the
 * first `options.length` slots with each distinct value; the remaining slots
 * are drawn at random. The final shuffle removes the front-loading bias while
 * preserving the multiset (and therefore the coverage guarantee). Because
 * every draw and swap comes from the seeded PRNG, the result is reproducible.
 */
function coveredAssignments<T>(count: number, options: readonly T[], rng: Rng): T[] {
  if (options.length === 0) {
    throw new RangeError("coveredAssignments requires a non-empty options list");
  }
  const result: T[] = [];
  for (let i = 0; i < count; i++) {
    result.push(i < options.length ? options[i]! : rng.pick(options));
  }
  return rng.shuffleInPlace(result);
}

/** Zero-padded index for stable, human-readable identifiers. */
function pad(index: number): string {
  return String(index).padStart(3, "0");
}

/** Deterministic ISO-8601 UTC timestamp offset from the fixed base instant. */
function timestampForIndex(index: number): string {
  return new Date(BASE_TIME_MS + index * 86_400_000).toISOString();
}

/**
 * Generate the synthetic case corpus.
 *
 * Deterministic in its inputs: `generateCases({ seed })` called twice with the
 * same seed returns deeply-equal results (Requirement 1.1 reproducibility).
 *
 * @returns at least 30 {@link GeneratedCase} records meeting Req 1.1–1.6.
 */
export function generateCases(options: GenerateOptions = {}): GeneratedCase[] {
  const seed = (options.seed ?? DEFAULT_SEED) >>> 0;
  const seedHex = seed.toString(16).padStart(8, "0");
  const rng = createRng(seed);
  const count = CASE_BLUEPRINTS.length;

  // Assign the diverse decorating attributes with a coverage guarantee. Each
  // attribute consumes PRNG draws in a fixed order, so the corpus is
  // reproducible from the seed (Req 1.3).
  const ages = coveredAssignments(count, AGE_BUCKETS, rng);
  const onsets = coveredAssignments(count, ONSET_CATEGORIES, rng);
  const sexes = coveredAssignments(count, SEXES, rng);
  const ancestries = coveredAssignments(count, ANCESTRIES, rng);
  const completeness = coveredAssignments(count, RECORD_COMPLETENESS, rng);
  const histories = coveredAssignments(count, GENOMIC_TEST_HISTORIES, rng);

  return CASE_BLUEPRINTS.map((blueprint, i) =>
    buildGeneratedCase({
      blueprint,
      index: i,
      seedHex,
      age: ages[i]!,
      onset: onsets[i]!,
      sex: sexes[i]!,
      ancestry: ancestries[i]!,
      recordCompleteness: completeness[i]!,
      genomicTestHistory: histories[i]!
    })
  );
}

/**
 * A generated corpus: the application-facing cases plus the hidden Ground_Truth
 * records, kept in a SEPARATE collection keyed by `caseId`.
 *
 * The separation is deliberate (Requirements 2.10, 30.6): Ground_Truth is never
 * embedded in the `Case`/`Patient` entities that interactive users see. Callers
 * that represent the isolated Ground_Truth store (e.g. the Evaluation_Framework
 * or the CDK Ground_Truth bucket) consume {@link GeneratedCorpus.groundTruth}
 * on its own.
 */
export interface GeneratedCorpus {
  /** Application-facing cases (Case + Patient + selection spec). */
  cases: GeneratedCase[];
  /** Hidden Ground_Truth records keyed by `caseId` (isolated from cases). */
  groundTruth: Record<string, GroundTruth>;
  /**
   * Per-case artifact bundles keyed by `caseId`, attached only when
   * `generateCorpus({ withArtifacts: true })` is used (task 7.3). The bundles
   * are derived deterministically from each case's spec and Ground_Truth.
   */
  artifacts?: Record<string, CaseArtifacts>;
}

/**
 * Generate the synthetic corpus together with its hidden Ground_Truth records.
 *
 * Produces the same cases as {@link generateCases} and, separately, one
 * {@link GroundTruth} per case derived from that case's intended answer
 * (`CaseGenerationSpec.diagnosticOutcome` and archetype). Ground_Truth is
 * returned in its own map — it is NOT attached to the returned Case/Patient
 * objects (Requirements 2.10, 30.6).
 *
 * Deterministic in its inputs, exactly like {@link generateCases}.
 */
export function generateCorpus(
  options: GenerateCorpusOptions = {}
): GeneratedCorpus {
  const seed = (options.seed ?? DEFAULT_SEED) >>> 0;
  const seedHex = seed.toString(16).padStart(8, "0");
  const cases = generateCases({ seed });

  const groundTruth: Record<string, GroundTruth> = {};
  cases.forEach((generated, index) => {
    const caseId = generated.case.caseId;
    groundTruth[caseId] = buildGroundTruth({
      caseId,
      spec: generated.spec,
      seedHex,
      index
    });
  });

  if (!options.withArtifacts) {
    return { cases, groundTruth };
  }

  const artifacts: Record<string, CaseArtifacts> = {};
  for (const generated of cases) {
    const caseId = generated.case.caseId;
    artifacts[caseId] = composeCaseArtifacts(generated, groundTruth[caseId]!);
  }

  return { cases, groundTruth, artifacts };
}

/**
 * Compose the per-case artifact bundles for a whole corpus, keyed by `caseId`
 * (task 7.3). A convenience wrapper over {@link generateCorpus} for callers
 * that want only the artifacts. Deterministic in its inputs.
 */
export function generateCaseArtifacts(
  options: GenerateOptions = {}
): Record<string, CaseArtifacts> {
  const { cases, groundTruth } = generateCorpus(options);
  const artifacts: Record<string, CaseArtifacts> = {};
  for (const generated of cases) {
    const caseId = generated.case.caseId;
    artifacts[caseId] = composeCaseArtifacts(generated, groundTruth[caseId]!);
  }
  return artifacts;
}

/**
 * Arguments for {@link buildGeneratedCase}: a case's categorical identity
 * (its {@link CaseBlueprint}) plus the explicitly-pinned decorating attributes,
 * a corpus index, and the hex seed. Exported so curated case sets (e.g. the
 * demonstration cases in `demo-cases.ts`) can build a single case with the
 * exact same machinery the corpus generator uses.
 */
export interface BuildArgs {
  blueprint: CaseBlueprint;
  index: number;
  seedHex: string;
  age: AgeBucket;
  onset: OnsetCategory;
  sex: Sex;
  ancestry: Ancestry;
  recordCompleteness: RecordCompleteness;
  genomicTestHistory: GenomicTestHistory;
}

/**
 * Build a single {@link GeneratedCase} from a blueprint and explicitly-chosen
 * decorating attributes. This is the shared construction path used both by the
 * seeded corpus generator ({@link generateCases}) and by curated case sets that
 * pin every attribute deterministically. Deterministic in its inputs.
 */
export function buildGeneratedCase(args: BuildArgs): GeneratedCase {
  const { blueprint, index, seedHex } = args;

  const caseId = syntheticIdentifier("case", seedHex, pad(index));
  const timestamp = timestampForIndex(index);
  const provenance: ProvenanceRef = {
    sourceId: GENERATOR_SOURCE,
    versionId: GENERATOR_VERSION,
    createdById: GENERATOR_ACTOR,
    ingestedAt: timestamp
  };

  const spec: CaseGenerationSpec = {
    clinicalArea: blueprint.clinicalArea,
    archetype: blueprint.archetype,
    inheritanceModel: blueprint.inheritanceModel,
    familyStructure: blueprint.familyStructure,
    familyBased: blueprint.familyStructure !== "single_patient",
    age: args.age,
    onset: args.onset,
    sex: args.sex,
    ancestry: args.ancestry,
    recordCompleteness: args.recordCompleteness,
    genomicTestHistory: args.genomicTestHistory,
    diagnosticOutcome: outcomeForArchetype(blueprint.archetype),
    title: blueprint.title
  };

  const caseEntity: Case = {
    ...createEnvelope({
      entityType: "Case",
      caseId,
      id: caseId,
      source: GENERATOR_SOURCE,
      status: INITIAL_DISPOSITION,
      provenance,
      accessClassification: "research",
      createdById: GENERATOR_ACTOR,
      now: timestamp
    }),
    entityType: "Case",
    clinicalArea: spec.clinicalArea,
    archetype: spec.archetype,
    inheritanceModel: spec.inheritanceModel,
    familyBased: spec.familyBased,
    dispositionStatus: INITIAL_DISPOSITION
  };

  const patient: Patient = {
    ...createEnvelope({
      entityType: "Patient",
      caseId,
      id: syntheticIdentifier("patient", seedHex, pad(index)),
      source: GENERATOR_SOURCE,
      status: "active",
      provenance,
      accessClassification: "research",
      createdById: GENERATOR_ACTOR,
      now: timestamp
    }),
    entityType: "Patient",
    sex: spec.sex,
    ageBucket: spec.age,
    ancestry: spec.ancestry,
    identifiersSynthetic: true
  };

  return { case: caseEntity, patient, spec };
}
