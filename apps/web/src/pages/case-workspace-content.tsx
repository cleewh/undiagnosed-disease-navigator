import { useState } from "react";
import type { ReactNode } from "react";
import { AuditHistory } from "../components/AuditHistory.js";
import { DataSourcesNote } from "../components/DataSourcesNote.js";
import { Icon } from "../components/icons.js";
import { SAMPLE_CASE_AUDIT_EVENTS } from "./audit-history-sample.js";
import { MetricBars, EegTrace, Pedigree, GrowthChart, ProteinLollipop } from "../components/charts.js";
import { ImageViewer } from "../components/ImageViewer.js";
import { DiagnosticOdyssey } from "../components/DiagnosticOdyssey.js";
import { EvidenceGraph } from "../components/EvidenceGraph.js";
import { ChromosomeIdeogram } from "../components/ChromosomeIdeogram.js";
import { MdtBoardRoom } from "../components/MdtBoardRoom.js";
import { VoiceNote } from "../components/VoiceNote.js";
import { useRatifiedDecisions, ratifiedAsAuditEvents } from "../ai/mdtDecisions.js";
import { LiveTrials } from "../components/LiveTrials.js";
import { LiveVariantAnnotation } from "../components/LiveVariantAnnotation.js";
import { LiveGeneSummary, LiveConsequence, LivePhenotypeMatches } from "../components/LivePanels.js";
import { AiCaseSummary, AiCopilot, AiVariantExplanation, AiDifferentialSuggestions, AiTaskPanel, AiOversightPanel } from "../components/AiAssist.js";
import {
  CLINVAR_VARIANTS,
  FEATURED_PHENOTYPES,
  GENE_DISEASE,
  TRANSCRIPTOMICS,
  METABOLOMICS,
  METABOLIC_SCREEN,
  METHYLATION_SUMMARY,
  SPECIMEN,
  IMAGING_STUDIES,
  CLINICAL_NOTES,
  MANAGEMENT_PLAN,
  PHARMACOGENOMICS,
  MECP2_ACMG,
  MECP2_ACMG_RESULT,
  MECP2_METRICS,
  MECP2_PROTEIN,
  VARIANT_QC,
  PIPELINE,
  COUNSELLING,
  CONSENTS,
  DISEASE_MATCHES,
  THERAPEUTICS,
  DISEASE_CODES,
  MME_NODES,
  MME_MATCHES,
  CASE_SUMMARY
} from "../data/reference.js";

// Clearly-synthetic content for the twelve Case workspace tabs (Req 24.2).
// Everything here is demonstration data for a single synthetic case
// (UDN-SYN-0007); no real patient information is present. The content is
// presentational only — controls are illustrative until the API is wired.

type Tone = "info" | "warning" | "success" | "neutral" | "danger";

const FEATURED = GENE_DISEASE.MECP2;

/** Renders the header banner shown above the workspace tabs. */
export function CaseHeader() {
  const c = CASE_SUMMARY;
  return (
    <section className="case-header" aria-label="Case summary banner">
      <div className="case-header__main">
        <span className="case-header__avatar" aria-hidden="true">
          <Icon name="activity" size={22} />
        </span>
        <div>
          <p className="case-header__eyebrow">
            <code>{c.caseId}</code> · {c.area} · candidate {FEATURED.gene} ({FEATURED.disease})
          </p>
          <h2 className="case-header__title">{c.proband}</h2>
          <p className="case-header__demographics">{c.demographics}</p>
        </div>
      </div>
      <div className="case-header__facts">
        <span className={`pill pill--${c.statusTone}`}>{c.status}</span>
        <span className="pill pill--neutral">{c.stage}</span>
        <span className={`pill pill--${c.consentResearch ? "success" : "danger"}`}>
          Research consent: {c.consentResearch ? "yes" : "no"}
        </span>
        <span className={`pill pill--${c.consentMatching ? "success" : "warning"}`}>
          External matching: {c.consentMatching ? "yes" : "pending"}
        </span>
      </div>
    </section>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <h2 className="card__title">{title}</h2>
      {subtitle && <p className="card__subtitle">{subtitle}</p>}
      {children}
    </section>
  );
}

// ---- Overview ------------------------------------------------------------

interface AddedNote {
  readonly date: string;
  readonly author: string;
  readonly role: string;
  readonly body: string;
}

function Overview(): ReactNode {
  const c = CASE_SUMMARY;
  const [dictated, setDictated] = useState<readonly AddedNote[]>([]);
  const addDictated = (body: string) =>
    setDictated((prev) => [
      { date: new Date().toISOString().slice(0, 10), author: "Dictated note", role: "This session", body },
      ...prev
    ]);
  const facts: ReadonlyArray<{ label: string; value: string }> = [
    { label: "Lead clinician", value: c.leadClinician },
    { label: "Genetic counsellor", value: c.counsellor },
    { label: "Case coordinator", value: c.coordinator },
    { label: "Case opened", value: c.opened },
    { label: "Last activity", value: c.lastActivity },
    { label: "Classification", value: "Research (synthetic)" }
  ];
  const findings: readonly string[] = [
    "Confirmed seizure phenotype (HP:0001250) with early-childhood onset.",
    "Developmental regression (HP:0002376) documented after age 1–2 years.",
    `Trio exome complete; candidate ${CLINVAR_VARIANTS.MECP2.gene} variant identified.`,
    "External matching consent not yet obtained (blocks cohort matching)."
  ];
  return (
    <>
      <div className="cw-grid">
        <Section title="Case summary" subtitle="Synthetic demonstration case; real reference vocabulary.">
          <dl className="def-list">
            {facts.map((f) => (
              <div key={f.label} className="def-list__row">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
            <div className="def-list__row">
              <dt>Working diagnosis</dt>
              <dd>{FEATURED.disease} (OMIM {FEATURED.omim})</dd>
            </div>
          </dl>
        </Section>
        <Section title="Key findings so far" subtitle="Non-diagnostic working summary.">
          <ul className="key-list">
            {findings.map((f) => (
              <li key={f}>
                <Icon name="check-circle" size={16} className="key-list__icon" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="cw-grid">
        <AiCaseSummary />
        <AiCopilot />
      </div>

      <AiOversightPanel />

      <Section title="Working diagnosis — standard coding" subtitle="Real terminology codes for Rett syndrome.">
        <ul className="code-list" aria-label="Standard disease codes">
          {DISEASE_CODES.map((c) => (
            <li key={c.system} className="code-chip">
              <span className="code-chip__system">{c.system}</span>
              <a className="code-chip__code" href={c.url} target="_blank" rel="noreferrer">{c.code}</a>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Clinical notes" subtitle="Synthetic narrative notes from the MDT.">
        <VoiceNote onSave={addDictated} />
        <ul className="notes-list">
          {dictated.map((note, i) => (
            <li key={`dictated-${i}`} className="note note--dictated">
              <div className="note__head">
                <span className="note__author">{note.author}</span>
                <span className="note__role">{note.role}</span>
                <time className="note__date" dateTime={note.date}>{note.date}</time>
              </div>
              <p className="note__body">{note.body}</p>
            </li>
          ))}
          {CLINICAL_NOTES.map((note) => (
            <li key={`${note.date}-${note.author}`} className="note">
              <div className="note__head">
                <span className="note__author">{note.author}</span>
                <span className="note__role">{note.role}</span>
                <time className="note__date" dateTime={note.date}>{note.date}</time>
              </div>
              <p className="note__body">{note.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <DataSourcesNote />
    </>
  );
}

// ---- Timeline ------------------------------------------------------------

interface TimelineEvent {
  readonly when: string;
  readonly title: string;
  readonly meta: string;
  readonly tone: Tone;
}

function Timeline(): ReactNode {
  const events: readonly TimelineEvent[] = [
    { when: "2025-02-14", title: "Analysis run approved", meta: "Trio exome · Dr. Ada Okonkwo", tone: "success" },
    { when: "2025-02-14", title: "Phenotype correction recorded", meta: "Status epilepticus confirmed", tone: "info" },
    { when: "2025-02-13", title: "Hypothesis proposed", meta: "MECP2 loss-of-function explanation (Rett syndrome)", tone: "info" },
    { when: "2025-02-13", title: "Variant prioritised", meta: "MECP2 c.502C>T (p.Arg168*) surfaced as top candidate", tone: "warning" },
    { when: "2025-02-12", title: "Case created from intake", meta: "system:intake-pipeline", tone: "neutral" }
  ];
  return (
    <Section title="Case timeline" subtitle="Chronological synthetic activity, most recent first.">
      <h3 className="cw-subheading">Diagnostic odyssey — animated replay</h3>
      <p className="card__subtitle">Play or scrub the full journey from intake to working diagnosis.</p>
      <DiagnosticOdyssey />

      <h3 className="cw-subheading">Activity log</h3>
      <ol className="timeline">
        {events.map((e, i) => (
          <li key={`${e.when}-${i}`} className="timeline__item">
            <span className={`timeline__marker timeline__marker--${e.tone}`} aria-hidden="true" />
            <div className="timeline__body">
              <p className="timeline__title">{e.title}</p>
              <p className="timeline__meta">
                <time dateTime={e.when}>{e.when}</time> · {e.meta}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ---- Phenotypes ----------------------------------------------------------

function Phenotypes(): ReactNode {
  return (
    <Section title="Phenotypes" subtitle="Real HPO terms with review status (patient data synthetic).">
      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">Phenotype terms for this case</caption>
          <thead>
            <tr>
              <th scope="col">HPO term</th>
              <th scope="col">Label</th>
              <th scope="col">Status</th>
              <th scope="col">Onset</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {FEATURED_PHENOTYPES.map((r) => (
              <tr key={r.id}>
                <td><code>{r.id}</code></td>
                <td>{r.label}</td>
                <td><span className={`pill pill--${r.tone}`}>{r.status}</span></td>
                <td>{r.onset}</td>
                <td>{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="cw-subheading">Candidate disease matches (phenotype similarity)</h3>
      <p className="card__subtitle">
        Ranked by HPO term overlap against real disease profiles. Diseases, genes and OMIM
        identifiers are real; similarity scores are illustrative.
      </p>
      <ul className="match-list">
        {DISEASE_MATCHES.map((m) => (
          <li key={m.disease} className="match-item">
            <div className="match-item__head">
              <span className="match-item__disease">{m.disease}</span>
              <span className="match-item__gene"><strong>{m.gene}</strong> · OMIM {m.omim}</span>
              <span className={`pill pill--${m.tone}`}>{m.score}% match</span>
            </div>
            <div className="match-item__bar" aria-hidden="true">
              <span className={`match-item__fill match-item__fill--${m.tone}`} style={{ width: `${m.score}%` }} />
            </div>
            <div className="match-item__terms">
              <span className="match-item__terms-label">{m.matched.length}/{m.total} terms:</span>
              {m.matched.map((t) => (
                <span key={t} className="chip">{t}</span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <LivePhenotypeMatches hpoIds={FEATURED_PHENOTYPES.map((p) => p.id)} />

      <DataSourcesNote />
    </Section>
  );
}

// ---- Family --------------------------------------------------------------

function Family(): ReactNode {
  const rows: ReadonlyArray<{ relation: string; affected: string; tone: Tone; sequenced: string; notes: string }> = [
    { relation: "Proband", affected: "Affected", tone: "danger", sequenced: "Yes (exome)", notes: "Index case" },
    { relation: "Mother", affected: "Unaffected", tone: "success", sequenced: "Yes (exome)", notes: "Trio member" },
    { relation: "Father", affected: "Unaffected", tone: "success", sequenced: "Yes (exome)", notes: "Trio member" },
    { relation: "Sibling", affected: "Unaffected", tone: "success", sequenced: "No", notes: "Clinically well" }
  ];
  return (
    <>
    <Section title="Family" subtitle="Pedigree members and sequencing status (synthetic).">
      <div className="pedigree-wrap">
        <Pedigree />
        <ul className="pedigree-legend" aria-label="Pedigree legend">
          <li><span className="peg peg--square" aria-hidden="true" /> Male</li>
          <li><span className="peg peg--circle" aria-hidden="true" /> Female</li>
          <li><span className="peg peg--filled" aria-hidden="true" /> Affected</li>
          <li><span className="peg peg--arrow" aria-hidden="true" /> Proband</li>
        </ul>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">Family members for this case</caption>
          <thead>
            <tr>
              <th scope="col">Relation</th>
              <th scope="col">Clinical status</th>
              <th scope="col">Sequenced</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.relation}>
                <td>{r.relation}</td>
                <td><span className={`pill pill--${r.tone}`}>{r.affected}</span></td>
                <td>{r.sequenced}</td>
                <td>{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>

    <Section title="Genetic counselling summary" subtitle="Inheritance, recurrence risk and reproductive options (synthetic; non-directive, for counselling).">
      <dl className="def-list">
        <div className="def-list__row"><dt>Inheritance</dt><dd>{COUNSELLING.inheritance}</dd></div>
        <div className="def-list__row"><dt>Recurrence risk</dt><dd>{COUNSELLING.recurrenceRisk}</dd></div>
        <div className="def-list__row"><dt>Reproductive options</dt><dd>{COUNSELLING.reproductiveOptions}</dd></div>
        <div className="def-list__row"><dt>Carrier implications</dt><dd>{COUNSELLING.carrierImplications}</dd></div>
        <div className="def-list__row"><dt>Disclosure</dt><dd>{COUNSELLING.disclosure}</dd></div>
      </dl>

      <h3 className="cw-subheading">Consent &amp; disclosure tracking</h3>
      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">Consent items for this case</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Status</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {CONSENTS.map((c) => (
              <tr key={c.item}>
                <td>{c.item}</td>
                <td><span className={`pill pill--${c.tone}`}>{c.status}</span></td>
                <td>{c.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
    </>
  );
}

// ---- Investigations ------------------------------------------------------

function Investigations(): ReactNode {
  const rows: ReadonlyArray<{ date: string; type: string; result: string; status: string; tone: Tone }> = [
    { date: "2024-02-02", type: "EEG", result: "Multifocal epileptiform discharges", status: "Reviewed", tone: "success" },
    { date: "2024-01-05", type: "CT head (non-contrast)", result: "No acute intracranial abnormality", status: "Reviewed", tone: "success" },
    { date: "2023-11-20", type: "Brain MRI (T2)", result: "No structural abnormality", status: "Reviewed", tone: "success" },
    { date: "2023-10-05", type: "Metabolic panel", result: "Mild lactate elevation (2.4 mmol/L)", status: "Flagged", tone: "warning" },
    { date: "2024-03-14", type: "Repeat MRI (+ MRS)", result: "Pending", status: "Ordered", tone: "info" }
  ];
  return (
    <>
      <Section title="Imaging viewer" subtitle="PACS-style viewer with in-app synthetic slices — not diagnostic images.">
        <ImageViewer />
      </Section>

      <Section title="Growth — head circumference (OFC)" subtitle="Reference percentile bands approximate the WHO girls' reference; patient trajectory is synthetic (acquired microcephaly).">
        <div className="growth-wrap">
          <GrowthChart />
        </div>
      </Section>

      <Section title="Physiological studies" subtitle="Illustrative synthetic traces rendered in-app.">
        <ul className="imaging-gallery" aria-label="Physiological studies">
          {IMAGING_STUDIES.filter((s) => s.thumbnail === "eeg").map((study) => (
            <li key={`${study.date}-${study.modality}`} className="imaging-card">
              <div className="imaging-card__thumb" aria-hidden="true">
                <EegTrace />
              </div>
              <div className="imaging-card__meta">
                <p className="imaging-card__modality">{study.modality}</p>
                <p className="imaging-card__site">{study.site} · {study.date}</p>
                <p className="imaging-card__impression">
                  <span className={`pill pill--${study.tone}`}>{study.impression}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Laboratory investigations" subtitle="Labs and imaging log (synthetic).">
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Investigations for this case</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Investigation</th>
                <th scope="col">Result</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.date}-${r.type}`}>
                  <td>{r.date}</td>
                  <td>{r.type}</td>
                  <td>{r.result}</td>
                  <td><span className={`pill pill--${r.tone}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

// ---- Genomics ------------------------------------------------------------

function Genomics(): ReactNode {
  const stats: ReadonlyArray<{ label: string; value: string }> = [
    { label: "Platform", value: "Exome (trio)" },
    { label: "Mean coverage", value: "112x" },
    { label: "Variants called", value: "48,210" },
    { label: "Prioritised", value: "27" }
  ];
  const mecp2 = CLINVAR_VARIANTS.MECP2;
  const variants: ReadonlyArray<{ gene: string; hgvs: string; protein: string; zygosity: string; classification: string; tone: Tone }> = [
    { gene: mecp2.gene, hgvs: mecp2.hgvs, protein: mecp2.protein, zygosity: "Heterozygous (de novo)", classification: `${mecp2.classification} (ClinVar)`, tone: mecp2.classificationTone }
  ];
  return (
    <>
      <Section title="Specimen &amp; accessioning" subtitle="Molecular study provenance (synthetic identifiers).">
        <dl className="def-list">
          <div className="def-list__row"><dt>Accession</dt><dd><code>{SPECIMEN.accession}</code></dd></div>
          <div className="def-list__row"><dt>Specimen</dt><dd>{SPECIMEN.type}</dd></div>
          <div className="def-list__row"><dt>Collected</dt><dd>{SPECIMEN.collected}</dd></div>
          <div className="def-list__row"><dt>Received</dt><dd>{SPECIMEN.received}</dd></div>
          <div className="def-list__row"><dt>Reported</dt><dd>{SPECIMEN.reported}</dd></div>
          <div className="def-list__row"><dt>Method</dt><dd>{SPECIMEN.method}</dd></div>
          <div className="def-list__row"><dt>Reporting laboratory</dt><dd>{SPECIMEN.lab}</dd></div>
          <div className="def-list__row"><dt>Accreditation</dt><dd>{SPECIMEN.accreditation}</dd></div>
        </dl>
      </Section>

      <Section title="Gene locus" subtitle="MECP2 lies at Xq28, the distal tip of the X-chromosome long arm.">
        <div className="ideogram-wrap">
          <ChromosomeIdeogram />
        </div>
      </Section>

      <Section title="Gene" subtitle="Live gene summary for the candidate gene.">
        <LiveGeneSummary entrezId="4204" symbol="MECP2" />
      </Section>

      <ul className="kpi-grid" aria-label="Sequencing summary">
        {stats.map((s) => (
          <li key={s.label} className="kpi-card">
            <p className="kpi-card__value">{s.value}</p>
            <p className="kpi-card__label">{s.label}</p>
          </li>
        ))}
      </ul>
      <Section title="Prioritised variants" subtitle="Top candidate for this case. Variant description and classification are real (ClinVar); differential genes CDKL5 and FOXG1 are shown gene-level on Variant-review.">
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Prioritised variants for this case</caption>
            <thead>
              <tr>
                <th scope="col">Gene</th>
                <th scope="col">Variant (HGVS)</th>
                <th scope="col">Protein</th>
                <th scope="col">Zygosity</th>
                <th scope="col">Classification</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => (
                <tr key={v.hgvs}>
                  <td><strong>{v.gene}</strong></td>
                  <td><code>{v.hgvs}</code></td>
                  <td><code>{v.protein}</code></td>
                  <td>{v.zygosity}</td>
                  <td><span className={`pill pill--${v.tone}`}>{v.classification}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Protein domains &amp; variant position"
        subtitle={`${MECP2_PROTEIN.isoform}. Domain boundaries and the common Rett hotspots are real; the candidate p.Arg168* is highlighted.`}
      >
        <div className="lollipop-wrap">
          <ProteinLollipop />
        </div>
        <ul className="lollipop-legend" aria-label="Protein map legend">
          <li><span className="peg peg--square" aria-hidden="true" /> Nonsense (truncating)</li>
          <li><span className="peg peg--circle" aria-hidden="true" /> Missense</li>
          <li><span className="lollipop-legend__mbd" aria-hidden="true" /> MBD (methyl-CpG binding)</li>
          <li><span className="lollipop-legend__trd" aria-hidden="true" /> TRD (transcription repression)</li>
        </ul>
        <p className="card__subtitle">
          p.Arg168* truncates the protein just after the MBD and before the TRD, removing the transcription-repression
          function — the mechanistic basis for the PVS1 (loss-of-function) call.
        </p>
      </Section>

      <Section
        title="Variant classification (ACMG/AMP)"
        subtitle="Evidence codes are the real ACMG/AMP criteria; their application is illustrative for this synthetic variant."
      >
        <div className={`acmg-result acmg-result--${MECP2_ACMG_RESULT.tone}`}>
          <span className={`pill pill--${MECP2_ACMG_RESULT.tone}`}>{MECP2_ACMG_RESULT.classification}</span>
          <span className="acmg-result__basis">{MECP2_ACMG_RESULT.basis}</span>
        </div>
        <ul className="acmg-list">
          {MECP2_ACMG.map((c) => (
            <li key={c.code} className="acmg-item">
              <span className={`acmg-code acmg-code--${c.tone}`}>{c.code}</span>
              <span className="acmg-item__body">
                <span className="acmg-item__name">{c.name} <span className="acmg-item__strength">· {c.strength}</span></span>
                <span className="acmg-item__detail">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <h3 className="cw-subheading">Predictors &amp; population frequency</h3>
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">In-silico predictors and population frequency</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Value</th>
                <th scope="col">Interpretation</th>
              </tr>
            </thead>
            <tbody>
              {MECP2_METRICS.map((m) => (
                <tr key={m.label}>
                  <td>{m.label}</td>
                  <td><span className={`pill pill--${m.tone}`}>{m.value}</span></td>
                  <td>{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="cw-subheading">Variant QC &amp; trio genotypes</h3>
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Variant-level quality control</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {VARIANT_QC.map((q) => (
                <tr key={q.label}>
                  <td>{q.label}</td>
                  <td><span className={`pill pill--${q.tone}`}>{q.value}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="cw-subheading">Analysis pipeline &amp; provenance</h3>
        <ul className="code-list" aria-label="Analysis pipeline provenance">
          {PIPELINE.map((p) => (
            <li key={p.stage} className="code-chip">
              <span className="code-chip__system">{p.stage}</span>
              <span className="code-chip__code">{p.tool}</span>
            </li>
          ))}
        </ul>

        <LiveVariantAnnotation variantId="chrX:g.153296777G>A" label="MECP2 c.502C>T (p.Arg168*) · rs61748421 · GRCh37/hg19" />
        <LiveConsequence rsid="rs61748421" gene="MECP2" />
        <AiVariantExplanation />
        <AiTaskPanel
          title="ACMG criteria suggester"
          task="acmg"
          inline
          fallbackText="Likely applicable: PVS1 (nonsense in a LoF gene), PM2 (absent from gnomAD), PM6 (assumed de novo, unconfirmed) → Pathogenic. Suggestion for clinician confirmation, not an automated call."
        />
      </Section>

      <Section
        title="Transcriptomics (RNA-seq outliers)"
        subtitle="Real genes; synthetic expression z-scores. MECP2 is under-expressed (consistent with NMD of the nonsense allele); BDNF and IGF1 are MeCP2 targets; GAPDH is a housekeeping control."
      >
        <MetricBars
          ariaLabel="RNA-seq expression z-scores"
          max={3}
          items={TRANSCRIPTOMICS.map((e) => ({
            label: e.gene,
            display: `${e.zScore > 0 ? "+" : ""}${e.zScore.toFixed(1)} · ${e.direction}`,
            value: e.zScore,
            tone: e.tone
          }))}
        />
      </Section>

      <div className="cw-grid">
        <Section title="Metabolomics" subtitle="Real analytes; synthetic levels (|z-score| shown).">
          <MetricBars
            ariaLabel="Metabolomics analyte z-scores"
            max={3}
            items={METABOLOMICS.map((m) => ({
              label: m.analyte,
              display: m.display,
              value: m.zScore,
              tone: m.tone
            }))}
          />
        </Section>
        <Section title="Methylation" subtitle="Genome-wide methylation array (synthetic).">
          <p>{METHYLATION_SUMMARY}</p>
        </Section>
      </div>

      <Section
        title="Targeted metabolic screen (mitochondrial workup)"
        subtitle="Prompted by the mildly elevated plasma lactate. Analytes and reference concepts are real; patient values are synthetic. Overall pattern is nonspecific and does not support a primary mitochondrial disorder."
      >
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Targeted metabolic screen</caption>
            <thead>
              <tr>
                <th scope="col">Test</th>
                <th scope="col">Result</th>
                <th scope="col">Interpretation</th>
              </tr>
            </thead>
            <tbody>
              {METABOLIC_SCREEN.map((m) => (
                <tr key={m.test}>
                  <td>{m.test}</td>
                  <td><span className={`pill pill--${m.tone}`}>{m.result}</span></td>
                  <td>{m.interpretation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Pharmacogenomics (PGx)"
        subtitle="Gene-drug relationships are real (PharmGKB / CPIC); patient diplotypes are synthetic. Not medical advice."
      >
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Pharmacogenomic results</caption>
            <thead>
              <tr>
                <th scope="col">Gene</th>
                <th scope="col">Diplotype</th>
                <th scope="col">Phenotype</th>
                <th scope="col">Relevant drugs</th>
                <th scope="col">Guidance basis</th>
              </tr>
            </thead>
            <tbody>
              {PHARMACOGENOMICS.map((p) => (
                <tr key={p.gene}>
                  <td><strong>{p.gene}</strong></td>
                  <td><code>{p.diplotype}</code></td>
                  <td><span className={`pill pill--${p.tone}`}>{p.phenotype}</span></td>
                  <td>{p.drugs}</td>
                  <td>{p.guidance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <DataSourcesNote />
    </>
  );
}

// ---- Hypotheses ----------------------------------------------------------

function Hypotheses(): ReactNode {
  const items: ReadonlyArray<{ title: string; state: string; tone: Tone; evidence: number; summary: string }> = [
    { title: "MECP2 loss-of-function explanation (Rett syndrome)", state: "Under review", tone: "info", evidence: 4, summary: "Consistent with seizures, developmental regression and acquired microcephaly; supported by a pathogenic MECP2 stop-gained variant." },
    { title: "CDKL5 / FOXG1 differential", state: "Proposed", tone: "neutral", evidence: 2, summary: "Early-seizure and congenital Rett-variant differentials; no reportable variant identified to date." }
  ];
  return (
    <Section title="Hypotheses" subtitle="Evidence-linked, non-diagnostic working hypotheses.">
      <ul className="card-grid" aria-label="Hypotheses">
        {items.map((h) => (
          <li key={h.title} className="card cw-subcard">
            <h3 className="card__title">{h.title}</h3>
            <p>
              <span className={`pill pill--${h.tone}`}>{h.state}</span>{" "}
              <span className="pill pill--neutral">{h.evidence} evidence links</span>
            </p>
            <p className="card__subtitle">{h.summary}</p>
          </li>
        ))}
      </ul>

      <h3 className="cw-subheading">Evidence graph</h3>
      <p className="card__subtitle">How the evidence connects. Click a node to focus its links; click the background to reset.</p>
      <div className="evgraph-wrap">
        <EvidenceGraph />
      </div>
      <ul className="evgraph-legend" aria-label="Evidence graph legend">
        <li><span className="evleg evleg--diagnosis" aria-hidden="true" /> Diagnosis</li>
        <li><span className="evleg evleg--variant" aria-hidden="true" /> Variant</li>
        <li><span className="evleg evleg--evidence" aria-hidden="true" /> Evidence</li>
        <li><span className="evleg evleg--phenotype" aria-hidden="true" /> Phenotype</li>
        <li><span className="evleg evleg--differential" aria-hidden="true" /> Differential</li>
        <li><span className="evleg-line evleg-line--support" aria-hidden="true" /> Supports</li>
        <li><span className="evleg-line evleg-line--partial" aria-hidden="true" /> Partial</li>
        <li><span className="evleg-line evleg-line--pending" aria-hidden="true" /> Pending</li>
      </ul>

      <h3 className="cw-subheading">Matchmaker Exchange</h3>
      <p className="card__subtitle">
        Federated "find similar patients" query across real MME nodes ({MME_NODES.join(", ")}).
        External-matching consent is pending for this case, so results are illustrative and synthetic.
      </p>
      <ul className="match-list">
        {MME_MATCHES.map((m) => (
          <li key={`${m.node}-${m.gene}`} className="match-item">
            <div className="match-item__head">
              <span className="match-item__disease">{m.node}</span>
              <span className="match-item__gene">Candidate gene <strong>{m.gene}</strong> · {m.overlap}</span>
              <span className={`pill pill--${m.tone}`}>{m.status}</span>
            </div>
          </li>
        ))}
      </ul>

      <AiDifferentialSuggestions />
    </Section>
  );
}

// ---- Evidence gaps -------------------------------------------------------

const EVIDENCE_GAPS: ReadonlyArray<{ gap: string; impact: string; tone: Tone }> = [
  { gap: "Segregation of MECP2 variant not confirmed in parents", impact: "Blocks de novo confirmation (PM6 to PS2) and reclassification", tone: "warning" },
  { gap: "External matching consent outstanding", impact: "Blocks cohort matching", tone: "danger" },
  { gap: "Repeat MRI pending", impact: "May refine structural hypothesis", tone: "info" }
];

function EvidenceGaps(): ReactNode {
  const [resolved, setResolved] = useState<Readonly<Record<string, boolean>>>({});
  const openCount = EVIDENCE_GAPS.filter((g) => resolved[g.gap] !== true).length;

  const toggle = (gap: string) => setResolved((prev) => ({ ...prev, [gap]: !prev[gap] }));

  return (
    <Section title="Evidence gaps" subtitle="Outstanding items that limit resolution (synthetic).">
      <ul className="queue-list">
        {EVIDENCE_GAPS.map((g) => {
          const isResolved = resolved[g.gap] === true;
          const tone: Tone = isResolved ? "success" : g.tone;
          return (
            <li key={g.gap} className={`queue-item${isResolved ? " queue-item--resolved" : ""}`}>
              <span className={`queue-item__severity queue-item__severity--${tone}`} aria-hidden="true" />
              <span className="queue-item__body">
                <span className="queue-item__primary">{g.gap}</span>
                <span className="queue-item__meta">{g.impact}</span>
              </span>
              <span className={`pill pill--${tone}`}>{isResolved ? "Resolved" : "Gap"}</span>
              <button
                type="button"
                className="btn btn--ghost"
                aria-pressed={isResolved}
                onClick={() => toggle(g.gap)}
              >
                {isResolved ? "Reopen" : "Resolve"}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="cw-footnote" role="status" aria-live="polite">
        {openCount} of {EVIDENCE_GAPS.length} gaps still open.
      </p>

      <AiTaskPanel
        title="AI: next best investigations"
        task="next-test"
        fallbackText="Suggestions for MDT consideration: (1) parental segregation of the MECP2 variant — resolves de novo status; (2) confirm external-matching consent — unblocks cohort matching; (3) repeat MRI — may refine structural questions. Non-diagnostic."
      />
    </Section>
  );
}

// ---- Tasks ---------------------------------------------------------------

interface TaskRow {
  readonly task: string;
  readonly owner: string;
  readonly due: string;
  readonly status: string;
  readonly tone: Tone;
}

const TASK_ROWS: readonly TaskRow[] = [
  { task: "Confirm phenotype corrections", owner: "Clinical geneticist", due: "2025-02-16", status: "In progress", tone: "info" },
  { task: "Obtain external matching consent", owner: "Genetic counsellor", due: "2025-02-18", status: "Not started", tone: "warning" },
  { task: "Order parental segregation", owner: "Bioinformatician", due: "2025-02-20", status: "Blocked", tone: "danger" },
  { task: "Schedule MDT meeting", owner: "Case coordinator", due: "2025-02-17", status: "In progress", tone: "info" }
];

function Tasks(): ReactNode {
  const [done, setDone] = useState<Readonly<Record<string, boolean>>>({});
  const completed = Object.values(done).filter(Boolean).length;

  const toggle = (task: string) => setDone((prev) => ({ ...prev, [task]: !prev[task] }));

  return (
    <Section title="Tasks" subtitle="Assigned across the MDT (synthetic).">
      <div className="table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">Tasks for this case</caption>
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Owner role</th>
              <th scope="col">Due</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="visually-hidden">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {TASK_ROWS.map((r) => {
              const isDone = done[r.task] === true;
              return (
                <tr key={r.task} className={isDone ? "task-row--done" : undefined}>
                  <td>{r.task}</td>
                  <td>{r.owner}</td>
                  <td>{r.due}</td>
                  <td>
                    <span className={`pill pill--${isDone ? "success" : r.tone}`}>
                      {isDone ? "Done" : r.status}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      aria-pressed={isDone}
                      onClick={() => toggle(r.task)}
                    >
                      {isDone ? "Reopen" : "Mark done"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="cw-footnote" role="status" aria-live="polite">
        {completed} of {TASK_ROWS.length} tasks complete.
      </p>
    </Section>
  );
}

// ---- MDT decisions -------------------------------------------------------

function MdtDecisions(): ReactNode {
  const ratified = useRatifiedDecisions();
  const baseRows: ReadonlyArray<{ date: string; decision: string; outcome: string; tone: Tone; rationale: string }> = [
    { date: "2025-02-10", decision: "Proceed to trio exome", outcome: "Approved", tone: "success", rationale: "Phenotype supports monogenic aetiology." },
    { date: "2025-02-13", decision: "Confirm MECP2 variant (segregation)", outcome: "Deferred", tone: "warning", rationale: "Awaiting parental segregation." }
  ];
  const rows = [
    ...ratified.map((d) => ({ date: d.date, decision: d.decision, outcome: d.outcome, tone: "success" as Tone, rationale: `${d.rationale} (Chair: ${d.chairLabel}.)` })),
    ...baseRows
  ];
  return (
    <>
      <MdtBoardRoom />

      <Section title="MDT decisions" subtitle="Board decisions with rationale (synthetic).">
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">MDT decisions for this case</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Decision</th>
                <th scope="col">Outcome</th>
                <th scope="col">Rationale</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.decision}>
                  <td>{r.date}</td>
                  <td>{r.decision}</td>
                  <td><span className={`pill pill--${r.tone}`}>{r.outcome}</span></td>
                  <td>{r.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Management & follow-up plan" subtitle="Illustrative synthetic care-coordination summary — not medical advice.">
        <ul className="plan-list">
          {MANAGEMENT_PLAN.map((p) => (
            <li key={p.item} className="plan-item">
              <span className={`plan-item__marker plan-item__marker--${p.tone}`} aria-hidden="true" />
              <span className="plan-item__body">
                <span className="plan-item__item">{p.item}</span>
                <span className="plan-item__meta">{p.category} · {p.owner}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Therapeutic landscape & clinical trials" subtitle="Drugs and trial identifiers are real (FDA / ClinicalTrials.gov); applicability to this synthetic case is illustrative — not medical advice.">
        <ul className="therapy-list">
          {THERAPEUTICS.map((t) => (
            <li key={t.name} className="therapy-item">
              <div className="therapy-item__head">
                <span className="therapy-item__name">{t.name}</span>
                <span className={`pill pill--${t.tone}`}>{t.status}</span>
              </div>
              <p className="therapy-item__kind">{t.kind}</p>
              <p className="therapy-item__detail">{t.detail}</p>
              {t.nct && t.url && (
                <p className="therapy-item__trial">
                  <a href={t.url} target="_blank" rel="noreferrer"><code>{t.nct}</code> · ClinicalTrials.gov</a>
                </p>
              )}
            </li>
          ))}
        </ul>
        <LiveTrials condition="Rett syndrome" />
      </Section>

      <AiTaskPanel
        title="Draft family summary letter"
        task="report-letter"
        fallbackText="Dear family, thank you for taking part in the review of your child's case. The team has examined the clinical features and completed genomic (trio exome) testing. A candidate genetic finding is under review; it has not yet been confirmed, and further checks (including parental testing) are planned. We will discuss the results with you at the next appointment and answer any questions. This letter is a synthetic demonstration and is not medical advice."
      />

      <DataSourcesNote />
    </>
  );
}

// ---- Reanalysis history --------------------------------------------------

function ReanalysisHistory(): ReactNode {
  const runs: readonly TimelineEvent[] = [
    { when: "2025-02-14", title: "Reanalysis re-surfaced case", meta: "Knowledge update KU-2025-014 · Gene MECP2", tone: "success" },
    { when: "2024-11-02", title: "Scheduled reanalysis", meta: "No new candidate variants", tone: "neutral" },
    { when: "2024-06-18", title: "Initial analysis", meta: "Trio exome baseline", tone: "info" }
  ];
  return (
    <Section title="Reanalysis history" subtitle="Automated and scheduled reanalysis runs (synthetic).">
      <ol className="timeline">
        {runs.map((e, i) => (
          <li key={`${e.when}-${i}`} className="timeline__item">
            <span className={`timeline__marker timeline__marker--${e.tone}`} aria-hidden="true" />
            <div className="timeline__body">
              <p className="timeline__title">{e.title}</p>
              <p className="timeline__meta">
                <time dateTime={e.when}>{e.when}</time> · {e.meta}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ---- Dispatch ------------------------------------------------------------

/** Audit history for the case, merging any decisions ratified this session
 *  (session-local) ahead of the sample immutable events. */
function CaseAuditHistory(): ReactNode {
  const ratified = useRatifiedDecisions();
  const events = [...ratifiedAsAuditEvents(CASE_SUMMARY.caseId), ...SAMPLE_CASE_AUDIT_EVENTS];
  return (
    <>
      {ratified.length > 0 && (
        <p className="cw-footnote" role="status">
          {ratified.length} decision{ratified.length === 1 ? "" : "s"} ratified this session shown at the top (session-local demonstration).
        </p>
      )}
      <AuditHistory events={events} caption="Immutable audit history for this case" />
    </>
  );
}

/** Renders the content for a Case workspace tab id (Req 24.2). */
export function renderCaseTabContent(tabId: string): ReactNode {
  switch (tabId) {
    case "overview":
      return <Overview />;
    case "timeline":
      return <Timeline />;
    case "phenotypes":
      return <Phenotypes />;
    case "family":
      return <Family />;
    case "investigations":
      return <Investigations />;
    case "genomics":
      return <Genomics />;
    case "hypotheses":
      return <Hypotheses />;
    case "evidence-gaps":
      return <EvidenceGaps />;
    case "tasks":
      return <Tasks />;
    case "mdt-decisions":
      return <MdtDecisions />;
    case "reanalysis-history":
      return <ReanalysisHistory />;
    case "audit-history":
      return <CaseAuditHistory />;
    default:
      return null;
  }
}
