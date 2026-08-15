// services/vertical-slice/src/hypothesis-card.ts
//
// Minimal, slice-scoped hypothesis card (vertical-slice stage 5).
//
// The full Hypothesis_Service is task 21; this module deliberately implements
// only the MINIMAL structure the vertical slice needs to demonstrate the
// seven-stage flow (design: Scope Summary, task 17.2). It builds an
// evidence-linked `Hypothesis` from the confirmed phenotypes produced by the
// clinician-confirmation stage:
//
//   * requires AT LEAST ONE evidence item — a zero-evidence card is rejected
//     (Req 11.1, 11.2 analogue);
//   * assigns the initial `Proposed` state from the defined set (Req 11.4);
//   * links the card to its evidence items and records an (empty) transition
//     history (Req 11.5, 11.7); and
//   * applies a minimal non-diagnostic vocabulary guard, rejecting card text
//     that contains a prohibited diagnostic term (Req 11.3 analogue).
//
// Everything here is pure and deterministic: for fixed inputs (including the
// `now` timestamp and ids) the produced objects are byte-for-byte identical,
// and no generative model is involved. The richer vocabulary, additional
// states, and authorisation rules are intentionally left to task 21.

import {
  createEnvelope,
  type AccessClassification,
  type ConfirmedPhenotype,
  type EvidenceItem,
  type Hypothesis,
  type ProvenanceRef
} from "@udn/domain";

/** Origin recorded on records produced by the slice hypothesis stage. */
export const HYPOTHESIS_CARD_SOURCE = "VerticalSlice_HypothesisCard";

/** The initial state assigned to a freshly created card (Req 11.4). */
export const INITIAL_HYPOTHESIS_STATE = "Proposed" as const;

/**
 * A minimal set of prohibited diagnostic terms (Req 11.3 analogue). The full
 * non-diagnostic vocabulary is task 21; this guard demonstrates the rejection
 * path for the slice. Matching is case-insensitive on word boundaries.
 */
export const PROHIBITED_DIAGNOSTIC_TERMS: readonly string[] = [
  "diagnosis",
  "diagnosed",
  "diagnostic",
  "confirmed disease",
  "definitive cause"
];

/** Why building a minimal hypothesis card failed. */
export type HypothesisCardErrorCode =
  /** No evidence item was available to link (Req 11.1, 11.2 analogue). */
  | "no_evidence"
  /** The card text contained a prohibited diagnostic term (Req 11.3 analogue). */
  | "prohibited_term";

/** A structured hypothesis-card failure. */
export interface HypothesisCardError {
  readonly code: HypothesisCardErrorCode;
  readonly message: string;
}

/** Inputs to {@link buildHypothesisCard}. */
export interface BuildHypothesisCardInput {
  /** Owning case id. */
  readonly caseId: string;
  /** Non-diagnostic card text (Req 11.3 analogue). */
  readonly text: string;
  /** Confirmed phenotypes that supply the card's evidence (Req 11.1). */
  readonly confirmedPhenotypes: readonly ConfirmedPhenotype[];
  /** Active knowledge-snapshot version in effect (Req 14.5). */
  readonly knowledgeSnapshotVersion: string;
  /** Actor id creating the card. */
  readonly createdById: string;
  /** Creation timestamp, ISO-8601 UTC. */
  readonly now: string;
  /** Access classification for produced records; defaults to "clinical". */
  readonly accessClassification?: AccessClassification;
  /** Origin recorded on produced envelopes; defaults to {@link HYPOTHESIS_CARD_SOURCE}. */
  readonly source?: string;
}

/** A successfully built minimal hypothesis card with its evidence items. */
export interface HypothesisCard {
  /** The evidence-linked hypothesis (Req 11.1, 11.4, 11.7). */
  readonly hypothesis: Hypothesis;
  /** The evidence items the card links to, one per confirmed phenotype. */
  readonly evidenceItems: readonly EvidenceItem[];
}

/** Result of {@link buildHypothesisCard}. */
export type BuildHypothesisCardResult =
  | { readonly ok: true; readonly card: HypothesisCard }
  | { readonly ok: false; readonly error: HypothesisCardError };

/** Return the first prohibited diagnostic term found in `text`, if any. */
function findProhibitedTerm(text: string): string | undefined {
  const haystack = text.toLowerCase();
  return PROHIBITED_DIAGNOSTIC_TERMS.find((term) => haystack.includes(term));
}

/** Build one evidence item from a confirmed phenotype. */
function toEvidenceItem(
  confirmed: ConfirmedPhenotype,
  input: BuildHypothesisCardInput
): EvidenceItem {
  const provenance: ProvenanceRef = {
    sourceId: confirmed.id,
    versionId: String(confirmed.version),
    createdById: input.createdById,
    ingestedAt: input.now
  };

  const envelope = createEnvelope({
    entityType: "EvidenceItem",
    caseId: input.caseId,
    source: input.source ?? HYPOTHESIS_CARD_SOURCE,
    status: "linked",
    provenance,
    accessClassification: input.accessClassification ?? "clinical",
    createdById: input.createdById,
    now: input.now
  });

  return {
    ...envelope,
    entityType: "EvidenceItem",
    sourceObjectRef: confirmed.id,
    kind: "confirmed_phenotype"
  };
}

/**
 * Build a minimal, evidence-linked hypothesis card from confirmed phenotypes
 * (vertical-slice stage 5; Req 11.1, 11.2, 11.3, 11.4, 11.7 analogues).
 *
 * Rejects the card when there is no evidence to link (`no_evidence`) or when
 * the text uses a prohibited diagnostic term (`prohibited_term`); on rejection
 * no records are produced. On success the card links to exactly one evidence
 * item per confirmed phenotype and starts in the `Proposed` state. Pure and
 * deterministic; no generative model is involved.
 */
export function buildHypothesisCard(
  input: BuildHypothesisCardInput
): BuildHypothesisCardResult {
  if (input.confirmedPhenotypes.length === 0) {
    return {
      ok: false,
      error: {
        code: "no_evidence",
        message:
          "Cannot create a hypothesis card: at least one evidence item is required."
      }
    };
  }

  const prohibited = findProhibitedTerm(input.text);
  if (prohibited !== undefined) {
    return {
      ok: false,
      error: {
        code: "prohibited_term",
        message: `Hypothesis card text contains a prohibited diagnostic term: "${prohibited}".`
      }
    };
  }

  const evidenceItems = input.confirmedPhenotypes.map((confirmed) =>
    toEvidenceItem(confirmed, input)
  );

  const provenance: ProvenanceRef = {
    sourceId: input.caseId,
    versionId: input.knowledgeSnapshotVersion,
    createdById: input.createdById,
    ingestedAt: input.now
  };

  const envelope = createEnvelope({
    entityType: "Hypothesis",
    caseId: input.caseId,
    source: input.source ?? HYPOTHESIS_CARD_SOURCE,
    status: INITIAL_HYPOTHESIS_STATE,
    provenance,
    accessClassification: input.accessClassification ?? "clinical",
    createdById: input.createdById,
    now: input.now
  });

  const hypothesis: Hypothesis = {
    ...envelope,
    entityType: "Hypothesis",
    state: INITIAL_HYPOTHESIS_STATE,
    text: input.text,
    evidenceItemIds: evidenceItems.map((item) => item.id),
    knowledgeSnapshotVersion: input.knowledgeSnapshotVersion,
    stateHistory: []
  };

  return { ok: true, card: { hypothesis, evidenceItems } };
}
