# Architecture

The Navigator is a serverless, event-driven AWS application. A React single-page
application talks to an API Gateway (REST) + Lambda backend; per-service Lambda
handlers persist to a single DynamoDB table and to versioned, encrypted S3
buckets; Step Functions orchestrate multi-step workflows; EventBridge carries
domain events; and every generative model call is funnelled through a single
`AI_Gateway`.

## High-level components

```
apps/web (React + TS, WCAG 2.1 AA)
        |
   CloudFront + WAF  ->  API Gateway (REST) + Lambda authorizer (Cognito)
        |
apps/api (per-service Lambda handlers)
  Case, Intake, Timeline, Phenotype, Review, Contradiction, Gap,
  Analysis, Prioritisation (deterministic), Hypothesis, MDT,
  Disposition, Knowledge, Reanalysis, Auth, Audit
        |
  +-- AI_Gateway (sole Bedrock path): grounding + injection defence + schema
  |     validation + cache  ->  Amazon Bedrock (model id from env var)
  +-- Step Functions state machines  ->  EventBridge domain bus
  +-- DynamoDB (single primary datastore)
  +-- S3 artifact buckets (versioned, SSE-KMS, per-type prefixes)
        + Ground_Truth bucket (Evaluation_Framework identity only)

evaluation/ : Evaluation_Framework + Athena/Glue over S3 (offline)
Security spine: KMS, IAM, CloudTrail, Secrets Manager, CloudWatch
```

## Key architectural decisions

### API style: API Gateway (REST) + Lambda

Chosen over AppSync GraphQL because the workflow is dominated by command-style,
approval-gated operations ("approve phenotype", "resolve contradiction",
"approve analysis run") whose authorisation and audit semantics map cleanly to
discrete REST resources and methods. Step Functions and EventBridge form the
orchestration backbone, which REST + Lambda integrates with natively. A Lambda
authorizer backed by Cognito enforces the 15-minute inactivity session timeout
and role checks uniformly.

### Primary datastore: Amazon DynamoDB

A single DynamoDB table is the primary datastore (see
[DATA_MODEL.md](./DATA_MODEL.md) for the key schema). The domain is a set of
case-scoped, provenance-carrying, versioned objects almost always accessed by
case and by entity type within a case — a natural single-table pattern.
Immutability and append semantics for audit events (7-year retention) and
knowledge snapshots map to conditional writes that forbid overwrite/delete.
Optimistic concurrency and versioning use conditional expressions on a
`version` attribute. Complex ad-hoc analytics are handled offline via S3 export
and Athena, keeping the transactional store lean.

### AI_Gateway is the sole path to Bedrock

Any generative invocation that does not route through the `AI_Gateway` is
rejected. The gateway composes four responsibilities: model abstraction
(model id from an environment variable; task types restricted to phenotype
extraction, summarisation, and drafting of explanations/reports), prompt
injection defence (untrusted document content in separate delimited segments,
never as instructions), grounding + schema validation (every statement linked
to a source object, output validated against a defined schema and an allowlist
of response structures), and failure handling + caching (retry up to 3
attempts, below-threshold output retained unconfirmed and marked for review).

### Deterministic engines

Variant/gene prioritisation, inheritance, segregation, phenotype similarity,
workflow state, permissions, audit, and final classification/reanalysis
eligibility run in pure deterministic modules with no generative model in the
execution path. If a generative output is ever detected in these paths, the
result is rejected, the last valid deterministic state is retained, and a
non-deterministic-result error is returned.

## AWS service mapping

| Concern | AWS service |
|---|---|
| Web hosting | S3 + CloudFront (static React build) |
| Edge protection | WAF on CloudFront / API Gateway |
| Authentication + roles | Amazon Cognito user pool (7 role groups) |
| API layer | API Gateway (REST) + Lambda + Lambda authorizer |
| Compute | AWS Lambda (per-service handlers) |
| Orchestration | AWS Step Functions |
| Eventing | Amazon EventBridge (custom bus) |
| Primary datastore | Amazon DynamoDB (single-table) |
| Object storage | Amazon S3 (versioned, SSE-KMS, per-type prefixes) |
| Genomics (optional) | AWS HealthOmics (Demo_Mode / Workflow_Mode) |
| AI models | Amazon Bedrock via AI_Gateway |
| Analytics / evaluation | Amazon Athena + Glue over S3 |
| Secrets | AWS Secrets Manager |
| Encryption keys | AWS KMS (CMKs) |
| Audit / monitoring | CloudTrail (365-day retention), CloudWatch |
| Infrastructure as code | AWS CDK (TypeScript) |

## Orchestration and eventing

Multi-step workflows (intake, analysis runs, reanalysis) run as Step Functions
state machines. A failed step halts the workflow, retains current state, and
records a failure indication.

Four domain event categories flow over an EventBridge custom bus:
`analysis-result`, `knowledge-update`, `reanalysis-trigger`, and `reminder`.
The headline reanalysis loop is event-driven:

1. A researcher/administrator publishes a synthetic-labelled `Knowledge_Update`.
2. `Knowledge_Service` emits a `knowledge-update` event.
3. `Reanalysis_Service` consumes it and, within 60 seconds, identifies
   `Unresolved_Cases` whose stored variants/genes/phenotypes intersect the
   update's declared delta set.
4. For each affected case it creates a `Reanalysis_Candidate` (recording which
   variant/gene/phenotype matched, linked to the triggering update), emits a
   `reanalysis-trigger` event, and adds the case to the review queue.
5. A clinical geneticist explicitly approves (identity + timestamp) before a
   reanalysis run starts; a successful run yields a before/after comparison.

Matching is a deterministic set-intersection over normalized identifiers:

```
affected(case, update) := (case.variants   ∩ update.variants)
                        ∪ (case.genes      ∩ update.genes)
                        ∪ (case.phenotypes ∩ update.phenotypes)
```

If `affected` is empty, no candidate is created.

## Analysis approval and genomic mode

An analysis request must select a genomic workflow, then moves
Draft → WorkflowSelected → PendingApproval → Approved before any run starts.
On approval, `Demo_Mode` returns precomputed synthetic results without
initiating a run; `Workflow_Mode` executes the approved (HealthOmics) workflow.
A run failure retains the pre-run state and records the failure.

## Frontend

A React + TypeScript SPA served from S3 + CloudFront, with pages Dashboard,
Case workspace, Phenotype-review, Variant-review, Hypothesis board, Reanalysis
inbox, and Audit viewer reachable via persistent primary navigation. The Case
workspace has tabs for Overview, Timeline, Phenotypes, Family, Investigations,
Genomics, Hypotheses, Evidence gaps, Tasks, MDT decisions, Reanalysis history,
and Audit history. Cross-cutting UI concerns include a persistent
Responsible_Use_Notice, a synthetic-data indicator wherever case data or a
Knowledge_Update is shown, an uncertainty indicator (>= 3 ordered levels)
adjacent to any AI output, WCAG 2.1 AA accessibility, and a research/clinical
classification label on every case record and view.
