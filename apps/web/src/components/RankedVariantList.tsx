// Presentational Variant-review screen (Task 21.2, Req 24.1).
//
// Renders the deterministically ranked variants/genes produced by the
// Prioritisation_Service (Req 10): each ranked item shows its per-factor
// explanation (every deterministic scoring factor and its contribution,
// Req 10.5) and its evidence links (links to the supporting source objects).
// This component is purely presentational and props-driven — it performs no
// scoring itself and contains no AI-generated interpretation (Req 10.6).

export type RankedItemKind = "variant" | "gene";

/** One deterministic scoring factor and its contribution to the total score. */
export interface FactorExplanation {
  /** Stable factor identifier (e.g. "consequence-severity"). */
  readonly id: string;
  /** Human-readable factor name shown to the reviewer. */
  readonly label: string;
  /** Weighted contribution this factor made to the total score. */
  readonly contribution: number;
  /** Optional deterministic detail (e.g. the observed value or bin). */
  readonly detail?: string;
}

/** A link to a supporting source object for a ranked item. */
export interface EvidenceLink {
  readonly id: string;
  /** Human-readable label for the source object. */
  readonly label: string;
  /** Location of the source object (in-app route or resource URL). */
  readonly href: string;
}

/** View model for a single ranked variant or gene. */
export interface RankedItemView {
  /** Stable variant/gene identifier used for the tie-break order (Req 10.2). */
  readonly id: string;
  readonly kind: RankedItemKind;
  /** 1-based rank position within the ordering. */
  readonly rank: number;
  /** Display label, e.g. a gene symbol or HGVS variant string. */
  readonly label: string;
  /** Total deterministic score (weighted sum of the factor contributions). */
  readonly score: number;
  /** Every deterministic factor that produced the rank (Req 10.5). */
  readonly factors: readonly FactorExplanation[];
  /** Links to the supporting source objects for this item. */
  readonly evidenceLinks: readonly EvidenceLink[];
}

export interface RankedVariantListProps {
  /** Ranked items in presentation order (already ordered by the service). */
  readonly items: readonly RankedItemView[];
  /** Prioritisation logic version recorded for the ranking (Req 10.7). */
  readonly logicVersion?: string;
  /** Message shown when there are no ranked items to display. */
  readonly emptyMessage?: string;
}

function formatContribution(value: number): string {
  // Explicit sign makes each factor's direction obvious to the reviewer.
  const sign = value >= 0 ? "+" : "\u2212"; // + or minus sign
  return `${sign}${Math.abs(value)}`;
}

/**
 * Renders ranked variants/genes with per-factor explanations and evidence
 * links. Semantic, accessible markup: an ordered list conveys the ranking, a
 * heading names each item, a description list enumerates the factors, and each
 * evidence link is a real anchor with accessible text.
 */
export function RankedVariantList({
  items,
  logicVersion,
  emptyMessage = "No ranked variants or genes are available for this case."
}: RankedVariantListProps) {
  if (items.length === 0) {
    return (
      <p data-testid="ranked-variants-empty" className="ranked-variants__empty">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="ranked-variants" data-testid="ranked-variants">
      {logicVersion !== undefined && (
        <p className="ranked-variants__logic-version" data-testid="ranked-variants-logic-version">
          Prioritisation logic version: <code>{logicVersion}</code>
        </p>
      )}
      <ol className="ranked-variants__list" data-testid="ranked-variants-list">
        {items.map((item) => (
          <li
            key={item.id}
            className="ranked-variants__item"
            data-testid={`ranked-item-${item.id}`}
          >
            <div className="ranked-variants__item-header">
              <h3 className="ranked-variants__item-title">
                <span className="ranked-variants__rank" aria-label={`Rank ${item.rank}`}>
                  #{item.rank}
                </span>{" "}
                {item.label}
                <span
                  className={`ranked-variants__kind ranked-variants__kind--${item.kind}`}
                  data-testid={`ranked-item-kind-${item.id}`}
                >
                  {item.kind === "gene" ? "Gene" : "Variant"}
                </span>
              </h3>
              <p className="ranked-variants__score" data-testid={`ranked-item-score-${item.id}`}>
                Score: <strong>{item.score}</strong>
              </p>
            </div>

            <section
              aria-label={`Scoring factors for ${item.label}`}
              className="ranked-variants__factors"
            >
              <h4 className="ranked-variants__subheading">Per-factor explanation</h4>
              <dl
                className="ranked-variants__factor-list"
                data-testid={`ranked-item-factors-${item.id}`}
              >
                {item.factors.map((factor) => (
                  <div key={factor.id} className="ranked-variants__factor">
                    <dt className="ranked-variants__factor-label">{factor.label}</dt>
                    <dd className="ranked-variants__factor-value">
                      <span className="ranked-variants__factor-contribution">
                        {formatContribution(factor.contribution)}
                      </span>
                      {factor.detail !== undefined && (
                        <span className="ranked-variants__factor-detail"> — {factor.detail}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section
              aria-label={`Evidence links for ${item.label}`}
              className="ranked-variants__evidence"
            >
              <h4 className="ranked-variants__subheading">Evidence</h4>
              {item.evidenceLinks.length === 0 ? (
                <p
                  className="ranked-variants__evidence-empty"
                  data-testid={`ranked-item-evidence-empty-${item.id}`}
                >
                  No linked evidence.
                </p>
              ) : (
                <ul
                  className="ranked-variants__evidence-list"
                  data-testid={`ranked-item-evidence-${item.id}`}
                >
                  {item.evidenceLinks.map((link) => (
                    <li key={link.id}>
                      <a href={link.href} className="ranked-variants__evidence-link">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </li>
        ))}
      </ol>
    </div>
  );
}
