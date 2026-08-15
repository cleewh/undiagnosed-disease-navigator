// Static configuration for the app shell: navigation targets, workspace tabs,
// and the exact Responsible_Use_Notice text (Requirements 24.1, 24.2, 25.1).

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
}

// The seven pages reachable from the persistent primary navigation (Req 24.1).
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "dashboard", label: "Dashboard", path: "/" },
  { id: "case-workspace", label: "Case workspace", path: "/case" },
  { id: "phenotype-review", label: "Phenotype-review", path: "/phenotype-review" },
  { id: "variant-review", label: "Variant-review", path: "/variant-review" },
  { id: "hypothesis-board", label: "Hypothesis board", path: "/hypothesis-board" },
  { id: "reanalysis-inbox", label: "Reanalysis inbox", path: "/reanalysis-inbox" },
  { id: "audit-viewer", label: "Audit viewer", path: "/audit-viewer" }
] as const;

// The guided demo mode (Requirement 29.2). It is a presentation aid rather than
// one of the seven primary pages (Req 24.1), so it is reached through a
// separate secondary control rather than the primary navigation.
export const GUIDED_DEMO_NAV: NavItem = {
  id: "guided-demo",
  label: "Guided demo",
  path: "/guided-demo"
} as const;

// The twelve Case workspace tabs (Req 24.2), in the order the design specifies.
export const CASE_WORKSPACE_TABS: readonly NavItem[] = [
  { id: "overview", label: "Overview", path: "overview" },
  { id: "timeline", label: "Timeline", path: "timeline" },
  { id: "phenotypes", label: "Phenotypes", path: "phenotypes" },
  { id: "family", label: "Family", path: "family" },
  { id: "investigations", label: "Investigations", path: "investigations" },
  { id: "genomics", label: "Genomics", path: "genomics" },
  { id: "hypotheses", label: "Hypotheses", path: "hypotheses" },
  { id: "evidence-gaps", label: "Evidence gaps", path: "evidence-gaps" },
  { id: "tasks", label: "Tasks", path: "tasks" },
  { id: "mdt-decisions", label: "MDT decisions", path: "mdt-decisions" },
  { id: "reanalysis-history", label: "Reanalysis history", path: "reanalysis-history" },
  { id: "audit-history", label: "Audit history", path: "audit-history" }
] as const;

// Exact Responsible_Use_Notice wording (Requirements 24.6, 25.1).
export const RESPONSIBLE_USE_NOTICE =
  "This prototype is intended for research, education and workflow demonstration. " +
  "It does not provide medical diagnosis or treatment advice. " +
  "All findings require review by appropriately qualified professionals.";
