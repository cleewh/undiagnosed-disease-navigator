# Cost Guidance

The Navigator is a demonstration deployment and is designed to stay inexpensive.
Cost control rests on three levers: **precomputed synthetic genomics**, an **AI
grounding cache**, and a **fully serverless, pay-per-use** architecture with
**mandatory resource tagging**.

## Precomputed synthetic genomics (Demo_Mode)

Where no live genomic-compute source is enabled, the Navigator uses
**precomputed synthetic genomic results** and does **not** run large-scale
genomic compute on the initial deployment. Analysis requests approved in
`Demo_Mode` are fulfilled from the `precomputed/` S3 prefix without initiating a
run. This removes the single largest potential cost (genomic pipelines) from the
default demonstration path.

`Workflow_Mode` — which executes a real (HealthOmics-backed) genomic workflow —
is opt-in and should be enabled only for a deliberate full run, since it incurs
genomic-compute cost.

## AI grounding cache

Amazon Bedrock invocations are cached by the `AI_Gateway`:

- When a grounded input identical to a previously cached input is submitted, the
  **cached** AI result is returned (no new model invocation, no new cost).
- When a grounded input has no cached result, the result is computed, stored in
  the cache, then returned.

Cache keys are a canonical hash of (task type, model id, authorised context,
prompt template version), so repeated demo runs over the same synthetic cases
reuse prior results. Task types are restricted to phenotype extraction,
summarisation, and drafting of explanations/reports, bounding the invocation
surface.

## Serverless, pay-per-use architecture

- **Lambda** (per-service handlers) — pay per request/duration; idle cost is
  effectively zero.
- **DynamoDB** — on-demand capacity avoids paying for provisioned throughput on
  a low-traffic demo.
- **S3 + CloudFront** — inexpensive static hosting and storage; buckets use
  versioning and SSE-KMS.
- **Step Functions / EventBridge** — pay per state transition / event.
- **Athena + Glue** — pay per query, used only for offline evaluation.

Choosing DynamoDB over a provisioned Aurora cluster is itself a cost decision
for a demonstration workload (see [DATA_MODEL.md](./DATA_MODEL.md)).

## Mandatory resource tagging

Every deployed AWS resource carries the required cost-allocation tags; **no
deployed resource is missing the required tags**. This makes spend attributable
per environment and per component in AWS Cost Explorer and billing reports.
Tagging is enforced in the CDK application so tags are applied at provisioning
time rather than retrofitted.

## Keeping costs low: checklist

- Leave the deployment in **Demo_Mode** unless a full genomic run is
  specifically required.
- Rely on the **AI grounding cache** by re-running demos over the same
  synthetic cases.
- Prefer **on-demand** DynamoDB for demo traffic levels.
- Confirm all resources are **tagged** after deployment.
- **Tear down** or scale to zero non-serverless experiments when idle;
  serverless components incur little idle cost but genomic and Bedrock usage do
  not.
- Keep CloudTrail (>= 365-day) and audit (7-year) retention in mind: log
  storage grows over time and should be budgeted for long-lived deployments.

## What can still incur cost

- `Workflow_Mode` genomic runs (HealthOmics compute).
- Bedrock invocations on **cache misses** (novel grounded inputs).
- Long-term storage for audit (7-year) and CloudTrail (365-day) retention.
- Athena scans over large exported datasets (mitigate with partitioning in
  Glue).
