# Data Model

The Navigator defines a typed domain model in `packages/domain` and persists it
to a single Amazon DynamoDB table using a single-table design. Every clinically
relevant object embeds a common provenance envelope.

## Common provenance envelope

Every clinically relevant object embeds the following envelope. Creation sets
`createdAt == modifiedAt` and `version = 1`. Modification updates `modifiedAt`
and increments `version` while preserving `createdAt` and `createdById`.
Persisting an object missing any required attribute, or with an access
classification outside the defined set, is rejected without altering existing
storage.

```typescript
export type AccessClassification = "research" | "clinical" | "ground_truth";

export interface ProvenanceRef {
  sourceId: string;      // originating source object identifier
  versionId: string;     // version identifier of the source
  createdById: string;   // User or system actor id
  ingestedAt: string;    // ISO-8601 UTC
}

export interface Envelope {
  id: string;                        // globally unique across all entity types
  entityType: EntityType;            // discriminator
  caseId: string;                    // owning case
  source: string;                    // origin
  version: number;                   // positive integer starting at 1
  status: string;                    // per-entity status enums narrow this
  provenance: ProvenanceRef;
  accessClassification: AccessClassification;
  createdAt: string;                 // ISO-8601 UTC, millisecond precision
  modifiedAt: string;                // ISO-8601 UTC, millisecond precision
  createdById: string;
  syntheticIndicator: true;          // synthetic-data indicator
}
```

## Entities

The model defines typed entities for at least the following (31+ entities), all
extending `Envelope`:

User, Role, Case, Patient, FamilyMember, Pedigree, Encounter,
ClinicalDocument, Observation, PhenotypeCandidate, ConfirmedPhenotype,
Contradiction, EvidenceGap, Biosample, GenomicTest, AnalysisRequest,
AnalysisRun, Variant, Gene, Disease, Hypothesis, EvidenceItem, Task,
MdtDecision, CaseDisposition, KnowledgeSource, KnowledgeSnapshot,
KnowledgeUpdate, ReanalysisCandidate, ModelInvocation, and AuditEvent.

## Identity, timestamps, and versioning rules

- Each object has a **globally unique id**, distinct from every other object
  across all entity types.
- `createdAt` and `modifiedAt` are UTC with **millisecond precision**;
  `createdById` identifies the creating user or system actor.
- Each object carries a `source`, a `version` (positive integer starting at 1),
  a `caseId`, a `status`, `provenance`, and an `accessClassification` from the
  defined set `{research, clinical, ground_truth}`.
- On creation: `createdAt == modifiedAt`, `version = 1`.
- On modification: `modifiedAt` updated, `version` incremented by 1;
  `createdAt` and `createdById` preserved.
- Persisting an object with a missing required attribute or an out-of-set
  access classification is rejected; existing storage is left unchanged; the
  error identifies the missing/invalid attribute.

Optimistic concurrency is enforced with DynamoDB conditional expressions on the
`version` attribute, giving byte-stable increment behaviour.

## DynamoDB single-table design

The primary key models case-scoped access:

- Partition key: `CASE#<caseId>`
- Sort key: `<ENTITY>#<entityId>`

### Access patterns

| Access pattern | Key / index |
|---|---|
| All objects for a case | PK `CASE#<caseId>` |
| Object by type within a case | PK `CASE#<caseId>`, SK begins_with `<ENTITY>#` |
| Unresolved cases | GSI1 PK `STATUS#UNRESOLVED` |
| Cases referencing a variant/gene/phenotype | GSI2 PK `REF#<kind>#<normalizedId>` |
| Review queue entries | GSI3 PK `QUEUE#<caseId or global>` sorted by `createdAt` |
| Audit events by object | GSI4 PK `AUDITOBJ#<objectId>` sorted by `ts` |
| Knowledge snapshot by version | PK `SNAPSHOT#<version>` |

GSI2 is the backbone of the reanalysis loop: it finds all unresolved cases that
reference a given normalized variant, gene, or phenotype identifier so that a
`Knowledge_Update` can be matched deterministically.

## Immutability and retention

- **Audit events** are immutable with a minimum **7-year retention**;
  modification/deletion requests are rejected. They are written with conditional
  writes that forbid overwrite/delete.
- **Knowledge snapshots** are immutable; modify/delete attempts are rejected and
  the original is preserved.
- AI corrections retain both the original AI-generated value and the corrected
  value with attribution to the correcting user.

## Offline analytics

Complex ad-hoc analytical queries are not run against DynamoDB. Case data is
exported to S3 and queried with **Athena + Glue** in the Evaluation_Framework,
keeping the transactional store lean. See [EVALUATION.md](./EVALUATION.md).
