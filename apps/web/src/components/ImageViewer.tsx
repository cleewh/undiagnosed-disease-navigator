import { useMemo, useRef, useState } from "react";
import { IMAGE_SERIES } from "../data/reference.js";

// A PACS/DICOM-style image viewer for the featured case. The chrome (modality,
// series list, slice scroll, window/level presets, a measurement tool, study
// metadata) mirrors real radiology software, but the pixels are procedurally
// generated / open-licensed reference slices — never a real scan of this
// patient. Image tooling here is deliberately NON-AI: window/level and linear
// measurement are standard viewer functions. True medical image AI (lesion
// segmentation, radiomics, volumetrics) is regulated Software-as-a-Medical-
// Device and would require validated models (e.g. MONAI on Amazon SageMaker,
// AWS HealthImaging) — out of scope for this synthetic demonstration.

interface SliceProps {
  readonly modality: "MRI" | "CT";
  readonly slice: number;
  readonly slices: number;
}

/** A single procedurally-generated axial head slice (grayscale, synthetic). */
function Slice({ modality, slice, slices }: SliceProps) {
  // Mid-slice weighting: structures are largest through the middle of the stack.
  const t = slices <= 1 ? 0.5 : slice / (slices - 1);
  const mid = 1 - Math.abs(t - 0.5) * 2; // 0 at ends, 1 in the middle
  const brainRx = 54 + mid * 6;
  const brainRy = 66 + mid * 6;
  const ventScale = 0.35 + mid * 0.65;

  const isCt = modality === "CT";
  const skull = isCt ? "#e6e6e6" : "#3a3f47";
  const brain = isCt ? "#5a5f66" : "#787d85";
  const vent = isCt ? "#26292e" : "#cdd3da";
  const gyri = isCt ? "#4a4e55" : "#666b73";

  // Deterministic gyral arcs so the image is stable across renders.
  const arcs = useMemo(() => {
    const paths: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const y = 60 + i * 18;
      const dir = i % 2 === 0 ? 1 : -1;
      paths.push(`M52 ${y} q48 ${dir * 12} 96 0`);
    }
    return paths;
  }, []);

  return (
    <svg viewBox="0 0 200 220" className="dicom__pixels" role="img" aria-label={`Synthetic ${modality} axial slice ${slice + 1} of ${slices} — not a diagnostic image`}>
      <defs>
        <radialGradient id="brainShade" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor={brain} />
          <stop offset="100%" stopColor={isCt ? "#3f4349" : "#5e636b"} />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="200" height="220" fill="#05070a" />
      {/* Scalp / skull */}
      <ellipse cx="100" cy="110" rx="72" ry="86" fill={skull} opacity={isCt ? 0.95 : 0.5} />
      <ellipse cx="100" cy="110" rx="66" ry="80" fill="#05070a" />
      {/* Brain parenchyma */}
      <ellipse cx="100" cy="110" rx={brainRx} ry={brainRy} fill="url(#brainShade)" />
      {/* Sulci / gyri texture */}
      <g stroke={gyri} strokeWidth="1" fill="none" opacity="0.5">
        {arcs.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      {/* Falx */}
      <line x1="100" y1={110 - brainRy + 6} x2="100" y2={110 + brainRy - 6} stroke={isCt ? "#2b2e33" : "#8a9099"} strokeWidth="1" opacity="0.7" />
      {/* Lateral ventricles (butterfly) */}
      <g fill={vent} opacity="0.9" transform={`translate(100 104) scale(${ventScale.toFixed(3)})`}>
        <path d="M-4 -14 q-16 6 -14 22 q10 6 16 -2 q2 -12 -2 -20 z" />
        <path d="M4 -14 q16 6 14 22 q-10 6 -16 -2 q-2 -12 2 -20 z" />
      </g>
    </svg>
  );
}

/** A synthetic single-voxel MR spectrum (PRESS). ppm axis 4.0 -> 0.5 with the
 *  major metabolite peaks (Cho, Cr, NAA) and a minimal/absent lactate doublet
 *  at 1.3 ppm — i.e. a reassuring, non-mitochondrial trace. Illustrative only. */
function MrSpectrum() {
  const baseline = 172;
  const x0 = 18;
  const x1 = 190;
  const ppmToX = (ppm: number) => x0 + ((4.0 - ppm) / (4.0 - 0.5)) * (x1 - x0);
  const peaks: ReadonlyArray<[number, number, number, string]> = [
    [3.2, 78, 5, "Cho"],
    [3.0, 88, 5, "Cr"],
    [2.0, 128, 6, "NAA"]
  ];
  const bump = (cx: number, h: number, w: number) =>
    `M${(cx - w).toFixed(1)},${baseline} Q${cx.toFixed(1)},${(baseline - 2 * h).toFixed(1)} ${(cx + w).toFixed(1)},${baseline}`;
  return (
    <svg viewBox="0 0 200 200" className="dicom__pixels" role="img" aria-label="Synthetic MR spectroscopy trace — reassuring, non-diagnostic">
      <rect x="0" y="0" width="200" height="200" fill="#05070a" />
      <line x1={x0} y1={baseline} x2={x1} y2={baseline} stroke="#3a4a63" strokeWidth="0.8" />
      {[4, 3, 2, 1].map((ppm) => (
        <g key={ppm}>
          <line x1={ppmToX(ppm)} y1={baseline} x2={ppmToX(ppm)} y2={baseline + 4} stroke="#3a4a63" strokeWidth="0.8" />
          <text x={ppmToX(ppm)} y={baseline + 14} fill="#7c8aa5" fontSize="8" textAnchor="middle">{ppm}.0</text>
        </g>
      ))}
      <text x={(x0 + x1) / 2} y={195} fill="#7c8aa5" fontSize="8" textAnchor="middle">Chemical shift (ppm)</text>
      {peaks.map(([ppm, h, w, label]) => (
        <g key={label}>
          <path d={bump(ppmToX(ppm), h, w)} fill="none" stroke="#7fe3b0" strokeWidth="1.4" />
          <text x={ppmToX(ppm)} y={baseline - h - 6} fill="#cdeee0" fontSize="8" textAnchor="middle">{label}</text>
        </g>
      ))}
      <path d={`${bump(ppmToX(1.33), 7, 2)} ${bump(ppmToX(1.27), 7, 2)}`} fill="none" stroke="#8a5a5a" strokeWidth="1" />
      <text x={ppmToX(1.3)} y={baseline - 16} fill="#a97d7d" fontSize="7" textAnchor="middle">Lac (nil)</text>
    </svg>
  );
}

// Display presets -> CSS filters approximating radiology display adjustments.
// Nominal only: the reference pixels carry no real Hounsfield/signal scale.
// These are modality-aware: window/level (brain, stroke, bone, soft-tissue) is
// a CT/Hounsfield concept, so it is only offered for CT. MRI has no Hounsfield
// scale, so it gets brightness/contrast-style display presets instead.
interface WindowPreset {
  readonly id: string;
  readonly label: string;
  readonly filter: string;
}
const CT_WINDOWS: readonly WindowPreset[] = [
  { id: "default", label: "Brain (W80/L40)", filter: "none" },
  { id: "stroke", label: "Stroke (W35/L35)", filter: "brightness(1.05) contrast(1.6)" },
  { id: "bone", label: "Bone (W2500/L480)", filter: "brightness(0.9) contrast(1.95)" },
  { id: "soft", label: "Soft tissue (W350/L40)", filter: "brightness(1.3) contrast(0.95)" },
  { id: "invert", label: "Invert", filter: "invert(1) brightness(1.05)" }
];
const MRI_DISPLAY: readonly WindowPreset[] = [
  { id: "default", label: "Default", filter: "none" },
  { id: "bright", label: "Brighten", filter: "brightness(1.25) contrast(1.1)" },
  { id: "graywhite", label: "Gray–white", filter: "brightness(1.05) contrast(1.4)" },
  { id: "invert", label: "Invert", filter: "invert(1) brightness(1.05)" }
];

// Assumed display field-of-view so the ruler can show an approximate length.
const ASSUMED_FOV_MM = 180;

interface Point {
  readonly x: number;
  readonly y: number;
}

export function ImageViewer() {
  const [seriesIndex, setSeriesIndex] = useState(0);
  const series = IMAGE_SERIES[seriesIndex] ?? IMAGE_SERIES[0];
  const [slice, setSlice] = useState(0);
  const [windowId, setWindowId] = useState("default");
  const [measuring, setMeasuring] = useState(false);
  const [pointA, setPointA] = useState<Point | null>(null);
  const [pointB, setPointB] = useState<Point | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  if (!series) return null;

  const frames = series.frames;
  const sliceCount = frames ? frames.length : series.slices;
  const safeSlice = Math.min(slice, sliceCount - 1);
  const frameSrc = frames ? frames[safeSlice] : undefined;
  const isReal = Boolean(frames);
  const isSpectrum = Boolean(series.spectrum);
  const windows = series.modality === "CT" ? CT_WINDOWS : MRI_DISPLAY;
  const preset = windows.find((w) => w.id === windowId) ?? windows[0];
  const filter = preset ? preset.filter : "none";

  const selectSeries = (index: number) => {
    const next = IMAGE_SERIES[index];
    if (!next) return;
    setSeriesIndex(index);
    setSlice(0);
    setWindowId("default");
    clearMeasure();
  };

  const clearMeasure = () => {
    setPointA(null);
    setPointB(null);
  };

  const distanceMm = (() => {
    if (!pointA || !pointB) return null;
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const norm = Math.sqrt(dx * dx + dy * dy); // 0..~1.4 of the frame
    return Math.round(norm * ASSUMED_FOV_MM);
  })();

  const onFrameClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!measuring || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const p: Point = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
    if (!pointA || (pointA && pointB)) {
      setPointA(p);
      setPointB(null);
    } else {
      setPointB(p);
    }
  };

  return (
    <div className="dicom" data-testid="image-viewer">
      <div className="dicom__series" role="tablist" aria-label="Imaging series">
        {IMAGE_SERIES.map((s, index) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={index === seriesIndex}
            className={index === seriesIndex ? "dicom__series-btn dicom__series-btn--active" : "dicom__series-btn"}
            onClick={() => selectSeries(index)}
          >
            <span className="dicom__series-modality">{s.modality}</span>
            <span className="dicom__series-seq">{s.sequence}</span>
          </button>
        ))}
      </div>

      {!isSpectrum && (
      <div className="dicom__toolbar" role="group" aria-label="Viewer tools">
        <span className="dicom__tool-label">{series.modality === "CT" ? "Window/level" : "Display"}</span>
        {windows.map((w) => (
          <button
            key={w.id}
            type="button"
            className={w.id === windowId ? "dicom__tool-btn dicom__tool-btn--active" : "dicom__tool-btn"}
            aria-pressed={w.id === windowId}
            onClick={() => setWindowId(w.id)}
          >
            {w.label}
          </button>
        ))}
        <span className="dicom__tool-sep" aria-hidden="true" />
        <button
          type="button"
          className={measuring ? "dicom__tool-btn dicom__tool-btn--active" : "dicom__tool-btn"}
          aria-pressed={measuring}
          onClick={() => {
            setMeasuring((m) => !m);
            if (measuring) clearMeasure();
          }}
        >
          Measure
        </button>
        {(pointA || pointB) && (
          <button type="button" className="dicom__tool-btn" onClick={clearMeasure}>
            Clear
          </button>
        )}
      </div>
      )}

      <div className="dicom__stage">
        <div
          className={`dicom__frame${measuring ? " dicom__frame--measuring" : ""}`}
          ref={frameRef}
          onClick={onFrameClick}
        >
          <div className="dicom__filtered" style={{ filter }}>
            {isSpectrum ? (
              <MrSpectrum />
            ) : frames && frameSrc ? (
              <img
                className="dicom__pixels dicom__pixels--real"
                src={frameSrc}
                alt={`Open-licensed reference ${series.modality} axial image, slice ${safeSlice + 1} of ${sliceCount} — illustrative reference, not this patient's scan`}
              />
            ) : (
              <Slice modality={series.modality} slice={slice} slices={sliceCount} />
            )}
          </div>

          {!isSpectrum && (
            <>
              <span className="dicom__orient dicom__orient--l" aria-hidden="true">R</span>
              <span className="dicom__orient dicom__orient--r" aria-hidden="true">L</span>
            </>
          )}

          {(pointA || pointB) && (
            <svg className="dicom__measure" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {pointA && pointB && (
                <line
                  x1={pointA.x * 100}
                  y1={pointA.y * 100}
                  x2={pointB.x * 100}
                  y2={pointB.y * 100}
                  className="dicom__measure-line"
                />
              )}
              {pointA && <circle cx={pointA.x * 100} cy={pointA.y * 100} r="1.4" className="dicom__measure-pt" />}
              {pointB && <circle cx={pointB.x * 100} cy={pointB.y * 100} r="1.4" className="dicom__measure-pt" />}
            </svg>
          )}

          <span className="dicom__overlay dicom__overlay--tl">{series.modality} · {series.site}</span>
          <span className="dicom__overlay dicom__overlay--tr">{isSpectrum ? "Single voxel" : `Slice ${safeSlice + 1}/${sliceCount}`}</span>
          <span className="dicom__overlay dicom__overlay--bl">
            {series.windowLevel}{preset && preset.id !== "default" ? ` · ${preset.label}` : ""}
          </span>
          <span className="dicom__overlay dicom__overlay--br">{isReal ? "REFERENCE" : `SYN-${series.id.toUpperCase()}`}</span>
          {distanceMm !== null && (
            <span className="dicom__overlay dicom__overlay--measure">≈ {distanceMm} mm (assumed scale)</span>
          )}
          <span className="dicom__watermark" aria-hidden="true">
            {isReal ? "REFERENCE IMAGE — NOT THIS PATIENT" : "SYNTHETIC — NOT A DIAGNOSTIC IMAGE"}
          </span>
        </div>
        {!isSpectrum && (
          <label className="dicom__scroll">
            <span className="visually-hidden">Scroll slices</span>
            <input
              type="range"
              min={0}
              max={sliceCount - 1}
              value={safeSlice}
              onChange={(e) => setSlice(Number(e.target.value))}
              aria-label={`Slice ${safeSlice + 1} of ${sliceCount}`}
            />
          </label>
        )}
      </div>

      {measuring && (
        <p className="dicom__hint" role="status">
          {!pointA
            ? "Click a start point on the image."
            : !pointB
              ? "Click an end point to measure."
              : `Approximate distance: ${distanceMm} mm (nominal ${ASSUMED_FOV_MM} mm field of view — reference image has no true scale).`}
        </p>
      )}

      <dl className="dicom__meta">
        <div><dt>Modality</dt><dd>{series.modality}</dd></div>
        <div><dt>Sequence</dt><dd>{series.sequence}</dd></div>
        <div><dt>Acquired</dt><dd>{series.date}</dd></div>
        {series.accession && <div><dt>Accession</dt><dd><code>{series.accession}</code></dd></div>}
        <div><dt>Impression</dt><dd><span className={`pill pill--${series.tone}`}>{series.impression}</span></dd></div>
        {isReal && (
          <div className="dicom__attribution">
            <dt>Reference image</dt>
            <dd>
              {series.credit} ·{" "}
              <a href={series.licenseUrl} target="_blank" rel="noreferrer">{series.license}</a>{" "}
              (<a href={series.sourceUrl} target="_blank" rel="noreferrer">{series.source}</a>).
              Illustrative reference — not this patient's scan.
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
