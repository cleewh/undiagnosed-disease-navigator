// services/timeline/src/filter.ts
//
// Deterministic timeline filtering (Timeline_Service, task 11.2).
//
// `filterTimeline` is a pure, deterministic function that narrows a
// reconstructed timeline (see `reconstructTimeline` in ./timeline.ts) to the
// entries matching a user-selected filter combination. Users may filter by
// source (source document or resource type), author, a confidence percentage
// range (min/max, inclusive), and AI-extracted status (Req 4.3). The filter
// dimensions are composable with AND semantics: every supplied dimension must
// match, and an omitted dimension does not restrict the result.
//
// Filtering preserves the input's relative order, so an already-ordered
// timeline (oldest-to-newest, Req 4.1) stays ordered after filtering.
//
// When an applied filter combination matches no entries, the result carries
// `matchedNone: true` together with the `appliedFilters` selections so the UI
// can show a "no entries match" indication while retaining the active filters
// (Req 4.6). This module is the DATA / SERVICE layer only; the filtering
// soundness/completeness property test is task 11.5.

import type { TimelineEntry, TimelineResourceType } from "./timeline.js";

// ---------------------------------------------------------------------------
// Filter selections
// ---------------------------------------------------------------------------

/**
 * A user-selected filter combination applied to a reconstructed timeline
 * (Req 4.3). Every field is optional; an omitted field imposes no restriction
 * on that dimension. Supplied fields combine with AND semantics.
 */
export interface TimelineFilters {
  /**
   * Match by source. An entry matches when the value equals either its
   * human-readable `sourceDocument` or its `resourceType`, so callers can
   * filter by a specific document string or by resource type (e.g.
   * "Observation").
   */
  source?: string;
  /** Match by exact author of the source document. */
  author?: string;
  /** Inclusive lower bound of the confidence percentage range [0, 100]. */
  minConfidence?: number;
  /** Inclusive upper bound of the confidence percentage range [0, 100]. */
  maxConfidence?: number;
  /** Match by AI-extracted status (true = AI-extracted, false = directly recorded). */
  aiExtracted?: boolean;
}

/**
 * The result of applying a filter combination to a timeline. Retains the
 * applied filter selections so the caller/UI can keep the active filters even
 * when nothing matches (Req 4.6).
 */
export interface TimelineFilterResult {
  /** The matching entries, in their original relative order. */
  entries: TimelineEntry[];
  /**
   * True when at least one filter dimension was applied yet no entry matched
   * (Req 4.6). False when the result is non-empty, and false when no filter was
   * applied at all (an empty input timeline is the empty-timeline case, Req
   * 4.5, not a no-match case).
   */
  matchedNone: boolean;
  /** The filter selections that were applied, retained for the UI (Req 4.6). */
  appliedFilters: TimelineFilters;
}

/** Indication shown when an applied filter combination matches no entries (Req 4.6). */
export const NO_MATCH_INDICATION =
  "No entries match the selected criteria.";

// ---------------------------------------------------------------------------
// Predicate construction
// ---------------------------------------------------------------------------

/** Whether any filter dimension is actually applied. */
function hasActiveFilters(filters: TimelineFilters): boolean {
  return (
    filters.source !== undefined ||
    filters.author !== undefined ||
    filters.minConfidence !== undefined ||
    filters.maxConfidence !== undefined ||
    filters.aiExtracted !== undefined
  );
}

/** Does the entry's source (document or resource type) equal the filter value? */
function matchesSource(entry: TimelineEntry, source: string): boolean {
  return (
    entry.sourceDocument === source ||
    entry.resourceType === (source as TimelineResourceType)
  );
}

/**
 * The composed AND predicate for a filter combination. Each supplied dimension
 * must match; omitted dimensions are skipped and therefore do not restrict.
 */
function matchesFilters(entry: TimelineEntry, filters: TimelineFilters): boolean {
  if (filters.source !== undefined && !matchesSource(entry, filters.source)) {
    return false;
  }
  if (filters.author !== undefined && entry.author !== filters.author) {
    return false;
  }
  if (
    filters.minConfidence !== undefined &&
    entry.confidence < filters.minConfidence
  ) {
    return false;
  }
  if (
    filters.maxConfidence !== undefined &&
    entry.confidence > filters.maxConfidence
  ) {
    return false;
  }
  if (
    filters.aiExtracted !== undefined &&
    entry.aiExtracted !== filters.aiExtracted
  ) {
    return false;
  }
  return true;
}

/** Copy only the defined filter dimensions so the retained selection is clean. */
function retainFilters(filters: TimelineFilters): TimelineFilters {
  const retained: TimelineFilters = {};
  if (filters.source !== undefined) retained.source = filters.source;
  if (filters.author !== undefined) retained.author = filters.author;
  if (filters.minConfidence !== undefined) {
    retained.minConfidence = filters.minConfidence;
  }
  if (filters.maxConfidence !== undefined) {
    retained.maxConfidence = filters.maxConfidence;
  }
  if (filters.aiExtracted !== undefined) {
    retained.aiExtracted = filters.aiExtracted;
  }
  return retained;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Filter a reconstructed timeline by a filter combination (Req 4.3, 4.6).
 *
 * Pure and deterministic. Applies the supplied filter dimensions (source,
 * author, confidence range, AI-extracted status) with AND semantics, keeping
 * only the entries that satisfy every applied dimension and preserving their
 * original relative order. Omitted dimensions impose no restriction, so an
 * empty filter returns all entries.
 *
 * When at least one filter dimension is applied but nothing matches, the result
 * carries `matchedNone: true` and the retained `appliedFilters` so the UI can
 * show a no-match indication without losing the active selections (Req 4.6).
 */
export function filterTimeline(
  entries: readonly TimelineEntry[],
  filters: TimelineFilters = {}
): TimelineFilterResult {
  const active = hasActiveFilters(filters);
  const matched = active
    ? entries.filter((entry) => matchesFilters(entry, filters))
    : [...entries];

  return {
    entries: matched,
    matchedNone: active && matched.length === 0,
    appliedFilters: retainFilters(filters)
  };
}
