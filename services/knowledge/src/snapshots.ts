// services/knowledge/src/snapshots.ts
//
// Versioned, immutable knowledge snapshots (Knowledge_Service, task 26.1,
// Requirement 14.1, 14.5, 14.6, 14.7, 14.8).
//
// This module holds the DETERMINISTIC snapshot logic of the Knowledge_Service.
// It never calls a generative model. It:
//
//   * records a Knowledge_Snapshot with a UNIQUE version id, a creation
//     timestamp, and the versions of HPO, ClinVar, gene-disease associations,
//     ontology, annotation, transcript, and prioritisation logic in use
//     (Req 14.1);
//   * associates a recording (analysis or hypothesis) with the version id of
//     the snapshot in effect, or rejects the recording when no snapshot exists
//     (Req 14.5, 14.6);
//   * retains prior snapshots as IMMUTABLE records and rejects any request to
//     modify or delete a retained snapshot, preserving the original unchanged
//     (Req 14.7, 14.8).
//
// Authorisation is out of scope for this deterministic core (the RBAC matrix
// lives in apps/api/src/auth). Every function is pure with respect to its
// inputs; the {@link KnowledgeSnapshotStore} is the single mutable holder of
// retained snapshots and only ever grows (append-only) — it exposes no path to
// mutate or remove a retained snapshot.

import {
  createEnvelope,
  type AccessClassification,
  type KnowledgeSnapshot,
  type ProvenanceRef
} from "@udn/domain";

/** Origin recorded on records produced by the Knowledge_Service. */
export const KNOWLEDGE_SOURCE = "Knowledge_Service";

/**
 * Knowledge is global rather than case-scoped, but the shared provenance
 * envelope requires a `caseId` (Req 23.3). Global knowledge records use this
 * sentinel unless a caller supplies an explicit owning case id.
 */
export const GLOBAL_CASE_ID = "GLOBAL";

/**
 * The complete set of source versions a Knowledge_Snapshot must record
 * (Req 14.1). Every field is mandatory: a snapshot captures the versions of
 * HPO, ClinVar, gene-disease associations, ontology, annotation, transcript,
 * and prioritisation logic in use at the point in time it is taken.
 */
export interface SnapshotSourceVersions {
  readonly hpoVersion: string;
  readonly clinvarVersion: string;
  readonly geneDiseaseVersion: string;
  readonly ontologyVersion: string;
  readonly annotationVersion: string;
  readonly transcriptVersion: string;
  readonly prioritisationLogicVersion: string;
}

/** Input for recording a new Knowledge_Snapshot (Req 14.1). */
export interface CreateSnapshotInput {
  /** The source versions captured by the snapshot (Req 14.1). */
  readonly sources: SnapshotSourceVersions;
  /** Identity of the actor recording the snapshot (envelope). */
  readonly createdById: string;
  /** Creation timestamp, ISO-8601 UTC (Req 14.1). */
  readonly at: string;
  /**
   * Unique snapshot version identifier (Req 14.1). When omitted a unique
   * version is derived from the store's current size so that successive
   * snapshots receive distinct, monotonically increasing versions.
   */
  readonly snapshotVersion?: string;
  /** Owning case id for the envelope; defaults to {@link GLOBAL_CASE_ID}. */
  readonly caseId?: string;
  /** Origin for the snapshot envelope; defaults to {@link KNOWLEDGE_SOURCE}. */
  readonly source?: string;
  /** Access classification for the snapshot; defaults to "research". */
  readonly accessClassification?: AccessClassification;
  /** Optional explicit id for the snapshot record; generated when omitted. */
  readonly id?: string;
  /** Optional provenance; a deterministic default is derived when omitted. */
  readonly provenance?: ProvenanceRef;
}

/** Why a snapshot action was rejected. */
export type SnapshotErrorCode =
  /** A snapshot with the requested version already exists (Req 14.1 uniqueness). */
  | "duplicate_version"
  /** No Knowledge_Snapshot exists to associate a recording with (Req 14.6). */
  | "no_snapshot"
  /** A modify/delete was attempted against a retained snapshot (Req 14.8). */
  | "immutable";

/** A structured snapshot-action failure. */
export interface SnapshotError {
  readonly code: SnapshotErrorCode;
  readonly message: string;
}

/**
 * Build a fully-formed, immutable Knowledge_Snapshot record from an input and
 * an assigned unique version (Req 14.1). Pure: never touches the store.
 */
function buildSnapshot(
  input: CreateSnapshotInput,
  snapshotVersion: string
): KnowledgeSnapshot {
  const caseId = input.caseId ?? GLOBAL_CASE_ID;

  const provenance: ProvenanceRef =
    input.provenance ?? {
      sourceId: snapshotVersion,
      versionId: snapshotVersion,
      createdById: input.createdById,
      ingestedAt: input.at
    };

  const envelope = createEnvelope({
    ...(input.id !== undefined ? { id: input.id } : {}),
    entityType: "KnowledgeSnapshot",
    caseId,
    source: input.source ?? KNOWLEDGE_SOURCE,
    status: "active",
    provenance,
    accessClassification: input.accessClassification ?? "research",
    createdById: input.createdById,
    now: input.at
  });

  return {
    ...envelope,
    entityType: "KnowledgeSnapshot",
    snapshotVersion,
    hpoVersion: input.sources.hpoVersion,
    clinvarVersion: input.sources.clinvarVersion,
    geneDiseaseVersion: input.sources.geneDiseaseVersion,
    ontologyVersion: input.sources.ontologyVersion,
    annotationVersion: input.sources.annotationVersion,
    transcriptVersion: input.sources.transcriptVersion,
    prioritisationLogicVersion: input.sources.prioritisationLogicVersion,
    immutable: true
  };
}

/** Successful snapshot recording (Req 14.1). */
export interface CreateSnapshotSuccess {
  readonly ok: true;
  /** The newly recorded, immutable snapshot. */
  readonly snapshot: KnowledgeSnapshot;
}

/** Failed snapshot recording; the store is left unchanged. */
export interface CreateSnapshotFailure {
  readonly ok: false;
  readonly error: SnapshotError;
}

/** Result of {@link KnowledgeSnapshotStore.createSnapshot}. */
export type CreateSnapshotResult = CreateSnapshotSuccess | CreateSnapshotFailure;

/** Result of associating a recording with the active snapshot (Req 14.5, 14.6). */
export type AssociateSnapshotResult =
  | { readonly ok: true; readonly snapshotVersion: string }
  | { readonly ok: false; readonly error: SnapshotError };

/** Result of a rejected modify/delete attempt (Req 14.8). */
export type ImmutableActionResult = {
  readonly ok: false;
  readonly error: SnapshotError;
  /** The retained snapshot, preserved unchanged (Req 14.8). */
  readonly snapshot: KnowledgeSnapshot;
};

/**
 * Append-only, in-memory holder of retained Knowledge_Snapshots (Req 14.7).
 *
 * The store enforces snapshot-version uniqueness (Req 14.1) and immutability
 * (Req 14.7, 14.8): it exposes NO operation that mutates or removes a retained
 * snapshot. Modify/delete attempts are explicitly rejected and return the
 * original snapshot unchanged. The most recently created snapshot is the
 * "active" one — the snapshot in effect for recordings (Req 14.5).
 *
 * Snapshots themselves are never mutated after creation; callers receive the
 * stored reference, which is a fully-populated immutable record.
 */
export class KnowledgeSnapshotStore {
  /** Retained snapshots keyed by their unique version (Req 14.1, 14.7). */
  private readonly byVersion = new Map<string, KnowledgeSnapshot>();
  /** Insertion order of versions; the last entry is the active snapshot. */
  private readonly order: string[] = [];

  /**
   * Record a new immutable Knowledge_Snapshot (Req 14.1, 14.7).
   *
   * Assigns the supplied version, or derives a unique monotonically increasing
   * version when none is given. Rejects a duplicate version with
   * `duplicate_version`, leaving the store unchanged (Req 14.1 uniqueness).
   */
  createSnapshot(input: CreateSnapshotInput): CreateSnapshotResult {
    const snapshotVersion =
      input.snapshotVersion ?? this.nextDerivedVersion();

    if (this.byVersion.has(snapshotVersion)) {
      return {
        ok: false,
        error: {
          code: "duplicate_version",
          message: `A Knowledge_Snapshot with version "${snapshotVersion}" already exists; snapshot versions must be unique.`
        }
      };
    }

    const snapshot = buildSnapshot(input, snapshotVersion);
    this.byVersion.set(snapshotVersion, snapshot);
    this.order.push(snapshotVersion);

    return { ok: true, snapshot };
  }

  /**
   * The most recently created snapshot — the one in effect for recordings
   * (Req 14.5) — or `null` when no snapshot has been recorded (Req 14.6).
   */
  getActiveSnapshot(): KnowledgeSnapshot | null {
    const activeVersion = this.order[this.order.length - 1];
    if (activeVersion === undefined) {
      return null;
    }
    // Guaranteed present: `order` and `byVersion` are updated together.
    return this.byVersion.get(activeVersion) ?? null;
  }

  /** Look up a retained snapshot by its version (Req 14.7). */
  getByVersion(snapshotVersion: string): KnowledgeSnapshot | undefined {
    return this.byVersion.get(snapshotVersion);
  }

  /** All retained snapshots in creation order (oldest first) (Req 14.7). */
  list(): readonly KnowledgeSnapshot[] {
    const snapshots: KnowledgeSnapshot[] = [];
    for (const version of this.order) {
      const snapshot = this.byVersion.get(version);
      if (snapshot !== undefined) {
        snapshots.push(snapshot);
      }
    }
    return snapshots;
  }

  /** Number of retained snapshots. */
  get size(): number {
    return this.order.length;
  }

  /**
   * Associate a recording (analysis or hypothesis) with the version id of the
   * snapshot in effect (Req 14.5), or reject when none exists (Req 14.6).
   */
  associateRecording(): AssociateSnapshotResult {
    const active = this.getActiveSnapshot();
    if (active === null) {
      return {
        ok: false,
        error: {
          code: "no_snapshot",
          message:
            "No Knowledge_Snapshot is available; the recording cannot be associated with a snapshot version."
        }
      };
    }
    return { ok: true, snapshotVersion: active.snapshotVersion };
  }

  /**
   * Reject a request to modify a retained snapshot (Req 14.8).
   *
   * The store never applies the change; it returns the original snapshot
   * unchanged with an `immutable` error. When the target version is unknown,
   * a `no_snapshot` error is returned instead.
   */
  rejectModify(snapshotVersion: string): ImmutableActionResult | CreateSnapshotFailure {
    return this.rejectMutation(snapshotVersion, "modify");
  }

  /**
   * Reject a request to delete a retained snapshot (Req 14.8).
   *
   * The store never removes the snapshot; it returns the original snapshot
   * unchanged with an `immutable` error. When the target version is unknown,
   * a `no_snapshot` error is returned instead.
   */
  rejectDelete(snapshotVersion: string): ImmutableActionResult | CreateSnapshotFailure {
    return this.rejectMutation(snapshotVersion, "delete");
  }

  private rejectMutation(
    snapshotVersion: string,
    action: "modify" | "delete"
  ): ImmutableActionResult | CreateSnapshotFailure {
    const snapshot = this.byVersion.get(snapshotVersion);
    if (snapshot === undefined) {
      return {
        ok: false,
        error: {
          code: "no_snapshot",
          message: `No Knowledge_Snapshot with version "${snapshotVersion}" exists.`
        }
      };
    }
    return {
      ok: false,
      error: {
        code: "immutable",
        message: `Knowledge_Snapshot "${snapshotVersion}" is immutable; the request to ${action} it was rejected and the record is preserved unchanged.`
      },
      snapshot
    };
  }

  /**
   * Derive a unique, monotonically increasing snapshot version from the current
   * store size (e.g. "snapshot-1", "snapshot-2"). Because the store is
   * append-only and versions are never reused, the derived value is unique.
   */
  private nextDerivedVersion(): string {
    let n = this.order.length + 1;
    let candidate = `snapshot-${n}`;
    while (this.byVersion.has(candidate)) {
      n += 1;
      candidate = `snapshot-${n}`;
    }
    return candidate;
  }
}
