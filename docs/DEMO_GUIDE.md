# Demo Guide

This guide walks through demonstrating the Navigator, with emphasis on the
headline capability: **continuous case re-evaluation**. All data shown is
synthetic; the persistent Responsible_Use_Notice remains visible throughout.

## Demonstration cases

The Navigator provides at least three polished demonstration cases, each of
which runs to completion and produces its expected result set without unhandled
errors:

1. **Missed-phenotype scenario** — a case where AI phenotype extraction and
   human confirmation surface a previously missed phenotype.
2. **Structural-variant scenario** — a case whose resolution depends on a
   structural variant in the genomic results.
3. **Knowledge-triggered reanalysis scenario** — an unresolved case that is
   re-surfaced when a simulated `Knowledge_Update` references one of its stored
   variants, genes, or phenotype associations.

If a demonstration case fails to load or does not complete its run, the
Navigator retains the pre-run state and displays an indication that the case
could not be completed.

## Guided demo mode

The Navigator provides a **guided demo mode** that walks through the
knowledge-triggered reanalysis scenario as an ordered sequence of steps,
presenting one step at a time from the first step to the final result. Run end
to end without manual pauses, the walkthrough completes in **5 to 7 minutes**.
Advancing or returning to a step displays the corresponding step within 2
seconds.

## Walkthrough: the reanalysis loop (7-stage vertical slice)

This mirrors the vertical slice that delivers the core value.

### 1. Synthetic case intake

Open the Dashboard and select a synthetic unresolved case. Note the visible
synthetic-data indicator and the research/clinical classification label. Intake
has validated the case against the Phenopacket schema and FHIR R4 definitions.

### 2. Clinical timeline

Open the Case workspace → Timeline tab. The longitudinal timeline is
reconstructed from the case clinical records, ordered oldest to most recent.
Each entry shows its source document, author, a confidence percentage, a link
to the source object, and an AI-extracted flag. Try filtering by source,
author, confidence range, or AI-extracted status.

### 3. Phenotype extraction

Open the Phenotypes tab and request phenotype extraction. Candidates are
produced via the `AI_Gateway` within 60 seconds, each mapped to 1–20 HPO terms,
classified as present/absent/uncertain/historical, with a confidence value and
a link to its supporting source object. Note the uncertainty indicator adjacent
to each AI output. All candidates are **pending review**.

### 4. Clinician confirmation

As a Clinical geneticist, review the candidates. Approve one (creating a
confirmed phenotype linked to the candidate, recording your identity and
timestamp), reject another, and edit a third before approval (both the original
AI value and your corrected value are retained). Confirm that a user without
review authorisation cannot approve, reject, or edit.

### 5. Hypothesis review

Open the Hypothesis board. Create an evidence-linked hypothesis card (it must
link to at least one evidence item; a zero-evidence card is rejected). Note the
non-diagnostic wording and the card state (Proposed / Under Review / Supported /
Refuted / Retired). Because the case has no confirmed diagnosis and is not a
closed non-genetic explanation, it remains an **Unresolved_Case**.

### 6. Simulated knowledge update

As a Researcher or Administrator, publish a simulated `Knowledge_Update` whose
declared delta set references a variant, gene, or phenotype stored on the
unresolved case. The update carries a visible synthetic indicator.

### 7. Reanalysis notification (the headline moment)

Within 60 seconds the `Reanalysis_Service` identifies the affected unresolved
case, creates a `Reanalysis_Candidate` recording exactly which variant, gene,
or phenotype matched, links it to the triggering update, and adds the case to
the review queue. Open the **Reanalysis inbox**: the case has been re-surfaced
with an explanation. Approve the reanalysis run (identity + timestamp recorded);
on completion, review the **before/after comparison view** of the case
classification, evidence, and outcome.

## Talking points

- **No case is forgotten.** The deterministic set-intersection match means an
  unresolved case is re-surfaced precisely when — and only when — the evidence
  that changed touches its stored references.
- **Everything is gated.** Nothing advanced without an authorised human action;
  every action is audited.
- **Everything is grounded.** Each AI statement links to a source object, and
  unlinked or unsupported statements are rejected and flagged for review.
- **Synthetic and non-diagnostic throughout.** See
  [RESPONSIBLE_USE.md](./RESPONSIBLE_USE.md).

## Reset between demos

Re-load the synthetic case library from `data/generator` to return cases to
their initial unresolved state before presenting again.
