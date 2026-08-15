// Ranked-variant view models for the Variant-review page, grounded in REAL
// reference data for the featured synthetic case (UDN-SYN-0007, a Rett-syndrome
// candidate). The ranking itself is illustrative (it stands in for the
// deterministic Prioritisation_Service output until the API is wired), but the
// genes, the variant description and its ClinVar classification are real:
//
//   MECP2 NM_004992.3:c.502C>T (p.Arg168*) — ClinVar: Pathogenic — Rett syndrome
//
// CDKL5 and FOXG1 are real genes in the Rett / developmental-and-epileptic-
// encephalopathy differential and are shown as gene-level candidates. The
// factor set mirrors the fixed, ordered factors in the design (Req 10.1) and
// each item carries a per-factor explanation (Req 10.5) and evidence links.

import type { RankedItemView } from "../components/RankedVariantList.js";

// Recorded prioritisation logic version for this ranking (Req 10.7).
export const SAMPLE_PRIORITISATION_LOGIC_VERSION = "prioritisation-logic-v1.0.0";

export const SAMPLE_RANKED_ITEMS: readonly RankedItemView[] = [
  {
    id: "mecp2-arg168ter",
    kind: "variant",
    rank: 1,
    label: "MECP2 NM_004992.3:c.502C>T (p.Arg168*)",
    score: 94,
    factors: [
      { id: "consequence-severity", label: "Molecular consequence severity", contribution: 30, detail: "Stop-gained (loss of function)" },
      { id: "allele-frequency", label: "Population allele-frequency rarity", contribution: 22, detail: "Absent from gnomAD" },
      { id: "clinvar-class", label: "ClinVar classification", contribution: 17, detail: "Pathogenic (Rett syndrome)" },
      { id: "gene-disease", label: "Gene-disease association strength", contribution: 13, detail: "MECP2 – Rett syndrome (definitive)" },
      { id: "inheritance-fit", label: "Inheritance-model fit", contribution: 8, detail: "Consistent with de novo (X-linked)" },
      { id: "phenotype-similarity", label: "Phenotype similarity", contribution: 3, detail: "Seizure, regression, GDD overlap" },
      { id: "qc-pass", label: "QC pass flag", contribution: 1, detail: "Passed candidate-list QC" }
    ],
    evidenceLinks: [
      { id: "mecp2-clinvar", label: "ClinVar classification record", href: "https://www.ncbi.nlm.nih.gov/clinvar/" },
      { id: "mecp2-annotation", label: "Annotation table entry", href: "/case?tab=genomics" }
    ]
  },
  {
    id: "cdkl5-gene",
    kind: "gene",
    rank: 2,
    label: "CDKL5",
    score: 71,
    factors: [
      { id: "consequence-severity", label: "Molecular consequence severity", contribution: 20, detail: "Predicted-damaging candidate (gene-level)" },
      { id: "allele-frequency", label: "Population allele-frequency rarity", contribution: 16, detail: "Rare in gnomAD" },
      { id: "clinvar-class", label: "ClinVar classification", contribution: 8, detail: "No established classification" },
      { id: "gene-disease", label: "Gene-disease association strength", contribution: 15, detail: "CDKL5 – developmental & epileptic encephalopathy" },
      { id: "inheritance-fit", label: "Inheritance-model fit", contribution: 7, detail: "Consistent with X-linked" },
      { id: "phenotype-similarity", label: "Phenotype similarity", contribution: 4, detail: "Early seizures overlap" },
      { id: "qc-pass", label: "QC pass flag", contribution: 1, detail: "Passed candidate-list QC" }
    ],
    evidenceLinks: [
      { id: "cdkl5-assoc", label: "Gene-disease association source", href: "https://www.orpha.net" },
      { id: "cdkl5-phenotype", label: "Phenotype-similarity detail", href: "/case?tab=phenotypes" }
    ]
  },
  {
    id: "foxg1-gene",
    kind: "gene",
    rank: 3,
    label: "FOXG1",
    score: 58,
    factors: [
      { id: "consequence-severity", label: "Molecular consequence severity", contribution: 16, detail: "Predicted-damaging candidate (gene-level)" },
      { id: "allele-frequency", label: "Population allele-frequency rarity", contribution: 15, detail: "Rare in gnomAD" },
      { id: "clinvar-class", label: "ClinVar classification", contribution: 7, detail: "No established classification" },
      { id: "gene-disease", label: "Gene-disease association strength", contribution: 12, detail: "FOXG1 – congenital Rett-variant syndrome" },
      { id: "inheritance-fit", label: "Inheritance-model fit", contribution: 6, detail: "Consistent with de novo dominant" },
      { id: "phenotype-similarity", label: "Phenotype similarity", contribution: 3, detail: "Microcephaly, regression overlap" },
      { id: "qc-pass", label: "QC pass flag", contribution: 1, detail: "Passed candidate-list QC" }
    ],
    evidenceLinks: [
      { id: "foxg1-assoc", label: "Gene-disease association source", href: "https://www.orpha.net" }
    ]
  }
] as const;
