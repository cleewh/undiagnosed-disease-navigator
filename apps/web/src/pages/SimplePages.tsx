import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Page } from "../components/Page.js";
import { RankedVariantList } from "../components/RankedVariantList.js";
import { AuditHistory } from "../components/AuditHistory.js";
import { GuidedDemo } from "../components/GuidedDemo.js";
import { DataSourcesNote } from "../components/DataSourcesNote.js";
import { Icon, toneIconName } from "../components/icons.js";
import { LIBRARY_CASES } from "../data/reference.js";
import { useAuth } from "../auth/AuthContext.js";
import {
  GUIDED_DEMO_MAX_DURATION_SECONDS,
  GUIDED_DEMO_MIN_DURATION_SECONDS,
  GUIDED_DEMO_STEP_COUNT
} from "./guided-demo-steps.js";
import {
  SAMPLE_PRIORITISATION_LOGIC_VERSION,
  SAMPLE_RANKED_ITEMS
} from "./variant-review-sample.js";
import { SAMPLE_LIBRARY_AUDIT_EVENTS } from "./audit-history-sample.js";

// Presentational pages for the app shell. All content shown is clearly-labelled
// synthetic demonstration data (the synthetic-data indicator and research /
// clinical classification label appear on every case-bearing view). Interactive
// controls are illustrative until the backend API is wired.

export function DashboardPage() {
  const { role, session } = useAuth();
  const name = session?.name ?? "colleague";

  return (
    <Page title="Dashboard" showsCaseData classification="research">
      <section className="role-hero" aria-label="Your workspace">
        <p className="role-hero__eyebrow">{role ? role.label : "Multidisciplinary team"}</p>
        <h2 className="role-hero__greeting">Welcome, {name}</h2>
        <p className="role-hero__focus">{role ? role.focus : "Case library overview."}</p>
      </section>

      {role && (
        <>
          <ul className="kpi-grid" aria-label="Your key metrics">
            {role.kpis.map((kpi) => (
              <li key={kpi.label} className={`kpi-card kpi-card--${kpi.tone}`}>
                <div className="kpi-card__head">
                  <span className={`kpi-card__icon kpi-card__icon--${kpi.tone}`}>
                    <Icon name={toneIconName(kpi.tone)} size={18} />
                  </span>
                  <p className="kpi-card__value">{kpi.value}</p>
                </div>
                <p className="kpi-card__label">{kpi.label}</p>
                <p className="kpi-card__hint">{kpi.hint}</p>
              </li>
            ))}
          </ul>

          <div className="dashboard-columns">
            <section className="card queue-card" aria-label={role.queueTitle}>
              <div className="card__header">
                <div>
                  <h2 className="card__title">{role.queueTitle}</h2>
                  <p className="card__subtitle">Prioritised for your role. Synthetic demonstration items.</p>
                </div>
                <span className="pill pill--neutral">{role.queue.length} items</span>
              </div>
              <ul className="queue-list">
                {role.queue.map((item) => (
                  <li key={item.primary} className="queue-item">
                    <span className={`queue-item__severity queue-item__severity--${item.tone}`} aria-hidden="true" />
                    <span className="queue-item__body">
                      <span className="queue-item__primary">{item.primary}</span>
                      <span className="queue-item__meta">{item.meta}</span>
                    </span>
                    <span className={`pill pill--${item.tone}`}>{item.tag}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card quick-actions" aria-label="Quick actions">
              <h2 className="card__title">Quick actions</h2>
              <p className="card__subtitle">Jump to where your work happens.</p>
              <div className="quick-actions__list">
                {role.quickActions.map((action) => (
                  <Link key={action.to} to={action.to} className="quick-action">
                    <span className="quick-action__label">{action.label}</span>
                    <Icon name="arrow-right" className="quick-action__icon" size={16} />
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      <section className="card" aria-label="Recent synthetic cases">
        <h2 className="card__title">Recent cases across the library</h2>
        <p className="card__subtitle">Synthetic cases, each grounded in a real candidate gene and disease.</p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Clinical area</th>
                <th scope="col">Candidate gene</th>
                <th scope="col">Disease</th>
                <th scope="col">Status</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {LIBRARY_CASES.map((row) => (
                <tr key={row.id}>
                  <td><code>{row.id}</code></td>
                  <td>{row.area}</td>
                  <td><strong>{row.candidateGene}</strong></td>
                  <td>{row.disease}</td>
                  <td><span className={`pill pill--${row.statusTone}`}>{row.status}</span></td>
                  <td>{row.updated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <DataSourcesNote />
    </Page>
  );
}

/** A clearly-synthetic phenotype candidate for the review list. */
interface DemoCandidate {
  readonly hpoId: string;
  readonly label: string;
  readonly assertion: string;
  readonly confidence: string;
  readonly confidenceKind: "success" | "warning" | "danger";
  readonly source: string;
}

const DEMO_CANDIDATES: readonly DemoCandidate[] = [
  { hpoId: "HP:0001250", label: "Seizure", assertion: "Present", confidence: "High", confidenceKind: "success", source: "Clinical note 2023-06-04" },
  { hpoId: "HP:0001263", label: "Global developmental delay", assertion: "Present", confidence: "Moderate", confidenceKind: "warning", source: "Encounter summary 2022-11-18" },
  { hpoId: "HP:0002376", label: "Developmental regression", assertion: "Uncertain", confidence: "Low", confidenceKind: "danger", source: "Referral letter 2022-09-02" }
];

type PhenotypeDecision = "pending" | "confirmed" | "rejected";

export function PhenotypeReviewPage() {
  const [decisions, setDecisions] = useState<Readonly<Record<string, PhenotypeDecision>>>(() =>
    Object.fromEntries(DEMO_CANDIDATES.map((c) => [c.hpoId, "pending" as PhenotypeDecision]))
  );
  const [message, setMessage] = useState<string>("");

  const decide = (candidate: DemoCandidate, decision: PhenotypeDecision) => {
    setDecisions((prev) => ({ ...prev, [candidate.hpoId]: decision }));
    setMessage(
      decision === "pending"
        ? `${candidate.label} returned to pending.`
        : `${candidate.label} ${decision}.`
    );
  };

  const counts = useMemo(() => {
    const values = Object.values(decisions);
    return {
      confirmed: values.filter((d) => d === "confirmed").length,
      rejected: values.filter((d) => d === "rejected").length,
      pending: values.filter((d) => d === "pending").length,
      total: values.length
    };
  }, [decisions]);

  const reviewed = counts.confirmed + counts.rejected;

  return (
    <Page title="Phenotype-review" showsCaseData classification="research">
      <p className="page-intro">Review and confirm extracted phenotype candidates.</p>

      <div className="review-bar" aria-label="Review progress">
        <div className="review-bar__meta">
          <strong>{reviewed}</strong> of {counts.total} reviewed
        </div>
        <div className="review-bar__pills">
          <span className="pill pill--success">{counts.confirmed} confirmed</span>
          <span className="pill pill--danger">{counts.rejected} rejected</span>
          <span className="pill pill--neutral">{counts.pending} pending</span>
        </div>
      </div>
      <p role="status" aria-live="polite" className="visually-hidden">{message}</p>

      <ul className="card-grid" aria-label="Phenotype candidates">
        {DEMO_CANDIDATES.map((candidate) => {
          const decision = decisions[candidate.hpoId] ?? "pending";
          return (
            <li
              key={candidate.hpoId}
              className={`card review-card review-card--${decision}`}
              data-testid={`phenotype-${candidate.hpoId}`}
            >
              <h2 className="card__title">{candidate.label}</h2>
              <p className="card__subtitle"><code>{candidate.hpoId}</code></p>
              <p>
                <span className="pill pill--neutral">{candidate.assertion}</span>{" "}
                <span className={`pill pill--${candidate.confidenceKind}`}>
                  Confidence: {candidate.confidence}
                </span>
              </p>
              <p className="ranked-variants__factor-detail">Source: {candidate.source}</p>

              {decision === "pending" ? (
                <div className="btn-row">
                  <button type="button" className="btn btn--primary" onClick={() => decide(candidate, "confirmed")}>
                    Approve
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => decide(candidate, "rejected")}>
                    Reject
                  </button>
                </div>
              ) : (
                <div className="review-card__decided">
                  <span className={`pill pill--${decision === "confirmed" ? "success" : "danger"}`}>
                    {decision === "confirmed" ? "Confirmed" : "Rejected"}
                  </span>
                  <button type="button" className="btn btn--ghost" onClick={() => decide(candidate, "pending")}>
                    Undo
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Page>
  );
}

export function VariantReviewPage() {
  return (
    <Page title="Variant-review" showsCaseData classification="research">
      <p className="page-intro">
        Ranked variants and genes with per-factor explanations. Ranking is deterministic; each item
        lists every scoring factor and its contribution, with links to supporting evidence.
      </p>
      <RankedVariantList
        items={SAMPLE_RANKED_ITEMS}
        logicVersion={SAMPLE_PRIORITISATION_LOGIC_VERSION}
      />
      <DataSourcesNote />
    </Page>
  );
}

/** A clearly-synthetic hypothesis card for the board. */
interface DemoHypothesis {
  readonly title: string;
  readonly state: string;
  readonly stateKind: "info" | "success" | "warning" | "neutral";
  readonly evidence: number;
  readonly summary: string;
}

const DEMO_HYPOTHESES: readonly DemoHypothesis[] = [
  { title: "Candidate channelopathy explanation", state: "Under review", stateKind: "info", evidence: 4, summary: "Consistent with the confirmed seizure phenotype and a rare SCN-family variant." },
  { title: "Possible mitochondrial contributor", state: "Proposed", stateKind: "neutral", evidence: 2, summary: "Supported by lactate observations; warrants further review." },
  { title: "Structural variant hypothesis", state: "Supported", stateKind: "success", evidence: 5, summary: "CNV overlaps a dosage-sensitive region associated with the case phenotypes." }
];

export function HypothesisBoardPage() {
  return (
    <Page title="Hypothesis board" showsCaseData classification="research">
      <p className="page-intro">Evidence-linked hypothesis cards. Every card retains at least one evidence link and uses non-diagnostic wording.</p>
      <ul className="card-grid" aria-label="Hypothesis cards">
        {DEMO_HYPOTHESES.map((h) => (
          <li key={h.title} className="card">
            <h2 className="card__title">{h.title}</h2>
            <p>
              <span className={`pill pill--${h.stateKind}`}>{h.state}</span>{" "}
              <span className="pill pill--neutral">{h.evidence} evidence links</span>
            </p>
            <p className="card__subtitle">{h.summary}</p>
          </li>
        ))}
      </ul>
    </Page>
  );
}

/** A clearly-synthetic re-surfaced case for the reanalysis inbox. */
interface DemoReanalysis {
  readonly caseId: string;
  readonly matched: string;
  readonly update: string;
  readonly when: string;
}

interface ReanalysisComparisonRow {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly changed: boolean;
}

interface DemoReanalysisFull extends DemoReanalysis {
  readonly comparison: readonly ReanalysisComparisonRow[];
}

const DEMO_REANALYSIS: readonly DemoReanalysisFull[] = [
  {
    caseId: "UDN-SYN-0021",
    matched: "Gene SCN1A",
    update: "KU-2025-014",
    when: "2025-02-14 11:20 UTC",
    comparison: [
      { label: "SCN1A variant classification", before: "Uncertain significance", after: "Likely pathogenic", changed: true },
      { label: "Rank position", before: "#4", after: "#1", changed: true },
      { label: "Supporting publications", before: "2", after: "5", changed: true },
      { label: "Case status", before: "Unresolved", after: "Candidate found (review)", changed: true }
    ]
  },
  {
    caseId: "UDN-SYN-0033",
    matched: "Variant chr12:… (VAR-9)",
    update: "KU-2025-013",
    when: "2025-02-13 09:02 UTC",
    comparison: [
      { label: "VAR-9 classification", before: "Likely benign", after: "Uncertain significance", changed: true },
      { label: "Rank position", before: "#12", after: "#6", changed: true },
      { label: "Case status", before: "Unresolved", after: "Unresolved", changed: false }
    ]
  }
];

export function ReanalysisInboxPage() {
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const openCase = DEMO_REANALYSIS.find((r) => r.caseId === openCaseId) ?? null;

  return (
    <Page title="Reanalysis inbox" showsCaseData classification="research">
      <p className="page-intro">
        Cases re-surfaced after a simulated knowledge update referenced a stored variant, gene, or
        phenotype. Review a reanalysis run to see the before / after comparison.
      </p>
      <section className="card" aria-label="Re-surfaced cases">
        <h2 className="card__title">Awaiting reanalysis</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Matched reference</th>
                <th scope="col">Triggering update</th>
                <th scope="col">Queued</th>
                <th scope="col"><span className="visually-hidden">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {DEMO_REANALYSIS.map((r) => {
                const isOpen = r.caseId === openCaseId;
                return (
                  <tr key={r.caseId}>
                    <td><code>{r.caseId}</code></td>
                    <td><span className="pill pill--info">{r.matched}</span></td>
                    <td><code>{r.update}</code></td>
                    <td>{r.when}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--primary"
                        aria-expanded={isOpen}
                        onClick={() => setOpenCaseId(isOpen ? null : r.caseId)}
                      >
                        {isOpen ? "Hide" : "Review"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {openCase && (
        <section className="card compare-card" aria-label={`Before and after comparison for ${openCase.caseId}`}>
          <div className="card__header">
            <div>
              <h2 className="card__title">Before / after · <code>{openCase.caseId}</code></h2>
              <p className="card__subtitle">
                Triggered by <code>{openCase.update}</code> ({openCase.matched}). Synthetic comparison.
              </p>
            </div>
            <span className="pill pill--info">
              {openCase.comparison.filter((c) => c.changed).length} changes
            </span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">Before and after comparison</caption>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {openCase.comparison.map((row) => (
                  <tr key={row.label} className={row.changed ? "compare-row--changed" : undefined}>
                    <td>{row.label}</td>
                    <td className="compare-before">{row.before}</td>
                    <td className="compare-after">
                      {row.after}
                      {row.changed && <span className="pill pill--success compare-badge">changed</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Page>
  );
}

export function AuditViewerPage() {
  return (
    <Page title="Audit viewer" showsCaseData classification="research">
      <p className="page-intro">
        Immutable audit history across the case library. Each event records the actor, the action,
        the affected object, and the UTC timestamp; corrections of AI output show both the original
        and corrected values.
      </p>
      <AuditHistory
        events={SAMPLE_LIBRARY_AUDIT_EVENTS}
        caption="Immutable audit history across the case library"
      />
    </Page>
  );
}

export function GuidedDemoPage() {
  const minutesLow = Math.round(GUIDED_DEMO_MIN_DURATION_SECONDS / 60);
  const minutesHigh = Math.round(GUIDED_DEMO_MAX_DURATION_SECONDS / 60);
  return (
    <Page title="Guided demo" showsCaseData classification="research">
      <p className="page-intro">
        A guided walkthrough of the knowledge-triggered reanalysis scenario, presented one step at
        a time from the first step to the final result. Run end to end without manual pauses, it
        completes in {minutesLow} to {minutesHigh} minutes across {GUIDED_DEMO_STEP_COUNT} steps.
      </p>
      <GuidedDemo />
    </Page>
  );
}

export function NotFoundPage() {
  return (
    <Page title="Page not found">
      <p className="page-intro">The requested page does not exist.</p>
    </Page>
  );
}
