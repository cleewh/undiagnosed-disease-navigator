/**
 * Canonical per-artifact-type S3 prefixes for the case-artifacts bucket.
 *
 * Requirement 26.8: each artifact type is stored under a separate, dedicated
 * S3 prefix. This module is the single source of truth for those prefixes so
 * that both infrastructure (bucket organisation, lifecycle/policies) and the
 * application layer (object-key construction) agree on the layout described in
 * design.md ("S3 Object Layout").
 */

/** The distinct artifact types that the Navigator persists as S3 objects. */
export type ArtifactType =
  | "fhir"
  | "phenopacket"
  | "pedigree"
  | "vcf"
  | "annotation"
  | "qc"
  | "candidates"
  | "cnv-sv"
  | "repeat"
  | "mito"
  | "precomputed";

/**
 * Maps each artifact type to its dedicated top-level prefix within the
 * case-artifacts bucket. Prefixes are mutually exclusive and stable.
 */
export const ARTIFACT_PREFIXES: Readonly<Record<ArtifactType, string>> = {
  fhir: "fhir/",
  phenopacket: "phenopacket/",
  pedigree: "pedigree/",
  vcf: "vcf/",
  annotation: "annotation/",
  qc: "qc/",
  candidates: "candidates/",
  "cnv-sv": "cnv-sv/",
  repeat: "repeat/",
  mito: "mito/",
  precomputed: "precomputed/",
};

/** All artifact types, in a stable order. */
export const ARTIFACT_TYPES: readonly ArtifactType[] = Object.keys(
  ARTIFACT_PREFIXES,
) as ArtifactType[];

/** The dedicated prefix for the isolated Ground_Truth bucket (Requirement 2.10). */
export const GROUND_TRUTH_PREFIX = "ground-truth/";

/**
 * Builds the canonical object key for an artifact of the given type belonging
 * to a specific case. Guarantees the object lands under exactly the dedicated
 * prefix for its type (Requirement 26.8).
 *
 * @param type   The artifact type.
 * @param caseId The owning case identifier.
 * @param name   Optional object name/suffix within the case folder.
 */
export function artifactKey(
  type: ArtifactType,
  caseId: string,
  name?: string,
): string {
  const trimmedCase = caseId.replace(/^\/+|\/+$/g, "");
  const base = `${ARTIFACT_PREFIXES[type]}${trimmedCase}/`;
  if (name === undefined || name === "") {
    return base;
  }
  return `${base}${name.replace(/^\/+/, "")}`;
}
