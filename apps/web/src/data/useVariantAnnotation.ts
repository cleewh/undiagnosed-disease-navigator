import { useEffect, useState } from "react";

// Live data hook: fetches variant annotations directly from MyVariant.info
// (BioThings, CORS-enabled — no backend proxy needed). Returns real gnomAD
// frequency, CADD score, ClinVar significance and cross-references for a given
// genomic-HGVS variant id. Defensive: aborts on unmount, guards environments
// without fetch, and exposes an error state for graceful fallback.

export interface VariantAnnotation {
  readonly rsid?: string;
  readonly caddPhred?: number;
  readonly gnomadGenomeAf?: number;
  readonly gnomadExomeAf?: number;
  readonly clinvarSignificance?: string;
  readonly clinvarVariantId?: number;
}

export type AnnotationState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: VariantAnnotation }
  | { readonly status: "error"; readonly message: string };

interface RawVariant {
  readonly dbsnp?: { readonly rsid?: string };
  readonly cadd?: { readonly phred?: number };
  readonly gnomad_genome?: { readonly af?: { readonly af?: number } };
  readonly gnomad_exome?: { readonly af?: { readonly af?: number } };
  readonly clinvar?: {
    readonly variant_id?: number;
    readonly rcv?: ReadonlyArray<{ readonly clinical_significance?: string }> | { readonly clinical_significance?: string };
  };
}

const FIELDS = [
  "dbsnp.rsid",
  "cadd.phred",
  "gnomad_genome.af.af",
  "gnomad_exome.af.af",
  "clinvar.rcv.clinical_significance",
  "clinvar.variant_id"
].join(",");

function parse(raw: RawVariant): VariantAnnotation {
  const rcv = raw.clinvar?.rcv;
  let significance: string | undefined;
  if (rcv) {
    const list = Array.isArray(rcv) ? rcv : [rcv];
    const values = list
      .map((r) => r.clinical_significance)
      .filter((s): s is string => typeof s === "string");
    significance = values.length > 0 ? Array.from(new Set(values)).join(", ") : undefined;
  }
  return {
    rsid: raw.dbsnp?.rsid,
    caddPhred: raw.cadd?.phred,
    gnomadGenomeAf: raw.gnomad_genome?.af?.af,
    gnomadExomeAf: raw.gnomad_exome?.af?.af,
    clinvarSignificance: significance,
    clinvarVariantId: raw.clinvar?.variant_id
  };
}

export function useVariantAnnotation(variantId: string): AnnotationState {
  const [state, setState] = useState<AnnotationState>({ status: "loading" });

  useEffect(() => {
    if (typeof fetch !== "function") {
      setState({ status: "error", message: "Live lookup unavailable in this environment." });
      return;
    }
    const controller = new AbortController();
    // Encode ">" but keep the ":" that the MyVariant id syntax uses.
    const encodedId = variantId.replace(/>/g, "%3E");
    const url = `https://myvariant.info/v1/variant/${encodedId}?fields=${encodeURIComponent(FIELDS)}`;

    setState({ status: "loading" });
    fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then((res) => {
        if (!res.ok) throw new Error(`MyVariant.info returned HTTP ${res.status}`);
        return res.json() as Promise<RawVariant>;
      })
      .then((raw) => setState({ status: "ready", data: parse(raw) }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: err instanceof Error ? err.message : "Live lookup failed." });
      });

    return () => controller.abort();
  }, [variantId]);

  return state;
}
