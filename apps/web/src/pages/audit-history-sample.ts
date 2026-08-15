// Illustrative, clearly-synthetic audit-event view models for the Audit viewer
// page and the Case workspace Audit-history tab. These stand in for the
// immutable events recorded by the Audit_Service (Req 22) until the API is
// wired in a later task. Every event carries an actor, an action, an affected
// object id, and a UTC timestamp with second precision (Req 22.2); the two
// correction rows also carry original and corrected values (Req 22.4). All
// identifiers and values are synthetic demonstration data only.

import type { AuditEventView } from "../components/AuditHistory.js";

// Case-scoped events (Case workspace Audit-history tab): all affect objects
// belonging to a single synthetic case.
export const SAMPLE_CASE_AUDIT_EVENTS: readonly AuditEventView[] = [
  {
    id: "aud-1006",
    actorId: "user:geneticist-synthetic-01",
    action: "approve",
    affectedObjectId: "analysis-run-synthetic-0007",
    at: "2025-02-14T11:42:19Z"
  },
  {
    id: "aud-1005",
    actorId: "user:counsellor-synthetic-03",
    action: "modify",
    affectedObjectId: "phenotype-synthetic-0031",
    at: "2025-02-14T10:15:02Z",
    correction: {
      originalValue: "HP:0001250 Seizure (AI-suggested)",
      correctedValue: "HP:0002133 Status epilepticus (clinician-confirmed)"
    }
  },
  {
    id: "aud-1004",
    actorId: "user:bioinformatician-synthetic-02",
    action: "modify",
    affectedObjectId: "variant-synthetic-0148",
    at: "2025-02-14T09:31:07Z",
    correction: {
      originalValue: "Likely benign (AI-suggested)",
      correctedValue: "Uncertain significance (clinician-confirmed)"
    }
  },
  {
    id: "aud-1003",
    actorId: "user:coordinator-synthetic-04",
    action: "create",
    affectedObjectId: "hypothesis-synthetic-0012",
    at: "2025-02-13T16:58:44Z"
  },
  {
    id: "aud-1002",
    actorId: "user:geneticist-synthetic-01",
    action: "reject",
    affectedObjectId: "hypothesis-synthetic-0009",
    at: "2025-02-13T15:22:10Z"
  },
  {
    id: "aud-1001",
    actorId: "system:intake-pipeline",
    action: "create",
    affectedObjectId: "case-synthetic-0002",
    at: "2025-02-12T08:00:00Z"
  }
] as const;

// Library-wide events (Audit viewer page): the case-scoped events above plus a
// couple that affect objects in other synthetic cases, demonstrating the
// cross-case view.
export const SAMPLE_LIBRARY_AUDIT_EVENTS: readonly AuditEventView[] = [
  {
    id: "aud-2003",
    actorId: "user:administrator-synthetic-00",
    action: "delete",
    affectedObjectId: "task-synthetic-0450",
    at: "2025-02-14T12:05:33Z"
  },
  {
    id: "aud-2002",
    actorId: "user:specialist-synthetic-05",
    action: "approve",
    affectedObjectId: "mdt-decision-synthetic-0021",
    at: "2025-02-14T11:50:12Z"
  },
  ...SAMPLE_CASE_AUDIT_EVENTS
] as const;
