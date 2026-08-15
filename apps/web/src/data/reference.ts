// Real, public reference data used to ground the demonstration.
//
// IMPORTANT: the *patients / cases* in this application are entirely synthetic.
// What is real here is the reference vocabulary the cases are built from:
//   - Human Phenotype Ontology (HPO) term identifiers and labels
//   - ClinVar variant descriptions and germline classifications (public domain)
//   - Gene–disease relationships and OMIM / Orphanet disease identifiers
//   - gnomAD population allele-frequency context (used qualitatively)
//
// This lets the workflow look and behave like real clinical software while
// containing no protected health information. Every screen that shows this data
// also renders the DataSourcesNote so the provenance is explicit.
//
// Verified against the sources below (see DATA_SOURCES):
//   MECP2 NM_004992.3:c.502C>T (p.Arg168*)      Pathogenic  Rett syndrome
//   CFTR  NM_000492.3:c.1521_1523del (p.Phe508del) Pathogenic Cystic fibrosis
//   HBB   NM_000518.5:c.20A>T (p.Glu7Val)        Pathogenic  Sickle cell disease
//   FBN1  NM_000138.5:c.184C>T (p.Arg62Cys)      Pathogenic  Marfan syndrome

export type Tone = "info" | "warning" | "success" | "neutral" | "danger";

export interface DataSource {
  readonly name: string;
  readonly detail: string;
  readonly url: string;
}

export const DATA_SOURCES: readonly DataSource[] = [
  { name: "HPO", detail: "Human Phenotype Ontology terms", url: "https://hpo.jax.org" },
  { name: "ClinVar", detail: "Variant classifications (NCBI, public domain)", url: "https://www.ncbi.nlm.nih.gov/clinvar/" },
  { name: "OMIM", detail: "Mendelian disease catalogue", url: "https://www.omim.org" },
  { name: "Orphanet", detail: "Rare disease nomenclature", url: "https://www.orpha.net" },
  { name: "gnomAD", detail: "Population allele frequencies", url: "https://gnomad.broadinstitute.org" },
  { name: "PharmGKB", detail: "Pharmacogenomics knowledge base", url: "https://www.pharmgkb.org" },
  { name: "CPIC", detail: "Pharmacogenetic dosing guidelines", url: "https://cpicpgx.org" },
  { name: "ClinicalTrials.gov", detail: "Clinical trial registry", url: "https://clinicaltrials.gov" }
];

/** A real HPO phenotype term. */
export interface HpoTerm {
  readonly id: string;
  readonly label: string;
}

/** A real gene → disease reference entry. */
export interface GeneDisease {
  readonly gene: string;
  readonly disease: string;
  readonly omim: string;
  readonly orpha: string;
  readonly inheritance: string;
}

// Real gene–disease references (identifiers per OMIM / Orphanet).
export const GENE_DISEASE = {
  MECP2: { gene: "MECP2", disease: "Rett syndrome", omim: "312750", orpha: "778", inheritance: "X-linked dominant (usually de novo)" },
  CFTR: { gene: "CFTR", disease: "Cystic fibrosis", omim: "219700", orpha: "586", inheritance: "Autosomal recessive" },
  HBB: { gene: "HBB", disease: "Sickle cell disease", omim: "603903", orpha: "232", inheritance: "Autosomal recessive" },
  FBN1: { gene: "FBN1", disease: "Marfan syndrome", omim: "154700", orpha: "558", inheritance: "Autosomal dominant" },
  SCN1A: { gene: "SCN1A", disease: "Dravet syndrome", omim: "607208", orpha: "33069", inheritance: "Autosomal dominant (usually de novo)" }
} satisfies Record<string, GeneDisease>;

/** A real ClinVar variant reference (verbatim HGVS + germline classification). */
export interface ClinVarVariant {
  readonly gene: string;
  readonly hgvs: string;
  readonly protein: string;
  readonly consequence: string;
  readonly classification: string;
  readonly classificationTone: Tone;
  readonly disease: string;
}

export const CLINVAR_VARIANTS = {
  MECP2: {
    gene: "MECP2",
    hgvs: "NM_004992.3:c.502C>T",
    protein: "p.Arg168*",
    consequence: "Stop-gained (loss of function)",
    classification: "Pathogenic",
    classificationTone: "danger",
    disease: "Rett syndrome"
  },
  CFTR: {
    gene: "CFTR",
    hgvs: "NM_000492.3:c.1521_1523del",
    protein: "p.Phe508del",
    consequence: "In-frame deletion",
    classification: "Pathogenic",
    classificationTone: "danger",
    disease: "Cystic fibrosis"
  },
  HBB: {
    gene: "HBB",
    hgvs: "NM_000518.5:c.20A>T",
    protein: "p.Glu7Val",
    consequence: "Missense",
    classification: "Pathogenic",
    classificationTone: "danger",
    disease: "Sickle cell disease"
  },
  FBN1: {
    gene: "FBN1",
    hgvs: "NM_000138.5:c.184C>T",
    protein: "p.Arg62Cys",
    consequence: "Missense",
    classification: "Pathogenic",
    classificationTone: "danger",
    disease: "Marfan syndrome"
  }
} satisfies Record<string, ClinVarVariant>;

/** A synthetic case grounded in a real gene–disease context. */
export interface LibraryCase {
  readonly id: string;
  readonly area: string;
  readonly candidateGene: string;
  readonly disease: string;
  readonly status: string;
  readonly statusTone: Tone;
  readonly updated: string;
}

// Synthetic case identifiers; real candidate genes and diseases.
export const LIBRARY_CASES: readonly LibraryCase[] = [
  { id: "UDN-SYN-0007", area: "Neurodevelopmental", candidateGene: "MECP2", disease: "Rett syndrome", status: "Phenotype review", statusTone: "info", updated: "2025-02-14" },
  { id: "UDN-SYN-0012", area: "Respiratory / multisystem", candidateGene: "CFTR", disease: "Cystic fibrosis", status: "Awaiting analysis approval", statusTone: "warning", updated: "2025-02-13" },
  { id: "UDN-SYN-0021", area: "Connective tissue", candidateGene: "FBN1", disease: "Marfan syndrome", status: "Unresolved", statusTone: "neutral", updated: "2025-02-11" },
  { id: "UDN-SYN-0033", area: "Haematological", candidateGene: "HBB", disease: "Sickle cell disease", status: "Reanalysis queued", statusTone: "warning", updated: "2025-02-10" },
  { id: "UDN-SYN-0041", area: "Neurodevelopmental", candidateGene: "SCN1A", disease: "Dravet syndrome", status: "Resolved (confirmed)", statusTone: "success", updated: "2025-02-08" }
];

// Real HPO terms for the featured case (UDN-SYN-0007, a Rett-syndrome
// candidate). Terms are Rett-consistent and drawn from the HPO.
export interface PhenotypeObservation extends HpoTerm {
  readonly status: string;
  readonly tone: Tone;
  readonly onset: string;
  readonly source: string;
}

export const FEATURED_PHENOTYPES: readonly PhenotypeObservation[] = [
  { id: "HP:0001250", label: "Seizure", status: "Confirmed", tone: "success", onset: "Early childhood", source: "Clinical note 2023-06-04" },
  { id: "HP:0002376", label: "Developmental regression", status: "Confirmed", tone: "success", onset: "Age 1–2 years", source: "Encounter 2024-01-11" },
  { id: "HP:0001263", label: "Global developmental delay", status: "Present", tone: "info", onset: "Infancy", source: "Encounter 2022-11-18" },
  { id: "HP:0000252", label: "Microcephaly", status: "Present", tone: "info", onset: "Acquired", source: "Growth chart 2023-03-20" },
  { id: "HP:0000733", label: "Stereotypy", status: "Present", tone: "info", onset: "Early childhood", source: "Clinical note 2023-06-04" }
];

// ---------------------------------------------------------------------------
// Multi-modal case data for the featured synthetic case (UDN-SYN-0007).
//
// Gene, analyte and disease NAMES below are real; the VALUES (z-scores, levels,
// impressions, note text, plan items) are synthetic demonstration data. None of
// this is real patient information or medical advice.
// ---------------------------------------------------------------------------

/** Transcriptomics outlier expression (RNA-seq). Real genes; synthetic z-scores. */
export interface ExpressionOutlier {
  readonly gene: string;
  readonly zScore: number;
  readonly direction: string;
  readonly tone: Tone;
  readonly note: string;
}

/** MeCP2 protein domain map and recurrent variant positions for a lollipop
 *  plot. Domain boundaries and the eight common Rett hotspots are real
 *  (MeCP2 e2 isoform, 486 aa); the featured variant is this case's candidate. */
export interface ProteinDomain {
  readonly name: string;
  readonly full: string;
  readonly start: number;
  readonly end: number;
  readonly tone: Tone;
}
export interface ProteinVariantMark {
  readonly label: string;
  readonly protein: string;
  readonly pos: number;
  readonly kind: "nonsense" | "missense";
  readonly featured: boolean;
}
export const MECP2_PROTEIN = {
  gene: "MECP2",
  isoform: "MeCP2 e2 · NP_004983.1 · 486 aa",
  length: 486,
  domains: [
    { name: "MBD", full: "Methyl-CpG-binding domain", start: 78, end: 162, tone: "info" },
    { name: "ID", full: "Intervening domain", start: 163, end: 206, tone: "neutral" },
    { name: "TRD", full: "Transcription-repression domain", start: 207, end: 310, tone: "warning" }
  ] as readonly ProteinDomain[],
  nls: { start: 255, end: 271 },
  variants: [
    { label: "R106W", protein: "p.Arg106Trp", pos: 106, kind: "missense", featured: false },
    { label: "R133C", protein: "p.Arg133Cys", pos: 133, kind: "missense", featured: false },
    { label: "T158M", protein: "p.Thr158Met", pos: 158, kind: "missense", featured: false },
    { label: "R168*", protein: "p.Arg168*", pos: 168, kind: "nonsense", featured: true },
    { label: "R255*", protein: "p.Arg255*", pos: 255, kind: "nonsense", featured: false },
    { label: "R270*", protein: "p.Arg270*", pos: 270, kind: "nonsense", featured: false },
    { label: "R294*", protein: "p.Arg294*", pos: 294, kind: "nonsense", featured: false },
    { label: "R306C", protein: "p.Arg306Cys", pos: 306, kind: "missense", featured: false }
  ] as readonly ProteinVariantMark[]
} as const;

export const TRANSCRIPTOMICS: readonly ExpressionOutlier[] = [
  { gene: "MECP2", zScore: -2.6, direction: "Under-expressed", tone: "danger", note: "Consistent with loss-of-function variant" },
  { gene: "BDNF", zScore: -1.9, direction: "Under-expressed", tone: "warning", note: "Known MeCP2 transcriptional target" },
  { gene: "IGF1", zScore: -1.4, direction: "Under-expressed", tone: "warning", note: "MeCP2-associated growth pathway" },
  { gene: "GAPDH", zScore: 0.1, direction: "Normal", tone: "success", note: "Housekeeping control" }
];

/** Metabolomics panel. Real analytes; synthetic levels. */
export interface Metabolite {
  readonly analyte: string;
  readonly display: string;
  readonly zScore: number;
  readonly tone: Tone;
}

export const METABOLOMICS: readonly Metabolite[] = [
  { analyte: "Lactate", display: "2.4 mmol/L (mildly elevated; ref <2.2)", zScore: 1.6, tone: "warning" },
  { analyte: "Pyruvate", display: "0.11 mmol/L (normal)", zScore: 0.4, tone: "success" },
  { analyte: "Alanine", display: "410 µmol/L (normal)", zScore: 0.6, tone: "success" },
  { analyte: "Ammonia", display: "38 µmol/L (normal)", zScore: 0.3, tone: "success" }
];

/** Short methylation summary (real concept, synthetic result). Two distinct
 *  analyses: a 15q11-q13 imprinting study to exclude Angelman (a differential),
 *  and a genome-wide episignature classifier that can support the MECP2 call. */
export const METHYLATION_SUMMARY =
  "Two analyses. (1) 15q11-q13 imprinting/methylation study: normal biparental methylation — " +
  "no evidence of Angelman syndrome, excluding a key differential. (2) Genome-wide methylation " +
  "episignature (EpiSign-style classifier): a MECP2/Rett-consistent episignature is reported, " +
  "supporting the molecular diagnosis. Note MECP2 encodes a methyl-CpG-binding protein, so the " +
  "primary defect is downstream target dysregulation, not a global methylation abnormality. (Synthetic result.)";

/** A single result in the targeted metabolic (mitochondrial) screen. Analyte
 *  names and reference concepts are real; patient values are synthetic. */
export interface MetabolicResult {
  readonly test: string;
  readonly result: string;
  readonly interpretation: string;
  readonly tone: Tone;
}

export const METABOLIC_SCREEN: readonly MetabolicResult[] = [
  { test: "Plasma lactate", result: "2.4 mmol/L", interpretation: "Mildly elevated (ref <2.2)", tone: "warning" },
  { test: "Plasma pyruvate", result: "0.11 mmol/L", interpretation: "Normal", tone: "success" },
  { test: "Lactate : pyruvate ratio", result: "21.8", interpretation: "Borderline (ref <20); nonspecific", tone: "warning" },
  { test: "CSF lactate", result: "1.8 mmol/L", interpretation: "Normal (ref <2.1); reassuring against CNS mitochondrial disease", tone: "success" },
  { test: "Plasma amino acids (alanine)", result: "410 µmol/L", interpretation: "Upper normal", tone: "neutral" },
  { test: "Urine organic acids", result: "No pathological excretion", interpretation: "No lactate/TCA-intermediate elevation; excludes organic aciduria", tone: "success" },
  { test: "Plasma acylcarnitine profile", result: "Normal", interpretation: "No fatty-acid oxidation defect", tone: "success" }
];

/** Specimen / accessioning metadata for the molecular study (synthetic). */
export const SPECIMEN = {
  accession: "MOL-2024-000742",
  type: "Peripheral blood (EDTA) · trio (proband + both parents)",
  collected: "2024-06-10",
  received: "2024-06-12",
  reported: "2024-06-18",
  lab: "UDN Reference Molecular Genetics Laboratory (synthetic)",
  accreditation: "Illustrative CLIA/CAP-style identifiers — synthetic",
  method: "Trio whole-exome sequencing · GRCh37/hg19 · mean depth 112x"
} as const;

/** Variant-level QC for the candidate MECP2 call (synthetic values). Coordinate
 *  is GRCh37/hg19 — consistent with the gnomAD v2 and MyVariant.info lookups. */
export interface QcRow {
  readonly label: string;
  readonly value: string;
  readonly tone: Tone;
}

export const VARIANT_QC: readonly QcRow[] = [
  { label: "Genomic (GRCh37)", value: "NC_000023.10:g.153296777G>A", tone: "neutral" },
  { label: "FILTER", value: "PASS", tone: "success" },
  { label: "Read depth (DP)", value: "96x", tone: "success" },
  { label: "Alt allele fraction", value: "0.49 (heterozygous)", tone: "success" },
  { label: "Genotype quality (GQ)", value: "99", tone: "success" },
  { label: "Mapping quality (MQ)", value: "60", tone: "success" },
  { label: "Trio genotypes", value: "Proband 0/1 · mother 0/0 (DP 91x) · father 0/0 (DP 88x)", tone: "info" },
  { label: "De novo confidence", value: "High — absent in both well-covered parents", tone: "warning" }
];

/** Analysis pipeline provenance (synthetic but internally consistent build). */
export interface PipelineStep {
  readonly stage: string;
  readonly tool: string;
}

export const PIPELINE: readonly PipelineStep[] = [
  { stage: "Reference build", tool: "GRCh37/hg19" },
  { stage: "Alignment", tool: "BWA-MEM" },
  { stage: "Variant calling", tool: "GATK HaplotypeCaller (joint trio genotyping)" },
  { stage: "De novo detection", tool: "GATK CalculateGenotypePosteriors + transmission filter" },
  { stage: "Annotation", tool: "Ensembl VEP" },
  { stage: "Population frequency", tool: "gnomAD v2.1.1 (exomes + genomes)" },
  { stage: "Transcript", tool: "NM_004992.3 (MECP2); MANE Select NM_004992.4" }
];

/** Genetic-counselling summary for the featured case (synthetic). */
export const COUNSELLING = {
  inheritance: "X-linked dominant. The MECP2 variant is assumed de novo (arose new in the child); most Rett syndrome is de novo.",
  recurrenceRisk:
    "If confirmed de novo in both parents, recurrence risk for a future pregnancy is low (roughly 0.5-1%) but not zero, because of possible parental germline (gonadal) mosaicism. Parental segregation testing is what refines this estimate.",
  reproductiveOptions:
    "Once the variant is confirmed, prenatal diagnosis and preimplantation genetic testing (PGT-M) can be offered for future pregnancies, with the residual germline-mosaicism risk discussed.",
  carrierImplications:
    "Assuming de novo occurrence (parental testing pending), the mother is most likely not a carrier; segregation testing will confirm and informs risk to the wider family.",
  disclosure:
    "Non-diagnostic language remains in use pending confirmation; the MDT will schedule results disclosure and follow-up counselling with the family."
} as const;

/** A consent line item tracked for the case (synthetic). */
export interface ConsentItem {
  readonly item: string;
  readonly status: string;
  readonly tone: Tone;
  readonly note: string;
}

export const CONSENTS: readonly ConsentItem[] = [
  { item: "Research participation", status: "Obtained", tone: "success", note: "Signed at intake." },
  { item: "External matching (Matchmaker Exchange)", status: "Pending", tone: "warning", note: "Required before cohort / MME matching can be relied upon." },
  { item: "Secondary findings (ACMG SF v3.2)", status: "Opted in", tone: "info", note: "Trio exome; return of medically actionable secondary findings elected." },
  { item: "Results disclosure to family", status: "Scheduled", tone: "info", note: "Awaiting MDT confirmation of the working diagnosis." }
];

/** An imaging / physiological study (schematic thumbnail rendered in-app). */
export interface ImagingStudy {
  readonly modality: string;
  readonly site: string;
  readonly date: string;
  readonly impression: string;
  readonly tone: Tone;
  readonly thumbnail: "eeg" | "brain";
}

export const IMAGING_STUDIES: readonly ImagingStudy[] = [
  { modality: "EEG", site: "Scalp, 21-lead", date: "2024-02-02", impression: "Multifocal epileptiform discharges", tone: "warning", thumbnail: "eeg" },
  { modality: "Brain MRI", site: "1.5T, without contrast", date: "2023-11-20", impression: "No structural abnormality", tone: "success", thumbnail: "brain" }
];

/** A synthetic clinical note. */
export interface ClinicalNote {
  readonly date: string;
  readonly author: string;
  readonly role: string;
  readonly body: string;
}

export const CLINICAL_NOTES: readonly ClinicalNote[] = [
  {
    date: "2025-02-14",
    author: "Dr. Ada Okonkwo",
    role: "Clinical geneticist",
    body:
      "MDT review of synthetic proband. Trio exome identifies a de novo MECP2 stop-gained variant " +
      "(c.502C>T, p.Arg168*), classified Pathogenic in ClinVar. Phenotype of seizures, developmental " +
      "regression and acquired microcephaly is consistent with Rett syndrome. Awaiting parental " +
      "segregation confirmation and external-matching consent before finalising. (Synthetic note.)"
  },
  {
    date: "2025-02-10",
    author: "Ms. Lena Farah",
    role: "Genetic counsellor",
    body:
      "Family briefing scheduled. Non-diagnostic language used pending confirmation. Consent for " +
      "external matching not yet obtained. (Synthetic note.)"
  }
];

/** A synthetic, non-prescriptive management / follow-up item. */
export interface ManagementItem {
  readonly category: string;
  readonly item: string;
  readonly owner: string;
  readonly tone: Tone;
}

export const MANAGEMENT_PLAN: readonly ManagementItem[] = [
  { category: "Confirmation", item: "Parental segregation of MECP2 variant", owner: "Bioinformatics", tone: "info" },
  { category: "Neurology", item: "Seizure management review", owner: "Medical specialist", tone: "warning" },
  { category: "Allied health", item: "Physiotherapy and occupational therapy referral", owner: "Coordinator", tone: "neutral" },
  { category: "Counselling", item: "Family counselling and consent for matching", owner: "Genetic counsellor", tone: "warning" },
  { category: "Surveillance", item: "Growth, scoliosis and cardiac surveillance schedule", owner: "Medical specialist", tone: "info" }
];

/** A pharmacogenomics result. Gene, drug and gene-drug guidance basis are real
 *  (PharmGKB / CPIC); the patient diplotype and phenotype are synthetic. */
export interface PgxResult {
  readonly gene: string;
  readonly diplotype: string;
  readonly phenotype: string;
  readonly drugs: string;
  readonly guidance: string;
  readonly tone: Tone;
}

export const PHARMACOGENOMICS: readonly PgxResult[] = [
  {
    gene: "HLA-B",
    diplotype: "*15:02 not detected",
    phenotype: "Negative",
    drugs: "Carbamazepine, oxcarbazepine",
    guidance: "No increased Stevens-Johnson/TEN risk flagged; standard use per CPIC.",
    tone: "success"
  },
  {
    gene: "CYP2C9",
    diplotype: "*1/*3",
    phenotype: "Intermediate metaboliser",
    drugs: "Phenytoin",
    guidance: "Consider reduced maintenance dose and monitoring (CPIC).",
    tone: "warning"
  },
  {
    gene: "CYP2C19",
    diplotype: "*1/*2",
    phenotype: "Intermediate metaboliser",
    drugs: "Clobazam",
    guidance: "Possible higher active-metabolite exposure; monitor response.",
    tone: "warning"
  },
  {
    gene: "CYP2D6",
    diplotype: "*1/*1",
    phenotype: "Normal metaboliser",
    drugs: "Codeine, many antidepressants",
    guidance: "Standard dosing expected.",
    tone: "success"
  }
];

/** A cross-sectional imaging series shown in the in-app viewer.
 *  When `frames` is present, these are REAL, openly-licensed, de-identified
 *  reference images (hosted with the site, attributed below) — shown as
 *  illustrative reference images, NOT the synthetic patient's own scans. When
 *  `frames` is absent, the viewer falls back to procedural synthetic slices. */
export interface ImageSeries {
  readonly id: string;
  readonly modality: "MRI" | "CT";
  readonly sequence: string;
  readonly site: string;
  readonly date: string;
  readonly slices: number;
  readonly windowLevel: string;
  readonly impression: string;
  readonly tone: Tone;
  /** Radiology accession identifier (synthetic). */
  readonly accession?: string;
  /** True for a single-voxel MR spectroscopy trace (rendered as a spectrum). */
  readonly spectrum?: boolean;
  /** Public paths to real reference-image frames (optional). */
  readonly frames?: readonly string[];
  readonly credit?: string;
  readonly license?: string;
  readonly licenseUrl?: string;
  readonly source?: string;
  readonly sourceUrl?: string;
}

const CT_FRAMES = Array.from({ length: 16 }, (_, i) => i + 1).map(
  (n) => `/reference-images/ct-${String(n).padStart(2, "0")}.png`
);

// MRI is the primary cross-sectional modality for a neurodevelopmental workup
// (no ionizing radiation, superior parenchymal detail). The protocol below is a
// realistic regression protocol (T2, FLAIR, DWI) plus MR spectroscopy — the
// highest-yield sequence given the mildly elevated lactate. The CT is retained
// but listed last, as it is the lower-yield study here.
export const IMAGE_SERIES: readonly ImageSeries[] = [
  {
    id: "mri-brain-t2",
    modality: "MRI",
    sequence: "T2 axial",
    site: "Brain · 1.5T",
    date: "2023-11-20",
    slices: 2,
    windowLevel: "T2 · TE 100 ms",
    impression: "No structural abnormality; no malformation of cortical development",
    tone: "success",
    accession: "MR-2023-118842",
    frames: ["/reference-images/mri-t2-1.jpg", "/reference-images/mri-t2-2.png"],
    credit: "Sean Novak",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    source: "Wikimedia Commons",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Normal_axial_T2-weighted_MR_image_of_the_brain.jpg"
  },
  {
    id: "mri-flair",
    modality: "MRI",
    sequence: "FLAIR axial",
    site: "Brain · 1.5T",
    date: "2023-11-20",
    slices: 12,
    windowLevel: "FLAIR · TI 2500 ms",
    impression: "No cortical or white-matter signal abnormality",
    tone: "success",
    accession: "MR-2023-118842"
  },
  {
    id: "mri-dwi",
    modality: "MRI",
    sequence: "DWI / ADC axial",
    site: "Brain · 1.5T",
    date: "2023-11-20",
    slices: 12,
    windowLevel: "DWI · b=1000",
    impression: "No restricted diffusion",
    tone: "success",
    accession: "MR-2023-118842"
  },
  {
    id: "mri-mrs",
    modality: "MRI",
    sequence: "MR spectroscopy (single-voxel)",
    site: "Basal ganglia · PRESS",
    date: "2023-11-20",
    slices: 1,
    windowLevel: "TE 135 ms",
    impression: "NAA/Cr and Cho/Cr within normal limits; no definite lactate doublet at 1.3 ppm — no spectroscopic evidence of a mitochondrial cytopathy",
    tone: "success",
    accession: "MR-2023-118842",
    spectrum: true
  },
  {
    id: "ct-head",
    modality: "CT",
    sequence: "Non-contrast axial · 4 mm",
    site: "Head",
    date: "2024-01-05",
    slices: CT_FRAMES.length,
    windowLevel: "WL 40 · WW 80",
    impression: "No acute intracranial abnormality (lower-yield for this indication)",
    tone: "success",
    accession: "CT-2024-004471",
    frames: CT_FRAMES,
    credit: "Mikael Häggström, M.D.",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    source: "Wikimedia Commons",
    sourceUrl: "https://commons.wikimedia.org/wiki/Scrollable_computed_tomography_images_of_a_normal_brain_(case_1)"
  }
];

// ---------------------------------------------------------------------------
// Variant classification (ACMG/AMP) + predictors, and phenotype→disease match.
// Criteria codes, predictor names, disease and OMIM identifiers are real; the
// applied evidence and scores are illustrative for the synthetic case.
// ---------------------------------------------------------------------------

/** An applied ACMG/AMP evidence criterion. */
export interface AcmgCriterion {
  readonly code: string;
  readonly name: string;
  readonly strength: string;
  readonly tone: Tone;
  readonly detail: string;
}

export const MECP2_ACMG: readonly AcmgCriterion[] = [
  {
    code: "PVS1",
    name: "Null variant in a loss-of-function gene",
    strength: "Very strong",
    tone: "danger",
    detail: "Nonsense variant (p.Arg168*); loss of function is an established MECP2 disease mechanism."
  },
  {
    code: "PM6",
    name: "Assumed de novo (confirmation pending)",
    strength: "Moderate",
    tone: "warning",
    detail: "Not detected in prior testing; parental segregation not yet confirmed."
  },
  {
    code: "PM2",
    name: "Absent from population databases",
    strength: "Moderate",
    tone: "warning",
    detail: "Not observed in gnomAD."
  }
];

export const MECP2_ACMG_RESULT = {
  classification: "Pathogenic",
  tone: "danger" as Tone,
  basis: "1 Very strong (PVS1) + 2 Moderate (PM6, PM2) meets Pathogenic under the ACMG/AMP 2015 combining rules."
};

/** A per-variant metric (in-silico predictor or population frequency). */
export interface VariantMetric {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly tone: Tone;
}

export const MECP2_METRICS: readonly VariantMetric[] = [
  { label: "gnomAD allele frequency", value: "Absent (0 / 152,000+ alleles)", note: "Supports PM2", tone: "success" },
  { label: "CADD (phred)", value: "36", note: "High predicted deleteriousness", tone: "danger" },
  { label: "REVEL", value: "N/A (not a missense variant)", note: "Nonsense variant", tone: "neutral" },
  { label: "SpliceAI (Δ max)", value: "0.02", note: "No splice impact predicted", tone: "success" }
];

/** A candidate disease ranked by HPO phenotype similarity. */
export interface DiseaseMatch {
  readonly disease: string;
  readonly gene: string;
  readonly omim: string;
  readonly score: number;
  readonly matched: readonly string[];
  readonly total: number;
  readonly tone: Tone;
}

// Real diseases / genes / OMIM identifiers; similarity scores are illustrative.
export const DISEASE_MATCHES: readonly DiseaseMatch[] = [
  { disease: "Rett syndrome", gene: "MECP2", omim: "312750", score: 92, matched: ["Seizure", "Developmental regression", "Microcephaly", "Stereotypy"], total: 5, tone: "success" },
  { disease: "CDKL5 deficiency disorder", gene: "CDKL5", omim: "300672", score: 74, matched: ["Seizure", "Developmental regression", "Global developmental delay"], total: 5, tone: "info" },
  { disease: "FOXG1 syndrome", gene: "FOXG1", omim: "613454", score: 68, matched: ["Microcephaly", "Developmental regression", "Stereotypy"], total: 5, tone: "info" },
  { disease: "Angelman syndrome", gene: "UBE3A", omim: "105830", score: 55, matched: ["Seizure", "Global developmental delay", "Stereotypy"], total: 5, tone: "neutral" }
];

// ---------------------------------------------------------------------------
// Therapeutics & trials, standard disease coding, growth (OFC), and Matchmaker
// Exchange. Drug names, trial NCT numbers and disease codes are REAL and were
// verified against FDA / ClinicalTrials.gov / WHO ICD / OMIM / Orphanet / MONDO.
// Their application to this synthetic case is illustrative and NOT medical advice.
// ---------------------------------------------------------------------------

/** A therapeutic option or clinical trial for the working diagnosis. */
export interface Therapy {
  readonly name: string;
  readonly kind: string;
  readonly status: string;
  readonly tone: Tone;
  readonly detail: string;
  readonly nct?: string;
  readonly url?: string;
}

export const THERAPEUTICS: readonly Therapy[] = [
  {
    name: "Trofinetide (DAYBUE)",
    kind: "Approved therapy · IGF-1 (GPE) analogue",
    status: "FDA approved 2023",
    tone: "success",
    detail: "First approved treatment for Rett syndrome (adults and children ≥2 years). Pivotal LAVENDER trial.",
    nct: "NCT04181723",
    url: "https://clinicaltrials.gov/study/NCT04181723"
  },
  {
    name: "TSHA-102",
    kind: "Investigational gene therapy · intrathecal AAV9 (MECP2)",
    status: "Trial · Breakthrough Therapy designation",
    tone: "info",
    detail: "REVEAL pivotal study in females with typical Rett syndrome.",
    nct: "NCT05606614",
    url: "https://clinicaltrials.gov/study/NCT05606614"
  },
  {
    name: "TSHA-102 (paediatric)",
    kind: "Investigational gene therapy · paediatric cohort",
    status: "Trial · recruiting",
    tone: "info",
    detail: "REVEAL paediatric study of TSHA-102 in girls with Rett syndrome.",
    nct: "NCT06152237",
    url: "https://clinicaltrials.gov/study/NCT06152237"
  },
  {
    name: "Symptomatic / supportive care",
    kind: "Anticonvulsants, PT/OT, nutrition, surveillance",
    status: "Standard of care",
    tone: "neutral",
    detail: "Seizure control and multidisciplinary supportive management alongside disease-specific options."
  }
];

/** Standard terminology codes for the working diagnosis (all real). */
export interface DiseaseCode {
  readonly system: string;
  readonly code: string;
  readonly url?: string;
}

export const DISEASE_CODES: readonly DiseaseCode[] = [
  { system: "ICD-10-CM", code: "F84.2", url: "https://www.icd10data.com/ICD10CM/Codes/F01-F99/F80-F89/F84-/F84.2" },
  { system: "OMIM", code: "312750", url: "https://www.omim.org/entry/312750" },
  { system: "Orphanet", code: "ORPHA:778", url: "https://www.orpha.net/en/disease/detail/778" },
  { system: "MONDO", code: "MONDO:0010726", url: "https://monarchinitiative.org/MONDO:0010726" },
  { system: "UMLS (MedGen)", code: "C0035372", url: "https://www.ncbi.nlm.nih.gov/medgen/C0035372" }
];

/** Head-circumference (OFC) growth reference. Percentile bands approximate the
 *  WHO girls' reference; the patient trajectory is synthetic and shows the
 *  acquired deceleration seen in Rett syndrome. Ages in months, values in cm. */
export const GROWTH_OFC = {
  ages: [0, 6, 12, 18, 24, 36, 48] as const,
  p3: [31.5, 39.5, 42, 43.5, 44.5, 46, 47] as const,
  p50: [34, 42, 44.5, 46, 47, 48.5, 49.5] as const,
  p97: [36.5, 44.5, 47, 48.5, 49.5, 51, 52] as const,
  patient: [
    { age: 0, cm: 34 },
    { age: 6, cm: 41.5 },
    { age: 12, cm: 43 },
    { age: 18, cm: 43.4 },
    { age: 24, cm: 43.8 }
  ] as const
};

/** A Matchmaker Exchange candidate match (real MME node names; synthetic matches). */
export interface MmeMatch {
  readonly node: string;
  readonly gene: string;
  readonly overlap: string;
  readonly status: string;
  readonly tone: Tone;
}

export const MME_NODES: readonly string[] = ["GeneMatcher", "PhenomeCentral", "DECIPHER", "MyGene2"];

export const MME_MATCHES: readonly MmeMatch[] = [
  { node: "GeneMatcher", gene: "MECP2", overlap: "4 / 5 HPO terms", status: "Contacted", tone: "success" },
  { node: "PhenomeCentral", gene: "MECP2", overlap: "3 / 5 HPO terms", status: "Awaiting reply", tone: "info" },
  { node: "DECIPHER", gene: "CDKL5", overlap: "2 / 5 HPO terms", status: "Differential", tone: "neutral" }
];

/** Case-level summary for the featured synthetic case (single source of truth). */
export interface CaseSummary {
  readonly caseId: string;
  readonly proband: string;
  readonly demographics: string;
  readonly area: string;
  readonly status: string;
  readonly statusTone: Tone;
  readonly stage: string;
  readonly leadClinician: string;
  readonly counsellor: string;
  readonly coordinator: string;
  readonly consentResearch: boolean;
  readonly consentMatching: boolean;
  readonly opened: string;
  readonly lastActivity: string;
}

export const CASE_SUMMARY: CaseSummary = {
  caseId: "UDN-SYN-0007",
  proband: "Synthetic proband",
  demographics: "Paediatric female · onset in infancy",
  area: "Neurodevelopmental",
  status: "Phenotype review",
  statusTone: "info",
  stage: "MDT review pending",
  leadClinician: "Dr. Ada Okonkwo",
  counsellor: "Ms. Lena Farah",
  coordinator: "Mr. Diego Alvarez",
  consentResearch: true,
  consentMatching: false,
  opened: "2025-02-12",
  lastActivity: "2025-02-14 11:42 UTC"
};
