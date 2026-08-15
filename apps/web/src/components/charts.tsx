// Dependency-free, presentational chart primitives used to give the multi-omics
// and imaging panels a clinical feel. All are illustrative: they render
// synthetic values and are clearly labelled as such. Charts are decorative
// (aria-hidden) and always paired with the underlying values as accessible
// text, so no information depends on the graphic alone.

export interface MetricBar {
  readonly label: string;
  readonly display: string;
  /** Signed magnitude used for the bar length (e.g. a z-score). */
  readonly value: number;
  readonly tone: "info" | "warning" | "success" | "neutral" | "danger";
}

export interface MetricBarsProps {
  readonly items: readonly MetricBar[];
  /** Absolute value that maps to a full-width bar. */
  readonly max: number;
  readonly ariaLabel: string;
}

/** Horizontal magnitude bars (CSS widths as percentages — never fixed px). */
export function MetricBars({ items, max, ariaLabel }: MetricBarsProps) {
  const safeMax = max <= 0 ? 1 : max;
  return (
    <ul className="metric-bars" aria-label={ariaLabel}>
      {items.map((item) => {
        const pct = Math.min(100, Math.round((Math.abs(item.value) / safeMax) * 100));
        return (
          <li key={item.label} className="metric-bar">
            <span className="metric-bar__label">{item.label}</span>
            <span className="metric-bar__track" aria-hidden="true">
              <span className={`metric-bar__fill metric-bar__fill--${item.tone}`} style={{ width: `${pct}%` }} />
            </span>
            <span className="metric-bar__value">{item.display}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** A synthetic, schematic multi-channel EEG-style trace (decorative). */
export function EegTrace() {
  const channels = 4;
  const width = 240;
  const height = 96;
  const rowH = height / channels;
  const rows = Array.from({ length: channels }, (_, i) => {
    const y = rowH * i + rowH / 2;
    // Deterministic pseudo-wave so it renders identically each time.
    let d = `M0 ${y.toFixed(1)}`;
    for (let x = 0; x <= width; x += 8) {
      const amp = (i % 2 === 0 ? 6 : 9) * Math.sin((x / 8 + i) * 1.1);
      const spike = x % 64 === 0 ? (i + 1) * 3 : 0;
      d += ` L${x} ${(y - amp - spike).toFixed(1)}`;
    }
    return d;
  });
  return (
    <svg
      className="schematic schematic--eeg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Illustrative synthetic EEG trace (not a diagnostic image)"
      preserveAspectRatio="none"
    >
      {rows.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="1.2" />
      ))}
    </svg>
  );
}

/** A synthetic, schematic axial brain outline (decorative). */
export function BrainSchematic() {
  return (
    <svg
      className="schematic schematic--brain"
      viewBox="0 0 120 96"
      role="img"
      aria-label="Schematic brain outline (synthetic, not a diagnostic image)"
    >
      <ellipse cx="60" cy="48" rx="46" ry="38" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M60 12 V84" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <path d="M24 40 q18 -14 36 0 q18 14 36 0" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <path d="M24 56 q18 14 36 0 q18 -14 36 0" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
    </svg>
  );
}

/**
 * A standard-notation family pedigree (synthetic). Squares are male, circles
 * female; a filled symbol is affected; the arrow marks the proband. Matches the
 * featured case: unaffected parents, affected proband, unaffected sibling.
 */
export function Pedigree() {
  const stroke = "#334155";
  return (
    <svg
      className="pedigree"
      viewBox="0 0 300 210"
      role="img"
      aria-label="Family pedigree (synthetic): unaffected father and mother; affected proband indicated by an arrow; one unaffected sibling."
    >
      {/* Mating + descent lines */}
      <g stroke={stroke} strokeWidth="1.5" fill="none">
        <line x1="104" y1="45" x2="196" y2="45" />
        <line x1="150" y1="45" x2="150" y2="110" />
        <line x1="100" y1="110" x2="200" y2="110" />
        <line x1="100" y1="110" x2="100" y2="126" />
        <line x1="200" y1="110" x2="200" y2="126" />
      </g>

      {/* Generation I: father (square) + mother (circle), both unaffected */}
      <rect x="76" y="31" width="28" height="28" fill="#fff" stroke={stroke} strokeWidth="1.5" />
      <circle cx="210" cy="45" r="14" fill="#fff" stroke={stroke} strokeWidth="1.5" />

      {/* Generation II: proband (affected female, filled circle) + sibling (male, unaffected square) */}
      <circle cx="100" cy="140" r="14" fill={stroke} stroke={stroke} strokeWidth="1.5" />
      <rect x="186" y="126" width="28" height="28" fill="#fff" stroke={stroke} strokeWidth="1.5" />

      {/* Proband arrow */}
      <g stroke={stroke} strokeWidth="1.5" fill="none">
        <line x1="68" y1="172" x2="86" y2="152" />
        <path d="M86 152 l-7 1 l3 -6" fill={stroke} />
      </g>

      {/* Labels */}
      <g fill="#55617a" fontSize="10" textAnchor="middle" fontWeight="600">
        <text x="90" y="24">Father</text>
        <text x="210" y="24">Mother</text>
        <text x="100" y="172">Proband</text>
        <text x="200" y="172">Sibling</text>
      </g>
    </svg>
  );
}

import { GROWTH_OFC, MECP2_PROTEIN } from "../data/reference.js";

const DOMAIN_FILL: Record<string, string> = {
  info: "#bcd8f5",
  neutral: "#dbe2ec",
  warning: "#f6dca0",
  success: "#bfe6cf",
  danger: "#f3c1bc"
};

/**
 * A protein "lollipop" / domain plot for MECP2: the protein backbone with its
 * functional domains (MBD, ID, TRD + NLS) and the recurrent Rett variant
 * positions as lollipops, with this case's candidate (p.Arg168*) highlighted.
 * Illustrative: domain boundaries and hotspots are real; layout is schematic.
 */
export function ProteinLollipop() {
  const p = MECP2_PROTEIN;
  const W = 460;
  const H = 190;
  const padL = 24;
  const padR = 18;
  const backboneY = 128;
  const backboneH = 18;
  const x = (pos: number) => padL + (pos / p.length) * (W - padL - padR);
  const ticks = [1, 100, 200, 300, 400, p.length];

  return (
    <svg
      className="lollipop"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`MECP2 protein domain map (${p.isoform}). The candidate variant p.Arg168* is a nonsense variant at residue 168, immediately after the methyl-CpG-binding domain and before the transcription-repression domain, truncating the protein and removing its repression function.`}
    >
      <rect x="0" y="0" width={W} height={H} fill="var(--c-surface)" />

      {/* Backbone */}
      <rect x={x(1)} y={backboneY} width={x(p.length) - x(1)} height={backboneH} rx="3" fill="#eef2f8" stroke="var(--c-border-strong)" strokeWidth="1" />

      {/* Domains */}
      {p.domains.map((d) => (
        <g key={d.name}>
          <rect x={x(d.start)} y={backboneY} width={x(d.end) - x(d.start)} height={backboneH} rx="2" fill={DOMAIN_FILL[d.tone] ?? "#dbe2ec"} stroke="var(--c-border-strong)" strokeWidth="1" />
          <text x={(x(d.start) + x(d.end)) / 2} y={backboneY + backboneH / 2 + 3} textAnchor="middle" fontSize="9" fontWeight="700" fill="#0f1b33">{d.name}</text>
        </g>
      ))}

      {/* NLS band within the TRD */}
      <rect x={x(p.nls.start)} y={backboneY - 3} width={x(p.nls.end) - x(p.nls.start)} height={backboneH + 6} fill="none" stroke="#7c3aed" strokeWidth="1.2" strokeDasharray="3 2" />
      <text x={(x(p.nls.start) + x(p.nls.end)) / 2} y={backboneY + backboneH + 12} textAnchor="middle" fontSize="7" fill="#7c3aed">NLS</text>

      {/* Axis ticks */}
      <g fill="var(--c-text-subtle)" fontSize="8">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={backboneY + backboneH} x2={x(t)} y2={backboneY + backboneH + 4} stroke="var(--c-border-strong)" strokeWidth="1" />
            <text x={x(t)} y={backboneY + backboneH + 20} textAnchor="middle">{t}</text>
          </g>
        ))}
        <text x={(padL + W - padR) / 2} y={H - 2} textAnchor="middle">Residue (aa)</text>
      </g>

      {/* Variant lollipops */}
      {p.variants.map((v) => {
        const cx = x(v.pos);
        const top = v.featured ? 34 : 74;
        const r = v.featured ? 6 : 3.4;
        const color = v.featured ? "#b42318" : v.kind === "nonsense" ? "#c08a86" : "#c9a24a";
        return (
          <g key={v.label}>
            <line x1={cx} y1={backboneY} x2={cx} y2={top} stroke={color} strokeWidth={v.featured ? 1.8 : 1} />
            {v.kind === "nonsense" ? (
              <rect x={cx - r} y={top - r} width={r * 2} height={r * 2} fill={color} transform={`rotate(45 ${cx} ${top})`} />
            ) : (
              <circle cx={cx} cy={top} r={r} fill={color} />
            )}
            {v.featured && (
              <text x={cx} y={top - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill="#b42318">{v.protein}</text>
            )}
            {!v.featured && (
              <text x={cx} y={top - 6} textAnchor="middle" fontSize="7" fill="var(--c-text-subtle)">{v.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Head-circumference (OFC) growth chart: P3/P50/P97 reference bands plus the
 * patient's trajectory. Reference bands approximate the WHO girls' reference;
 * the patient points are synthetic (showing acquired microcephaly). Rendered as
 * SVG; an accessible summary is provided via role="img" + aria-label.
 */
export function GrowthChart() {
  const W = 420;
  const H = 260;
  const padL = 40;
  const padB = 28;
  const padT = 12;
  const padR = 12;
  const maxAge = 48;
  const yMin = 30;
  const yMax = 53;

  const x = (age: number) => padL + (age / maxAge) * (W - padL - padR);
  const y = (cm: number) => padT + (1 - (cm - yMin) / (yMax - yMin)) * (H - padT - padB);

  const line = (vals: readonly number[]) =>
    GROWTH_OFC.ages.map((age, i) => `${i === 0 ? "M" : "L"}${x(age).toFixed(1)} ${y(vals[i] ?? 0).toFixed(1)}`).join(" ");

  const patient = GROWTH_OFC.patient.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.age).toFixed(1)} ${y(p.cm).toFixed(1)}`).join(" ");

  const yTicks = [32, 36, 40, 44, 48, 52];
  const xTicks = [0, 12, 24, 36, 48];

  return (
    <svg
      className="growth-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Head-circumference growth chart: patient starts near the 50th percentile and decelerates below the 3rd percentile by two years (synthetic; reference bands approximate the WHO girls' reference)."
    >
      <rect x="0" y="0" width={W} height={H} fill="var(--c-surface)" />
      {/* Grid + axes */}
      <g stroke="var(--c-border)" strokeWidth="1">
        {yTicks.map((t) => (
          <line key={`y${t}`} x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} />
        ))}
      </g>
      <g fill="var(--c-text-subtle)" fontSize="9">
        {yTicks.map((t) => (
          <text key={`yl${t}`} x={padL - 6} y={y(t) + 3} textAnchor="end">{t}</text>
        ))}
        {xTicks.map((t) => (
          <text key={`xl${t}`} x={x(t)} y={H - padB + 14} textAnchor="middle">{t}</text>
        ))}
        <text x={(padL + W - padR) / 2} y={H - 2} textAnchor="middle">Age (months)</text>
      </g>
      {/* Reference percentile lines */}
      <path d={line(GROWTH_OFC.p97)} fill="none" stroke="var(--c-border-strong)" strokeWidth="1" strokeDasharray="4 3" />
      <path d={line(GROWTH_OFC.p50)} fill="none" stroke="var(--c-text-subtle)" strokeWidth="1.25" />
      <path d={line(GROWTH_OFC.p3)} fill="none" stroke="var(--c-border-strong)" strokeWidth="1" strokeDasharray="4 3" />
      {/* Patient trajectory */}
      <path d={patient} fill="none" stroke="var(--c-danger)" strokeWidth="2.25" />
      {GROWTH_OFC.patient.map((p) => (
        <circle key={p.age} cx={x(p.age)} cy={y(p.cm)} r="3.2" fill="var(--c-danger)" />
      ))}
      {/* Labels for the bands */}
      <g fill="var(--c-text-subtle)" fontSize="9">
        <text x={W - padR} y={y(GROWTH_OFC.p97[GROWTH_OFC.p97.length - 1] ?? 0) - 3} textAnchor="end">P97</text>
        <text x={W - padR} y={y(GROWTH_OFC.p50[GROWTH_OFC.p50.length - 1] ?? 0) - 3} textAnchor="end">P50</text>
        <text x={W - padR} y={y(GROWTH_OFC.p3[GROWTH_OFC.p3.length - 1] ?? 0) - 3} textAnchor="end">P3</text>
      </g>
    </svg>
  );
}
