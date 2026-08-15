// services/timeline/src/timeline.ts
//
// Deterministic diagnostic timeline reconstruction (Timeline_Service, task
// 11.1).
//
// `reconstructTimeline` is a pure, deterministic function that consolidates a
// case's fragmented clinical events (FHIR R4 Encounters, Observations, and
// Conditions) into a single chronological timeline ordered oldest-to-newest by
// clinical event date (Req 4.1). Events sharing the same clinical event date
// are disambiguated by a fixed, documented tie-break of
// `(timestamp, resourceType, resourceId)` so that byte-for-byte identical input
// always yields byte-for-byte identical output (design: Deterministic Engine ->
// Timeline reconstruction).
//
// Each produced `TimelineEntry` exposes the fields required by Req 4.2: the
// source document, the author, a confidence indicator (percentage 0-100), a
// link to the source object, and a flag indicating whether the entry was
// AI-extracted. For directly-recorded structured FHIR data the defaults are a
// confidence of 100 and an AI-extracted flag of `false`; both can be overridden
// per resource so that AI-extracted prior findings can carry a lower confidence
// and a raised flag.
//
// This module is the DATA / SERVICE layer only. Filtering is task 11.2, the
// ordering property test is task 11.3, and the Timeline workspace tab render is
// a later UI task. Navigation is served here by returning the source-object
// reference (Req 4.4) and resolving it back to its source object, returning
// `undefined` when the reference cannot be resolved (Req 4.7).

// ---------------------------------------------------------------------------
// Clinical-event input shapes (structurally compatible with @udn/data-generator
// FhirRecord resources, but declared locally so the runtime does not depend on
// the generator)
// ---------------------------------------------------------------------------

/** Fields common to every clinical event accepted by the timeline. */
interface TimelineResourceCommon {
  /** Stable resource identifier, unique within its resource type. */
  id: string;
  /** Optional recorded author; defaults to a synthetic provider when absent. */
  author?: string;
  /**
   * Whether this event was AI-extracted rather than directly recorded.
   * Defaults to `false` for structured FHIR data (Req 4.2).
   */
  aiExtracted?: boolean;
  /**
   * Confidence indicator as a percentage in [0, 100]. Defaults to 100 for
   * directly-recorded structured data (Req 4.2). Values outside the range are
   * clamped.
   */
  confidence?: number;
}

/** A FHIR R4 Encounter, reduced to the fields the timeline consumes. */
export interface TimelineEncounter extends TimelineResourceCommon {
  resourceType: "Encounter";
  /** Clinical event period; `start` is used as the event date. */
  period: { start: string; end?: string };
  /** Encounter class, used to describe the source document. */
  class?: { display?: string };
}

/** A FHIR R4 Observation, reduced to the fields the timeline consumes. */
export interface TimelineObservation extends TimelineResourceCommon {
  resourceType: "Observation";
  /** Clinical event date. */
  effectiveDateTime: string;
  /** Coded concept, used to describe the source document. */
  code?: { text?: string };
}

/** A FHIR R4 Condition, reduced to the fields the timeline consumes. */
export interface TimelineCondition extends TimelineResourceCommon {
  resourceType: "Condition";
  /** Clinical event (onset) date. */
  onsetDateTime: string;
  /** Coded concept, used to describe the source document. */
  code?: { text?: string };
}

/** The union of clinical-event resources understood by the timeline. */
export type TimelineResource =
  | TimelineEncounter
  | TimelineObservation
  | TimelineCondition;

/**
 * The clinical data for one case from which a timeline is reconstructed. Each
 * collection is optional; a case with no clinical records yields an empty
 * timeline (Req 4.5). This shape is structurally compatible with the
 * `FhirRecord` produced by `@udn/data-generator`.
 */
export interface CaseClinicalData {
  encounters?: readonly TimelineEncounter[];
  observations?: readonly TimelineObservation[];
  conditions?: readonly TimelineCondition[];
}

// ---------------------------------------------------------------------------
// Timeline entry (rendered output)
// ---------------------------------------------------------------------------

/** The resource types that can appear on the timeline. */
export type TimelineResourceType = TimelineResource["resourceType"];

/**
 * A single rendered timeline entry. Exposes every field required by Req 4.2 and
 * the ordering keys used by the deterministic tie-break.
 */
export interface TimelineEntry {
  /** Stable, unique entry identifier (`<resourceType>/<resourceId>`). */
  entryId: string;
  /** Clinical event date, ISO-8601, used for ordering (Req 4.1). */
  eventDate: string;
  /** Resource type, part of the tie-break ordering key. */
  resourceType: TimelineResourceType;
  /** Source resource identifier, part of the tie-break ordering key. */
  resourceId: string;
  /** Human-readable description of the source document (Req 4.2). */
  sourceDocument: string;
  /** Author of the source document (Req 4.2). */
  author: string;
  /** Confidence indicator as a percentage in [0, 100] (Req 4.2). */
  confidence: number;
  /** Reference to the linked source object for navigation (Req 4.2, 4.4). */
  sourceObjectRef: string;
  /** Whether the entry was AI-extracted (Req 4.2). */
  aiExtracted: boolean;
}

/**
 * The full result of a timeline reconstruction, including an empty-state
 * indication for the no-records case (Req 4.5).
 */
export interface TimelineResult {
  /** Chronologically ordered entries (oldest first). */
  entries: TimelineEntry[];
  /** True when the case contains no clinical records (Req 4.5). */
  isEmpty: boolean;
  /**
   * Present only when `isEmpty` is true: a human-readable indication that no
   * diagnostic records are available (Req 4.5).
   */
  indication?: string;
}

// ---------------------------------------------------------------------------
// Constants and defaults
// ---------------------------------------------------------------------------

/** Indication shown when a case has no clinical records (Req 4.5). */
export const EMPTY_TIMELINE_INDICATION =
  "No diagnostic records are available for this case.";

/** Indication shown when a selected source object cannot be retrieved (Req 4.7). */
export const UNAVAILABLE_SOURCE_INDICATION =
  "The linked source object is unavailable.";

/** Default confidence for directly-recorded structured FHIR data (Req 4.2). */
const DEFAULT_CONFIDENCE = 100;

/** Minimum and maximum of the confidence percentage range (Req 4.2). */
const MIN_CONFIDENCE = 0;
const MAX_CONFIDENCE = 100;

/** Deterministic synthetic author used when a resource records no author. */
const DEFAULT_AUTHORS: Record<TimelineResourceType, string> = {
  Encounter: "Synthetic Attending Clinician",
  Observation: "Synthetic Reporting Provider",
  Condition: "Synthetic Diagnosing Clinician"
};

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/** Clamp a supplied confidence into the inclusive [0, 100] percentage range. */
function normaliseConfidence(confidence: number | undefined): number {
  if (confidence === undefined || Number.isNaN(confidence)) {
    return DEFAULT_CONFIDENCE;
  }
  if (confidence < MIN_CONFIDENCE) return MIN_CONFIDENCE;
  if (confidence > MAX_CONFIDENCE) return MAX_CONFIDENCE;
  return confidence;
}

/** Build the `<resourceType>/<resourceId>` reference for a resource. */
function refOf(resourceType: TimelineResourceType, resourceId: string): string {
  return `${resourceType}/${resourceId}`;
}

/** Derive the human-readable source-document description for an entry. */
function describeSource(resource: TimelineResource): string {
  switch (resource.resourceType) {
    case "Encounter":
      return `Encounter (${resource.class?.display ?? "clinical encounter"})`;
    case "Observation":
      return `Observation (${resource.code?.text ?? "clinical observation"})`;
    case "Condition":
      return `Condition (${resource.code?.text ?? "clinical condition"})`;
    default: {
      const _exhaustive: never = resource;
      return _exhaustive;
    }
  }
}

/** The clinical event date for a resource (the field varies by resource type). */
function eventDateOf(resource: TimelineResource): string {
  switch (resource.resourceType) {
    case "Encounter":
      return resource.period.start;
    case "Observation":
      return resource.effectiveDateTime;
    case "Condition":
      return resource.onsetDateTime;
    default: {
      const _exhaustive: never = resource;
      return _exhaustive;
    }
  }
}

/** Map a single clinical-event resource to a rendered timeline entry. */
function toEntry(resource: TimelineResource): TimelineEntry {
  const { resourceType, id } = resource;
  const ref = refOf(resourceType, id);
  return {
    entryId: ref,
    eventDate: eventDateOf(resource),
    resourceType,
    resourceId: id,
    sourceDocument: describeSource(resource),
    author: resource.author ?? DEFAULT_AUTHORS[resourceType],
    confidence: normaliseConfidence(resource.confidence),
    sourceObjectRef: ref,
    aiExtracted: resource.aiExtracted ?? false
  };
}

// ---------------------------------------------------------------------------
// Deterministic ordering (Req 4.1 + documented tie-break)
// ---------------------------------------------------------------------------

/** Locale-independent string comparison for stable, reproducible ordering. */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Total order over timeline entries: oldest clinical event date first, then the
 * fixed tie-break `(timestamp, resourceType, resourceId)`.
 *
 * Timestamps are compared chronologically by parsed epoch milliseconds so that
 * differing ISO-8601 representations of the same instant order correctly. When
 * a timestamp cannot be parsed, the raw string is compared instead, keeping the
 * order total and deterministic. Because `resourceId` is unique within a
 * resource type and the reference embeds the type, the comparator never returns
 * 0 for two distinct entries — the ordering is unambiguous.
 */
function compareEntries(a: TimelineEntry, b: TimelineEntry): number {
  const ta = Date.parse(a.eventDate);
  const tb = Date.parse(b.eventDate);

  if (Number.isNaN(ta) || Number.isNaN(tb)) {
    const byRawDate = compareStrings(a.eventDate, b.eventDate);
    if (byRawDate !== 0) return byRawDate;
  } else if (ta !== tb) {
    return ta < tb ? -1 : 1;
  }

  const byType = compareStrings(a.resourceType, b.resourceType);
  if (byType !== 0) return byType;

  return compareStrings(a.resourceId, b.resourceId);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconstruct a case's diagnostic timeline (Req 4.1, 4.2, 4.4).
 *
 * Pure and deterministic: consolidates the case's FHIR Encounters,
 * Observations, and Conditions into a single list of entries ordered
 * oldest-to-newest by clinical event date, applying the fixed
 * `(timestamp, resourceType, resourceId)` tie-break. Same input -> byte-for-byte
 * identical output. Returns an empty array when the case has no clinical
 * records (see {@link buildTimeline} for the accompanying empty-state
 * indication).
 */
export function reconstructTimeline(data: CaseClinicalData): TimelineEntry[] {
  const resources: TimelineResource[] = [
    ...(data.encounters ?? []),
    ...(data.observations ?? []),
    ...(data.conditions ?? [])
  ];

  const entries = resources.map(toEntry);
  entries.sort(compareEntries);
  return entries;
}

/**
 * Reconstruct a case's timeline and report the empty-state indication (Req 4.5).
 *
 * Wraps {@link reconstructTimeline}; when the case has no clinical records the
 * result carries `isEmpty: true` and an `indication` string so the UI can show
 * that no diagnostic records are available.
 */
export function buildTimeline(data: CaseClinicalData): TimelineResult {
  const entries = reconstructTimeline(data);
  if (entries.length === 0) {
    return { entries, isEmpty: true, indication: EMPTY_TIMELINE_INDICATION };
  }
  return { entries, isEmpty: false };
}

/**
 * Return the source-object reference to navigate to when a timeline entry is
 * selected (Req 4.4). Navigation resolution itself is served by
 * {@link resolveSourceObject}.
 */
export function selectEntry(entry: TimelineEntry): string {
  return entry.sourceObjectRef;
}

/**
 * Resolve a source-object reference back to its originating clinical resource
 * (Req 4.4). Returns the matching resource, or `undefined` when the reference
 * cannot be resolved so that callers can present an unavailable-source
 * indication without losing the current timeline view (Req 4.7).
 */
export function resolveSourceObject(
  data: CaseClinicalData,
  sourceObjectRef: string
): TimelineResource | undefined {
  const resources: TimelineResource[] = [
    ...(data.encounters ?? []),
    ...(data.observations ?? []),
    ...(data.conditions ?? [])
  ];
  return resources.find(
    (resource) => refOf(resource.resourceType, resource.id) === sourceObjectRef
  );
}
