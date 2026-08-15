import { useVariantAnnotation } from "../data/useVariantAnnotation.js";

// Live variant annotations from MyVariant.info for a given genomic-HGVS id.
// Falls back to a note if the lookup is unavailable (the curated predictor
// table above still applies).
export function LiveVariantAnnotation({ variantId, label }: { readonly variantId: string; readonly label: string }) {
  const state = useVariantAnnotation(variantId);

  const fmtAf = (af?: number) => (af === undefined ? "Absent" : af.toExponential(2));

  return (
    <div className="live-annot" data-testid="live-variant-annotation">
      <div className="live-trials__head">
        <span className="live-badge"><span className="live-badge__dot" aria-hidden="true" /> Live</span>
        <span className="live-trials__source">{label} · MyVariant.info</span>
      </div>

      {state.status === "loading" && <p className="live-trials__status" role="status">Loading live annotations…</p>}

      {state.status === "error" && (
        <p className="live-trials__status live-trials__status--error" role="status">
          Live annotations unavailable ({state.message}). The curated values above still apply.
        </p>
      )}

      {state.status === "ready" && (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">Live variant annotations</caption>
            <thead>
              <tr><th scope="col">Source</th><th scope="col">Live value</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>gnomAD genome AF</td>
                <td><span className={`pill pill--${state.data.gnomadGenomeAf === undefined ? "success" : "info"}`}>{fmtAf(state.data.gnomadGenomeAf)}</span></td>
              </tr>
              <tr>
                <td>gnomAD exome AF</td>
                <td><span className={`pill pill--${state.data.gnomadExomeAf === undefined ? "success" : "info"}`}>{fmtAf(state.data.gnomadExomeAf)}</span></td>
              </tr>
              <tr>
                <td>CADD (phred)</td>
                <td><span className="pill pill--danger">{state.data.caddPhred ?? "N/A"}</span></td>
              </tr>
              <tr>
                <td>ClinVar significance</td>
                <td>
                  {state.data.clinvarVariantId ? (
                    <a href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${state.data.clinvarVariantId}/`} target="_blank" rel="noreferrer">
                      {state.data.clinvarSignificance ?? "See ClinVar"}
                    </a>
                  ) : (
                    state.data.clinvarSignificance ?? "N/A"
                  )}
                </td>
              </tr>
              <tr>
                <td>dbSNP</td>
                <td>
                  {state.data.rsid ? (
                    <a href={`https://www.ncbi.nlm.nih.gov/snp/${state.data.rsid}`} target="_blank" rel="noreferrer"><code>{state.data.rsid}</code></a>
                  ) : "N/A"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
