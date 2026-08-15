import { useClinicalTrials } from "../data/useClinicalTrials.js";

// Renders live recruiting trials fetched from ClinicalTrials.gov. Falls back
// gracefully to a note (the curated therapeutics list remains above) if the
// live lookup is unavailable.
export function LiveTrials({ condition }: { readonly condition: string }) {
  const state = useClinicalTrials(condition);

  return (
    <div className="live-trials" data-testid="live-trials">
      <div className="live-trials__head">
        <span className="live-badge"><span className="live-badge__dot" aria-hidden="true" /> Live</span>
        <span className="live-trials__source">
          Recruiting trials for “{condition}” · ClinicalTrials.gov API v2
        </span>
      </div>

      {state.status === "loading" && (
        <p className="live-trials__status" role="status">Loading live trials…</p>
      )}

      {state.status === "error" && (
        <p className="live-trials__status live-trials__status--error" role="status">
          Live trials unavailable ({state.message}). The curated list above still applies.
        </p>
      )}

      {state.status === "ready" && state.trials.length === 0 && (
        <p className="live-trials__status" role="status">No recruiting trials returned.</p>
      )}

      {state.status === "ready" && state.trials.length > 0 && (
        <ul className="live-trials__list">
          {state.trials.map((t) => (
            <li key={t.nctId} className="live-trials__item">
              <a href={t.url} target="_blank" rel="noreferrer" className="live-trials__title">{t.title}</a>
              <span className="live-trials__meta">
                <code>{t.nctId}</code>
                <span className="pill pill--info">{t.phase}</span>
                <span className="pill pill--success">{t.status}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
