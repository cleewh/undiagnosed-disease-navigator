// A schematic X-chromosome ideogram with Giemsa banding and the MECP2 locus at
// Xq28 highlighted. Band layout is simplified/illustrative (not to scale); the
// point is to place MECP2 at the distal tip of the long arm, where it really
// sits. Dependency-free SVG.

interface Band {
  readonly name: string;
  readonly start: number; // fraction 0..1 along the chromosome
  readonly end: number;
  readonly stain: "gneg" | "gpos25" | "gpos50" | "gpos75" | "gpos100" | "acen";
}

const STAIN_FILL: Record<Band["stain"], string> = {
  gneg: "#f3f4f6",
  gpos25: "#c9ced6",
  gpos50: "#9aa2ae",
  gpos75: "#6b7280",
  gpos100: "#3f4653",
  acen: "#b42318"
};

// Simplified X-chromosome bands (p arm, centromere ~0.40, q arm to Xq28 at tip).
const BANDS: readonly Band[] = [
  { name: "Xp22", start: 0.0, end: 0.14, stain: "gneg" },
  { name: "Xp21", start: 0.14, end: 0.24, stain: "gpos100" },
  { name: "Xp11", start: 0.24, end: 0.39, stain: "gneg" },
  { name: "cen", start: 0.39, end: 0.42, stain: "acen" },
  { name: "Xq13", start: 0.42, end: 0.54, stain: "gpos50" },
  { name: "Xq21", start: 0.54, end: 0.67, stain: "gpos100" },
  { name: "Xq22", start: 0.67, end: 0.77, stain: "gneg" },
  { name: "Xq24", start: 0.77, end: 0.85, stain: "gpos75" },
  { name: "Xq26", start: 0.85, end: 0.92, stain: "gpos50" },
  { name: "Xq27", start: 0.92, end: 0.96, stain: "gneg" },
  { name: "Xq28", start: 0.96, end: 1.0, stain: "gpos25" }
];

export function ChromosomeIdeogram() {
  const W = 620;
  const H = 120;
  const x0 = 20;
  const x1 = W - 20;
  const barY = 34;
  const barH = 30;
  const span = x1 - x0;
  const xf = (f: number) => x0 + f * span;
  const q28 = BANDS[BANDS.length - 1]!;
  const q28mid = xf((q28.start + q28.end) / 2);

  return (
    <svg className="ideogram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="X-chromosome ideogram: the MECP2 gene is highlighted at band Xq28, at the distal tip of the long (q) arm.">
      {/* p / q arm labels */}
      <text x={xf(0.2)} y={20} textAnchor="middle" fontSize="10" fill="var(--c-text-subtle)">p arm</text>
      <text x={xf(0.7)} y={20} textAnchor="middle" fontSize="10" fill="var(--c-text-subtle)">q arm</text>

      {/* Bands (clipped to a rounded chromosome outline) */}
      <defs>
        <clipPath id="chrClip">
          <rect x={x0} y={barY} width={span} height={barH} rx={barH / 2} />
        </clipPath>
      </defs>
      <g clipPath="url(#chrClip)">
        {BANDS.map((b) => (
          <rect key={b.name} x={xf(b.start)} y={barY} width={xf(b.end) - xf(b.start)} height={barH} fill={STAIN_FILL[b.stain]} />
        ))}
        {/* centromere pinch */}
        <circle cx={xf(0.405)} cy={barY + barH / 2} r={barH / 2} fill={STAIN_FILL.acen} opacity="0.85" />
        {/* MECP2 highlight over Xq28 */}
        <rect x={xf(q28.start)} y={barY} width={xf(q28.end) - xf(q28.start)} height={barH} fill="#ef4444" opacity="0.55" />
      </g>
      <rect x={x0} y={barY} width={span} height={barH} rx={barH / 2} fill="none" stroke="var(--c-border-strong)" strokeWidth="1.2" />

      {/* Marker + callout to MECP2 / Xq28 */}
      <line x1={q28mid} y1={barY - 4} x2={q28mid} y2={barY + barH + 4} stroke="#b42318" strokeWidth="1.5" />
      <line x1={q28mid} y1={barY + barH + 4} x2={q28mid} y2={barY + barH + 18} stroke="#b42318" strokeWidth="1.5" />
      <text x={q28mid} y={barY + barH + 30} textAnchor="end" fontSize="11" fontWeight="700" fill="#b42318">MECP2 · Xq28</text>

      {/* Band ticks */}
      <g fill="var(--c-text-subtle)" fontSize="7.5">
        {BANDS.filter((b) => b.name !== "cen").map((b) => (
          <text key={b.name} x={xf((b.start + b.end) / 2)} y={barY - 4} textAnchor="middle">{b.name.replace("X", "")}</text>
        ))}
      </g>
      <text x={x0} y={H - 4} fontSize="8" fill="var(--c-text-subtle)">Chromosome X · schematic banding (not to scale)</text>
    </svg>
  );
}
