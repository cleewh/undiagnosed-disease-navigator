import { useEffect, useState } from "react";

// Live data hooks for three CORS-enabled public biomedical APIs:
//   - MyGene.info        gene summary
//   - Ensembl REST (VEP) variant molecular consequence / transcripts
//   - HPO (ontology.jax.org) phenotype→disease associations
// All are called directly from the browser (no backend). Each hook aborts on
// unmount, guards environments without fetch, and exposes loading/ready/error.

function usable(): boolean {
  return typeof fetch === "function";
}

// --- MyGene.info: gene summary -------------------------------------------

export interface GeneSummary {
  readonly symbol: string;
  readonly name: string;
  readonly type?: string;
  readonly summary?: string;
  readonly chrom?: string;
  readonly start?: number;
  readonly end?: number;
  readonly strand?: number;
  readonly ensemblGene?: string;
}

export type GeneState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly gene: GeneSummary }
  | { readonly status: "error"; readonly message: string };

export function useGeneSummary(entrezId: string): GeneState {
  const [state, setState] = useState<GeneState>({ status: "loading" });
  useEffect(() => {
    if (!usable()) return setState({ status: "error", message: "Live lookup unavailable." });
    const ac = new AbortController();
    const url = `https://mygene.info/v3/gene/${entrezId}?fields=symbol,name,summary,type_of_gene,genomic_pos`;
    setState({ status: "loading" });
    fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } })
      .then((r) => { if (!r.ok) throw new Error(`MyGene.info HTTP ${r.status}`); return r.json(); })
      .then((d: {
        symbol?: string; name?: string; summary?: string; type_of_gene?: string;
        genomic_pos?: { chr?: string; start?: number; end?: number; strand?: number; ensemblgene?: string }
          | ReadonlyArray<{ chr?: string; start?: number; end?: number; strand?: number; ensemblgene?: string }>;
      }) => {
        const pos = Array.isArray(d.genomic_pos) ? d.genomic_pos[0] : d.genomic_pos;
        setState({
          status: "ready",
          gene: {
            symbol: d.symbol ?? entrezId,
            name: d.name ?? "",
            type: d.type_of_gene,
            summary: d.summary,
            chrom: pos?.chr,
            start: pos?.start,
            end: pos?.end,
            strand: pos?.strand,
            ensemblGene: pos?.ensemblgene
          }
        });
      })
      .catch((e: unknown) => { if (!ac.signal.aborted) setState({ status: "error", message: e instanceof Error ? e.message : "Failed." }); });
    return () => ac.abort();
  }, [entrezId]);
  return state;
}

// --- Ensembl VEP: molecular consequence ----------------------------------

export interface Consequence {
  readonly mostSevere: string;
  readonly assembly?: string;
  readonly impact?: string;
  readonly transcriptId?: string;
  readonly biotype?: string;
  readonly transcriptCount: number;
}

export type ConsequenceState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: Consequence }
  | { readonly status: "error"; readonly message: string };

interface RawTc {
  readonly gene_symbol?: string;
  readonly transcript_id?: string;
  readonly consequence_terms?: readonly string[];
  readonly impact?: string;
  readonly biotype?: string;
  readonly canonical?: number;
  readonly mane_select?: string;
}

export function useVariantConsequence(rsid: string, gene: string): ConsequenceState {
  const [state, setState] = useState<ConsequenceState>({ status: "loading" });
  useEffect(() => {
    if (!usable()) return setState({ status: "error", message: "Live lookup unavailable." });
    const ac = new AbortController();
    const url = `https://rest.ensembl.org/vep/human/id/${encodeURIComponent(rsid)}?content-type=application/json`;
    setState({ status: "loading" });
    fetch(url, { signal: ac.signal, headers: { Accept: "application/json" } })
      .then((r) => { if (!r.ok) throw new Error(`Ensembl HTTP ${r.status}`); return r.json(); })
      .then((arr: ReadonlyArray<{ most_severe_consequence?: string; assembly_name?: string; transcript_consequences?: readonly RawTc[] }>) => {
        const r = arr[0];
        if (!r) throw new Error("No consequence data.");
        const tcs = r.transcript_consequences ?? [];
        const forGene = tcs.filter((t) => t.gene_symbol === gene);
        const rep = forGene.find((t) => t.mane_select) ?? forGene.find((t) => t.canonical === 1) ?? forGene[0] ?? tcs[0];
        setState({
          status: "ready",
          data: {
            mostSevere: r.most_severe_consequence ?? "unknown",
            assembly: r.assembly_name,
            impact: rep?.impact,
            transcriptId: rep?.transcript_id,
            biotype: rep?.biotype,
            transcriptCount: tcs.length
          }
        });
      })
      .catch((e: unknown) => { if (!ac.signal.aborted) setState({ status: "error", message: e instanceof Error ? e.message : "Failed." }); });
    return () => ac.abort();
  }, [rsid, gene]);
  return state;
}

// --- HPO: phenotype→disease association ranking --------------------------

export interface PhenotypeDiseaseMatch {
  readonly id: string;
  readonly name: string;
  readonly mondoId?: string;
  readonly matched: number;
  readonly total: number;
}

export type PhenotypeMatchState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly matches: readonly PhenotypeDiseaseMatch[] }
  | { readonly status: "error"; readonly message: string };

interface RawDisease { readonly id?: string; readonly name?: string; readonly mondoId?: string }

export function usePhenotypeMatches(hpoIds: readonly string[]): PhenotypeMatchState {
  const [state, setState] = useState<PhenotypeMatchState>({ status: "loading" });
  const key = hpoIds.join(",");
  useEffect(() => {
    if (!usable()) return setState({ status: "error", message: "Live lookup unavailable." });
    const ac = new AbortController();
    setState({ status: "loading" });
    Promise.all(
      hpoIds.map((id) =>
        fetch(`https://ontology.jax.org/api/network/annotation/${id}`, { signal: ac.signal, headers: { Accept: "application/json" } })
          .then((r) => { if (!r.ok) throw new Error(`HPO HTTP ${r.status}`); return r.json() as Promise<{ diseases?: readonly RawDisease[] }>; })
          .then((d) => d.diseases ?? [])
      )
    )
      .then((lists) => {
        const acc = new Map<string, { name: string; mondoId?: string; matched: number }>();
        for (const diseases of lists) {
          for (const dis of diseases) {
            if (!dis.id) continue;
            const prev = acc.get(dis.id);
            if (prev) prev.matched += 1;
            else acc.set(dis.id, { name: dis.name ?? dis.id, mondoId: dis.mondoId, matched: 1 });
          }
        }
        const matches = Array.from(acc.entries())
          .map(([id, v]) => ({ id, name: v.name, mondoId: v.mondoId, matched: v.matched, total: hpoIds.length }))
          .filter((m) => m.matched >= 2)
          .sort((a, b) => b.matched - a.matched || a.name.localeCompare(b.name))
          .slice(0, 8);
        setState({ status: "ready", matches });
      })
      .catch((e: unknown) => { if (!ac.signal.aborted) setState({ status: "error", message: e instanceof Error ? e.message : "Failed." }); });
    return () => ac.abort();
  }, [key, hpoIds]);
  return state;
}
