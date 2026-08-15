// services/intake/src/intake.ts
//
// The Intake_Service validation + Case-creation pipeline (Requirement 3).
//
// Given a synthetic case's ingested artifacts (FHIR clinical record, GA4GH
// Phenopacket, pedigree, and genomic artifacts), `ingestCase`:
//
//   1. validates the Phenopacket and the FHIR resources against structural
//      schema checks (Req 3.1, 2.3, 2.4, 2.5);
//   2. enforces artifact constraints — every required artifact must be present
//      and well-formed, and no artifact may exceed 50 MB (Req 3.3);
//   3. on ANY failure, rejects the case, creates NO Case record, and returns a
//      structured error list naming the failing field with expected/actual
//      values or the violated artifact constraint (Req 3.2, 3.3); and
//   4. on success, creates a Case record in the initial `intake` status,
//      retains every ingested artifact byte-for-byte unmodified, records
//      Provenance for each artifact (source id, version id, created-by,
//      ingestion timestamp), and persists the Case via the repository port
//      (Req 3.4, 3.5).
//
// The Ground_Truth access restriction (Req 3.6) is enforced through the
// `ground-truth-access` guard: when an ingested artifact references a
// Ground_Truth file, intake returns a SEALED handle instead of the raw
// reference, so only the Evaluation_Framework can open it (Req 3.6, 2.10,
// 30.6). A `groundTruthRef` seam carries the reference in unchanged.

import {
  createEnvelope,
  utcNow,
  type Case,
  type CaseDispositionStatus,
  type Envelope,
  type InheritanceModel,
  type ProvenanceRef
} from "@udn/domain";

import {
  MAX_ARTIFACT_SIZE_BYTES,
  artifactError,
  type IntakeError
} from "./errors.js";
import {
  sealGroundTruth,
  type SealedGroundTruth
} from "./ground-truth-access.js";
import { validateFhir, validatePhenopacket } from "./validation.js";

/**
 * The protected payload sealed behind the Ground_Truth guard when a case
 * references a Ground_Truth file (Req 3.6). It carries the reference and the
 * owning case id; it is only retrievable via `accessGroundTruth` with an
 * Evaluation_Framework principal.
 */
export interface GroundTruthReference {
  /** The case the Ground_Truth belongs to. */
  caseId: string;
  /** The reference to the Ground_Truth file/resource. */
  ref: string;
}

/** The initial lifecycle state a freshly ingested case enters (Req 3.4). */
export const INITIAL_INTAKE_STATUS: CaseDispositionStatus = "intake";

/** The narrow persistence surface intake depends on (Req 3.4). */
export interface CaseRepositoryPort {
  /** Persist a domain object; `SingleTableRepository.put` satisfies this. */
  put(entity: Envelope): Promise<void>;
}

/**
 * The kind of an ingested artifact. `fhir` and `phenopacket` additionally
 * undergo schema validation; every kind is size-checked and retained.
 */
export type ArtifactKind =
  | "fhir"
  | "phenopacket"
  | "pedigree"
  | "vcf"
  | "annotation"
  | "qc"
  | "candidates"
  | "inheritance"
  | "cnv_sv"
  | "repeat_expansion"
  | "mitochondrial";

/**
 * The artifact kinds every case MUST carry on intake (Req 2.3, 2.4, 2.6, 2.7).
 * Conditional artifacts (inheritance/CNV-SV/repeat/mitochondrial) are retained
 * when present but are not required by intake.
 */
export const REQUIRED_ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "fhir",
  "phenopacket",
  "pedigree",
  "vcf",
  "annotation",
  "qc",
  "candidates"
];

/**
 * A single ingested artifact together with the provenance inputs the workflow
 * must record for it (Req 3.5). `content` is retained unmodified; `sizeBytes`
 * may be supplied for artifacts backed by external files, otherwise the size
 * is derived from the serialized content.
 */
export interface IngestArtifact {
  /** Stable name of the artifact, e.g. "phenopacket", "vcf". */
  name: string;
  /** Artifact kind, controlling validation and required-set membership. */
  kind: ArtifactKind;
  /** The artifact payload, retained byte-for-byte unmodified (Req 3.4). */
  content: unknown;
  /** Optional explicit size in bytes (e.g. for file-backed artifacts). */
  sizeBytes?: number;
  /** Originating source object identifier (Req 3.5). */
  sourceId: string;
  /** Version identifier of the source (Req 3.5). */
  versionId: string;
  /** Actor id that produced the artifact (Req 3.5). */
  createdById: string;
}

/** Metadata used to populate the created Case record (Req 3.4). */
export interface IntakeCaseMetadata {
  clinicalArea: string;
  archetype: string;
  inheritanceModel: InheritanceModel;
  familyBased: boolean;
}

/** Input to {@link ingestCase}. */
export interface IngestCaseInput {
  /** Identifier of the case being ingested. */
  caseId: string;
  /** Case-level metadata for the created Case record. */
  caseMetadata: IntakeCaseMetadata;
  /** The ingested artifacts (order preserved on retention). */
  artifacts: IngestArtifact[];
  /** Actor id performing the ingestion; recorded as the Case creator. */
  createdById: string;
  /** Recorded origin of the case; defaults to "Intake_Service". */
  source?: string;
  /**
   * Ground_Truth reference seam. Carried through unchanged; access control is
   * enforced by a separate task (8.2 / Req 3.6), never by intake.
   */
  groundTruthRef?: string;
  /** Explicit ingestion timestamp (ISO-8601 UTC); defaults to now. */
  now?: string;
}

/**
 * An artifact retained after successful intake, unmodified, with its recorded
 * provenance (Req 3.4, 3.5).
 */
export interface RetainedArtifact {
  name: string;
  kind: ArtifactKind;
  /** The original artifact content, unmodified (Req 3.4). */
  content: unknown;
  /** Byte size used for the 50 MB constraint check. */
  sizeBytes: number;
  /** Provenance recorded for this artifact (Req 3.5). */
  provenance: ProvenanceRef;
}

/** Outcome of a successful intake (Req 3.4, 3.5). */
export interface IntakeCreated {
  status: "created";
  /** The created Case record, in the initial intake status. */
  case: Case;
  /** Every ingested artifact, retained unmodified with its provenance. */
  artifacts: RetainedArtifact[];
  /**
   * When the case references a Ground_Truth file, a SEALED handle to that
   * reference. The reference is only retrievable via `accessGroundTruth` with
   * an Evaluation_Framework principal; every other requester is denied with an
   * authorization error (Req 3.6, 2.10, 30.6). Absent when no Ground_Truth is
   * referenced.
   */
  groundTruth?: SealedGroundTruth<GroundTruthReference>;
}

/** Outcome of a rejected intake; no Case record was created (Req 3.2, 3.3). */
export interface IntakeRejected {
  status: "rejected";
  /** One or more structured validation errors. */
  errors: IntakeError[];
}

/** The result of {@link ingestCase}. */
export type IntakeResult = IntakeCreated | IntakeRejected;

/**
 * Estimate the byte size of an artifact for the 50 MB constraint (Req 3.3).
 * A caller-supplied `sizeBytes` wins (e.g. for file-backed artifacts);
 * otherwise the size is derived from the UTF-8 serialization of the content.
 * String content is measured directly; other content is measured via its JSON
 * serialization. This is deterministic and dependency-light.
 */
export function artifactSizeBytes(artifact: IngestArtifact): number {
  if (typeof artifact.sizeBytes === "number") {
    return artifact.sizeBytes;
  }
  const { content } = artifact;
  const text = typeof content === "string" ? content : JSON.stringify(content) ?? "";
  return Buffer.byteLength(text, "utf8");
}

/**
 * Validate ingested artifacts and, on success, create + persist a Case record.
 *
 * Rejection is total: if any artifact constraint (Req 3.3) or schema check
 * (Req 3.1, 3.2) fails, NO Case record is created or persisted and every
 * detected error is returned. On success the Case is created in the initial
 * `intake` status with all artifacts retained unmodified and provenance
 * recorded for each (Req 3.4, 3.5), then persisted through the repository.
 */
export async function ingestCase(
  repository: CaseRepositoryPort,
  input: IngestCaseInput
): Promise<IntakeResult> {
  const ingestedAt = input.now ?? utcNow();
  const errors: IntakeError[] = [];

  // --- Artifact constraints: presence, well-formedness, size (Req 3.3) ------
  const byKind = new Map<ArtifactKind, IngestArtifact>();
  for (const artifact of input.artifacts) {
    // Malformed: a required-shaped artifact whose content is null/undefined.
    if (artifact.content === undefined || artifact.content === null) {
      errors.push(
        artifactError(
          "artifact_malformed",
          artifact.name,
          `Artifact "${artifact.name}" is malformed: its content is ${
            artifact.content === null ? "null" : "missing"
          }.`
        )
      );
    } else if (artifactSizeBytes(artifact) > MAX_ARTIFACT_SIZE_BYTES) {
      errors.push(
        artifactError(
          "artifact_too_large",
          artifact.name,
          `Artifact "${artifact.name}" is ${artifactSizeBytes(
            artifact
          )} bytes, exceeding the ${MAX_ARTIFACT_SIZE_BYTES}-byte (50 MB) limit.`
        )
      );
    }
    // First artifact of a kind wins for the required-set / validation lookups.
    if (!byKind.has(artifact.kind)) {
      byKind.set(artifact.kind, artifact);
    }
  }

  for (const kind of REQUIRED_ARTIFACT_KINDS) {
    if (!byKind.has(kind)) {
      errors.push(
        artifactError(
          "artifact_missing",
          kind,
          `Required artifact "${kind}" is missing from the ingested case.`
        )
      );
    }
  }

  // --- Schema validation for the schema-bearing artifacts (Req 3.1, 2.3-2.5)-
  const phenopacket = byKind.get("phenopacket");
  if (phenopacket && phenopacket.content !== undefined && phenopacket.content !== null) {
    errors.push(...validatePhenopacket(phenopacket.content));
  }
  const fhir = byKind.get("fhir");
  if (fhir && fhir.content !== undefined && fhir.content !== null) {
    errors.push(...validateFhir(fhir.content));
  }

  // --- Reject: create no Case record (Req 3.2, 3.3) -------------------------
  if (errors.length > 0) {
    return { status: "rejected", errors };
  }

  // --- Success: retain artifacts + record provenance (Req 3.4, 3.5) ---------
  const retained: RetainedArtifact[] = input.artifacts.map((artifact) => ({
    name: artifact.name,
    kind: artifact.kind,
    content: artifact.content,
    sizeBytes: artifactSizeBytes(artifact),
    provenance: {
      sourceId: artifact.sourceId,
      versionId: artifact.versionId,
      createdById: artifact.createdById,
      ingestedAt
    }
  }));

  const source = input.source ?? "Intake_Service";
  const provenance: ProvenanceRef = {
    sourceId: source,
    versionId: "intake",
    createdById: input.createdById,
    ingestedAt
  };

  const envelope = createEnvelope({
    entityType: "Case",
    caseId: input.caseId,
    id: input.caseId,
    source,
    status: INITIAL_INTAKE_STATUS,
    provenance,
    accessClassification: "clinical",
    createdById: input.createdById,
    now: ingestedAt
  });

  const caseRecord: Case = {
    ...envelope,
    entityType: "Case",
    clinicalArea: input.caseMetadata.clinicalArea,
    archetype: input.caseMetadata.archetype,
    inheritanceModel: input.caseMetadata.inheritanceModel,
    familyBased: input.caseMetadata.familyBased,
    dispositionStatus: INITIAL_INTAKE_STATUS
  };

  await repository.put(caseRecord);

  const created: IntakeCreated = {
    status: "created",
    case: caseRecord,
    artifacts: retained
  };

  // A referenced Ground_Truth file is routed through the access guard: intake
  // never returns the raw reference, only a sealed handle openable solely by
  // the Evaluation_Framework (Req 3.6, 2.10, 30.6).
  if (input.groundTruthRef !== undefined) {
    created.groundTruth = sealGroundTruth<GroundTruthReference>(
      input.groundTruthRef,
      { caseId: input.caseId, ref: input.groundTruthRef }
    );
  }

  return created;
}
