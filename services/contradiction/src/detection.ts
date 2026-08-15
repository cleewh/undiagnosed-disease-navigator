// services/contradiction/src/detection.ts
//
// Deterministic contradiction detection and resolution (Contradiction_Service,
// task 15.1).
//
// This engine is DETERMINISTIC and contains no AI. A contradiction is defined
// (Req 7.1, and design "Contradiction_Service") as two or more evidence items
// asserting mutually exclusive values for the same attribute of the same case
// entity. `detectContradictions` evaluates both confirmed and candidate
// evidence and returns unresolved `Contradiction` records, each linking every
// conflicting source object (a minimum of two — Req 7.3, 7.4). Detection never
// auto-resolves anything (Req 7.5): every produced record has status
// "unresolved". `resolveContradiction` records an authorised reviewer's
// resolution (Req 7.6) and rejects an unauthorised one while leaving the record
// unchanged (Req 7.7).
//
// Determinism: for a fixed set of envelope options (`now`, `createdById`,
// `source`, ...), the same input evidence always produces byte-for-byte
// identical output. Record ids are derived from the conflicting
// (caseEntityId, attribute) pair rather than randomly generated, groups are
// emitted in a stable sorted order, and every linked source-object list is
// sorted, so nothing in the output depends on input ordering or a random
// source.
//
// The 5-second bound and up-to-3-times retry-on-failure (Req 7.2) are runtime
// concerns handled by the caller/orchestrator. The core `detectContradictions`
// is a pure function; `evaluateWithRetry` is a lightweight, optional wrapper
// that provides the retry-and-retain-prior-records behaviour without pulling
// any timing dependency into the pure core.

import {
  createEnvelope,
  touchEnvelope,
  type AccessClassification,
  type Contradiction,
  type ProvenanceRef
} from "@udn/domain";

// ---------------------------------------------------------------------------
// Evidence input model
// ---------------------------------------------------------------------------

/**
 * The value an evidence item asserts for an attribute. Modelled generically so
 * a single predicate covers phenotype present/absent (string), differing onset
 * ages (number), and family-history / lab-vs-narrative changes (string), among
 * others.
 */
export type EvidenceValue = string | number | boolean;

/** Whether an evidence item is confirmed or still a candidate (both evaluated). */
export type EvidenceItemStatus = "confirmed" | "candidate";

/**
 * A single generic evidence item. This is deliberately independent of the
 * domain `EvidenceItem` entity (which models hypothesis evidence): here an
 * evidence item is any assertion of a value for an attribute of a case entity,
 * carrying a reference back to its source object.
 */
export interface ContradictionEvidenceItem {
  /** Reference to the source object that asserts this value (Req 7.4). */
  sourceRef: string;
  /** The case entity the assertion is about (e.g. patient, a phenotype). */
  caseEntityId: string;
  /** The attribute in question, e.g. "phenotype:HP:0001250" or "onsetAge". */
  attribute: string;
  /** The asserted value (Req 7.1). */
  value: EvidenceValue;
  /** Confirmed or candidate; both are evaluated (Req 7.1). Defaults to candidate. */
  status?: EvidenceItemStatus;
}

// ---------------------------------------------------------------------------
// Detection options (envelope inputs)
// ---------------------------------------------------------------------------

/**
 * Envelope inputs required to stamp produced `Contradiction` records. Supplying
 * a fixed `now` keeps detection fully deterministic across runs.
 */
export interface DetectContradictionsOptions {
  /** Owning case id for the produced records (envelope, Req 23.3). */
  caseId: string;
  /** Actor id recorded as the creator of the records (envelope). */
  createdById: string;
  /** Origin of the records, e.g. "Contradiction_Service" (envelope). */
  source: string;
  /** ISO-8601 UTC timestamp stamped as createdAt/modifiedAt. */
  now: string;
  /** Access classification for the produced records. Defaults to "clinical". */
  accessClassification?: AccessClassification;
  /** Optional provenance; a deterministic default is derived when omitted. */
  provenance?: ProvenanceRef;
}

// ---------------------------------------------------------------------------
// Value-conflict predicate
// ---------------------------------------------------------------------------

/**
 * Canonical key for a value, used to decide equality. Strings are trimmed so
 * "present" and " present " are treated as the same assertion; the type is
 * included so the number 5 and the string "5" are treated as distinct
 * assertions. Because an attribute of an entity has a single true value,
 * distinct canonical keys are mutually exclusive.
 */
function valueKey(value: EvidenceValue): string {
  const normalised = typeof value === "string" ? value.trim() : String(value);
  return `${typeof value}:${normalised}`;
}

/**
 * The value-conflict predicate: two asserted values are mutually exclusive when
 * their canonical keys differ. This covers present-vs-absent, differing scalar
 * onset ages, and any other distinct-value disagreement (Req 7.1).
 */
export function valuesConflict(a: EvidenceValue, b: EvidenceValue): boolean {
  return valueKey(a) !== valueKey(b);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Locale-independent string comparison for stable, reproducible ordering. */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Internal accumulator for one (caseEntityId, attribute) group. */
interface EvidenceGroup {
  caseEntityId: string;
  attribute: string;
  /** Distinct canonical value keys seen in the group. */
  valueKeys: Set<string>;
  /** Distinct source-object references seen in the group. */
  sourceRefs: Set<string>;
}

/** Composite group key; the NUL separator cannot appear in normal identifiers. */
function groupKey(caseEntityId: string, attribute: string): string {
  return `${caseEntityId}\u0000${attribute}`;
}

/**
 * Composite `entityAttribute` value stored on the record, identifying both the
 * case entity and the attribute in conflict.
 */
export function entityAttributeOf(caseEntityId: string, attribute: string): string {
  return `${caseEntityId}::${attribute}`;
}

/** Deterministic, content-derived record id for a conflicting group. */
function contradictionId(caseEntityId: string, attribute: string): string {
  return `Contradiction-${entityAttributeOf(caseEntityId, attribute)}`;
}

/**
 * Detect contradictions across the supplied evidence items (Req 7.1, 7.3, 7.4,
 * 7.5).
 *
 * Pure and deterministic. Evidence is grouped by (caseEntityId, attribute);
 * a group yields exactly one unresolved `Contradiction` record when it contains
 * two or more mutually exclusive values contributed by two or more distinct
 * source objects. Each record links every distinct conflicting source object
 * (sorted, minimum two — Req 7.4) and always has status "unresolved" — the
 * function never resolves anything (Req 7.5). Records are returned in a stable
 * order sorted by their composite entity/attribute key.
 */
export function detectContradictions(
  evidenceItems: readonly ContradictionEvidenceItem[],
  options: DetectContradictionsOptions
): Contradiction[] {
  const groups = new Map<string, EvidenceGroup>();

  for (const item of evidenceItems) {
    const key = groupKey(item.caseEntityId, item.attribute);
    let group = groups.get(key);
    if (!group) {
      group = {
        caseEntityId: item.caseEntityId,
        attribute: item.attribute,
        valueKeys: new Set<string>(),
        sourceRefs: new Set<string>()
      };
      groups.set(key, group);
    }
    group.valueKeys.add(valueKey(item.value));
    group.sourceRefs.add(item.sourceRef);
  }

  const provenance: ProvenanceRef =
    options.provenance ?? {
      sourceId: options.source,
      versionId: "1",
      createdById: options.createdById,
      ingestedAt: options.now
    };
  const accessClassification = options.accessClassification ?? "clinical";

  const records: Contradiction[] = [];

  for (const group of groups.values()) {
    // A contradiction requires mutually exclusive values (>= 2 distinct value
    // keys) contributed by >= 2 distinct source objects so the record can link
    // the minimum two conflicting sources required by Req 7.4.
    if (group.valueKeys.size < 2 || group.sourceRefs.size < 2) {
      continue;
    }

    const conflictingSourceRefs = [...group.sourceRefs].sort(compareStrings);

    const base = createEnvelope({
      id: contradictionId(group.caseEntityId, group.attribute),
      entityType: "Contradiction",
      caseId: options.caseId,
      source: options.source,
      status: "unresolved",
      provenance,
      accessClassification,
      createdById: options.createdById,
      now: options.now
    });

    records.push({
      ...base,
      entityType: "Contradiction",
      status: "unresolved",
      conflictingSourceRefs,
      entityAttribute: entityAttributeOf(group.caseEntityId, group.attribute)
    });
  }

  records.sort((a, b) => compareStrings(a.entityAttribute, b.entityAttribute));
  return records;
}

// ---------------------------------------------------------------------------
// Resolution (authorised vs unauthorised)
// ---------------------------------------------------------------------------

/** Input for an attempt to resolve a contradiction (Req 7.6, 7.7). */
export interface ResolveContradictionInput {
  /** The recorded resolution outcome (Req 7.6). */
  outcome: string;
  /** Reviewer-supplied rationale (Req 7.6). */
  rationale: string;
  /** Identity of the resolving reviewer (Req 7.6). */
  reviewerId: string;
  /** Resolution timestamp, ISO-8601 UTC (Req 7.6). */
  at: string;
  /** Whether the reviewer holds resolution authorisation (Req 7.7). */
  isAuthorised: boolean;
}

/** A structured authorisation failure returned when an unauthorised reviewer resolves (Req 7.7). */
export interface AuthorisationError {
  code: "not_authorised";
  message: string;
  reviewerId: string;
}

/** Result of a resolution attempt: either the updated record, or an error with the record unchanged. */
export type ResolveContradictionResult =
  | { ok: true; record: Contradiction }
  | { ok: false; error: AuthorisationError; record: Contradiction };

/**
 * Resolve a contradiction (Req 7.6, 7.7).
 *
 * For an authorised reviewer, records the resolution outcome, rationale,
 * reviewer identity, and timestamp, sets status to "resolved", and bumps the
 * envelope version/modifiedAt. The input record is never mutated; a new record
 * is returned. For an unauthorised reviewer the resolution is rejected, the
 * record is retained unchanged in its unresolved status, and an authorisation
 * error is returned.
 */
export function resolveContradiction(
  record: Contradiction,
  input: ResolveContradictionInput
): ResolveContradictionResult {
  if (!input.isAuthorised) {
    return {
      ok: false,
      record,
      error: {
        code: "not_authorised",
        reviewerId: input.reviewerId,
        message: `Reviewer "${input.reviewerId}" is not authorised to resolve contradiction "${record.id}".`
      }
    };
  }

  const touched = touchEnvelope(record, input.at);
  const resolved: Contradiction = {
    ...touched,
    status: "resolved",
    resolution: {
      outcome: input.outcome,
      rationale: input.rationale,
      byId: input.reviewerId,
      at: input.at
    }
  };
  return { ok: true, record: resolved };
}

// ---------------------------------------------------------------------------
// Optional retry wrapper (Req 7.2 support)
// ---------------------------------------------------------------------------

/** Outcome of a retrying evaluation (Req 7.2). */
export interface EvaluationResult {
  /** Whether the evaluation completed or was abandoned after exhausting retries. */
  status: "completed" | "incomplete";
  /** The detected contradictions on success; the retained prior records on failure. */
  contradictions: Contradiction[];
  /** Number of attempts made (1..maxAttempts). */
  attempts: number;
  /** Human-readable status indication, present when the evaluation did not complete (Req 7.2). */
  indication?: string;
}

/** Status indication surfaced when contradiction evaluation does not complete (Req 7.2). */
export const EVALUATION_INCOMPLETE_INDICATION =
  "Contradiction evaluation did not complete; prior contradiction records are retained.";

/**
 * Run a detection thunk with up-to-3-attempts retry (Req 7.2), keeping the pure
 * core untouched. On success returns the detected contradictions. If every
 * attempt throws, the prior contradiction records are retained unchanged and a
 * status indication reports that evaluation did not complete.
 *
 * The caller supplies `run` (typically `() => detectContradictions(items, opts)`)
 * so timing (the 5-second bound) and the evaluation itself stay the caller's
 * concern; this wrapper only orchestrates retries and prior-record retention.
 */
export function evaluateWithRetry(
  run: () => Contradiction[],
  priorRecords: readonly Contradiction[] = [],
  maxAttempts = 3
): EvaluationResult {
  const attemptsAllowed = Math.max(1, Math.floor(maxAttempts));
  let attempts = 0;
  for (let i = 0; i < attemptsAllowed; i++) {
    attempts++;
    try {
      return { status: "completed", contradictions: run(), attempts };
    } catch {
      // Retain prior records and try again until attempts are exhausted.
    }
  }
  return {
    status: "incomplete",
    contradictions: [...priorRecords],
    attempts,
    indication: EVALUATION_INCOMPLETE_INDICATION
  };
}
