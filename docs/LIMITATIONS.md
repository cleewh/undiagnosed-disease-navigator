# Limitations and Non-Goals

This document states, plainly, what the Navigator is **not** and where its
current boundaries lie. It complements [RESPONSIBLE_USE.md](./RESPONSIBLE_USE.md).

## Not a medical device

The Navigator is a prototype for **research, education, and workflow
demonstration**. It does not provide medical diagnosis or treatment advice, is
not validated or certified as a medical device, and must not be used to make or
influence clinical decisions about a real patient.

## Synthetic data only

The system operates on **synthetic or appropriately licensed public data only**.
It has no capability, and no authorisation, to ingest real patient data. Cases
missing a synthetic-data indicator, or containing identifiers matching a
real-patient source, are rejected at intake. Do not attempt to load real
patient records.

## AI outputs are candidates, not conclusions

- All AI-generated phenotypes, summaries, and explanations are **candidates
  requiring human review**; nothing is auto-confirmed.
- AI output is constrained to grounded, source-linked statements; the
  `AI_Gateway` rejects unlinked or unsupported statements. This reduces but does
  not eliminate the possibility of subtly incorrect extractions — human review
  remains mandatory.
- Generative task types are restricted to phenotype extraction, summarisation,
  and drafting of explanations/reports. The system will not perform other
  generative tasks.
- Clinical *interpretation* of prioritisation is intentionally **absent** from
  rankings and their explanations; prioritisation is deterministic only.

## Deterministic prioritisation boundaries

Variant/gene prioritisation is a fixed, versioned, deterministic scoring
function. It is reproducible and explainable by design, but:

- It reflects only the pinned knowledge snapshot and the fixed factor set and
  weights of its logic version; it does not discover novel biology.
- Missing or invalid required inputs cause outright rejection with an error and
  **no partial ranking**, rather than a best-effort estimate.

## Genomics is demo-first

The initial deployment runs in **Demo_Mode** with precomputed synthetic genomic
results and does **not** run large-scale genomic compute. Real genomic pipeline
execution requires `Workflow_Mode` (HealthOmics) and is out of scope for the
default demonstration. Precomputed results are illustrative, not derived from
real sequencing.

## Reanalysis matching scope

Continuous re-evaluation matches a `Knowledge_Update` to unresolved cases by a
**deterministic set-intersection** over normalized variant, gene, and phenotype
identifiers. Consequently:

- Matching is only as good as the normalized identifiers stored on a case and
  declared in an update's delta set. Semantically related but differently
  identified entities are not matched.
- The demonstration ships **between 5 and 50** simulated updates; it is not a
  live feed of real knowledge-base changes.

## Interface and scale

- The UI is **desktop-first**. It remains usable with no loss of content or
  function and no horizontal scrolling of primary content between 375px and
  767px, but it is not optimised as a mobile-native experience.
- Accessibility targets the **programmatically verifiable** subset of WCAG 2.1
  Level AA (validated with automated tooling such as `axe-core`). Full WCAG
  conformance additionally requires manual testing with assistive technologies
  and expert review, which is outside automated validation.
- Real-time multi-user collaboration is not a goal; refresh is EventBridge-driven
  plus polling rather than live subscriptions.

## Data and operational constraints

- Each ingested artifact is limited to **50 MB**.
- Sessions end after **15 minutes** of inactivity, requiring re-authentication.
- Audit events are immutable with a **7-year** minimum retention; they cannot be
  edited or deleted, by design.
- Complex ad-hoc analytics run **offline** via Athena/Glue, not against the
  transactional DynamoDB store.

## Explicit non-goals

- Providing diagnosis, prognosis, or treatment recommendations.
- Autonomous action without human approval (including external case sharing or
  family contact, which always require manual confirmation).
- Combining research-classified and clinical-classified records.
- Processing, storing, or displaying real patient data.
