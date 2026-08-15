// Role model for the multidisciplinary team (MDT) board.
//
// The Navigator supports seven specialist roles (see docs/SECURITY.md). Each
// role gets a tailored workspace on sign-in: a distinct accent, a default
// landing view, a focus statement, role-specific KPIs, a personal work queue,
// and quick actions. All values here are clearly-synthetic demonstration data.

export type RoleId =
  | "clinical_geneticist"
  | "bioinformatician"
  | "genetic_counsellor"
  | "medical_specialist"
  | "researcher"
  | "case_coordinator"
  | "administrator";

export type Tone = "info" | "warning" | "success" | "neutral" | "danger";

export interface RoleKpi {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly tone: Tone;
}

export interface RoleQueueItem {
  readonly primary: string;
  readonly meta: string;
  readonly tag: string;
  readonly tone: Tone;
}

export interface RoleQuickAction {
  readonly label: string;
  readonly to: string;
}

export interface RoleDefinition {
  readonly id: RoleId;
  /** Formal role label, e.g. "Clinical geneticist". */
  readonly label: string;
  /** Sample display name for the demo identity. */
  readonly sampleName: string;
  /** Initials shown in the avatar. */
  readonly initials: string;
  /** One-line description of the role's scope. */
  readonly scope: string;
  /** Role accent colour (hex) used to theme the shell. */
  readonly accent: string;
  /** Default route the role lands on after sign-in. */
  readonly landingPath: string;
  /** Headline framing shown on the personalised dashboard. */
  readonly focus: string;
  readonly kpis: readonly RoleKpi[];
  readonly queueTitle: string;
  readonly queue: readonly RoleQueueItem[];
  readonly quickActions: readonly RoleQuickAction[];
}

export const ROLES: readonly RoleDefinition[] = [
  {
    id: "clinical_geneticist",
    label: "Clinical geneticist",
    sampleName: "Dr. Ada Okonkwo",
    initials: "AO",
    scope: "Confirms phenotypes, reviews hypotheses, chairs MDT decisions.",
    accent: "#2563eb",
    landingPath: "/phenotype-review",
    focus: "Phenotype confirmations and hypotheses awaiting your review.",
    kpis: [
      { label: "Awaiting your confirmation", value: "6", hint: "AI-extracted phenotype candidates", tone: "info" },
      { label: "Hypotheses to review", value: "4", hint: "Across 3 unresolved cases", tone: "warning" },
      { label: "MDT decisions pending", value: "2", hint: "Scheduled for this week", tone: "neutral" }
    ],
    queueTitle: "Phenotype candidates to confirm",
    queue: [
      { primary: "Seizure (HP:0001250)", meta: "UDN-SYN-0007 · confidence High", tag: "Confirm", tone: "success" },
      { primary: "Global developmental delay (HP:0001263)", meta: "UDN-SYN-0007 · confidence Moderate", tag: "Review", tone: "warning" },
      { primary: "Developmental regression (HP:0002376)", meta: "UDN-SYN-0012 · confidence Low", tag: "Uncertain", tone: "danger" }
    ],
    quickActions: [
      { label: "Open phenotype review", to: "/phenotype-review" },
      { label: "Go to hypothesis board", to: "/hypothesis-board" }
    ]
  },
  {
    id: "bioinformatician",
    label: "Bioinformatician",
    sampleName: "Dr. Ravi Menon",
    initials: "RM",
    scope: "Requests and approves genomic analyses; triages ranked variants.",
    accent: "#0e7490",
    landingPath: "/variant-review",
    focus: "Analysis approvals and ranked variants needing triage.",
    kpis: [
      { label: "Analyses awaiting approval", value: "3", hint: "Demo_Mode precomputed results", tone: "warning" },
      { label: "Runs completed", value: "11", hint: "This week (synthetic)", tone: "success" },
      { label: "Variants to triage", value: "27", hint: "Across active cases", tone: "info" }
    ],
    queueTitle: "Analysis requests",
    queue: [
      { primary: "Exome trio · UDN-SYN-0012", meta: "Estimated cost 12.5 units · Bioinformatician approval", tag: "Approve", tone: "warning" },
      { primary: "Genome · UDN-SYN-0033", meta: "CNV/SV workflow · pending inputs", tag: "Blocked", tone: "danger" },
      { primary: "Repeat-expansion · UDN-SYN-0021", meta: "Precomputed results available", tag: "Ready", tone: "success" }
    ],
    quickActions: [
      { label: "Open variant review", to: "/variant-review" },
      { label: "View case workspace", to: "/case" }
    ]
  },
  {
    id: "genetic_counsellor",
    label: "Genetic counsellor",
    sampleName: "Ms. Lena Farah",
    initials: "LF",
    scope: "Manages family communication, consent, and disclosure.",
    accent: "#7c3aed",
    landingPath: "/hypothesis-board",
    focus: "Family-facing items: consent, disclosure, and hypothesis framing.",
    kpis: [
      { label: "Families to brief", value: "3", hint: "Awaiting counselling session", tone: "info" },
      { label: "Consent items", value: "5", hint: "External-matching confirmations", tone: "warning" },
      { label: "Disclosures pending", value: "1", hint: "Requires manual confirmation", tone: "danger" }
    ],
    queueTitle: "Counselling queue",
    queue: [
      { primary: "Consent for external matching · UDN-SYN-0021", meta: "Manual confirmation required", tag: "Confirm", tone: "warning" },
      { primary: "Family briefing · UDN-SYN-0007", meta: "Non-diagnostic hypothesis summary ready", tag: "Schedule", tone: "info" }
    ],
    quickActions: [
      { label: "Open hypothesis board", to: "/hypothesis-board" },
      { label: "Review audit history", to: "/audit-viewer" }
    ]
  },
  {
    id: "medical_specialist",
    label: "Medical specialist",
    sampleName: "Dr. Sofia Ricci",
    initials: "SR",
    scope: "Contributes specialty expertise and consult opinions to the MDT.",
    accent: "#b45309",
    landingPath: "/case",
    focus: "Consults requested in your specialty and cases to weigh in on.",
    kpis: [
      { label: "Consults requested", value: "4", hint: "Awaiting your opinion", tone: "warning" },
      { label: "Cases in your specialty", value: "9", hint: "Neurology (synthetic)", tone: "info" },
      { label: "MDT votes cast", value: "12", hint: "This month", tone: "success" }
    ],
    queueTitle: "Consult requests",
    queue: [
      { primary: "Neurological review · UDN-SYN-0007", meta: "Seizure phenotype confirmed", tag: "Opinion", tone: "warning" },
      { primary: "Multisystem review · UDN-SYN-0021", meta: "Unresolved · reanalysis queued", tag: "Review", tone: "info" }
    ],
    quickActions: [
      { label: "Open case workspace", to: "/case" },
      { label: "View hypotheses", to: "/hypothesis-board" }
    ]
  },
  {
    id: "researcher",
    label: "Researcher",
    sampleName: "Dr. Noah Bergström",
    initials: "NB",
    scope: "Publishes synthetic knowledge updates; monitors reanalysis.",
    accent: "#047857",
    landingPath: "/reanalysis-inbox",
    focus: "Knowledge updates you publish and the reanalyses they trigger.",
    kpis: [
      { label: "Knowledge updates published", value: "14", hint: "Synthetic, this quarter", tone: "success" },
      { label: "Reanalyses triggered", value: "3", hint: "Cases re-surfaced", tone: "info" },
      { label: "Cohort matches", value: "8", hint: "Across the library", tone: "neutral" }
    ],
    queueTitle: "Recent knowledge updates",
    queue: [
      { primary: "KU-2025-014 · Gene MECP2", meta: "Re-surfaced UDN-SYN-0007", tag: "Matched", tone: "success" },
      { primary: "KU-2025-013 · Variant VAR-9", meta: "Re-surfaced UDN-SYN-0033", tag: "Matched", tone: "success" },
      { primary: "KU-2025-012 · Phenotype HP:0001250", meta: "No intersecting cases", tag: "No match", tone: "neutral" }
    ],
    quickActions: [
      { label: "Open reanalysis inbox", to: "/reanalysis-inbox" },
      { label: "View variant rankings", to: "/variant-review" }
    ]
  },
  {
    id: "case_coordinator",
    label: "Case coordinator",
    sampleName: "Mr. Diego Alvarez",
    initials: "DA",
    scope: "Runs intake, assigns tasks, and keeps cases moving.",
    accent: "#be123c",
    landingPath: "/",
    focus: "Intakes, task assignments, and cases that need scheduling.",
    kpis: [
      { label: "New intakes", value: "2", hint: "Validated, awaiting assignment", tone: "info" },
      { label: "Tasks assigned", value: "18", hint: "Across the MDT", tone: "neutral" },
      { label: "Cases needing scheduling", value: "5", hint: "MDT meeting this week", tone: "warning" }
    ],
    queueTitle: "Coordination queue",
    queue: [
      { primary: "Assign reviewer · UDN-SYN-0041", meta: "New intake · cardiac", tag: "Assign", tone: "info" },
      { primary: "Schedule MDT · UDN-SYN-0007", meta: "2 pending decisions", tag: "Schedule", tone: "warning" },
      { primary: "Chase analysis inputs · UDN-SYN-0033", meta: "Blocked on genomic inputs", tag: "Follow up", tone: "danger" }
    ],
    quickActions: [
      { label: "View case library", to: "/" },
      { label: "Open case workspace", to: "/case" }
    ]
  },
  {
    id: "administrator",
    label: "Administrator",
    sampleName: "Dr. Demo Admin",
    initials: "DA",
    scope: "Oversees users, configuration, audit, and system health.",
    accent: "#334155",
    landingPath: "/audit-viewer",
    focus: "Users, configuration, and the immutable audit trail.",
    kpis: [
      { label: "Active users", value: "23", hint: "Across 7 roles", tone: "info" },
      { label: "Audit events today", value: "148", hint: "Immutable, 7-year retention", tone: "neutral" },
      { label: "System health", value: "OK", hint: "All services nominal", tone: "success" }
    ],
    queueTitle: "Administration",
    queue: [
      { primary: "Review role assignments", meta: "2 pending access requests", tag: "Review", tone: "warning" },
      { primary: "Gap-rule configuration", meta: "1 proposed change", tag: "Approve", tone: "info" },
      { primary: "Ground_Truth access policy", meta: "Evaluation_Framework only · enforced", tag: "Locked", tone: "success" }
    ],
    quickActions: [
      { label: "Open audit viewer", to: "/audit-viewer" },
      { label: "View case library", to: "/" }
    ]
  }
] as const;

/** Look up a role definition by id, or `undefined` when unknown. */
export function roleById(id: string): RoleDefinition | undefined {
  return ROLES.find((role) => role.id === id);
}
