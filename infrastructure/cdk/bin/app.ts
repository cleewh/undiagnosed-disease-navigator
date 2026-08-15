#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { App, Tags } from "aws-cdk-lib";
import { FoundationStack } from "../lib/foundation-stack.js";
import { AuthStack } from "../lib/auth-stack.js";
import { OrchestrationStack } from "../lib/orchestration-stack.js";
import { WebHostingStack } from "../lib/web-hosting-stack.js";
import { CopilotStack } from "../lib/copilot-stack.js";

/**
 * CDK application entrypoint for the AI-Assisted Undiagnosed Disease Case
 * Navigator (Requirement 27.1: all infrastructure defined via AWS CDK).
 *
 * Stacks are registered here from dedicated stack files. This structure is
 * intentionally open for extension:
 * - the Auth stack (Cognito user pool + Lambda authorizer) is added in task 5.1;
 * - the API / orchestration stack is added in task 34.1.
 * Each new stack lives in its own file under `lib/`, is imported here, and can
 * consume the foundation resources via the public members of FoundationStack.
 */
const app = new App();

// Deployment environment (account/region) is resolved from the standard CDK
// environment variables so the same app synthesizes locally and in CI.
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// Required resource tags applied at the app level so EVERY resource in EVERY
// stack inherits them and none is left untagged (Requirement 32.4).
const project =
  (app.node.tryGetContext("project") as string | undefined) ??
  "undiagnosed-disease-navigator";
const environment =
  (app.node.tryGetContext("environment") as string | undefined) ?? "demo";
const costCenter =
  (app.node.tryGetContext("costCenter") as string | undefined) ?? "udn-demo";

Tags.of(app).add("project", project);
Tags.of(app).add("environment", environment);
Tags.of(app).add("cost-center", costCenter);

// --- Foundation: data, storage, keys, audit trail (task 4.1) ---------------
const foundation = new FoundationStack(app, "UdnFoundationStack", {
  env,
  description:
    "UDN Navigator foundation: KMS key, DynamoDB single table, S3 buckets, CloudTrail",
});

// --- Auth: Cognito user pool, role groups, Lambda authorizer (task 5.1) -----
// Passes `foundation` so auth-related wiring can reference shared resources.
const auth = new AuthStack(app, "UdnAuthStack", {
  env,
  description:
    "UDN Navigator auth: Cognito user pool with 7 role groups and the Lambda authorizer",
  foundation,
});

// --- Orchestration: Step Functions, EventBridge, HealthOmics gating (task 34.1)
// Passes `foundation` for the table/buckets/key and `auth` for app composition.
// Defaults to Demo_Mode so the initial deployment never runs large-scale
// genomic compute (Requirements 32.1, 32.5).
const genomicMode =
  (app.node.tryGetContext("genomicMode") as "Demo_Mode" | "Workflow_Mode" | undefined) ??
  "Demo_Mode";

const orchestration = new OrchestrationStack(app, "UdnOrchestrationStack", {
  env,
  description:
    "UDN Navigator orchestration: Step Functions workflows, EventBridge domain bus and rules, HealthOmics gating",
  foundation,
  auth,
  genomicMode,
});

void orchestration;

// --- Web hosting: static SPA portal (S3 + CloudFront) ----------------------
// Standalone stack (depends on no other stack) so the UI can be previewed on
// its own. CloudFront is a global service; the stack is pinned to us-east-1.
// The SPA build directory is resolved absolutely from this file so synth works
// regardless of the invoking working directory. Compiled location is
// `infrastructure/cdk/dist/bin/app.js`, so the repo root is four levels up.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const webBuildPath = resolve(repoRoot, "apps/web/build");

const webHosting = new WebHostingStack(app, "UdnWebHostingStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" },
  description:
    "UDN Navigator web portal: private S3 origin + CloudFront serving the synthetic-demo SPA",
  webBuildPath,
});

void webHosting;

// --- Copilot: Bedrock-backed AI case assistant (API Gateway HTTP API) -------
// The Lambda has NO Function URL (so it is never world-accessible); it is
// invokable only by this API Gateway. The HTTP API is CORS-locked to the
// CloudFront origin and throttled. Pinned to us-east-1 (Bedrock Nova Lite).
const copilotLambdaPath = resolve(repoRoot, "infrastructure/cdk/lambda/copilot");
const copilotAllowedOrigin =
  (app.node.tryGetContext("copilotAllowedOrigin") as string | undefined) ??
  "https://d4lhvidpu453o.cloudfront.net";

// Region + model for the copilot. Default us-east-1 with Amazon Nova Lite
// (validated on-demand there); the Bedrock Guardrail is created in the same
// region. Override via context, e.g. -c copilotRegion=ap-southeast-1
// -c copilotModelId=anthropic.claude-3-haiku-20240307-v1:0 for in-country SG.
const copilotRegion =
  (app.node.tryGetContext("copilotRegion") as string | undefined) ?? "us-east-1";
const copilotModelId =
  (app.node.tryGetContext("copilotModelId") as string | undefined) ?? "amazon.nova-lite-v1:0";

const copilot = new CopilotStack(app, "UdnCopilotStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: copilotRegion },
  description:
    "UDN Navigator AI copilot: grounded, non-diagnostic Amazon Bedrock (Converse) assistant with Guardrail, behind a CORS-locked, throttled API Gateway HTTP API (Lambda has no public URL)",
  lambdaAssetPath: copilotLambdaPath,
  allowedOrigin: copilotAllowedOrigin,
  modelId: copilotModelId,
});

void copilot;

app.synth();
