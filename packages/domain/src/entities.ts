// packages/domain/src/entities.ts
//
// The typed domain model (Requirement 23.1). Every clinically relevant object
// extends the shared provenance `Envelope` (see envelope.ts) and pins its
// `entityType` discriminator to a single literal so objects are exhaustively
// distinguishable at runtime and in the type system.
//
// Field definitions follow the design's "Typed Domain Model" section. Only
// selected, illustrative fields are modelled per entity; each entity inherits
// the full envelope (unique id, UTC timestamps, created-by, source, version,
// case id, status, provenance, and access classification — Req 23.2, 23.3).
//
// NOTE: `EntityType`, `ObjectStatus`, `AccessClassification`, and
// `ProvenanceRef` are defined and exported by envelope.ts; they are imported
// here rather than redeclared to keep a single source of truth.

import type { Envelope, ProvenanceRef } from "./envelope.js";

// ---------------------------------------------------------------------------
// Shared value types and unions
// ---------------------------------------------------------------------------

/**
 * The seven system roles (design: Typed Domain Model; Req 21.1).
 */
export type UserRole =
  | "ClinicalGeneticist"
  | "Bioinformatician"
  | "GeneticCounsellor"
  | "MedicalSpecialist"
  | "Researcher"
  | "CaseCoordinator"
  | "Administrator";

/** The complete list of user roles, exported for iteration/validation. */
export const USER_ROLES: readonly UserRole[] = [
  "ClinicalGeneticist",
  "Bioinformatician",
  "GeneticCounsellor",
  "MedicalSpecialist",
  "Researcher",
  "CaseCoordinator",
  "Administrator"
];

/** Inheritance model for a case (Req 1.4). */
export type InheritanceModel =
  | "sporadic"
  | "autosomal_recessive"
  | "autosomal_dominant"
  | "x_linked"
  | "mitochondrial"
  | "uncertain";

/** Case-level disposition/status lifecycle (Req 13). */
export type CaseDispositionStatus =
  | "intake"
  | "in_review"
  | "unresolved"
  | "confirmed_diagnosis"
  | "closed_non_genetic";

/** Phenotype assertion polarity (Req 5.3). */
export type Assertion = "present" | "absent" | "uncertain" | "historical";

/** A mapping from extracted text to an HPO term with confidence in [0.00, 1.00]. */
export interface HpoMapping {
  hpoId: string;
  /** Confidence in the range 0.00–1.00. */
  confidence: number;
}

/** Phenotype-candidate review lifecycle (Req 5.6/5.7/6). */
export type PhenotypeCandidateStatus =
  | "pending_review"
  | "unresolved"
  | "approved"
  | "rejected";

/** Contradiction lifecycle (Req 7.3/7.6). */
export type ContradictionStatus = "unresolved" | "resolved";

/** Analysis-request lifecycle (Req 9). */
export type AnalysisRequestStatus =
  | "draft"
  | "workflow_selected"
  | "pending_approval"
  | "approved"
  | "rejected";

/** Analysis-run lifecycle (Req 9.8/9.9). */
export type AnalysisRunStatus = "running" | "completed" | "failed";

/** Genomic operation mode (Req 9.6/9.7). */
export type GenomicMode = "Demo_Mode" | "Workflow_Mode";

/** Hypothesis states (Req 11.4). */
export type HypothesisState =
  | "Proposed"
  | "Under Review"
  | "Supported"
  | "Refuted"
  | "Retired";

/** The complete list of hypothesis states, exported for iteration/validation. */
export const HYPOTHESIS_STATES: readonly HypothesisState[] = [
  "Proposed",
  "Under Review",
  "Supported",
  "Refuted",
  "Retired"
];

/** Task lifecycle (Req 12.4). */
export type TaskState = "open" | "done";

/** Terminal disposition for a case (Req 13.1/13.4). */
export type DispositionState =
  | "confirmed_diagnosis"
  | "closed_non_genetic"
  | "unresolved";

/** Knowledge-update processing state (Req 15). */
export type KnowledgeUpdateStatus = "pending" | "processed";

/** Outcome of gateway validation on a model invocation (Req 18/19/20). */
export type ValidationOutcome =
  | "passed"
  | "schema_failed"
  | "allowlist_failed"
  | "ungrounded"
  | "unsupported"
  | "below_confidence";

/** Audit action kinds (Req 22.1). */
export type AuditAction = "create" | "modify" | "approve" | "reject" | "delete";

// ---------------------------------------------------------------------------
// Identity and access (User, Role)
// ---------------------------------------------------------------------------

export interface User extends Envelope {
  entityType: "User";
  displayName: string;
  roles: UserRole[];
}

export interface Role extends Envelope {
  entityType: "Role";
  name: UserRole;
  permissions: string[];
}

// ---------------------------------------------------------------------------
// Case and subjects (Case, Patient, FamilyMember, Pedigree)
// ---------------------------------------------------------------------------

export interface Case extends Envelope {
  entityType: "Case";
  /** Clinical area (Req 1.2). */
  clinicalArea: string;
  /** Case archetype (Req 1.6). */
  archetype: string;
  /** Inheritance model (Req 1.4). */
  inheritanceModel: InheritanceModel;
  /** Whether the case is family-based (Req 1.5, 2.8). */
  familyBased: boolean;
  /** Disposition/status lifecycle (Req 13). */
  dispositionStatus: CaseDispositionStatus;
}

export interface Patient extends Envelope {
  entityType: "Patient";
  sex: string;
  ageBucket: string;
  ancestry: string;
  /** Identifiers are synthetic only (Req 2.1/2.2). */
  identifiersSynthetic: true;
}

export interface FamilyMember extends Envelope {
  entityType: "FamilyMember";
  sex: string;
  relationship: string;
}

export interface Pedigree extends Envelope {
  entityType: "Pedigree";
  members: string[];
  relationships: { parent: string; child: string }[];
}

// ---------------------------------------------------------------------------
// Clinical record (Encounter, ClinicalDocument, Observation)
// ---------------------------------------------------------------------------

export interface Encounter extends Envelope {
  entityType: "Encounter";
  eventDate: string;
  fhirResourceRef: string;
}

export interface ClinicalDocument extends Envelope {
  entityType: "ClinicalDocument";
  author: string;
  sourceObjectRef: string;
  aiExtracted: boolean;
}

export interface Observation extends Envelope {
  entityType: "Observation";
  eventDate: string;
  code: string;
  value: string;
  sourceObjectRef: string;
}

// ---------------------------------------------------------------------------
// Phenotype workflow (PhenotypeCandidate, ConfirmedPhenotype)
// ---------------------------------------------------------------------------

export interface PhenotypeCandidate extends Envelope {
  entityType: "PhenotypeCandidate";
  /** Review lifecycle (Req 5.6/5.7/6). */
  status: PhenotypeCandidateStatus;
  assertion: Assertion;
  /** Confidence in [0.00, 1.00] (Req 5.4). */
  confidence: number;
  /** 1–20 HPO mappings (Req 5.2). */
  hpoMappings: HpoMapping[];
  /** Up to 10 alternatives, descending confidence (Req 5.5). */
  alternatives: HpoMapping[];
  /** Supporting source (Req 5.4). */
  sourceObjectRef: string;
  aiExtracted: true;
}

export interface ConfirmedPhenotype extends Envelope {
  entityType: "ConfirmedPhenotype";
  /** Link to the source candidate (Req 6.2). */
  candidateId: string;
  approvedById: string;
  approvedAt: string;
  /** Edit tracking (Req 6.4/25.7). */
  originalValue?: unknown;
  correctedValue?: unknown;
}

// ---------------------------------------------------------------------------
// Consistency and gaps (Contradiction, EvidenceGap)
// ---------------------------------------------------------------------------

export interface Contradiction extends Envelope {
  entityType: "Contradiction";
  /** Lifecycle (Req 7.3/7.6). */
  status: ContradictionStatus;
  /** At least two conflicting source objects (Req 7.4). */
  conflictingSourceRefs: string[];
  /** The attribute in conflict (Req 7.1). */
  entityAttribute: string;
  /** Present only for an authorised resolution (Req 7.6). */
  resolution?: { outcome: string; rationale: string; byId: string; at: string };
}

export interface EvidenceGap extends Envelope {
  entityType: "EvidenceGap";
  /** The case data element that triggered the rule (Req 8.4). */
  triggeringElementRef: string;
  ruleId: string;
  /** Always framed as a review item, never medical necessity (Req 8.3). */
  framedAsReviewItem: true;
}

// ---------------------------------------------------------------------------
// Genomics inputs (Biosample, GenomicTest, AnalysisRequest, AnalysisRun)
// ---------------------------------------------------------------------------

export interface Biosample extends Envelope {
  entityType: "Biosample";
  sampleType: string;
}

export interface GenomicTest extends Envelope {
  entityType: "GenomicTest";
  testType: string;
  artifactRefs: string[];
}

export interface AnalysisRequest extends Envelope {
  entityType: "AnalysisRequest";
  /** Lifecycle (Req 9). */
  status: AnalysisRequestStatus;
  /** Required to submit (Req 9.1/9.2). */
  workflowId?: string;
  /** Input artifacts (Req 9.3). */
  inputArtifactRefs: string[];
  /** Tool versions (Req 9.3/9.8). */
  toolVersions: Record<string, string>;
  /** Reference versions (Req 9.3/9.8). */
  referenceVersions: Record<string, string>;
  /** Estimated cost (Req 9.3). */
  estimatedCost: number;
  /** Required approver role (Req 9.3/9.4). */
  requiredApproverRole: UserRole;
  approvedById?: string;
  approvedAt?: string;
  /** Demo vs. workflow execution (Req 9.6/9.7). */
  genomicMode: GenomicMode;
  /** Active knowledge snapshot version (Req 14.5). */
  knowledgeSnapshotVersion: string;
}

export interface AnalysisRun extends Envelope {
  entityType: "AnalysisRun";
  requestId: string;
  /** Lifecycle (Req 9.8/9.9). */
  status: AnalysisRunStatus;
  outputRefs: string[];
  /** Includes tool + reference versions. */
  provenance: ProvenanceRef;
}

// ---------------------------------------------------------------------------
// Genomic knowledge entities (Variant, Gene, Disease)
// ---------------------------------------------------------------------------

/** A single deterministic per-factor scoring contribution (Req 10.5). */
export interface FactorContribution {
  factor: string;
  contribution: number;
}

export interface Variant extends Envelope {
  entityType: "Variant";
  /** Normalized identifier for reanalysis matching (Req 15.1). */
  normalizedId: string;
  geneId: string;
  /** Deterministic score (Req 10). */
  score?: number;
  rank?: number;
  factorContributions?: FactorContribution[];
  /** Pinned prioritisation logic version (Req 10.7). */
  prioritisationLogicVersion?: string;
}

export interface Gene extends Envelope {
  entityType: "Gene";
  normalizedId: string;
  symbol: string;
  score?: number;
  rank?: number;
  factorContributions?: FactorContribution[];
}

export interface Disease extends Envelope {
  entityType: "Disease";
  normalizedId: string;
  name: string;
  associatedGeneIds: string[];
}

// ---------------------------------------------------------------------------
// Reasoning (Hypothesis, EvidenceItem)
// ---------------------------------------------------------------------------

export interface Hypothesis extends Envelope {
  entityType: "Hypothesis";
  state: HypothesisState;
  /** Non-diagnostic vocabulary only (Req 11.3). */
  text: string;
  /** At least one evidence item (Req 11.1/11.2/11.7). */
  evidenceItemIds: string[];
  /** Active knowledge snapshot version (Req 14.5). */
  knowledgeSnapshotVersion: string;
  /** State-transition history (Req 11.5). */
  stateHistory: {
    from: HypothesisState;
    to: HypothesisState;
    byId: string;
    at: string;
  }[];
}

export interface EvidenceItem extends Envelope {
  entityType: "EvidenceItem";
  sourceObjectRef: string;
  kind: string;
}

// ---------------------------------------------------------------------------
// Collaboration (Task, MdtDecision)
// ---------------------------------------------------------------------------

export interface Task extends Envelope {
  entityType: "Task";
  /** Exactly one registered assignee (Req 12.4). */
  assigneeId: string;
  description: string;
  state: TaskState;
}

export interface MdtDecision extends Envelope {
  entityType: "MdtDecision";
  hypothesisId: string;
  /** Decision and disposition (Req 12.3/12.6). */
  decision: string;
  disposition: string;
  /** Participants and decision time (Req 12.6). */
  participants: string[];
  decidedAt: string;
  /** Comments, 1–5,000 chars each (Req 12.1/12.2). */
  comments: { authorId: string; body: string; at: string; mentions: string[] }[];
  /** At most one vote per user per card (Req 12.5). */
  votes: { userId: string; value: string }[];
}

// ---------------------------------------------------------------------------
// Disposition (CaseDisposition)
// ---------------------------------------------------------------------------

export interface CaseDisposition extends Envelope {
  entityType: "CaseDisposition";
  /** Terminal disposition (Req 13.1/13.4). */
  dispositionState: DispositionState;
  /** Grounded draft summary, gated by human approval (Req 13.2/13.3/13.5/13.7). */
  draftSummary?: {
    statements: { text: string; sourceObjectRef?: string; unsourced: boolean }[];
    final: boolean;
  };
}

// ---------------------------------------------------------------------------
// Knowledge and reanalysis (KnowledgeSource, KnowledgeSnapshot,
// KnowledgeUpdate, ReanalysisCandidate)
// ---------------------------------------------------------------------------

export interface KnowledgeSource extends Envelope {
  entityType: "KnowledgeSource";
  sourceType: string;
}

export interface KnowledgeSnapshot extends Envelope {
  entityType: "KnowledgeSnapshot";
  /** Unique snapshot version (Req 14.1). */
  snapshotVersion: string;
  hpoVersion: string;
  clinvarVersion: string;
  geneDiseaseVersion: string;
  ontologyVersion: string;
  annotationVersion: string;
  transcriptVersion: string;
  /** Pinned prioritisation logic version (Req 14.1). */
  prioritisationLogicVersion: string;
  /** Immutable snapshot (Req 14.7/14.8). */
  immutable: true;
}

export interface KnowledgeUpdate extends Envelope {
  entityType: "KnowledgeUpdate";
  /** Synthetic-data indicator (Req 14.3). */
  syntheticIndicator: true;
  /** Delta contents used for reanalysis matching (Req 15.1). */
  delta: {
    variants: string[];
    genes: string[];
    phenotypes: string[];
    diseases: string[];
  };
  status: KnowledgeUpdateStatus;
}

export interface ReanalysisCandidate extends Envelope {
  entityType: "ReanalysisCandidate";
  /** Link to the triggering update (Req 15.8). */
  knowledgeUpdateId: string;
  /** Matched relevance (Req 15.2). */
  relevance: {
    matchedVariants: string[];
    matchedGenes: string[];
    matchedPhenotypes: string[];
  };
  /** Present once an authorised approval is recorded (Req 15.4). */
  approval?: { byId: string; at: string };
}

// ---------------------------------------------------------------------------
// Governance (ModelInvocation, AuditEvent)
// ---------------------------------------------------------------------------

export interface ModelInvocation extends Envelope {
  entityType: "ModelInvocation";
  /** Invoked model id (Req 19.5). */
  modelId: string;
  /** Invoking user (Req 19.5). */
  invokingUserId: string;
  /** Invocation timestamp (Req 19.5). */
  invokedAt: string;
  /** Gateway validation outcome (Req 18/19/20). */
  validationOutcome: ValidationOutcome;
  /** Unauthorised portions excluded from context (Req 19.7). */
  excludedContext?: string[];
  /** Whether output was flagged for review (Req 18.6/20.2). */
  markedForReview: boolean;
  /** Reason for review flag (Req 20.2). */
  reviewReason?: string;
}

export interface AuditEvent extends Envelope {
  entityType: "AuditEvent";
  /** Actor id (Req 22.2). */
  actorId: string;
  /** Action performed (Req 22.1). */
  action: AuditAction;
  /** Affected object id (Req 22.2). */
  affectedObjectId: string;
  /** UTC timestamp, ≥ second precision (Req 22.2). */
  at: string;
  /** Original and corrected values on AI correction (Req 22.4). */
  originalValue?: unknown;
  correctedValue?: unknown;
  /** Immutable, 7-year retention (Req 22.3). */
  immutable: true;
}

// ---------------------------------------------------------------------------
// Discriminated union of every typed entity
// ---------------------------------------------------------------------------

/**
 * Discriminated union over the `entityType` literal of every typed domain
 * entity (Req 23.1). Useful for exhaustive switch handling.
 */
export type DomainEntity =
  | User
  | Role
  | Case
  | Patient
  | FamilyMember
  | Pedigree
  | Encounter
  | ClinicalDocument
  | Observation
  | PhenotypeCandidate
  | ConfirmedPhenotype
  | Contradiction
  | EvidenceGap
  | Biosample
  | GenomicTest
  | AnalysisRequest
  | AnalysisRun
  | Variant
  | Gene
  | Disease
  | Hypothesis
  | EvidenceItem
  | Task
  | MdtDecision
  | CaseDisposition
  | KnowledgeSource
  | KnowledgeSnapshot
  | KnowledgeUpdate
  | ReanalysisCandidate
  | ModelInvocation
  | AuditEvent;
