import {
  Stack,
  type StackProps,
  RemovalPolicy,
  CfnOutput,
  Duration,
  aws_dynamodb as dynamodb,
  aws_s3 as s3,
  aws_kms as kms,
  aws_iam as iam,
  aws_cloudtrail as cloudtrail,
  aws_logs as logs,
} from "aws-cdk-lib";
import type { Construct } from "constructs";
import { ARTIFACT_TYPES, ARTIFACT_PREFIXES } from "./artifact-prefixes.js";

/**
 * Properties for {@link FoundationStack}.
 */
export interface FoundationStackProps extends StackProps {
  /**
   * Whether resources should be retained on stack deletion. Defaults to
   * `false` for the demonstration deployment so the environment can be torn
   * down cheaply; set to `true` for any long-lived environment.
   */
  readonly retainData?: boolean;
}

/**
 * Foundation stack: shared data, storage, encryption keys, and audit trail.
 *
 * Establishes the primitives every other stack builds on:
 * - a customer-managed KMS key (CMK) used to encrypt data at rest (Req 26.1);
 * - the DynamoDB single table with GSI1-GSI4 (Req 27.5, 26.1, design GSIs);
 * - the versioned, SSE-KMS case-artifacts bucket organised by per-type prefix
 *   (Req 26.3, 26.7, 26.8);
 * - a separate, isolated Ground_Truth bucket readable only by a dedicated
 *   Evaluation_Framework role (Req 2.10);
 * - a CloudTrail trail with >= 365-day retention (Req 26.4).
 *
 * Every resource is tagged at the app level (Req 32.4). The table, buckets,
 * key, and Evaluation_Framework role are exposed as public readonly members so
 * later stacks (Auth in task 5.1, API/orchestration in task 34.1) can grant
 * least-privilege access without re-declaring these resources.
 */
export class FoundationStack extends Stack {
  /** Customer-managed key protecting all data at rest in this stack. */
  public readonly encryptionKey: kms.Key;
  /** DynamoDB single table backing every case-scoped domain entity. */
  public readonly table: dynamodb.Table;
  /** Versioned, encrypted bucket holding per-type case artifacts. */
  public readonly caseArtifactsBucket: s3.Bucket;
  /** Isolated bucket holding hidden Ground_Truth, Evaluation_Framework only. */
  public readonly groundTruthBucket: s3.Bucket;
  /** The only identity permitted to read Ground_Truth. */
  public readonly evaluationFrameworkRole: iam.Role;
  /** Organisation-wide audit trail. */
  public readonly auditTrail: cloudtrail.Trail;

  constructor(scope: Construct, id: string, props: FoundationStackProps = {}) {
    super(scope, id, props);

    const removalPolicy = props.retainData
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    // --- Encryption key (Req 26.1) -------------------------------------------
    this.encryptionKey = new kms.Key(this, "DataKey", {
      alias: "udn/data",
      description:
        "UDN Navigator customer-managed key for DynamoDB, S3, and CloudTrail encryption",
      enableKeyRotation: true,
      removalPolicy,
    });

    // --- DynamoDB single table (Req 27.5, 26.1) ------------------------------
    // Generic PK/SK per design: PK CASE#<caseId>, SK <ENTITY>#<id>.
    this.table = new dynamodb.Table(this, "PrimaryTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      removalPolicy,
    });

    // GSI1: unresolved cases (PK STATUS#UNRESOLVED). design 13.4, 15.1
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: cases referencing a variant/gene/phenotype (PK REF#<kind>#<id>). 15.1
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI3: review queue entries (PK QUEUE#..., sorted by createdAt). 15.3, 24
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI3",
      partitionKey: { name: "GSI3PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI3SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI4: audit events by object (PK AUDITOBJ#<objectId>, sorted by ts). 22
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI4",
      partitionKey: { name: "GSI4PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI4SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- Case-artifacts bucket (Req 26.3, 26.7, 26.8) ------------------------
    this.caseArtifactsBucket = new s3.Bucket(this, "CaseArtifactsBucket", {
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: !props.retainData,
    });

    // Record the dedicated per-artifact-type prefixes on the resource so the
    // layout (Req 26.8) is explicit and auditable in the synthesized template.
    this.caseArtifactsBucket.node.addMetadata(
      "artifact-prefixes",
      ARTIFACT_TYPES.map((t) => ARTIFACT_PREFIXES[t]).join(","),
    );

    // --- Evaluation_Framework role (Req 2.10) --------------------------------
    // A dedicated, assumable identity that is the ONLY principal permitted to
    // read Ground_Truth. It is created here so the Ground_Truth bucket policy
    // can reference it and later stacks can attach the offline evaluation job.
    this.evaluationFrameworkRole = new iam.Role(this, "EvaluationFrameworkRole", {
      assumedBy: new iam.AccountRootPrincipal(),
      description:
        "Dedicated Evaluation_Framework identity: sole reader of Ground_Truth",
    });

    // --- Ground_Truth bucket (Req 2.10) --------------------------------------
    // Physically separate, isolated bucket. Access is granted ONLY to the
    // Evaluation_Framework role and explicitly denied to every other principal.
    this.groundTruthBucket = new s3.Bucket(this, "GroundTruthBucket", {
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: !props.retainData,
    });

    // Grant the Evaluation_Framework role full read/write on Ground_Truth and
    // the ability to use the CMK to decrypt objects.
    this.groundTruthBucket.grantReadWrite(this.evaluationFrameworkRole);
    this.encryptionKey.grantEncryptDecrypt(this.evaluationFrameworkRole);

    // Deny every principal that is NOT the Evaluation_Framework role. This
    // enforces "readable by the Evaluation_Framework and not readable by any
    // other component" (Req 2.10). The condition scopes the deny by principal
    // ARN so the grant above remains effective for the evaluation identity.
    this.groundTruthBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "DenyAccessExceptEvaluationFramework",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:*"],
        resources: [
          this.groundTruthBucket.bucketArn,
          this.groundTruthBucket.arnForObjects("*"),
        ],
        conditions: {
          StringNotEquals: {
            "aws:PrincipalArn": this.evaluationFrameworkRole.roleArn,
          },
        },
      }),
    );

    // --- CloudTrail (Req 26.4) -----------------------------------------------
    // Management + data-access events retained for at least 365 days via the
    // CloudWatch Logs retention setting; the trail's S3 log bucket also carries
    // a matching lifecycle expiration.
    const trailLogBucket = new s3.Bucket(this, "TrailLogBucket", {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: !props.retainData,
      // Retain trail logs for at least 365 days (Req 26.4). Objects transition
      // to cheaper storage after a year but are never expired before then.
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(365),
            },
          ],
        },
      ],
    });

    this.auditTrail = new cloudtrail.Trail(this, "AuditTrail", {
      bucket: trailLogBucket,
      encryptionKey: this.encryptionKey,
      sendToCloudWatchLogs: true,
      cloudWatchLogsRetention: logs.RetentionDays.ONE_YEAR,
      managementEvents: cloudtrail.ReadWriteType.ALL,
      includeGlobalServiceEvents: true,
      isMultiRegionTrail: true,
    });

    // Record S3 object-level (data) access events for the case artifact and
    // Ground_Truth buckets so access to sensitive objects is audited (26.4).
    this.auditTrail.addS3EventSelector(
      [
        { bucket: this.caseArtifactsBucket },
        { bucket: this.groundTruthBucket },
      ],
      { readWriteType: cloudtrail.ReadWriteType.ALL },
    );

    // --- Outputs for cross-stack consumption ---------------------------------
    new CfnOutput(this, "PrimaryTableName", {
      value: this.table.tableName,
      description: "DynamoDB single-table name",
    });
    new CfnOutput(this, "CaseArtifactsBucketName", {
      value: this.caseArtifactsBucket.bucketName,
      description: "Case-artifacts bucket name",
    });
    new CfnOutput(this, "GroundTruthBucketName", {
      value: this.groundTruthBucket.bucketName,
      description: "Isolated Ground_Truth bucket name",
    });
    new CfnOutput(this, "DataKeyArn", {
      value: this.encryptionKey.keyArn,
      description: "Customer-managed KMS key ARN",
    });
    new CfnOutput(this, "EvaluationFrameworkRoleArn", {
      value: this.evaluationFrameworkRole.roleArn,
      description: "Evaluation_Framework role ARN (sole Ground_Truth reader)",
    });
  }
}
