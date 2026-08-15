import { DATA_SOURCES } from "../data/reference.js";

// Provenance note rendered on data-bearing views. States plainly that patients
// are synthetic while the reference vocabulary (HPO / ClinVar / OMIM /
// Orphanet / gnomAD) is real, and links each source.
export function DataSourcesNote() {
  return (
    <p className="data-sources" data-testid="data-sources-note">
      <strong>Reference data:</strong> phenotype terms, variant classifications and disease
      identifiers are drawn from real public sources; patient cases are synthetic. Sources:{" "}
      {DATA_SOURCES.map((source, index) => (
        <span key={source.name}>
          <a href={source.url} target="_blank" rel="noreferrer" title={source.detail}>
            {source.name}
          </a>
          {index < DATA_SOURCES.length - 1 ? ", " : "."}
        </span>
      ))}
    </p>
  );
}
