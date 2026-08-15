# Deployment and Operational Runbook

All AWS infrastructure is defined as code using **AWS CDK (TypeScript)** in
`infrastructure/cdk`. There are no manually created console or CLI resources.
Deployment provisions every defined resource, reports a completion status, and
requires no manual post-deployment steps. If a deployment fails, it stops,
rolls back to the pre-deployment state, and records a failure indication.

## Prerequisites

- Node.js >= 20 and npm (workspaces enabled).
- An AWS account and credentials with permission to deploy the stack. Obtain
  credentials via your organisation's standard sign-in flow rather than
  long-lived keys.
- AWS CDK v2 (invoked through the `infrastructure/cdk` package scripts).
- A Bedrock model identifier for the target region (supplied via environment
  variable — see below).

> Follow the repository AWS guidance: prefer infrastructure-as-code over CLI
> mutations, apply Well-Architected principles, and use hyphens (not em
> dashes) in resource names and descriptions.

## Build and test before deploying

```bash
npm install
npm run build                 # tsc --build across all workspaces
npm test                      # vitest run
npm run validate:structure    # repo structure + documentation validation
```

## Configuration

The `AI_Gateway` reads the Bedrock **model identifier from an environment
variable** at initialisation. If the variable is absent or empty, all
generative invocations are rejected with a configuration-missing error and no
model is invoked. Set it before deploying or before running any AI-dependent
workflow, for example:

```bash
export NAVIGATOR_BEDROCK_MODEL_ID="<region-appropriate-model-id>"
```

Runtime secrets are retrieved from **AWS Secrets Manager** and are never placed
in application code, logs, or on-disk files.

## Genomic operation mode

The initial deployment defaults to **Demo_Mode**: analysis requests are
fulfilled from precomputed synthetic genomic results and no large-scale genomic
compute runs. **Workflow_Mode** executes an approved (HealthOmics-backed)
genomic workflow and is enabled deliberately for a full run. See
[COST_GUIDANCE.md](./COST_GUIDANCE.md).

## Deploy

```bash
# From the CDK package (see its package.json for the exact script names)
npm run deploy --workspace infrastructure/cdk
```

The CDK application provisions, at minimum:

- S3 + CloudFront (static web app) with a WAF web ACL.
- Cognito user pool with the seven role groups.
- API Gateway (REST) + Lambda handlers + Lambda authorizer.
- Step Functions state machines and an EventBridge custom bus.
- A single DynamoDB table with the required GSIs.
- Versioned, SSE-KMS S3 artifact buckets with per-type prefixes, plus the
  isolated Ground_Truth bucket.
- KMS customer-managed keys, least-privilege IAM roles, CloudTrail
  (>= 365-day retention), CloudWatch log groups, and Secrets Manager entries.

Every deployed resource carries the required cost-allocation tags; no resource
is left untagged (see [COST_GUIDANCE.md](./COST_GUIDANCE.md)).

## Post-deployment verification

1. Confirm the CDK deployment reported a completion status with no manual
   steps outstanding.
2. Load synthetic cases (`data/generator`) and confirm the synthetic-data
   indicator appears in the UI.
3. Sign in with a test user in each Cognito role group and confirm the RBAC
   matrix is enforced (see [SECURITY.md](./SECURITY.md)).
4. Confirm CloudTrail is recording management and data-access events.
5. Run the guided demo end to end (see [DEMO_GUIDE.md](./DEMO_GUIDE.md)).

## Operational runbook

### Workflow step failure

Step Functions halt the workflow, retain current state, and record a failure
indication. Inspect the execution history in the Step Functions console and the
associated CloudWatch logs, then re-drive from the retained state.

### AI invocation failure

The `AI_Gateway` retries a failed invocation up to 3 attempts. On exhaustion it
presents an error indication and logs the failure with reason and timestamp
within 5 seconds. Below-threshold or schema-failing output is retained
unconfirmed and marked for review, never overwriting confirmed output.

### Reanalysis identification failure

If identification for a `Knowledge_Update` fails to complete, the update is
retained pending, retried up to 3 times, and an error identifying the failed
update is produced. No affected case is silently dropped.

### Analysis / reanalysis run failure

A failed run preserves the pre-run (or pre-reanalysis) state unchanged and
records the failure. No partial results are promoted.

### Audit recording failure

Audit recording retries up to 3 times; on exhaustion it returns an error to the
initiating action and preserves the pending event for reprocessing.

### Session expiry

Sessions inactive for 15 minutes are ended; users must re-authenticate before
further access to case data.

## Rollback

Deployments roll back automatically on failure. To revert a successful
deployment, redeploy the previous CDK revision; because all state-bearing
resources use versioning/point-in-time recovery, data is preserved across
redeploys.

## Teardown

Destroying the stack removes provisioned compute and networking. Buckets with
versioning and the immutable audit/knowledge stores are retained by default to
preserve the 7-year audit retention guarantee; remove them explicitly only when
the retention obligation no longer applies.
