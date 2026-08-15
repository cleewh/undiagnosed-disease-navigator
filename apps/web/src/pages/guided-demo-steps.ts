// Ordered step sequence for the guided demo mode (Requirement 29.2, 29.3).
//
// The guided demo walks through the knowledge-triggered reanalysis scenario as
// an ordered sequence of steps, presented one at a time from the first step to
// the final result. This module models that sequence as plain, testable
// TypeScript data so both the UI and the timing bound can be verified without a
// running browser.
//
// The seven steps mirror the seven-stage reanalysis walkthrough documented in
// docs/DEMO_GUIDE.md ("Walkthrough: the reanalysis loop"). Each step records an
// estimated presenter duration; the sum of the durations is the end-to-end
// walkthrough length, which must fall within the 5-to-7-minute bound
// (Requirement 29.3). All content shown is synthetic (Req 1.8/25.1).

/** A single ordered step in the guided demo walkthrough. */
export interface GuidedDemoStep {
  /** Stable step identifier. */
  readonly id: string;
  /** 1-based position of the step within the ordered sequence. */
  readonly ordinal: number;
  /** Short step title shown in the step header and indicator. */
  readonly title: string;
  /** One-sentence summary of what the presenter shows in this step. */
  readonly summary: string;
  /**
   * In-app route the step corresponds to, so the presenter can open the
   * relevant page/tab alongside the walkthrough (mirrors DEMO_GUIDE.md).
   */
  readonly route: string;
  /** Human-readable label for the target page/tab. */
  readonly routeLabel: string;
  /** Talking points / actions for this step. */
  readonly details: readonly string[];
  /**
   * Estimated presenter time for this step, in seconds. The sum across all
   * steps is the end-to-end walkthrough duration (Req 29.3).
   */
  readonly estimatedDurationSeconds: number;
}

/** Lower bound of the end-to-end walkthrough duration: 5 minutes (Req 29.3). */
export const GUIDED_DEMO_MIN_DURATION_SECONDS = 5 * 60;

/** Upper bound of the end-to-end walkthrough duration: 7 minutes (Req 29.3). */
export const GUIDED_DEMO_MAX_DURATION_SECONDS = 7 * 60;

// The ordered steps, first to final result. Ordinals are 1-based and
// contiguous; the sequence is frozen so callers cannot reorder it.
export const GUIDED_DEMO_STEPS: readonly GuidedDemoStep[] = [
  {
    id: "synthetic-case-intake",
    ordinal: 1,
    title: "Synthetic case intake",
    summary:
      "Open the Dashboard and select a synthetic unresolved case validated at intake.",
    route: "/",
    routeLabel: "Dashboard",
    details: [
      "Note the visible synthetic-data indicator and the research/clinical classification label.",
      "Intake has validated the case against the Phenopacket schema and FHIR R4 definitions."
    ],
    estimatedDurationSeconds: 40
  },
  {
    id: "clinical-timeline",
    ordinal: 2,
    title: "Clinical timeline",
    summary:
      "Open the Case workspace Timeline tab to see the longitudinal timeline, ordered oldest to most recent.",
    route: "/case",
    routeLabel: "Case workspace - Timeline",
    details: [
      "Each entry shows its source document, author, a confidence percentage, a source link, and an AI-extracted flag.",
      "Try filtering by source, author, confidence range, or AI-extracted status."
    ],
    estimatedDurationSeconds: 50
  },
  {
    id: "phenotype-extraction",
    ordinal: 3,
    title: "Phenotype extraction",
    summary:
      "Request phenotype extraction; candidates are produced via the AI_Gateway within 60 seconds.",
    route: "/phenotype-review",
    routeLabel: "Phenotype-review",
    details: [
      "Each candidate maps to 1-20 HPO terms, is classified present/absent/uncertain/historical, and carries a confidence value and a link to its supporting source.",
      "Note the uncertainty indicator adjacent to each AI output. All candidates are pending review."
    ],
    estimatedDurationSeconds: 70
  },
  {
    id: "clinician-confirmation",
    ordinal: 4,
    title: "Clinician confirmation",
    summary:
      "As a Clinical geneticist, review the candidates: approve one, reject another, and edit a third before approval.",
    route: "/phenotype-review",
    routeLabel: "Phenotype-review",
    details: [
      "Approval records reviewer identity and timestamp; edits retain both the original AI value and the corrected value.",
      "Confirm that a user without review authorisation cannot approve, reject, or edit."
    ],
    estimatedDurationSeconds: 60
  },
  {
    id: "hypothesis-review",
    ordinal: 5,
    title: "Hypothesis review",
    summary:
      "Open the Hypothesis board and create an evidence-linked hypothesis card.",
    route: "/hypothesis-board",
    routeLabel: "Hypothesis board",
    details: [
      "The card must link to at least one evidence item; a zero-evidence card is rejected.",
      "Note the non-diagnostic wording and the card state. The case remains an Unresolved_Case."
    ],
    estimatedDurationSeconds: 55
  },
  {
    id: "simulated-knowledge-update",
    ordinal: 6,
    title: "Simulated knowledge update",
    summary:
      "As a Researcher or Administrator, publish a simulated Knowledge_Update whose delta references a stored variant, gene, or phenotype.",
    route: "/reanalysis-inbox",
    routeLabel: "Reanalysis inbox",
    details: [
      "The update carries a visible synthetic indicator.",
      "Its declared delta set references evidence stored on the unresolved case."
    ],
    estimatedDurationSeconds: 40
  },
  {
    id: "reanalysis-notification",
    ordinal: 7,
    title: "Reanalysis notification (the headline moment)",
    summary:
      "Within 60 seconds the Reanalysis_Service re-surfaces the affected case in the Reanalysis inbox with an explanation.",
    route: "/reanalysis-inbox",
    routeLabel: "Reanalysis inbox",
    details: [
      "A Reanalysis_Candidate records exactly which variant, gene, or phenotype matched and links to the triggering update.",
      "Approve the reanalysis run (identity + timestamp recorded); on completion, review the before/after comparison view."
    ],
    estimatedDurationSeconds: 85
  }
] as const;

/** Total number of steps in the walkthrough. */
export const GUIDED_DEMO_STEP_COUNT = GUIDED_DEMO_STEPS.length;

/**
 * Sum of every step's estimated duration: the end-to-end walkthrough length in
 * seconds when run without manual pauses (Req 29.3).
 */
export function totalEstimatedDurationSeconds(
  steps: readonly GuidedDemoStep[] = GUIDED_DEMO_STEPS
): number {
  return steps.reduce((total, step) => total + step.estimatedDurationSeconds, 0);
}
