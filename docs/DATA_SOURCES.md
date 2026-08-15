# Data Sources

The Navigator operates on **synthetic data only**. No real patient data is
ever ingested, stored, or displayed. This document describes the synthetic case
dataset, the standards it conforms to, and the versioned knowledge sources used
for prioritisation and reanalysis.

## Synthetic case dataset

The synthetic dataset is produced by the deterministic generator in
`data/generator`. At initial data load the case library provides **at least 30
synthetic undiagnosed-disease cases** with the following coverage guarantees.

### Clinical-area coverage

At least one case per area across: neurodevelopmental, neuromuscular,
mitochondrial, metabolic, immunodeficiency, renal, cardiac, connective-tissue,
ophthalmic, hearing, multisystem, and adult-onset.

### Attribute variation

The library contains at least two distinct values for each of: age, onset, sex,
family structure, ancestry, inheritance model, record completeness, genomic
test history, and diagnostic outcome.

### Inheritance models

At least one case per model: sporadic, autosomal recessive, autosomal dominant,
X-linked, mitochondrial, and uncertain. The library includes at least one
single-patient case and at least one family-based case.

### Case archetypes

At least one case per archetype: previously missed diagnosis, newly established
gene-disease association, structural variant, repeat expansion, mitochondrial,
mosaic variant, phenocopy, dual diagnosis, unsolved case, and non-genetic
explanation.

## Synthetic labelling and safety

- Every synthetic case stores a **synthetic-data indicator** in its metadata.
- The UI displays a visible synthetic indicator wherever case data is shown.
- Real patient identifiers are excluded from all synthetic case data; every
  identifier field is populated with synthetic values that match no entry in
  any real-patient identifier source.
- If a case record is missing the synthetic-data indicator, it is rejected from
  the case library and an indication that the record was rejected as unlabeled
  is retained.
- If a patient profile contains an identifier matching a real-patient source,
  the case is rejected and excluded, with an error indicating a real identifier
  was detected.

The generator's safety and labelling properties are exercised by
`data/generator/src/synthetic-safety.test.ts` and
`data/generator/src/synthetic-labelling.property.test.ts`.

## Per-case artifacts and standards

Each synthetic case is composed of standardised clinical and genomic artifacts:

| Artifact | Standard / format | Notes |
|---|---|---|
| Patient profile | Synthetic identifiers | Matches no real-patient source |
| Longitudinal clinical record | **FHIR R4** resources | Spans at least 2 years of events |
| Phenopacket | **GA4GH Phenopacket** | Validates with zero schema errors |
| Pedigree | Structured family tree | Individuals, sex, parent-child links |
| Genomic artifacts | VCF, annotation table, QC summary, candidate variant list | At minimum one each |
| Family artifacts | Trio/family VCF + inheritance results | For family-based cases |
| Specialised results | CNV_SV, repeat-expansion, mitochondrial | When the archetype requires them |
| Ground_Truth | Hidden per-case answer key | Readable **only** by Evaluation_Framework |

Each ingested artifact is subject to a **50 MB** size limit. Intake validates
each case against the Phenopacket schema and the FHIR R4 resource definitions
within 30 seconds per case; a validation failure rejects the case and records
the failing field, the expected value/format, and the actual value received.

## Knowledge sources and snapshots

Prioritisation and reanalysis are grounded in versioned, immutable knowledge
snapshots managed by `Knowledge_Service`. A `Knowledge_Snapshot` records a
unique version id, a creation timestamp, and the versions of:

- **HPO** (Human Phenotype Ontology)
- **ClinVar**-style variant classifications
- **Gene-disease association** strengths
- **Ontology**, **annotation**, and **transcript** versions
- The **prioritisation logic** version in use

When an analysis or hypothesis is recorded, it is associated with the snapshot
version in effect; if no snapshot exists, the recording is rejected. Prior
snapshots are immutable — modify/delete attempts are rejected and the original
is preserved.

## Simulated knowledge updates

The Navigator provides **between 5 and 50** simulated `Knowledge_Update`
records. Each carries a synthetic indicator in metadata and is displayed with a
visible synthetic indicator. A `Knowledge_Update` declares a delta set — the
variants, genes, gene-disease associations, and phenotype terms it touches —
which the `Reanalysis_Service` intersects against each unresolved case's stored
references to drive continuous re-evaluation (see
[ARCHITECTURE.md](./ARCHITECTURE.md)).

## Ground_Truth isolation

Ground_Truth files are stored in a **separate S3 bucket** whose bucket policy
and IAM grants permit only the Evaluation_Framework identity, denying all other
requesters with an authorization error. No interactive role can read
Ground_Truth. See [SECURITY.md](./SECURITY.md) and
[EVALUATION.md](./EVALUATION.md).
