import { useMemo, useState } from "react";

// Interactive evidence graph: a hand-laid network showing how the evidence
// converges on the working diagnosis. Evidence criteria support the variant,
// the variant and the phenotypes support Rett syndrome, and some phenotypes
// also partially support the differentials (why they remain open). Click a node
// to focus its connections; click the background to reset. Dependency-free SVG.

type NodeType = "diagnosis" | "variant" | "evidence" | "phenotype" | "differential";
type Relation = "support" | "pending" | "partial";

interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly full: string;
  readonly type: NodeType;
  readonly x: number;
  readonly y: number;
}
interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly rel: Relation;
  readonly w: number;
}

const NODES: readonly GraphNode[] = [
  { id: "pvs1", label: "PVS1", full: "PVS1 — null variant in a LoF gene", type: "evidence", x: 80, y: 110 },
  { id: "gnomad", label: "gnomAD 0", full: "Absent from gnomAD (PM2)", type: "evidence", x: 80, y: 220 },
  { id: "denovo", label: "de novo?", full: "Assumed de novo (PM6) — unconfirmed", type: "evidence", x: 80, y: 330 },
  { id: "variant", label: "MECP2 var", full: "MECP2 c.502C>T (p.Arg168*)", type: "variant", x: 235, y: 220 },
  { id: "rett", label: "Rett", full: "Rett syndrome (working diagnosis)", type: "diagnosis", x: 410, y: 220 },
  { id: "seizure", label: "Seizure", full: "Seizure (HP:0001250)", type: "phenotype", x: 560, y: 70 },
  { id: "regression", label: "Regression", full: "Developmental regression (HP:0002376)", type: "phenotype", x: 665, y: 150 },
  { id: "gdd", label: "GDD", full: "Global developmental delay (HP:0001263)", type: "phenotype", x: 675, y: 245 },
  { id: "microcephaly", label: "Microcephaly", full: "Secondary microcephaly (HP:0005484)", type: "phenotype", x: 615, y: 335 },
  { id: "stereotypy", label: "Stereotypy", full: "Hand stereotypies (HP:0012171)", type: "phenotype", x: 500, y: 115 },
  { id: "cdkl5", label: "CDKL5", full: "CDKL5 deficiency disorder", type: "differential", x: 340, y: 390 },
  { id: "foxg1", label: "FOXG1", full: "FOXG1 syndrome", type: "differential", x: 445, y: 395 },
  { id: "angelman", label: "Angelman", full: "Angelman syndrome (UBE3A)", type: "differential", x: 550, y: 385 }
];

const EDGES: readonly GraphEdge[] = [
  { from: "pvs1", to: "variant", rel: "support", w: 3 },
  { from: "gnomad", to: "variant", rel: "support", w: 2 },
  { from: "denovo", to: "variant", rel: "pending", w: 2 },
  { from: "variant", to: "rett", rel: "support", w: 4 },
  { from: "seizure", to: "rett", rel: "support", w: 2 },
  { from: "regression", to: "rett", rel: "support", w: 2 },
  { from: "gdd", to: "rett", rel: "support", w: 2 },
  { from: "microcephaly", to: "rett", rel: "support", w: 2 },
  { from: "stereotypy", to: "rett", rel: "support", w: 2 },
  { from: "seizure", to: "cdkl5", rel: "partial", w: 1.4 },
  { from: "regression", to: "cdkl5", rel: "partial", w: 1.4 },
  { from: "microcephaly", to: "foxg1", rel: "partial", w: 1.4 },
  { from: "stereotypy", to: "foxg1", rel: "partial", w: 1.4 },
  { from: "seizure", to: "angelman", rel: "partial", w: 1.4 },
  { from: "stereotypy", to: "angelman", rel: "partial", w: 1.4 }
];

const NODE_FILL: Record<NodeType, string> = {
  diagnosis: "#2563eb",
  variant: "#7c3aed",
  evidence: "#0e7490",
  phenotype: "#067647",
  differential: "#b45309"
};
const NODE_R: Record<NodeType, number> = {
  diagnosis: 32,
  variant: 24,
  evidence: 17,
  phenotype: 15,
  differential: 18
};
const REL_STROKE: Record<Relation, string> = {
  support: "#22c55e",
  pending: "#0e7490",
  partial: "#f59e0b"
};

export function EvidenceGraph() {
  const [selected, setSelected] = useState<string | null>(null);
  const byId = useMemo(() => Object.fromEntries(NODES.map((n) => [n.id, n])), []);

  const neighbors = useMemo(() => {
    if (!selected) return null;
    const set = new Set<string>([selected]);
    EDGES.forEach((e) => {
      if (e.from === selected) set.add(e.to);
      if (e.to === selected) set.add(e.from);
    });
    return set;
  }, [selected]);

  const edgeActive = (e: GraphEdge) => !selected || e.from === selected || e.to === selected;
  const nodeActive = (id: string) => !selected || (neighbors?.has(id) ?? false);

  return (
    <svg
      className="evgraph"
      viewBox="0 0 730 440"
      role="img"
      aria-label="Evidence graph: PVS1 and absence from gnomAD support the MECP2 variant; the variant and five phenotypes support the working diagnosis of Rett syndrome; some phenotypes also partially support the CDKL5, FOXG1 and Angelman differentials."
    >
      <rect x="0" y="0" width="730" height="440" fill="transparent" onClick={() => setSelected(null)} />

      {/* Edges */}
      {EDGES.map((e, i) => {
        const a = byId[e.from];
        const b = byId[e.to];
        if (!a || !b) return null;
        const active = edgeActive(e);
        return (
          <line
            key={`${e.from}-${e.to}-${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={REL_STROKE[e.rel]}
            strokeWidth={e.w}
            strokeDasharray={e.rel === "support" ? undefined : "5 4"}
            opacity={active ? 0.85 : 0.1}
          />
        );
      })}

      {/* Nodes */}
      {NODES.map((n) => {
        const active = nodeActive(n.id);
        const r = NODE_R[n.type];
        return (
          <g
            key={n.id}
            className="evgraph__node"
            opacity={active ? 1 : 0.28}
            onClick={(ev) => {
              ev.stopPropagation();
              setSelected((cur) => (cur === n.id ? null : n.id));
            }}
          >
            <circle cx={n.x} cy={n.y} r={r} fill={NODE_FILL[n.type]} stroke={selected === n.id ? "#0f1b33" : "#fff"} strokeWidth={selected === n.id ? 3 : 1.5} />
            <text x={n.x} y={n.y + r + 12} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--c-text)">{n.label}</text>
            <title>{n.full}</title>
          </g>
        );
      })}
    </svg>
  );
}
