# Responsible Use

## Non-diagnostic positioning

**The AI-Assisted Undiagnosed Disease Case Navigator is not a medical device.**
It is a prototype intended for **research, education, and workflow
demonstration**. It does **not** provide medical diagnosis or treatment advice,
and it must never be used to make or influence clinical decisions about a real
patient.

Every user session displays a persistent **Responsible_Use_Notice** stating
that the prototype is intended for research, education, and workflow
demonstration and does not provide medical diagnosis or treatment advice. The
notice remains visible within the viewport without requiring the user to scroll
and stays visible or accessible for the duration of the session.

## Synthetic data only

**The Navigator operates on synthetic data only.** No real patient data is
ingested, stored, processed, or displayed.

- Every synthetic case stores a synthetic-data indicator in its metadata, and
  the UI shows a visible synthetic indicator wherever case data or a
  `Knowledge_Update` is displayed.
- Real patient identifiers are excluded from all synthetic case data. Any case
  whose patient profile matches a real-patient identifier source is rejected
  and excluded, with an error indicating a real identifier was detected.
- Any case record missing the synthetic-data indicator is rejected from the
  case library and retained as rejected-unlabeled.

See [DATA_SOURCES.md](./DATA_SOURCES.md) for the full synthetic-data policy.

## Human-in-the-loop is mandatory

No AI output is ever auto-confirmed. Every clinically relevant transition
requires an explicit action by an authorised human reviewer.

- The Navigator does not produce an autonomous diagnosis or treatment
  recommendation without an authorised human reviewer explicitly confirming the
  output before it is finalised.
- AI-extracted phenotypes are stored as **pending review** and require an
  explicit approval action from an authorised reviewer before becoming
  confirmed phenotypes.
- Contradictions are never auto-resolved; a human reviewer records the
  outcome, rationale, identity, and timestamp.
- Analysis runs and reanalysis runs require explicit human approval (recorded
  with approver identity and timestamp) before they start.
- Output marked for review never auto-advances the workflow state of a case.

## Grounding, uncertainty, and correction

- Every AI-generated statement is linked to one or more source objects; the
  `AI_Gateway` rejects unlinked or unsupported statements and marks them for
  review (see [SECURITY.md](./SECURITY.md)).
- When AI-generated output is presented, an **uncertainty indicator** conveying
  a confidence level on a scale of at least three ordered levels is shown
  adjacent to that output.
- An authorised user viewing AI-generated information may correct it; both the
  original AI-generated value and the corrected value are retained with
  attribution to the correcting user.

## Non-diagnostic language

Diagnostic hypothesis cards are expressed using wording drawn from a predefined
**non-diagnostic vocabulary**. Any card text containing a prohibited diagnostic
term is rejected. Evidence gaps are framed as review items, never as statements
of medical necessity.

## Research vs clinical separation

Every case record and interface view is labelled with either a **research** or
a **clinical** classification. Records classified as research are prevented from
being combined with records classified as clinical.

## No automated external action

The Navigator does not initiate any external case sharing or family contact
through automation. If an external share or family-contact action is requested,
an authorised user must manually confirm the action before it proceeds.

## Patient-facing output gating

If AI-generated output is designated as patient-facing and has not received
recorded human review, the Navigator blocks the output from being presented and
displays an indication that human review is required.
