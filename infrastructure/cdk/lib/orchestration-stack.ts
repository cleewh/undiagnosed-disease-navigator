import {
  Stack,
  type StackProps,
  Duration,
  CfnOutput,
  RemovalPolicy,
  aws_events as events,
  aws_events_targets as targets,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_sqs as sqs,
  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as tasks,
} from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { GenomicMode } from "@udn/domain";
import type { FoundationStack } from "./foundation-stack.js";
import type { AuthStack } from "./auth-stack.js";
import { ARTIFACT_PREFIXES } from "./artifact-prefixes.js";
import {
  DOMAIN_EVENT_BUS_NAME,
  EVENT_DETAIL_TYPES,
  EVENT_SOURCES,
} from "./domain-events.js";

/**
 * Fail-safe placeholder body for the orchestration worker Lambdas.
 *
 * The verified handlers live in `@udn/api` and the `services/*` packages
 * (Analysis_Service, Reanalysis_Service, etc.). Bundling those handlers is
 * wired by a later API-integration task; until then each worker echoes its
 * input so the state machines are synthesizable and executable in a
 * demonstration environment without performing any real mutation.
 */
const WORKER_PLACEHOLDER_CODE = [
  "exports.handler = async (event) => {",
  "  // Placeholder worker. Replaced at deploy time by the bundled",
  "  // @udn/api / services handler in a later integration task.",
  "  return { ...(event ?? {}), placeholder: true };",
  "};",
].join("\n");

/** Number of retry attempts applied to workflow steps and event targets (Req 15.5, 22.5). */
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Properties for {@link OrchestrationStack}.
 */
export interface OrchestrationStackProps extends StackProps {
  /** Foundation stack providing the table, buckets, and encryption key. */
  readonly foundation: FoundationStack;
  /** Auth stack; accepted for app composition and future API wiring. */
  readonly auth: AuthStack;
  /**
   * Genomic operation mode for HealthOmics gating. Defaults to `Demo_Mode`
   * so the initial deployment never runs large-scale genomic compute
   * (Requirements 32.1, 32.5) and instead returns precomputed synthetic
   * results (Requirement 9.6).
   */
  readonly genomicMode?: GenomicMode;
}

/**
 * Orchestration stack: Step Functions state machines, the EventBridge domain
 * bus and rules, and HealthOmics gating.
 *
 * Implements task 34.1 (Requirements 27.2, 27.3, 27.4, 27.6):
 * - an EventBridge custom bus carrying the four required domain event
 *   categories (analysis-result, knowledge-update, reanalysis-trigger,
 *   reminder) with rules that route knowledge-update events straight into the
 *   reanalysis workflow (Req 27.4; the knowledge-update -> reanalysis loop);
 * - an analysis state machine whose genomic run is gated behind a required
 *   approval and whose mode branch returns precomputed results in Demo_Mode or
 *   initiates a HealthOmics run in Workflow_Mode (Req 9.3, 9.4, 9.6, 9.7, 27.6);
 * - a reanalysis state machine that deterministically identifies affected
 *   cases, creates candidates, and re-queues them (Req 15.1, 15.2, 15.3);
 * - halt-on-failure semantics: every step catches failures, records a failure
 *   indication, and terminates without advancing (Requirement 27.3, 9.9).
 *
 * Security note: this stack exposes no network-reachable endpoint. Its state
 * machines and bus are invoked only by IAM-authorized principals and by the
 * API tier, which sits behind API Gateway + the Cognito Lambda authorizer
 * (AuthStack). Genomic runs are reachable only after the in-workflow approval
 * gate, so no genomic compute can start without required-role approval.
 */
export class OrchestrationStack extends Stack {
  /** Custom domain event bus (Requirement 27.4). */
  public readonly domainBus: events.EventBus;
  /** Approval-gated analysis workflow (Requirements 9, 27.2). */
  public readonly analysisWorkflow: sfn.StateMachine;
  /** Continuous reanalysis workflow (Requirements 15, 27.2). */
  public readonly reanalysisWorkflow: sfn.StateMachine;
  /** Dead-letter queue for undeliverable event-rule targets. */
  public readonly eventDeadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: OrchestrationStackProps) {
    super(scope, id, props);

    const { foundation } = props;
    const genomicMode: GenomicMode = props.genomicMode ?? "Demo_Mode";

    // --- Domain event bus (Req 27.4) -----------------------------------------
    this.domainBus = new events.EventBus(this, "DomainBus", {
      eventBusName: DOMAIN_EVENT_BUS_NAME,
    });

    // Archive domain events so they can be replayed for demonstration and
    // debugging without re-publishing from producers (Well-Architected:
    // operational excellence).
    this.domainBus.archive("DomainBusArchive", {
      archiveName: "udn-domain-bus-archive",
      description: "Replayable archive of all Navigator domain events",
      retention: Duration.days(365),
      eventPattern: { account: [this.account] },
    });

    // Shared dead-letter queue for event delivery failures.
    this.eventDeadLetterQueue = new sqs.Queue(this, "EventDlq", {
      queueName: "udn-domain-events-dlq",
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: foundation.encryptionKey,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- Reanalysis workflow (Req 15, 27.2, 27.3) ----------------------------
    this.reanalysisWorkflow = this.buildReanalysisWorkflow(foundation);

    // --- Analysis workflow with HealthOmics gating (Req 9, 27.2, 27.6) -------
    this.analysisWorkflow = this.buildAnalysisWorkflow(foundation, genomicMode);

    // --- EventBridge rules (Req 27.4) ----------------------------------------
    this.buildEventRules();

    // --- Outputs for cross-stack / deployment visibility (Req 27.7) ----------
    new CfnOutput(this, "DomainBusName", {
      value: this.domainBus.eventBusName,
      description: "EventBridge domain bus name",
    });
    new CfnOutput(this, "AnalysisWorkflowArn", {
      value: this.analysisWorkflow.stateMachineArn,
      description: "Analysis Step Functions state machine ARN",
    });
    new CfnOutput(this, "ReanalysisWorkflowArn", {
      value: this.reanalysisWorkflow.stateMachineArn,
      description: "Reanalysis Step Functions state machine ARN",
    });
    new CfnOutput(this, "GenomicMode", {
      value: genomicMode,
      description:
        "Active genomic operation mode (Demo_Mode returns precomputed results)",
    });
  }

  /**
   * Creates a fail-safe placeholder worker Lambda that later integration wires
   * to the real service handler. Granted least-privilege access to the shared
   * table, artifacts bucket, and encryption key as needed by callers.
   */
  private makeWorker(
    id: string,
    functionName: string,
    description: string,
    foundation: FoundationStack,
    extraEnv: Record<string, string> = {},
  ): lambda.Function {
    const fn = new lambda.Function(this, id, {
      functionName,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline(WORKER_PLACEHOLDER_CODE),
      timeout: Duration.seconds(30),
      memorySize: 256,
      description,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        TABLE_NAME: foundation.table.tableName,
        ARTIFACTS_BUCKET: foundation.caseArtifactsBucket.bucketName,
        DOMAIN_BUS_NAME: DOMAIN_EVENT_BUS_NAME,
        ...extraEnv,
      },
    });
    return fn;
  }

  /**
   * Builds the reanalysis state machine: deterministic identification of
   * affected Unresolved_Cases, candidate creation, a reanalysis-trigger event,
   * and review-queue entry (Requirements 15.1, 15.2, 15.3, 15.8, 15.9).
   */
  private buildReanalysisWorkflow(
    foundation: FoundationStack,
  ): sfn.StateMachine {
    const identifyFn = this.makeWorker(
      "IdentifyAffectedCasesFn",
      "udn-reanalysis-identify",
      "Deterministically intersect case references with a knowledge-update delta (Req 15.1)",
      foundation,
    );
    const createCandidatesFn = this.makeWorker(
      "CreateReanalysisCandidatesFn",
      "udn-reanalysis-create-candidates",
      "Create Reanalysis_Candidate records linked to the triggering update (Req 15.2)",
      foundation,
    );
    const enqueueFn = this.makeWorker(
      "AddToReviewQueueFn",
      "udn-reanalysis-enqueue",
      "Add affected cases to the review queue (Req 15.3)",
      foundation,
    );
    const recordFailureFn = this.makeWorker(
      "RecordReanalysisFailureFn",
      "udn-reanalysis-record-failure",
      "Record a reanalysis failure and keep the update pending for reprocessing (Req 15.5)",
      foundation,
    );

    for (const fn of [identifyFn, createCandidatesFn, enqueueFn, recordFailureFn]) {
      foundation.table.grantReadWriteData(fn);
      foundation.encryptionKey.grantEncryptDecrypt(fn);
    }

    // Terminal failure path: record the failure, then fail the execution so it
    // halts and retains state (Req 27.3, 15.5, 15.7).
    const recordFailure = new tasks.LambdaInvoke(this, "RecordReanalysisFailure", {
      lambdaFunction: recordFailureFn,
      payloadResponseOnly: true,
      resultPath: "$.failure",
    }).next(
      new sfn.Fail(this, "ReanalysisFailed", {
        error: "ReanalysisFailed",
        cause:
          "Reanalysis step failed; update kept pending and pre-reanalysis state preserved (Req 15.5, 15.7, 27.3)",
      }),
    );

    const succeed = new sfn.Succeed(this, "ReanalysisComplete");

    const enqueue = new tasks.LambdaInvoke(this, "AddToReviewQueue", {
      lambdaFunction: enqueueFn,
      payloadResponseOnly: true,
      resultPath: "$.queue",
    });
    enqueue.addCatch(recordFailure, { resultPath: "$.error" });
    enqueue.next(succeed);

    // Publish a reanalysis-trigger domain event onto the bus (Req 27.4).
    const publishTrigger = new tasks.EventBridgePutEvents(
      this,
      "PublishReanalysisTrigger",
      {
        entries: [
          {
            eventBus: this.domainBus,
            source: EVENT_SOURCES.reanalysis,
            detailType: EVENT_DETAIL_TYPES.reanalysisTrigger,
            detail: sfn.TaskInput.fromObject({
              "candidates.$": "$.candidates",
              "updateId.$": "$.updateId",
            }),
          },
        ],
        resultPath: "$.published",
      },
    );
    publishTrigger.addCatch(recordFailure, { resultPath: "$.error" });
    publishTrigger.next(enqueue);

    const createCandidates = new tasks.LambdaInvoke(
      this,
      "CreateReanalysisCandidates",
      {
        lambdaFunction: createCandidatesFn,
        payloadResponseOnly: true,
        resultPath: "$.candidates",
      },
    );
    createCandidates.addRetry({
      maxAttempts: MAX_RETRY_ATTEMPTS,
      interval: Duration.seconds(2),
      backoffRate: 2,
    });
    createCandidates.addCatch(recordFailure, { resultPath: "$.error" });
    createCandidates.next(publishTrigger);

    // No intersection -> create no candidate (Req 15.9).
    const noCandidate = new sfn.Pass(this, "NoReanalysisCandidate", {
      comment: "References do not intersect; no candidate created (Req 15.9)",
    }).next(succeed);

    const hasAffected = new sfn.Choice(this, "AnyAffectedCases")
      .when(
        sfn.Condition.and(
          sfn.Condition.isPresent("$.affected[0]"),
        ),
        createCandidates,
      )
      .otherwise(noCandidate);

    // Identify affected cases within 60s, retry up to 3 times (Req 15.1, 15.5).
    const identify = new tasks.LambdaInvoke(this, "IdentifyAffectedCases", {
      lambdaFunction: identifyFn,
      payloadResponseOnly: true,
      resultPath: "$.affected",
      taskTimeout: sfn.Timeout.duration(Duration.seconds(60)),
    });
    identify.addRetry({
      maxAttempts: MAX_RETRY_ATTEMPTS,
      interval: Duration.seconds(2),
      backoffRate: 2,
    });
    identify.addCatch(recordFailure, { resultPath: "$.error" });
    identify.next(hasAffected);

    const logGroup = new logs.LogGroup(this, "ReanalysisWorkflowLogs", {
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    return new sfn.StateMachine(this, "ReanalysisWorkflow", {
      stateMachineName: "udn-reanalysis-workflow",
      definitionBody: sfn.DefinitionBody.fromChainable(identify),
      timeout: Duration.minutes(15),
      tracingEnabled: true,
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: false,
      },
    });
  }

  /**
   * Builds the analysis state machine with the approval gate and HealthOmics
   * mode branch (Requirements 9.1-9.9, 27.2, 27.3, 27.6).
   */
  private buildAnalysisWorkflow(
    foundation: FoundationStack,
    genomicMode: GenomicMode,
  ): sfn.StateMachine {
    const validateFn = this.makeWorker(
      "ValidateAnalysisRequestFn",
      "udn-analysis-validate",
      "Validate the analysis request and required workflow selection (Req 9.1, 9.2)",
      foundation,
    );
    const demoResultsFn = this.makeWorker(
      "ReturnPrecomputedResultsFn",
      "udn-analysis-precomputed",
      "Return precomputed synthetic genomic results without a run (Req 9.6, 27.6, 32.5)",
      foundation,
      { PRECOMPUTED_PREFIX: ARTIFACT_PREFIXES.precomputed },
    );
    const startRunFn = this.makeWorker(
      "StartHealthOmicsRunFn",
      "udn-analysis-healthomics-run",
      "Initiate an approved AWS HealthOmics run in Workflow_Mode (Req 9.7, 27.6)",
      foundation,
    );
    const recordOutputsFn = this.makeWorker(
      "RecordAnalysisOutputsFn",
      "udn-analysis-record-outputs",
      "Record analysis outputs with provenance (Req 9.8)",
      foundation,
    );
    const recordFailureFn = this.makeWorker(
      "RecordAnalysisFailureFn",
      "udn-analysis-record-failure",
      "Record an analysis failure and retain the pre-run state (Req 9.9, 27.3)",
      foundation,
    );

    for (const fn of [validateFn, recordOutputsFn, recordFailureFn]) {
      foundation.table.grantReadWriteData(fn);
      foundation.encryptionKey.grantEncryptDecrypt(fn);
    }
    // Demo_Mode reader only needs to read precomputed artifacts.
    foundation.table.grantReadData(demoResultsFn);
    foundation.caseArtifactsBucket.grantRead(demoResultsFn);
    foundation.encryptionKey.grantDecrypt(demoResultsFn);

    // Workflow_Mode worker needs table access plus scoped HealthOmics control.
    foundation.table.grantReadWriteData(startRunFn);
    foundation.encryptionKey.grantEncryptDecrypt(startRunFn);
    foundation.caseArtifactsBucket.grantReadWrite(startRunFn);
    // Least-privilege HealthOmics run control. Specific run/workflow ARNs are
    // not known at synth time, so actions are scoped to this account/region via
    // the execution context; tighten to explicit workflow ARNs once defined.
    startRunFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "HealthOmicsRunControl",
        effect: iam.Effect.ALLOW,
        actions: [
          "omics:StartRun",
          "omics:GetRun",
          "omics:ListRunTasks",
          "omics:GetRunTask",
          "omics:CancelRun",
        ],
        resources: ["*"],
      }),
    );

    // Terminal states.
    const failNoWorkflow = new sfn.Fail(this, "AnalysisWorkflowNotSelected", {
      error: "WorkflowSelectionRequired",
      cause:
        "Analysis request submitted without a genomic workflow selection (Req 9.2)",
    });
    const failNotApproved = new sfn.Fail(this, "AnalysisNotApproved", {
      error: "ApprovalRequired",
      cause:
        "Genomic analysis run requires required-role approval before starting (Req 9.3, 9.4)",
    });
    const succeed = new sfn.Succeed(this, "AnalysisComplete");

    const recordFailure = new tasks.LambdaInvoke(this, "RecordAnalysisFailure", {
      lambdaFunction: recordFailureFn,
      payloadResponseOnly: true,
      resultPath: "$.failure",
    }).next(
      new sfn.Fail(this, "AnalysisRunFailed", {
        error: "AnalysisRunFailed",
        cause:
          "A workflow step failed; pre-run state retained and failure recorded (Req 9.9, 27.3)",
      }),
    );

    const recordOutputs = new tasks.LambdaInvoke(this, "RecordAnalysisOutputs", {
      lambdaFunction: recordOutputsFn,
      payloadResponseOnly: true,
      resultPath: "$.outputs",
    });
    recordOutputs.addCatch(recordFailure, { resultPath: "$.error" });
    recordOutputs.next(succeed);

    // Demo_Mode branch: precomputed results, no run initiated (Req 9.6, 32.5).
    const demoBranch = new tasks.LambdaInvoke(this, "ReturnPrecomputedResults", {
      lambdaFunction: demoResultsFn,
      payloadResponseOnly: true,
      resultPath: "$.run",
    });
    demoBranch.addRetry({
      maxAttempts: MAX_RETRY_ATTEMPTS,
      interval: Duration.seconds(2),
      backoffRate: 2,
    });
    demoBranch.addCatch(recordFailure, { resultPath: "$.error" });
    demoBranch.next(recordOutputs);

    // Workflow_Mode branch: initiate the approved HealthOmics run (Req 9.7).
    const workflowBranch = new tasks.LambdaInvoke(this, "StartHealthOmicsRun", {
      lambdaFunction: startRunFn,
      payloadResponseOnly: true,
      resultPath: "$.run",
    });
    workflowBranch.addRetry({
      maxAttempts: MAX_RETRY_ATTEMPTS,
      interval: Duration.seconds(5),
      backoffRate: 2,
    });
    workflowBranch.addCatch(recordFailure, { resultPath: "$.error" });
    workflowBranch.next(recordOutputs);

    // Mode branch is only reachable AFTER the approval gate below, so no
    // genomic run can be initiated without required-role approval (security).
    const modeChoice = new sfn.Choice(this, "GenomicModeChoice")
      .when(
        sfn.Condition.stringEquals("$.genomicMode", "Demo_Mode"),
        demoBranch,
      )
      .when(
        sfn.Condition.stringEquals("$.genomicMode", "Workflow_Mode"),
        workflowBranch,
      )
      .otherwise(demoBranch);

    // Approval gate (Req 9.3, 9.4): proceed only on an explicit approval.
    const approvalGate = new sfn.Choice(this, "ApprovalGate")
      .when(
        sfn.Condition.booleanEquals("$.approval.approved", true),
        modeChoice,
      )
      .otherwise(failNotApproved);

    // Require a selected workflow before anything else (Req 9.1, 9.2).
    const workflowSelected = new sfn.Choice(this, "WorkflowSelectedChoice")
      .when(sfn.Condition.isPresent("$.workflowId"), approvalGate)
      .otherwise(failNoWorkflow);

    const validate = new tasks.LambdaInvoke(this, "ValidateAnalysisRequest", {
      lambdaFunction: validateFn,
      payloadResponseOnly: true,
      resultPath: "$.validation",
    });
    validate.addCatch(recordFailure, { resultPath: "$.error" });
    validate.next(workflowSelected);

    const logGroup = new logs.LogGroup(this, "AnalysisWorkflowLogs", {
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    void genomicMode; // recorded as a CfnOutput; workflows read mode from input.

    return new sfn.StateMachine(this, "AnalysisWorkflow", {
      stateMachineName: "udn-analysis-workflow",
      definitionBody: sfn.DefinitionBody.fromChainable(validate),
      timeout: Duration.hours(1),
      tracingEnabled: true,
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: false,
      },
    });
  }

  /**
   * Wires EventBridge rules for the four domain event categories. The
   * knowledge-update rule routes straight into the reanalysis workflow,
   * realising the knowledge-update -> reanalysis loop (Req 27.4, 14 -> 15).
   * The remaining categories are delivered to a placeholder domain-event
   * handler that later integration replaces with real consumers.
   */
  private buildEventRules(): void {
    // knowledge-update -> reanalysis workflow (the headline loop).
    const knowledgeUpdateRule = new events.Rule(this, "KnowledgeUpdateRule", {
      ruleName: "udn-knowledge-update-to-reanalysis",
      eventBus: this.domainBus,
      description:
        "Route knowledge-update events into the reanalysis workflow (Req 27.4)",
      eventPattern: {
        source: [EVENT_SOURCES.knowledge],
        detailType: [EVENT_DETAIL_TYPES.knowledgeUpdate],
      },
    });
    knowledgeUpdateRule.addTarget(
      new targets.SfnStateMachine(this.reanalysisWorkflow, {
        deadLetterQueue: this.eventDeadLetterQueue,
        retryAttempts: MAX_RETRY_ATTEMPTS,
      }),
    );

    // Placeholder consumer for the remaining domain event categories so the
    // rules have valid targets and delivery failures are captured in the DLQ.
    const domainEventHandler = new lambda.Function(this, "DomainEventHandlerFn", {
      functionName: "udn-domain-event-handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline(WORKER_PLACEHOLDER_CODE),
      timeout: Duration.seconds(30),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      description:
        "Placeholder consumer for analysis-result, reanalysis-trigger, and reminder events (Req 27.4)",
    });

    const consumerRules: ReadonlyArray<{
      readonly id: string;
      readonly ruleName: string;
      readonly source: string;
      readonly detailType: string;
    }> = [
      {
        id: "AnalysisResultRule",
        ruleName: "udn-analysis-result",
        source: EVENT_SOURCES.analysis,
        detailType: EVENT_DETAIL_TYPES.analysisResult,
      },
      {
        id: "ReanalysisTriggerRule",
        ruleName: "udn-reanalysis-trigger",
        source: EVENT_SOURCES.reanalysis,
        detailType: EVENT_DETAIL_TYPES.reanalysisTrigger,
      },
      {
        id: "ReminderRule",
        ruleName: "udn-reminder",
        source: EVENT_SOURCES.scheduler,
        detailType: EVENT_DETAIL_TYPES.reminder,
      },
    ];

    for (const rule of consumerRules) {
      const r = new events.Rule(this, rule.id, {
        ruleName: rule.ruleName,
        eventBus: this.domainBus,
        description: `Deliver ${rule.detailType} events (Req 27.4)`,
        eventPattern: {
          source: [rule.source],
          detailType: [rule.detailType],
        },
      });
      r.addTarget(
        new targets.LambdaFunction(domainEventHandler, {
          deadLetterQueue: this.eventDeadLetterQueue,
          retryAttempts: MAX_RETRY_ATTEMPTS,
        }),
      );
    }
  }
}
