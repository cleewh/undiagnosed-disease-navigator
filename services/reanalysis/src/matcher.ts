// services/reanalysis/src/matcher.ts
//
// Deterministic reanalysis feature-vs-delta matcher and review-queue
// construction (Reanalysis_Service, task 17.1 — slice scope).
//
// This engine is DETERMINISTIC and contains NO AI (design: "Deterministic
// Engines (Prioritisation_Service and reanalysis matching)"). It never calls
// the AI_Gateway or any generative model.
//
// Matching is a set-intersection over NORMALISED identifiers between a case
// feature vector and a Knowledge_Update delta (design: Req 15.1):
//
//   affected(case, update) := (case.variants   ∩ update.variants)
//                           ∪ (case.genes      ∩ update.genes)
//                           ∪ (case.phenotypes ∩ update.phenotypes)
//
// - If `affected` is NON-EMPTY, a `ReanalysisCandidate` is created recording
//   the matched relevance (which specific variants/genes/phenotypes matched),
//   linked to the triggering Knowledge_Update, and the affected case is added
//   to the review queue (Req 15.1, 15.2, 15.3, 15.8).
// - If `affected` is EMPTY, NO candidate is created (Req 15.9).
//
// Determinism: identifiers are normalised (trim + case-fold) before
// intersection, matched identifiers are de-duplicated and returned in a stable
// sorted order, and every produced candidate id is content-derived from
// (caseId, knowledgeUpdateId) rather than randomly generated. For a fixed set
// of envelope options (`now`, `createdById`, `source`, ...) the same inputs
// therefore always produce byte-for-byte identical output regardless of input
// ordering.
//
// The 60-second identification bound and up-to-3-times retry-on-failure
// (Req 15.5) are runtime concerns handled by the caller/orchestrator; the core
// here is a pure function.

import {
  createEnvelope,
  type AccessClassification,
  type KnowledgeUpdate,
  type ProvenanceRef,
  type ReanalysisCandidate
} from "@udn/domain";

// ---------------------------------------------------------------------------
// Case feature vector
// ---------------------------------------------------------------------------

/**
 * The deterministic feature vector a case exposes for reanalysis matching: its
 * stored variant identifiers, gene identifiers, and phenotype (HPO)
 * associations (design: "Each Unresolved_Case exposes a deterministic feature
 * vector of its stored references"). Identifiers are supplied in their raw
 * stored form; the matcher normalises them before intersection.
 */
export interface CaseFeatureVector {
  /** Owning case id (Req 15.1). */
  caseId: string;
  /** Stored variant identifiers (raw). */
  variants: readonly string[];
  /** Stored gene identifiers (raw). */
  genes: readonly string[];
  /** Stored phenotype (HPO) association identifiers (raw). */
  phenotypes: readonly string[];
}

// ---------------------------------------------------------------------------
// Identifier normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise an identifier for intersection (design: "normalized identifiers",
 * "case-fold/trim"). Surrounding whitespace is trimmed and the identifier is
 * case-folded to lower case so that, e.g., " BRCA1 " and "brca1" are treated
 * as the same reference. Case-folding uses a fixed (locale-independent) lower
 * casing to keep results reproducible.
 */
export function normaliseIdentifier(id: string): string {
  return id.trim().toLowerCase();
}

/** Locale-independent string comparison for stable, reproducible ordering. */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Deterministic intersection of two identifier lists over their normalised
 * forms. Empty (whitespace-only) identifiers are ignored. The result contains
 * each matching normalised identifier at most once, in ascending sorted order.
 */
function intersectNormalised(
  caseIds: readonly string[],
  deltaIds: readonly string[]
): string[] {
  const deltaSet = new Set<string>();
  for (const raw of deltaIds) {
    const normalised = normaliseIdentifier(raw);
    if (normalised.length > 0) {
      deltaSet.add(normalised);
    }
  }

  const matched = new Set<string>();
  for (const raw of caseIds) {
    const normalised = normaliseIdentifier(raw);
    if (normalised.length > 0 && deltaSet.has(normalised)) {
      matched.add(normalised);
    }
  }

  return [...matched].sort(compareStrings);
}

// ---------------------------------------------------------------------------
// Matched relevance
// ---------------------------------------------------------------------------

/**
 * The relevance of a Knowledge_Update to a case: which specific variants,
 * genes, and phenotype associations matched (Req 15.2). Each list holds
 * normalised identifiers in stable sorted order.
 */
export interface MatchedRelevance {
  matchedVariants: string[];
  matchedGenes: string[];
  matchedPhenotypes: string[];
}

/**
 * Compute the matched relevance between a case feature vector and a
 * Knowledge_Update delta (design `affected(case, update)`; Req 15.1, 15.2).
 * Pure and deterministic. The intersection is non-empty exactly when at least
 * one of the three matched lists is non-empty.
 */
export function computeRelevance(
  feature: CaseFeatureVector,
  update: KnowledgeUpdate
): MatchedRelevance {
  return {
    matchedVariants: intersectNormalised(feature.variants, update.delta.variants),
    matchedGenes: intersectNormalised(feature.genes, update.delta.genes),
    matchedPhenotypes: intersectNormalised(feature.phenotypes, update.delta.phenotypes)
  };
}

/** True when a relevance records at least one matched variant, gene, or phenotype. */
export function hasRelevance(relevance: MatchedRelevance): boolean {
  return (
    relevance.matchedVariants.length > 0 ||
    relevance.matchedGenes.length > 0 ||
    relevance.matchedPhenotypes.length > 0
  );
}

// ---------------------------------------------------------------------------
// Candidate creation
// ---------------------------------------------------------------------------

/**
 * Envelope inputs required to stamp a produced `ReanalysisCandidate`. Supplying
 * a fixed `now` keeps matching fully deterministic across runs.
 */
export interface MatchOptions {
  /** Actor id recorded as the creator of the candidate (envelope). */
  createdById: string;
  /** Origin of the candidate, e.g. "Reanalysis_Service" (envelope). */
  source: string;
  /** ISO-8601 UTC timestamp stamped as createdAt/modifiedAt. */
  now: string;
  /** Access classification for the candidate. Defaults to "clinical". */
  accessClassification?: AccessClassification;
  /** Optional provenance; a deterministic default is derived when omitted. */
  provenance?: ProvenanceRef;
}

/**
 * Deterministic, content-derived candidate id for a (case, update) pair. Two
 * runs over the same case and update therefore yield the same id, and a single
 * update never produces two candidates for the same case.
 */
export function reanalysisCandidateId(caseId: string, knowledgeUpdateId: string): string {
  return `ReanalysisCandidate-${caseId}::${knowledgeUpdateId}`;
}

/**
 * Build a `ReanalysisCandidate` for a matched case (Req 15.2, 15.8). The
 * candidate records the matched relevance and links to the triggering
 * Knowledge_Update. Callers must only invoke this when relevance is non-empty.
 */
function buildCandidate(
  feature: CaseFeatureVector,
  update: KnowledgeUpdate,
  relevance: MatchedRelevance,
  options: MatchOptions
): ReanalysisCandidate {
  const provenance: ProvenanceRef =
    options.provenance ?? {
      sourceId: update.id,
      versionId: String(update.version),
      createdById: options.createdById,
      ingestedAt: options.now
    };

  const base = createEnvelope({
    id: reanalysisCandidateId(feature.caseId, update.id),
    entityType: "ReanalysisCandidate",
    caseId: feature.caseId,
    source: options.source,
    status: "pending",
    provenance,
    accessClassification: options.accessClassification ?? "clinical",
    createdById: options.createdById,
    now: options.now
  });

  return {
    ...base,
    entityType: "ReanalysisCandidate",
    knowledgeUpdateId: update.id,
    relevance: {
      matchedVariants: relevance.matchedVariants,
      matchedGenes: relevance.matchedGenes,
      matchedPhenotypes: relevance.matchedPhenotypes
    }
  };
}

// ---------------------------------------------------------------------------
// Single-case matching
// ---------------------------------------------------------------------------

/** Outcome of matching one case feature vector against one Knowledge_Update. */
export interface ReanalysisMatchResult {
  /** Whether the case is affected (the intersection was non-empty). */
  matched: boolean;
  /** The matched relevance (all empty lists when unmatched). */
  relevance: MatchedRelevance;
  /**
   * The created candidate when matched (Req 15.2, 15.8); `null` when the
   * intersection is empty and no candidate is created (Req 15.9).
   */
  candidate: ReanalysisCandidate | null;
}

/**
 * Match a single case feature vector against a Knowledge_Update (Req 15.1,
 * 15.2, 15.8, 15.9).
 *
 * Pure and deterministic. Computes the normalised-identifier intersection; when
 * it is non-empty, returns a `ReanalysisCandidate` recording the matched
 * relevance and linked to the update. When it is empty, returns
 * `{ matched: false, candidate: null }` — no candidate is created.
 */
export function matchCase(
  feature: CaseFeatureVector,
  update: KnowledgeUpdate,
  options: MatchOptions
): ReanalysisMatchResult {
  const relevance = computeRelevance(feature, update);

  if (!hasRelevance(relevance)) {
    return { matched: false, relevance, candidate: null };
  }

  return {
    matched: true,
    relevance,
    candidate: buildCandidate(feature, update, relevance, options)
  };
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

/**
 * A review-queue entry for an affected case (Req 15.3). Derived from a created
 * `ReanalysisCandidate`; ordering mirrors the persistence GSI3 review queue
 * (oldest-first by the candidate's createdAt, then id).
 */
export interface ReviewQueueEntry {
  /** The affected case added to the queue. */
  caseId: string;
  /** The candidate that placed the case in the queue. */
  candidateId: string;
  /** The Knowledge_Update that triggered the candidate (Req 15.8). */
  knowledgeUpdateId: string;
  /** When the case entered the queue (the candidate's createdAt). */
  enqueuedAt: string;
}

/** Build the review-queue entry for a created candidate (Req 15.3). */
export function reviewQueueEntryOf(candidate: ReanalysisCandidate): ReviewQueueEntry {
  return {
    caseId: candidate.caseId,
    candidateId: candidate.id,
    knowledgeUpdateId: candidate.knowledgeUpdateId,
    enqueuedAt: candidate.createdAt
  };
}

/**
 * Order review-queue entries deterministically: oldest-first by `enqueuedAt`,
 * breaking ties by candidate id (mirrors persistence GSI3 SK `<createdAt>#<id>`).
 */
function compareQueueEntries(a: ReviewQueueEntry, b: ReviewQueueEntry): number {
  const byTime = compareStrings(a.enqueuedAt, b.enqueuedAt);
  return byTime !== 0 ? byTime : compareStrings(a.candidateId, b.candidateId);
}

// ---------------------------------------------------------------------------
// Batch matching (one update against many unresolved cases)
// ---------------------------------------------------------------------------

/**
 * Result of matching one Knowledge_Update against a set of unresolved case
 * feature vectors (design reanalysis loop; Req 15.1, 15.2, 15.3, 15.8, 15.9).
 */
export interface ReanalysisMatchBatch {
  /** Created candidates, one per affected case, in stable case-id order. */
  candidates: ReanalysisCandidate[];
  /** Review-queue entries for the affected cases, oldest-first (Req 15.3). */
  reviewQueue: ReviewQueueEntry[];
}

/**
 * Match a Knowledge_Update against many unresolved case feature vectors
 * (Req 15.1, 15.2, 15.3, 15.8, 15.9).
 *
 * Pure and deterministic. Produces a `ReanalysisCandidate` for every case whose
 * normalised feature vector intersects the update delta, links each to the
 * triggering update, and returns the corresponding review-queue entries. Cases
 * with an empty intersection contribute no candidate (Req 15.9). Candidates are
 * returned in stable case-id order and the review queue is ordered oldest-first.
 */
export function matchUnresolvedCases(
  features: readonly CaseFeatureVector[],
  update: KnowledgeUpdate,
  options: MatchOptions
): ReanalysisMatchBatch {
  const candidates: ReanalysisCandidate[] = [];

  for (const feature of features) {
    const result = matchCase(feature, update, options);
    if (result.candidate !== null) {
      candidates.push(result.candidate);
    }
  }

  candidates.sort((a, b) => compareStrings(a.caseId, b.caseId));

  const reviewQueue = candidates.map(reviewQueueEntryOf).sort(compareQueueEntries);

  return { candidates, reviewQueue };
}
