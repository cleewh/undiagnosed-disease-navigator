import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons.js";

// Diagnostic-odyssey scrubber: an animated, end-to-end replay of the case's
// journey from intake to working diagnosis. Each milestone shows what was known
// at that point and how the evidence accrued. Pure front-end, session-local,
// grounded in the synthetic case record — non-diagnostic. A "Play" control
// advances through the milestones; the range input scrubs to any point.

type Tone = "info" | "warning" | "success" | "neutral" | "danger";

interface Milestone {
  readonly date: string;
  readonly title: string;
  readonly detail: string;
  readonly evidence: number;
  readonly tone: Tone;
}

// Ordered oldest -> newest so the scrubber reads left-to-right in time.
const MILESTONES: readonly Milestone[] = [
  { date: "2024-06-18", title: "Case intake", detail: "Paediatric neurodevelopmental referral created from intake pipeline; no genomic data yet.", evidence: 0, tone: "neutral" },
  { date: "2024-06-18", title: "Baseline trio exome", detail: "Initial trio-exome analysis run; 48,210 variants called, none yet prioritised as causal.", evidence: 1, tone: "info" },
  { date: "2024-11-02", title: "Scheduled reanalysis", detail: "Automated reanalysis found no new candidate variants against the knowledge base of the time.", evidence: 1, tone: "neutral" },
  { date: "2025-02-12", title: "Phenotype deepened", detail: "Seizure, developmental regression, acquired microcephaly and stereotypies coded to HPO and confirmed.", evidence: 2, tone: "info" },
  { date: "2025-02-13", title: "Variant prioritised", detail: "MECP2 c.502C>T (p.Arg168*) surfaces as top candidate — a stop-gained, absent from gnomAD, CADD 36.", evidence: 3, tone: "warning" },
  { date: "2025-02-13", title: "Hypothesis proposed", detail: "MECP2 loss-of-function explanation raised; consistent with the Rett-syndrome phenotype pattern.", evidence: 4, tone: "info" },
  { date: "2025-02-14", title: "Reanalysis re-surfaced case", detail: "Knowledge update KU-2025-014 (gene MECP2) re-surfaced the case for board review.", evidence: 4, tone: "success" },
  { date: "2025-02-14", title: "Working diagnosis (under review)", detail: "ACMG/AMP: PVS1 + PM2 + PM6 -> Pathogenic. Working diagnosis Rett syndrome (OMIM 312750), pending parental segregation and consent.", evidence: 5, tone: "success" }
];

const MAX_EVIDENCE = MILESTONES[MILESTONES.length - 1]?.evidence ?? 1;
const STEP_MS = 1600;

export function DiagnosticOdyssey() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setIndex((i) => {
        if (i >= MILESTONES.length - 1) return i;
        return i + 1;
      });
    }, STEP_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing]);

  // Stop auto-play once we reach the end.
  useEffect(() => {
    if (index >= MILESTONES.length - 1) setPlaying(false);
  }, [index]);

  const current = MILESTONES[index] ?? MILESTONES[0];
  if (!current) return null;
  const atEnd = index >= MILESTONES.length - 1;
  const evidencePct = Math.round((current.evidence / MAX_EVIDENCE) * 100);

  const togglePlay = () => {
    if (atEnd) {
      setIndex(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  };

  return (
    <div className="odyssey" data-testid="diagnostic-odyssey">
      <div className="odyssey__controls">
        <button type="button" className="btn btn--primary odyssey__play" onClick={togglePlay} aria-pressed={playing}>
          <Icon name={playing ? "activity" : "check-circle"} size={16} />
          {atEnd ? "Replay" : playing ? "Pause" : "Play"}
        </button>
        <label className="odyssey__scrub">
          <span className="visually-hidden">Scrub the diagnostic journey</span>
          <input
            type="range"
            min={0}
            max={MILESTONES.length - 1}
            value={index}
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
            aria-label={`Milestone ${index + 1} of ${MILESTONES.length}: ${current.title}`}
          />
        </label>
        <span className="odyssey__counter">
          {index + 1}/{MILESTONES.length}
        </span>
      </div>

      <ol className="odyssey__track" aria-hidden="true">
        {MILESTONES.map((m, i) => (
          <li
            key={`${m.date}-${m.title}`}
            className={
              "odyssey__dot" +
              (i === index ? " odyssey__dot--current" : "") +
              (i < index ? " odyssey__dot--past" : "")
            }
            title={m.title}
          >
            <span className={`odyssey__dot-mark odyssey__dot-mark--${m.tone}`} />
          </li>
        ))}
      </ol>

      <div className="odyssey__stage" role="status" aria-live="polite">
        <p className="odyssey__date">
          <time dateTime={current.date}>{current.date}</time>
        </p>
        <h4 className="odyssey__title">
          <span className={`pill pill--${current.tone}`}>Step {index + 1}</span> {current.title}
        </h4>
        <p className="odyssey__detail">{current.detail}</p>
        <div className="odyssey__evidence">
          <span className="odyssey__evidence-label">Evidence toward diagnosis</span>
          <div className="match-item__bar" aria-hidden="true">
            <span className="match-item__fill match-item__fill--success" style={{ width: `${evidencePct}%` }} />
          </div>
          <span className="odyssey__evidence-val">{current.evidence}/{MAX_EVIDENCE} strands</span>
        </div>
      </div>

      <p className="ai-disclaimer">
        Animated replay of the synthetic case record — non-diagnostic; for demonstration of the diagnostic odyssey.
      </p>
    </div>
  );
}
