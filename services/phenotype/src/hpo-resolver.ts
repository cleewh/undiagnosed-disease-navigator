// services/phenotype/src/hpo-resolver.ts
//
// HPO resolution seam (Requirement 5.2, 5.5, 5.7).
//
// The AI_Gateway returns grounded phenotype STATEMENTS as free text (see the
// AI response schema in @udn/ai-gateway); it does not itself emit Human
// Phenotype Ontology (HPO) identifiers. The Phenotype_Service therefore maps
// each extracted phenotype term to HPO terms through an injectable
// `HpoResolver`. Keeping resolution behind a narrow seam means the service is
// unit-testable with a deterministic in-memory lexicon and no external
// ontology dependency, while production can swap in a real HPO index.
//
// A term is UNRESOLVABLE (Req 5.7) when the resolver yields no HPO mapping that
// is a valid, known identifier. The service marks such candidates "unresolved"
// and flags them for review rather than discarding them.

import type { HpoMapping } from "@udn/domain";

/**
 * The canonical shape of a valid HPO identifier, e.g. `HP:0001250`
 * (seven digits, zero-padded). Used by the default resolver's validity check.
 */
export const HPO_ID_PATTERN = /^HP:\d{7}$/;

/**
 * Whether `hpoId` is syntactically a valid HPO identifier (Req 5.7). This is a
 * format check only; membership in a known ontology is an additional, optional
 * constraint enforced by {@link createLexiconHpoResolver} via its `knownHpoIds`.
 */
export function isValidHpoIdFormat(hpoId: string): boolean {
  return HPO_ID_PATTERN.test(hpoId);
}

/**
 * The result of resolving a single phenotype term to HPO terms.
 *
 * `mappings` are the HPO terms chosen for the candidate (Req 5.2: 1-20 when the
 * term resolves). `alternatives` are additional plausible mappings surfaced for
 * reviewer consideration (Req 5.5: up to 10, ordered by descending confidence).
 * Both lists may contain ids the service will reject as invalid/unknown; the
 * service filters them, and a term whose `mappings` yields no valid id is
 * treated as unresolvable (Req 5.7).
 */
export interface HpoResolution {
  /** Chosen HPO mappings for the term (best-first is not required; the service sorts). */
  readonly mappings: readonly HpoMapping[];
  /** Alternative plausible mappings for the term (optional). */
  readonly alternatives?: readonly HpoMapping[];
}

/**
 * Injectable HPO resolution seam (Req 5.2, 5.5, 5.7).
 *
 * Implementations map a phenotype term (the AI statement text) to HPO terms.
 * Returning an empty `mappings` — or only invalid/unknown ids — signals the
 * term is unresolvable.
 */
export interface HpoResolver {
  /** Resolve a phenotype term to HPO mappings and alternatives. */
  resolve(term: string): HpoResolution;
  /** Whether an HPO id is valid AND known to this resolver (Req 5.7). */
  isValidHpoId(hpoId: string): boolean;
}

/** A lexicon entry: the mappings and optional alternatives for one term. */
export interface HpoLexiconEntry {
  readonly mappings: readonly HpoMapping[];
  readonly alternatives?: readonly HpoMapping[];
}

/** Options for {@link createLexiconHpoResolver}. */
export interface LexiconHpoResolverOptions {
  /**
   * Term -> resolution lexicon. Keys are matched case-insensitively after
   * trimming surrounding whitespace so incidental casing/spacing does not cause
   * a miss.
   */
  readonly lexicon: Record<string, HpoLexiconEntry>;
  /**
   * Optional allowlist of HPO ids considered "known". When provided, an id must
   * be BOTH syntactically valid and present in this set to be accepted; when
   * omitted, only the syntactic format check applies.
   */
  readonly knownHpoIds?: Iterable<string>;
}

/** Normalise a term for lexicon lookup (trim + lowercase). */
function normaliseTerm(term: string): string {
  return term.trim().toLowerCase();
}

/**
 * Create a deterministic, in-memory {@link HpoResolver} backed by a lexicon
 * (Req 5.2, 5.5, 5.7). Suitable for tests and demo data; production can provide
 * an alternative resolver implementing the same seam.
 *
 * An id is accepted only when it passes {@link isValidHpoIdFormat} and, if a
 * `knownHpoIds` allowlist is supplied, is a member of it. A term absent from
 * the lexicon resolves to empty mappings (unresolvable).
 */
export function createLexiconHpoResolver(
  options: LexiconHpoResolverOptions
): HpoResolver {
  const table = new Map<string, HpoLexiconEntry>();
  for (const [term, entry] of Object.entries(options.lexicon)) {
    table.set(normaliseTerm(term), entry);
  }
  const known = options.knownHpoIds ? new Set(options.knownHpoIds) : undefined;

  const isValidHpoId = (hpoId: string): boolean => {
    if (!isValidHpoIdFormat(hpoId)) {
      return false;
    }
    return known === undefined || known.has(hpoId);
  };

  return {
    isValidHpoId,
    resolve(term: string): HpoResolution {
      const entry = table.get(normaliseTerm(term));
      if (entry === undefined) {
        return { mappings: [] };
      }
      return {
        mappings: entry.mappings,
        ...(entry.alternatives !== undefined ? { alternatives: entry.alternatives } : {})
      };
    }
  };
}
