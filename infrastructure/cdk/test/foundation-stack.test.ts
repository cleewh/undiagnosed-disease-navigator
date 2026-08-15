// CDK assertion smoke tests for the foundation stack (task 4.2).
//
// These synthesize the FoundationStack inside an App (with the same app-level
// tags applied by bin/app.ts) and use aws-cdk-lib/assertions to verify the
// security- and durability-relevant properties of the synthesized template:
//   - a single DynamoDB table with GSI1-GSI4, PITR, and CMK SSE (Req 26.1, 27.5);
//   - versioned, SSE-KMS, public-access-blocked S3 buckets (Req 26.3, 26.7);
//   - the Ground_Truth deny-except-Evaluation_Framework policy (Req 2.10);
//   - a rotating KMS key (Req 26.1);
//   - a CloudTrail trail with 365-day CloudWatch Logs retention (Req 26.4);
//   - required resource tags on taggable resources (Req 32.4).

import { describe, it, expect, beforeAll } from "vitest";
import { App, Tags } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { FoundationStack } from "../lib/foundation-stack.js";

const TAGS = {
  project: "undiagnosed-disease-navigator",
  environment: "demo",
  "cost-center": "udn-demo",
} as const;

/** Synthesize the stack once with the app-level tags bin/app.ts applies. */
function synthTemplate(): Template {
  const app = new App();
  const stack = new FoundationStack(app, "TestFoundationStack");
  Tags.of(app).add("project", TAGS.project);
  Tags.of(app).add("environment", TAGS.environment);
  Tags.of(app).add("cost-center", TAGS["cost-center"]);
  return Template.fromStack(stack);
}

/** Assert every required tag is present on a resource's Tags array (order-independent). */
function expectRequiredTags(tags: unknown): void {
  const list = (tags ?? []) as Array<{ Key: string; Value: string }>;
  for (const [key, value] of Object.entries(TAGS)) {
    expect(list).toContainEqual({ Key: key, Value: value });
  }
}

describe("FoundationStack synthesis", () => {
  let template: Template;

  beforeAll(() => {
    template = synthTemplate();
  });

  describe("DynamoDB single table (Req 26.1, 27.5)", () => {
    it("defines exactly one table", () => {
      template.resourceCountIs("AWS::DynamoDB::Table", 1);
    });

    it("declares GSI1-GSI4 and nothing else", () => {
      const tables = template.findResources("AWS::DynamoDB::Table");
      const table = Object.values(tables)[0];
      expect(table).toBeDefined();
      const gsis = (table?.Properties?.GlobalSecondaryIndexes ?? []) as Array<{
        IndexName: string;
      }>;
      const names = gsis.map((g) => g.IndexName).sort();
      expect(names).toEqual(["GSI1", "GSI2", "GSI3", "GSI4"]);
    });

    it("enables point-in-time recovery", () => {
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });
    });

    it("encrypts at rest with the customer-managed key", () => {
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        SSESpecification: Match.objectLike({
          SSEEnabled: true,
          SSEType: "KMS",
          KMSMasterKeyId: Match.anyValue(),
        }),
      });
    });

    it("carries the required tags", () => {
      const tables = template.findResources("AWS::DynamoDB::Table");
      for (const table of Object.values(tables)) {
        expectRequiredTags(table.Properties?.Tags);
      }
    });
  });

  describe("S3 buckets (Req 26.3, 26.7)", () => {
    it("defines the three foundation buckets", () => {
      // case-artifacts, Ground_Truth, and the CloudTrail log bucket.
      template.resourceCountIs("AWS::S3::Bucket", 3);
    });

    it("every bucket enables versioning, KMS SSE, and blocks public access", () => {
      const buckets = template.findResources("AWS::S3::Bucket");
      const entries = Object.values(buckets);
      expect(entries.length).toBe(3);
      for (const bucket of entries) {
        const props = bucket.Properties ?? {};
        expect(props.VersioningConfiguration).toEqual({ Status: "Enabled" });

        const rules =
          props.BucketEncryption?.ServerSideEncryptionConfiguration ?? [];
        expect(rules.length).toBeGreaterThan(0);
        for (const rule of rules) {
          expect(
            rule.ServerSideEncryptionByDefault?.SSEAlgorithm,
          ).toBe("aws:kms");
        }

        expect(props.PublicAccessBlockConfiguration).toEqual({
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        });
      }
    });

    it("tags each bucket with the required tags", () => {
      const buckets = template.findResources("AWS::S3::Bucket");
      for (const bucket of Object.values(buckets)) {
        expectRequiredTags(bucket.Properties?.Tags);
      }
    });
  });

  describe("Ground_Truth isolation (Req 2.10)", () => {
    it("denies all principals except the Evaluation_Framework role", () => {
      template.hasResourceProperties(
        "AWS::S3::BucketPolicy",
        Match.objectLike({
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([
              Match.objectLike({
                Sid: "DenyAccessExceptEvaluationFramework",
                Effect: "Deny",
                Action: "s3:*",
                Principal: Match.objectLike({ AWS: "*" }),
                Condition: {
                  StringNotEquals: {
                    "aws:PrincipalArn": Match.anyValue(),
                  },
                },
              }),
            ]),
          }),
        }),
      );
    });
  });

  describe("Encryption key (Req 26.1)", () => {
    it("defines a KMS key with rotation enabled", () => {
      template.hasResourceProperties("AWS::KMS::Key", {
        EnableKeyRotation: true,
      });
    });
  });

  describe("Audit trail (Req 26.4)", () => {
    it("defines a CloudTrail trail", () => {
      template.resourceCountIs("AWS::CloudTrail::Trail", 1);
    });

    it("retains CloudWatch Logs for 365 days", () => {
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        RetentionInDays: 365,
      });
    });
  });
});
