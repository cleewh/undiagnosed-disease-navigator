import {
  useGeneSummary,
  useVariantConsequence,
  usePhenotypeMatches,
  type PhenotypeDiseaseMatch
} from "../data/liveHooks.js";

function LiveHead({ label }: { readonly label: string }) {
  return (
    <div className="live-trials__head">
      <span className="live-badge"><span className="live-badge__dot" aria-hidden="true" /> Live</span>
      <span className="live-trials__source">{label}</span>
    </div>
  );
}

/** MyGene.info gene summary. */
export function LiveGeneSummary({ entrezId, symbol }: { readonly entrezId: string; readonly symbol: string }) {
  const state = useGeneSummary(entrezId);
  return (
    <div className="live-annot" data-testid="live-gene-summary">
      <LiveHead label={`${symbol} gene · MyGene.info`} />
      {state.status === "loading" && <p className="live-trials__status" role="status">Loading gene summary…</p>}
      {state.status === "error" && (
        <p className="live-trials__status live-trials__status--error" role="status">Gene summary unavailable ({state.message}).</p>
      )}
      {state.status === "ready" && (
        <>
          <p className="gene-summary__head">
            <strong>{state.gene.symbol}</strong> — {state.gene.name}
            {state.gene.type && <span className="pill pill--neutral gene-summary__type">{state.gene.type}</span>}
          </p>
          {state.gene.chrom && (
            <p className="gene-summary__loc">
              chr{state.gene.chrom}:{state.gene.start?.toLocaleString()}–{state.gene.end?.toLocaleString()}
              {state.gene.strand ? ` (${state.gene.strand === -1 ? "−" : "+"} strand)` : ""}
              {state.gene.ensemblGene && (
                <> · <a href={`https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=${state.gene.ensemblGene}`} target="_blank" rel="noreferrer">{state.gene.ensemblGene}</a></>
              )}
            </p>
          )}
          {state.gene.summary && <p className="gene-summary__text">{state.gene.summary}</p>}
        </>
      )}
    </div>
  );
}

/** Ensembl VEP molecular consequence. */
export function LiveConsequence({ rsid, gene }: { readonly rsid: string; readonly gene: string }) {
  const state = useVariantConsequence(rsid, gene);
  return (
    <div className="live-annot" data-testid="live-consequence">
      <LiveHead label={`Molecular consequence · Ensembl VEP (${rsid})`} />
      {state.status === "loading" && <p className="live-trials__status" role="status">Loading consequence…</p>}
      {state.status === "error" && (
        <p className="live-trials__status live-trials__status--error" role="status">Consequence unavailable ({state.message}).</p>
      )}
      {state.status === "ready" && (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Live molecular consequence</caption>
            <tbody>
              <tr><td>Most severe consequence</td><td><span className="pill pill--danger">{state.data.mostSevere.replace(/_/g, " ")}</span></td></tr>
              <tr><td>Impact</td><td><span className="pill pill--warning">{state.data.impact ?? "N/A"}</span></td></tr>
              <tr><td>Assembly</td><td>{state.data.assembly ?? "N/A"}</td></tr>
              <tr><td>Representative transcript</td><td><code>{state.data.transcriptId ?? "N/A"}</code> {state.data.biotype ? `· ${state.data.biotype}` : ""}</td></tr>
              <tr><td>Transcripts annotated</td><td>{state.data.transcriptCount}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function diseaseUrl(m: PhenotypeDiseaseMatch): string | undefined {
  if (m.id.startsWith("OMIM:")) return `https://www.omim.org/entry/${m.id.slice(5)}`;
  if (m.id.startsWith("ORPHA:")) return `https://www.orpha.net/en/disease/detail/${m.id.slice(6)}`;
  if (m.mondoId) return `https://monarchinitiative.org/${m.mondoId}`;
  return undefined;
}

/** HPO phenotype→disease association ranking. */
export function LivePhenotypeMatches({ hpoIds }: { readonly hpoIds: readonly string[] }) {
  const state = usePhenotypeMatches(hpoIds);
  return (
    <div className="live-annot" data-testid="live-phenotype-matches">
      <LiveHead label="Diseases sharing this case's HPO terms · HPO (ontology.jax.org)" />
      {state.status === "loading" && <p className="live-trials__status" role="status">Querying phenotype associations…</p>}
      {state.status === "error" && (
        <p className="live-trials__status live-trials__status--error" role="status">Live associations unavailable ({state.message}). The curated match above still applies.</p>
      )}
      {state.status === "ready" && state.matches.length === 0 && (
        <p className="live-trials__status" role="status">No diseases shared ≥2 of the case terms.</p>
      )}
      {state.status === "ready" && state.matches.length > 0 && (
        <ul className="match-list">
          {state.matches.map((m) => {
            const url = diseaseUrl(m);
            return (
              <li key={m.id} className="match-item">
                <div className="match-item__head">
                  <span className="match-item__disease">{url ? <a href={url} target="_blank" rel="noreferrer">{m.name}</a> : m.name}</span>
                  <span className="match-item__gene"><code>{m.id}</code></span>
                  <span className="pill pill--info">{m.matched}/{m.total} terms</span>
                </div>
                <div className="match-item__bar" aria-hidden="true">
                  <span className="match-item__fill match-item__fill--info" style={{ width: `${Math.round((m.matched / m.total) * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
