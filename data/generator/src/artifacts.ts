// data/generator/src/artifacts.ts
//
// Per-case artifact composition (task 7.3).
//
// Given a `GeneratedCase` (its `CaseGenerationSpec`) and the case's hidden
// `GroundTruth`, this module deterministically composes the standardised
// clinical and genomic artifacts every synthetic case must carry
// (Requirement 2):
//
//   - a FHIR R4 longitudinal clinical record spanning >= 2 years (Req 2.3),
//   - a GA4GH Phenopacket with present + excluded phenotypic features (Req 2.4),
//   - a pedigree consistent with the case's family structure and inheritance
//     model (Req 2.6),
//   - synthetic genomic artifacts: a VCF, an annotation table, a QC summary,
//     and a candidate variant list (Req 2.7),
//   - for family-based cases: a trio/family VCF and inheritance results
//     (Req 2.8), and
//   - where the archetype requires it: CNV/SV results (structural_variant),
//     repeat-expansion results (repeat_expansion), or mitochondrial results
//     (mitochondrial) (Req 2.9).
//
// DETERMINISM: composition is a pure function of the case's `caseId`, its
// `CaseGenerationSpec`, and its `GroundTruth`. A per-case PRNG is seeded from
// the `caseId` (which itself embeds the corpus seed), so the artifacts are
// byte-for-byte reproducible from the corpus seed.
//
// GROUND_TRUTH ISOLATION: the intended causal variant(s) are DERIVED from
// Ground_Truth so that solved cases are internally consistent (the causal
// variant appears in the VCF, the annotation table, and — among decoys — the
// candidate list), but the artifacts never carry an "this is the answer" flag.
// A candidate list that includes the true positive among plausible decoys is
// exactly what a realistic pipeline emits (Req 2.7, 2.10, 30.6).

import type { GeneratedCase } from "./generator.js";
import type { CausalFinding, GroundTruth, Zygosity } from "./ground-truth.js";
import { createRng, type Rng } from "./prng.js";
import type { CaseArchetype, FamilyStructure, Sex } from "./taxonomy.js";

// ---------------------------------------------------------------------------
// FHIR R4 (minimal, valid-shaped) resource types (Req 2.3)
// ---------------------------------------------------------------------------

/** A reference to another FHIR resource, e.g. `{ reference: "Patient/p1" }`. */
export interface FhirReference {
  reference: string;
}

/** A FHIR CodeableConcept with a single coding for brevity. */
export interface FhirCodeableConcept {
  coding: { system: string; code: string; display: string }[];
  text: string;
}

/** FHIR R4 Patient resource (minimal required shape). */
export interface FhirPatient {
  resourceType: "Patient";
  id: string;
  /** FHIR administrative gender. */
  gender: "male" | "female" | "other" | "unknown";
  /** Synthetic-data marker carried as a resource extension flag. */
  syntheticIndicator: true;
}

/** FHIR R4 Encounter resource (minimal required shape). */
export interface FhirEncounter {
  resourceType: "Encounter";
  id: string;
  status: "finished";
  class: { system: string; code: string; display: string };
  subject: FhirReference;
  period: { start: string; end: string };
}

/** FHIR R4 Observation resource (minimal required shape). */
export interface FhirObservation {
  resourceType: "Observation";
  id: string;
  status: "final";
  code: FhirCodeableConcept;
  subject: FhirReference;
  encounter: FhirReference;
  effectiveDateTime: string;
  valueString: string;
}

/** FHIR R4 Condition resource (minimal required shape). */
export interface FhirCondition {
  resourceType: "Condition";
  id: string;
  clinicalStatus: FhirCodeableConcept;
  code: FhirCodeableConcept;
  subject: FhirReference;
  onsetDateTime: string;
}

/**
 * A longitudinal FHIR R4 clinical record for one case (Req 2.3). The record
 * spans at least two years between its earliest and latest clinical events;
 * {@link FhirRecord.periodStart} and {@link FhirRecord.periodEnd} report that
 * span for convenient assertion.
 */
export interface FhirRecord {
  patient: FhirPatient;
  encounters: FhirEncounter[];
  observations: FhirObservation[];
  conditions: FhirCondition[];
  /** ISO-8601 date of the earliest clinical event. */
  periodStart: string;
  /** ISO-8601 date of the latest clinical event. */
  periodEnd: string;
  /** Whole-day span between the earliest and latest events. */
  spanDays: number;
}

// ---------------------------------------------------------------------------
// GA4GH Phenopacket (well-formed shape) types (Req 2.4)
// ---------------------------------------------------------------------------

/** An ontology class reference (id + human-readable label). */
export interface OntologyClass {
  id: string;
  label: string;
}

/** A Phenopacket PhenotypicFeature: an HPO term, present unless `excluded`. */
export interface PhenotypicFeature {
  type: OntologyClass;
  /** True when the phenotype is explicitly EXCLUDED (asserted absent). */
  excluded: boolean;
}

/** Phenopacket subject sex values (GA4GH Sex enum subset). */
export type PhenopacketSex = "FEMALE" | "MALE" | "UNKNOWN_SEX";

/** A GA4GH Pedigree Person as embedded in a Phenopacket. */
export interface PhenopacketPerson {
  individualId: string;
  paternalId: string;
  maternalId: string;
  sex: PhenopacketSex;
  /** Affected status w.r.t. the case phenotype. */
  affectedStatus: "AFFECTED" | "UNAFFECTED" | "MISSING";
}

/** GA4GH Pedigree embedded in a Phenopacket (family cases). */
export interface PhenopacketPedigree {
  persons: PhenopacketPerson[];
}

/** A well-formed GA4GH Phenopacket for one case (Req 2.4). */
export interface Phenopacket {
  id: string;
  subject: {
    id: string;
    sex: PhenopacketSex;
  };
  /** Present + excluded phenotypic features (Req 2.4). */
  phenotypicFeatures: PhenotypicFeature[];
  /** Present only for family-based cases. */
  pedigree?: PhenopacketPedigree;
  metaData: {
    created: string;
    createdBy: string;
    phenopacketSchemaVersion: "2.0";
    resources: { id: string; name: string; namespacePrefix: string }[];
  };
}

// ---------------------------------------------------------------------------
// Pedigree artifact (Req 2.6)
// ---------------------------------------------------------------------------

/** A single individual in a pedigree. */
export interface PedigreeIndividual {
  id: string;
  sex: PhenopacketSex;
  /** True for the proband (index patient). */
  isProband: boolean;
  /** Affected status w.r.t. the case phenotype. */
  affected: boolean;
}

/** A directed parent -> child relationship. */
export interface PedigreeRelationship {
  parent: string;
  child: string;
}

/**
 * A pedigree definition consistent with the case's family structure and
 * inheritance model (Req 2.6). Every relationship references defined members,
 * exactly one individual is the proband, and every non-founder has both a
 * mother and a father defined.
 */
export interface PedigreeArtifact {
  familyStructure: FamilyStructure;
  probandId: string;
  individuals: PedigreeIndividual[];
  relationships: PedigreeRelationship[];
}

// ---------------------------------------------------------------------------
// Genomic artifacts (Req 2.7, 2.8, 2.9)
// ---------------------------------------------------------------------------

/** A single VCF genotype call for one sample at one record. */
export interface VcfGenotype {
  sampleId: string;
  /** VCF GT field, e.g. "0/1", "1/1", "0/0", "1". */
  gt: string;
}

/** A single VCF record (one variant line). */
export interface VcfRecord {
  chrom: string;
  pos: number;
  id: string;
  ref: string;
  alt: string;
  qual: number;
  filter: "PASS" | "LowQual";
  info: string;
  genotypes: VcfGenotype[];
}

/** A synthetic VCF (single-sample or trio/family). */
export interface VcfArtifact {
  fileName: string;
  /** Sample ids in column order (proband first). */
  samples: string[];
  /** True when the VCF carries multiple family samples (Req 2.8). */
  isFamilyVcf: boolean;
  records: VcfRecord[];
  /** Rendered VCF text (header + records). */
  text: string;
}

/** A single annotation-table row (one per VCF variant). */
export interface AnnotationRow {
  variantId: string;
  gene: string;
  consequence: string;
  /** Synthetic population allele frequency in [0, 1]. */
  alleleFrequency: number;
  /** ClinVar-style classification label (synthetic). */
  clinicalSignificance: string;
  transcript: string;
}

/** The annotation table for a case (Req 2.7). */
export interface AnnotationTable {
  fileName: string;
  rows: AnnotationRow[];
}

/** A QC summary for a case's sequencing (Req 2.7). */
export interface QcSummary {
  fileName: string;
  meanCoverage: number;
  pctBasesAbove20x: number;
  contaminationEstimate: number;
  tiTvRatio: number;
  totalVariants: number;
  passVariants: number;
  overallPass: boolean;
}

/** A single candidate variant on the review list. */
export interface CandidateVariant {
  variantId: string;
  gene: string;
  /** Synthetic 0-100 priority score used only for ordering the list. */
  priorityScore: number;
  consequence: string;
  clinicalSignificance: string;
}

/** The candidate variant list for a case (Req 2.7). */
export interface CandidateVariantList {
  fileName: string;
  candidates: CandidateVariant[];
}

/** Per-variant inheritance/segregation result (family cases, Req 2.8). */
export interface InheritanceResult {
  variantId: string;
  /** Segregation pattern derived from the pedigree and inheritance model. */
  segregation: string;
  /** True when the observed genotypes are consistent with the model. */
  consistentWithModel: boolean;
}

/** Inheritance results for a family-based case (Req 2.8). */
export interface InheritanceResults {
  fileName: string;
  results: InheritanceResult[];
}

/** A single CNV/SV call (Req 2.9, structural_variant archetype). */
export interface CnvSvCall {
  id: string;
  type: "DEL" | "DUP" | "INV" | "INS";
  chrom: string;
  start: number;
  end: number;
  copyNumber: number;
  gene: string;
  classification: string;
}

/** CNV/SV results (Req 2.9). */
export interface CnvSvResults {
  fileName: string;
  calls: CnvSvCall[];
}

/** A single repeat-expansion locus result (Req 2.9, repeat_expansion). */
export interface RepeatExpansionCall {
  locus: string;
  gene: string;
  motif: string;
  repeatCount: number;
  normalMax: number;
  pathogenicMin: number;
  classification: "normal" | "intermediate" | "expanded";
}

/** Repeat-expansion results (Req 2.9). */
export interface RepeatExpansionResults {
  fileName: string;
  calls: RepeatExpansionCall[];
}

/** A single mitochondrial variant result (Req 2.9, mitochondrial). */
export interface MitochondrialCall {
  variantId: string;
  gene: string;
  /** Heteroplasmy fraction in [0, 1]. */
  heteroplasmy: number;
  classification: string;
}

/** Mitochondrial results (Req 2.9). */
export interface MitochondrialResults {
  fileName: string;
  calls: MitochondrialCall[];
}

/**
 * The full typed bundle of per-case artifacts (Req 2.3, 2.4, 2.6-2.9).
 * Conditional artifacts (`inheritanceResults`, `cnvSvResults`,
 * `repeatExpansionResults`, `mitochondrialResults`) are present only when the
 * case's family structure or archetype requires them.
 */
export interface CaseArtifacts {
  caseId: string;
  fhir: FhirRecord;
  phenopacket: Phenopacket;
  pedigree: PedigreeArtifact;
  vcf: VcfArtifact;
  annotation: AnnotationTable;
  qc: QcSummary;
  candidates: CandidateVariantList;
  /** Present when the case is family-based (Req 2.8). */
  inheritanceResults?: InheritanceResults;
  /** Present when the archetype is `structural_variant` (Req 2.9). */
  cnvSvResults?: CnvSvResults;
  /** Present when the archetype is `repeat_expansion` (Req 2.9). */
  repeatExpansionResults?: RepeatExpansionResults;
  /** Present when the archetype is `mitochondrial` (Req 2.9). */
  mitochondrialResults?: MitochondrialResults;
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Fixed base date for FHIR clinical events (kept off the wall clock). */
const FHIR_BASE_MS = Date.UTC(2018, 0, 15, 0, 0, 0, 0);

/** Fixed instant recorded as the Phenopacket creation time. */
const PHENOPACKET_CREATED = "2020-01-01T00:00:00.000Z";

const ONE_DAY_MS = 86_400_000;

/**
 * FNV-1a 32-bit hash of a string, used to seed the per-case PRNG from the
 * `caseId` so composition is deterministic yet varies per case.
 */
function seedFromString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** ISO date-time offset from the FHIR base instant by whole days. */
function fhirDate(dayOffset: number): string {
  return new Date(FHIR_BASE_MS + dayOffset * ONE_DAY_MS).toISOString();
}

/** Map an internal `Sex` to a FHIR administrative gender. */
function fhirGender(sex: Sex): FhirPatient["gender"] {
  switch (sex) {
    case "female":
      return "female";
    case "male":
      return "male";
    case "unknown":
      return "unknown";
    default: {
      const _exhaustive: never = sex;
      return _exhaustive;
    }
  }
}

/** Map an internal `Sex` to a GA4GH Phenopacket sex. */
function phenopacketSex(sex: Sex): PhenopacketSex {
  switch (sex) {
    case "female":
      return "FEMALE";
    case "male":
      return "MALE";
    case "unknown":
      return "UNKNOWN_SEX";
    default: {
      const _exhaustive: never = sex;
      return _exhaustive;
    }
  }
}

/** Number of members implied by a family structure (incl. the proband). */
function familyMemberIds(
  familyStructure: FamilyStructure,
  probandId: string
): {
  proband: string;
  mother?: string;
  father?: string;
  sibling?: string;
  maternalGrandmother?: string;
  maternalGrandfather?: string;
} {
  switch (familyStructure) {
    case "single_patient":
      return { proband: probandId };
    case "trio":
      return {
        proband: probandId,
        mother: `${probandId}-mother`,
        father: `${probandId}-father`
      };
    case "quad":
      return {
        proband: probandId,
        mother: `${probandId}-mother`,
        father: `${probandId}-father`,
        sibling: `${probandId}-sibling`
      };
    case "extended_family":
      return {
        proband: probandId,
        mother: `${probandId}-mother`,
        father: `${probandId}-father`,
        maternalGrandmother: `${probandId}-mgmother`,
        maternalGrandfather: `${probandId}-mgfather`
      };
    default: {
      const _exhaustive: never = familyStructure;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// FHIR R4 record (Req 2.3)
// ---------------------------------------------------------------------------

/** Synthetic observation vocabulary keyed loosely by clinical area token. */
const OBSERVATION_CODES: readonly { code: string; display: string }[] = [
  { code: "SYN-OBS-0001", display: "Synthetic clinical finding A" },
  { code: "SYN-OBS-0002", display: "Synthetic clinical finding B" },
  { code: "SYN-OBS-0003", display: "Synthetic laboratory result" },
  { code: "SYN-OBS-0004", display: "Synthetic imaging observation" },
  { code: "SYN-OBS-0005", display: "Synthetic developmental milestone" }
];

/**
 * Build a longitudinal FHIR R4 record spanning at least two years (Req 2.3).
 *
 * Encounters are placed on strictly increasing day offsets whose final value
 * always exceeds 730 days, so the earliest-to-latest span is guaranteed to be
 * >= 2 years regardless of the seeded jitter.
 */
function buildFhirRecord(
  generated: GeneratedCase,
  groundTruth: GroundTruth,
  rng: Rng
): FhirRecord {
  const caseId = generated.case.caseId;
  const patientResourceId = `${caseId}-fhir-patient`;
  const patient: FhirPatient = {
    resourceType: "Patient",
    id: patientResourceId,
    gender: fhirGender(generated.spec.sex),
    syntheticIndicator: true
  };

  // 6-9 encounters spaced ~170 days apart guarantees the last offset exceeds
  // 730 days (6 encounters => >= 5 * 170 = 850 days) (Req 2.3).
  const encounterCount = 6 + rng.int(4);
  const spacing = 170;

  const encounters: FhirEncounter[] = [];
  const observations: FhirObservation[] = [];
  const dayOffsets: number[] = [];

  for (let i = 0; i < encounterCount; i++) {
    // First encounter anchors the timeline at day 0; later ones add jitter
    // strictly smaller than the spacing so ordering is preserved.
    const jitter = i === 0 ? 0 : rng.int(30);
    const dayOffset = i * spacing + jitter;
    dayOffsets.push(dayOffset);

    const start = fhirDate(dayOffset);
    const encounterId = `${caseId}-enc-${String(i + 1).padStart(2, "0")}`;
    encounters.push({
      resourceType: "Encounter",
      id: encounterId,
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: "AMB",
        display: "ambulatory"
      },
      subject: { reference: `Patient/${patientResourceId}` },
      period: { start, end: start }
    });

    // 1-2 observations per encounter.
    const obsPerEncounter = 1 + rng.int(2);
    for (let k = 0; k < obsPerEncounter; k++) {
      const vocab = rng.pick(OBSERVATION_CODES);
      const obsId = `${encounterId}-obs-${k + 1}`;
      observations.push({
        resourceType: "Observation",
        id: obsId,
        status: "final",
        code: {
          coding: [
            {
              system: "https://synthetic.udn.example/observation",
              code: vocab.code,
              display: vocab.display
            }
          ],
          text: vocab.display
        },
        subject: { reference: `Patient/${patientResourceId}` },
        encounter: { reference: `Encounter/${encounterId}` },
        effectiveDateTime: start,
        valueString: `synthetic-value-${rng.int(1000)}`
      });
    }
  }

  const firstOffset = dayOffsets[0] ?? 0;
  const lastOffset = dayOffsets[dayOffsets.length - 1] ?? firstOffset;

  // A presenting Condition at the first encounter; solved cases additionally
  // carry a diagnostic Condition near the end of the record.
  const conditions: FhirCondition[] = [
    {
      resourceType: "Condition",
      id: `${caseId}-cond-presenting`,
      clinicalStatus: {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/condition-clinical",
            code: "active",
            display: "Active"
          }
        ],
        text: "Active"
      },
      code: {
        coding: [
          {
            system: "https://synthetic.udn.example/condition",
            code: `SYN-COND-${generated.spec.clinicalArea.toUpperCase()}`,
            display: `Synthetic ${generated.spec.clinicalArea} presentation`
          }
        ],
        text: `Synthetic ${generated.spec.clinicalArea} presentation`
      },
      subject: { reference: `Patient/${patientResourceId}` },
      onsetDateTime: fhirDate(firstOffset)
    }
  ];

  if (groundTruth.causalFindings.length > 0) {
    const finding = groundTruth.causalFindings[0]!;
    conditions.push({
      resourceType: "Condition",
      id: `${caseId}-cond-diagnostic`,
      clinicalStatus: {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/condition-clinical",
            code: "active",
            display: "Active"
          }
        ],
        text: "Active"
      },
      code: {
        coding: [
          {
            system: "https://synthetic.udn.example/condition",
            code: `SYN-DX-${finding.gene}`,
            display: `Synthetic candidate condition linked to ${finding.gene}`
          }
        ],
        text: `Synthetic candidate condition linked to ${finding.gene}`
      },
      subject: { reference: `Patient/${patientResourceId}` },
      onsetDateTime: fhirDate(lastOffset)
    });
  }

  return {
    patient,
    encounters,
    observations,
    conditions,
    periodStart: fhirDate(firstOffset),
    periodEnd: fhirDate(lastOffset),
    spanDays: lastOffset - firstOffset
  };
}

// ---------------------------------------------------------------------------
// Pedigree (Req 2.6)
// ---------------------------------------------------------------------------

/** Whether the transmitting parent is affected under an inheritance model. */
function parentAffected(
  archetype: CaseArchetype,
  inheritance: string
): { motherAffected: boolean; fatherAffected: boolean } {
  switch (inheritance) {
    case "autosomal_dominant":
      // A single transmitting parent is affected (choose the mother).
      return { motherAffected: true, fatherAffected: false };
    case "mitochondrial":
      // Maternal transmission: the mother (maternal line) is affected.
      return { motherAffected: true, fatherAffected: false };
    default:
      // Recessive, X-linked (carrier mother, unaffected), sporadic, uncertain:
      // parents are not clinically affected. Mosaic is post-zygotic in the
      // proband, so parents are unaffected as well.
      void archetype;
      return { motherAffected: false, fatherAffected: false };
  }
}

/** Build a pedigree consistent with family structure + inheritance (Req 2.6). */
function buildPedigree(generated: GeneratedCase): PedigreeArtifact {
  const caseId = generated.case.caseId;
  const probandId = `${caseId}-proband`;
  const { familyStructure, sex, inheritanceModel, archetype } = generated.spec;
  const ids = familyMemberIds(familyStructure, probandId);

  const { motherAffected, fatherAffected } = parentAffected(
    archetype as CaseArchetype,
    inheritanceModel
  );

  const individuals: PedigreeIndividual[] = [
    {
      id: probandId,
      sex: phenopacketSex(sex),
      isProband: true,
      affected: true
    }
  ];
  const relationships: PedigreeRelationship[] = [];

  if (ids.mother && ids.father) {
    individuals.push(
      {
        id: ids.mother,
        sex: "FEMALE",
        isProband: false,
        affected: motherAffected
      },
      {
        id: ids.father,
        sex: "MALE",
        isProband: false,
        affected: fatherAffected
      }
    );
    relationships.push(
      { parent: ids.mother, child: probandId },
      { parent: ids.father, child: probandId }
    );
  }

  if (ids.sibling && ids.mother && ids.father) {
    individuals.push({
      id: ids.sibling,
      sex: "UNKNOWN_SEX",
      isProband: false,
      affected: false
    });
    relationships.push(
      { parent: ids.mother, child: ids.sibling },
      { parent: ids.father, child: ids.sibling }
    );
  }

  if (ids.maternalGrandmother && ids.maternalGrandfather && ids.mother) {
    // For mitochondrial inheritance the maternal grandmother is on the
    // affected maternal line.
    const mgmAffected = inheritanceModel === "mitochondrial";
    individuals.push(
      {
        id: ids.maternalGrandmother,
        sex: "FEMALE",
        isProband: false,
        affected: mgmAffected
      },
      {
        id: ids.maternalGrandfather,
        sex: "MALE",
        isProband: false,
        affected: false
      }
    );
    relationships.push(
      { parent: ids.maternalGrandmother, child: ids.mother },
      { parent: ids.maternalGrandfather, child: ids.mother }
    );
  }

  return { familyStructure, probandId, individuals, relationships };
}

// ---------------------------------------------------------------------------
// Phenopacket (Req 2.4)
// ---------------------------------------------------------------------------

/** Build the GA4GH Phenopacket for a case (present + excluded features). */
function buildPhenopacket(
  generated: GeneratedCase,
  groundTruth: GroundTruth,
  pedigree: PedigreeArtifact,
  rng: Rng
): Phenopacket {
  const caseId = generated.case.caseId;
  const subjectId = `${caseId}-subject`;

  // Present features: the case's expected phenotypes (always >= 2).
  const present: PhenotypicFeature[] = groundTruth.expectedPhenotypes.map(
    (hpoId, i) => ({
      type: { id: hpoId, label: `Synthetic phenotype ${i + 1}` },
      excluded: false
    })
  );

  // Excluded features: 1-3 synthetic terms explicitly asserted absent, drawn
  // from a decoy pool disjoint from the present set (Req 2.4).
  const excludedCount = 1 + rng.int(3);
  const areaToken = generated.spec.clinicalArea
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-");
  const excluded: PhenotypicFeature[] = [];
  for (let i = 1; i <= excludedCount; i++) {
    excluded.push({
      type: {
        id: `SYN-HP-EXCL-${areaToken}-${i}`,
        label: `Synthetic excluded phenotype ${i}`
      },
      excluded: true
    });
  }

  const phenopacket: Phenopacket = {
    id: `${caseId}-phenopacket`,
    subject: { id: subjectId, sex: phenopacketSex(generated.spec.sex) },
    phenotypicFeatures: [...present, ...excluded],
    metaData: {
      created: PHENOPACKET_CREATED,
      createdBy: "synthetic-case-generator",
      phenopacketSchemaVersion: "2.0",
      resources: [
        {
          id: "hp",
          name: "Synthetic Human Phenotype Ontology (synthetic)",
          namespacePrefix: "SYN-HP"
        }
      ]
    }
  };

  // Family cases embed a GA4GH pedigree derived from the pedigree artifact.
  if (generated.spec.familyBased) {
    const idMap = new Map<string, string>();
    for (const individual of pedigree.individuals) {
      idMap.set(individual.id, individual.id);
    }
    const persons: PhenopacketPerson[] = pedigree.individuals.map(
      (individual) => {
        const parents = pedigree.relationships.filter(
          (rel) => rel.child === individual.id
        );
        let paternalId = "0";
        let maternalId = "0";
        for (const rel of parents) {
          const parent = pedigree.individuals.find(
            (person) => person.id === rel.parent
          );
          if (parent?.sex === "MALE") {
            paternalId = parent.id;
          } else if (parent?.sex === "FEMALE") {
            maternalId = parent.id;
          }
        }
        return {
          individualId: individual.id,
          paternalId,
          maternalId,
          sex: individual.sex,
          affectedStatus: individual.affected ? "AFFECTED" : "UNAFFECTED"
        };
      }
    );
    phenopacket.pedigree = { persons };
  }

  return phenopacket;
}

// ---------------------------------------------------------------------------
// Genomic artifacts (Req 2.7, 2.8)
// ---------------------------------------------------------------------------

/** Contig chosen for a variant, respecting inheritance where it matters. */
function contigForFinding(finding: CausalFinding, rng: Rng): string {
  if (finding.inheritanceModel === "x_linked") {
    return "chrX";
  }
  if (finding.inheritanceModel === "mitochondrial") {
    return "chrM";
  }
  return `chr${1 + rng.int(22)}`;
}

/** Proband genotype string for a causal finding given its zygosity. */
function probandGenotype(zygosity: Zygosity): string {
  switch (zygosity) {
    case "homozygous":
      return "1/1";
    case "heterozygous":
      return "0/1";
    case "hemizygous":
      return "1";
    case "homoplasmic":
      return "1/1";
    case "mosaic":
      return "0/1";
    case "unknown":
      return "0/1";
    default: {
      const _exhaustive: never = zygosity;
      return _exhaustive;
    }
  }
}

/** Parent genotypes for a causal finding consistent with the model. */
function parentGenotypes(finding: CausalFinding): {
  mother: string;
  father: string;
} {
  switch (finding.inheritanceModel) {
    case "autosomal_recessive":
      // Both parents are unaffected carriers.
      return { mother: "0/1", father: "0/1" };
    case "autosomal_dominant":
      // The transmitting parent (mother, per the pedigree) carries it.
      return { mother: "0/1", father: "0/0" };
    case "x_linked":
      // Carrier mother, unaffected father.
      return { mother: "0/1", father: "0/0" };
    case "mitochondrial":
      // Maternal transmission.
      return { mother: "1/1", father: "0/0" };
    case "sporadic":
    case "uncertain":
      // De novo: neither parent carries the variant.
      return { mother: "0/0", father: "0/0" };
    default: {
      const _exhaustive: never = finding.inheritanceModel;
      return _exhaustive;
    }
  }
}

/** Segregation label for a family case derived from the inheritance model. */
function segregationLabel(finding: CausalFinding): string {
  if (finding.zygosity === "mosaic") {
    return "de_novo_mosaic";
  }
  switch (finding.inheritanceModel) {
    case "autosomal_recessive":
      return "biparental_recessive";
    case "autosomal_dominant":
      return "inherited_dominant";
    case "x_linked":
      return "x_linked_maternal";
    case "mitochondrial":
      return "maternal_mitochondrial";
    case "sporadic":
    case "uncertain":
      return "de_novo";
    default: {
      const _exhaustive: never = finding.inheritanceModel;
      return _exhaustive;
    }
  }
}

const REF_BASES = ["A", "C", "G", "T"] as const;
const CONSEQUENCES = [
  "missense_variant",
  "stop_gained",
  "frameshift_variant",
  "splice_donor_variant",
  "synonymous_variant"
] as const;

interface BuiltVariant {
  record: VcfRecord;
  gene: string;
  consequence: string;
  clinicalSignificance: string;
  alleleFrequency: number;
  transcript: string;
  causal: boolean;
}

/**
 * Build the VCF plus the shared per-variant metadata used to derive the
 * annotation table and candidate list. Family cases produce genotype columns
 * for the proband and parents (Req 2.7, 2.8).
 */
function buildVariants(
  generated: GeneratedCase,
  groundTruth: GroundTruth,
  familySamples: string[],
  rng: Rng
): BuiltVariant[] {
  const probandSample = familySamples[0]!;
  const motherSample = familySamples[1];
  const fatherSample = familySamples[2];
  const built: BuiltVariant[] = [];

  // Causal variants derived from Ground_Truth (Req 2.7 internal consistency).
  for (const finding of groundTruth.causalFindings) {
    const chrom = contigForFinding(finding, rng);
    const pos = 1_000_000 + rng.int(9_000_000);
    const ref = rng.pick(REF_BASES);
    let alt = rng.pick(REF_BASES);
    while (alt === ref) {
      alt = rng.pick(REF_BASES);
    }
    const genotypes: VcfGenotype[] = [
      { sampleId: probandSample, gt: probandGenotype(finding.zygosity) }
    ];
    if (motherSample && fatherSample) {
      const parents = parentGenotypes(finding);
      genotypes.push(
        { sampleId: motherSample, gt: parents.mother },
        { sampleId: fatherSample, gt: parents.father }
      );
    }
    built.push({
      record: {
        chrom,
        pos,
        id: finding.variantId,
        ref,
        alt,
        qual: 200 + rng.int(600),
        filter: "PASS",
        info: `GENE=${finding.gene};ZYG=${finding.zygosity}`,
        genotypes
      },
      gene: finding.gene,
      consequence: rng.pick(CONSEQUENCES.slice(0, 4)),
      clinicalSignificance: "uncertain_significance",
      alleleFrequency: Number((rng.int(50) / 100000).toFixed(6)),
      transcript: `SYN-TX-${finding.gene}`,
      causal: true
    });
  }

  // Decoy variants: 4-6 benign/common calls the review must sift through.
  const decoyCount = 4 + rng.int(3);
  for (let i = 0; i < decoyCount; i++) {
    const chrom = `chr${1 + rng.int(22)}`;
    const pos = 1_000_000 + rng.int(9_000_000);
    const ref = rng.pick(REF_BASES);
    let alt = rng.pick(REF_BASES);
    while (alt === ref) {
      alt = rng.pick(REF_BASES);
    }
    const genotypes: VcfGenotype[] = [{ sampleId: probandSample, gt: "0/1" }];
    if (motherSample && fatherSample) {
      genotypes.push(
        { sampleId: motherSample, gt: rng.pick(["0/0", "0/1"]) },
        { sampleId: fatherSample, gt: rng.pick(["0/0", "0/1"]) }
      );
    }
    const gene = `SYNGENE-DECOY-${i + 1}`;
    built.push({
      record: {
        chrom,
        pos,
        id: `syn-decoy-${generated.case.caseId}-${i + 1}`,
        ref,
        alt,
        qual: 50 + rng.int(400),
        filter: rng.next() < 0.85 ? "PASS" : "LowQual",
        info: `GENE=${gene}`,
        genotypes
      },
      gene,
      consequence: rng.pick(CONSEQUENCES),
      clinicalSignificance: rng.pick([
        "benign",
        "likely_benign",
        "uncertain_significance"
      ]),
      alleleFrequency: Number((0.01 + rng.int(2000) / 10000).toFixed(6)),
      transcript: `SYN-TX-${gene}`,
      causal: false
    });
  }

  return built;
}

/** Render a structured VCF into minimal valid-shaped VCF text. */
function renderVcfText(samples: string[], records: VcfRecord[]): string {
  const lines: string[] = [];
  lines.push("##fileformat=VCFv4.2");
  lines.push("##source=synthetic-case-generator");
  lines.push('##INFO=<ID=GENE,Number=1,Type=String,Description="Synthetic gene">');
  lines.push('##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">');
  lines.push(
    `#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${samples.join("\t")}`
  );
  for (const record of records) {
    const gtBySample = new Map<string, string>();
    for (const gt of record.genotypes) {
      gtBySample.set(gt.sampleId, gt.gt);
    }
    const sampleCols = samples.map((sample) => gtBySample.get(sample) ?? "./.");
    lines.push(
      [
        record.chrom,
        String(record.pos),
        record.id,
        record.ref,
        record.alt,
        String(record.qual),
        record.filter,
        record.info,
        "GT",
        ...sampleCols
      ].join("\t")
    );
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Archetype-specific artifacts (Req 2.9)
// ---------------------------------------------------------------------------

function buildCnvSvResults(
  generated: GeneratedCase,
  groundTruth: GroundTruth,
  rng: Rng
): CnvSvResults {
  const gene = groundTruth.causalFindings[0]?.gene ?? "SYNGENE-SV-1";
  const start = 1_000_000 + rng.int(5_000_000);
  const length = 10_000 + rng.int(500_000);
  const type = rng.pick(["DEL", "DUP", "INV", "INS"] as const);
  return {
    fileName: `cnv-sv/${generated.case.caseId}/cnv_sv_results.json`,
    calls: [
      {
        id: `syn-sv-${generated.case.caseId}-1`,
        type,
        chrom: `chr${1 + rng.int(22)}`,
        start,
        end: start + length,
        copyNumber: type === "DEL" ? 1 : type === "DUP" ? 3 : 2,
        gene,
        classification: "likely_pathogenic"
      }
    ]
  };
}

function buildRepeatExpansionResults(
  generated: GeneratedCase,
  groundTruth: GroundTruth,
  rng: Rng
): RepeatExpansionResults {
  const gene = groundTruth.causalFindings[0]?.gene ?? "SYNGENE-REPEAT-1";
  const normalMax = 30 + rng.int(10);
  const pathogenicMin = normalMax + 20 + rng.int(30);
  const repeatCount = pathogenicMin + 5 + rng.int(80);
  const motif = rng.pick(["CAG", "CTG", "GAA", "CGG", "GCN"]);
  return {
    fileName: `repeat/${generated.case.caseId}/repeat_expansion_results.json`,
    calls: [
      {
        locus: `SYN-REPEAT-${gene}`,
        gene,
        motif,
        repeatCount,
        normalMax,
        pathogenicMin,
        classification: "expanded"
      }
    ]
  };
}

function buildMitochondrialResults(
  generated: GeneratedCase,
  groundTruth: GroundTruth,
  rng: Rng
): MitochondrialResults {
  const finding = groundTruth.causalFindings[0];
  const gene = finding?.gene ?? "SYNGENE-MT-1";
  const variantId = finding?.variantId ?? `syn-mt-${generated.case.caseId}-1`;
  return {
    fileName: `mito/${generated.case.caseId}/mitochondrial_results.json`,
    calls: [
      {
        variantId,
        gene,
        heteroplasmy: Number((0.4 + rng.int(60) / 100).toFixed(2)),
        classification: "likely_pathogenic"
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// Public API (Req 2.3, 2.4, 2.6-2.9)
// ---------------------------------------------------------------------------

/**
 * Deterministically compose the full artifact bundle for one case from its
 * `GeneratedCase` and hidden `GroundTruth` (Req 2.3, 2.4, 2.6-2.9).
 *
 * Deterministic in its inputs: the same `(generatedCase, groundTruth)` pair
 * always yields a deeply-equal bundle, because the per-case PRNG is seeded from
 * the `caseId` (which embeds the corpus seed).
 */
export function composeCaseArtifacts(
  generated: GeneratedCase,
  groundTruth: GroundTruth
): CaseArtifacts {
  const caseId = generated.case.caseId;
  const rng = createRng(seedFromString(caseId));

  const fhir = buildFhirRecord(generated, groundTruth, rng);
  const pedigree = buildPedigree(generated);
  const phenopacket = buildPhenopacket(generated, groundTruth, pedigree, rng);

  // Sample columns: proband first, then parents for family-based cases.
  const probandSample = `${caseId}-proband`;
  const familySamples: string[] = [probandSample];
  if (generated.spec.familyBased) {
    familySamples.push(`${caseId}-mother`, `${caseId}-father`);
  }

  const built = buildVariants(generated, groundTruth, familySamples, rng);
  const records = built.map((variant) => variant.record);

  const vcf: VcfArtifact = {
    fileName: `vcf/${caseId}/${
      generated.spec.familyBased ? "family" : "proband"
    }.vcf`,
    samples: familySamples,
    isFamilyVcf: generated.spec.familyBased,
    records,
    text: renderVcfText(familySamples, records)
  };

  const annotation: AnnotationTable = {
    fileName: `annotation/${caseId}/annotations.tsv`,
    rows: built.map((variant) => ({
      variantId: variant.record.id,
      gene: variant.gene,
      consequence: variant.consequence,
      alleleFrequency: variant.alleleFrequency,
      clinicalSignificance: variant.clinicalSignificance,
      transcript: variant.transcript
    }))
  };

  const passVariants = records.filter((r) => r.filter === "PASS").length;
  const qc: QcSummary = {
    fileName: `qc/${caseId}/qc_summary.json`,
    meanCoverage: 80 + rng.int(60),
    pctBasesAbove20x: Number((0.9 + rng.int(90) / 1000).toFixed(3)),
    contaminationEstimate: Number((rng.int(30) / 1000).toFixed(3)),
    tiTvRatio: Number((1.9 + rng.int(30) / 100).toFixed(2)),
    totalVariants: records.length,
    passVariants,
    overallPass: true
  };

  // Candidate list: causal variants (where present) plus a couple of decoys,
  // ordered by a synthetic priority score. The causal variant appears among
  // realistic decoys but is NOT flagged as the answer (Req 2.7, 2.10).
  const candidateSource = built.filter(
    (variant) => variant.causal || variant.record.filter === "PASS"
  );
  const candidates: CandidateVariant[] = candidateSource
    .map((variant) => ({
      variantId: variant.record.id,
      gene: variant.gene,
      priorityScore: variant.causal ? 70 + rng.int(30) : rng.int(70),
      consequence: variant.consequence,
      clinicalSignificance: variant.clinicalSignificance
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const artifacts: CaseArtifacts = {
    caseId,
    fhir,
    phenopacket,
    pedigree,
    vcf,
    annotation,
    qc,
    candidates: {
      fileName: `candidates/${caseId}/candidate_variants.json`,
      candidates
    }
  };

  // Family cases additionally carry inheritance/segregation results (Req 2.8).
  if (generated.spec.familyBased) {
    const causal = groundTruth.causalFindings;
    const results: InheritanceResult[] =
      causal.length > 0
        ? causal.map((finding) => ({
            variantId: finding.variantId,
            segregation: segregationLabel(finding),
            consistentWithModel: true
          }))
        : [
            {
              // Unsolved/non-genetic family cases still emit a (negative)
              // inheritance result over the candidate set.
              variantId: records[0]?.id ?? `syn-none-${caseId}`,
              segregation: "no_segregating_candidate",
              consistentWithModel: false
            }
          ];
    artifacts.inheritanceResults = {
      fileName: `inheritance/${caseId}/inheritance_results.json`,
      results
    };
  }

  // Archetype-specific results (Req 2.9).
  switch (generated.spec.archetype) {
    case "structural_variant":
      artifacts.cnvSvResults = buildCnvSvResults(generated, groundTruth, rng);
      break;
    case "repeat_expansion":
      artifacts.repeatExpansionResults = buildRepeatExpansionResults(
        generated,
        groundTruth,
        rng
      );
      break;
    case "mitochondrial":
      artifacts.mitochondrialResults = buildMitochondrialResults(
        generated,
        groundTruth,
        rng
      );
      break;
    default:
      break;
  }

  return artifacts;
}
