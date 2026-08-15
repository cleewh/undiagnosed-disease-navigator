// CDK assertion smoke tests for the orchestration stack (task 34.2).
//
// These synthesize the OrchestrationStack inside an App (with the same
// app-level tags bin/app.ts applies, and the required foundation + auth
// stacks it depends on) and use aws-cdk-lib/assertions to verify the
// orchestration-relevant properties of the synthesized template:
//   - the EventBridge custom bus named `udn-domain-bus` (Req 27.4);
//   - two Step Functions state machines: analysis + reanalysis (Req 27.2);
//   - a rule matching source `udn.knowledge` / detail-type `knowledge-update`
//     targeting the reanalysis state machine (the knowledge-update ->
//     reanalysis loop, Req 27.4);
//   - rules for the other domain event categories (Req 27.4);
//   - HealthOmics run-control IAM permissions on the Workflow_Mode worker
//     (omics:StartRun etc., Req 9.7, 27.6);
//   - required resource tags present (Req 32.4).

import { describe, it, expect, beforeAll } from "vitest";
import { App, Tags } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { FoundationStack } from "../lib/foundation-stack.js";
import { AuthStack } from "../lib/auth-stack.js";
import { OrchestrationStack } from "../lib/orchestration-stack.js";
import {
  DOMAIN_EVENT_BUS_NAME,
  EVENT_SOURCES,
  EVENT_DETAIL_TYPES,
} from "../lib/domain-events.js";

const TAGS = {
  project: "undiagnosed-disease-navigator",
  environment: "demo",
  "cost-center": "udn-demo",
} as const;

/**
 * Synthesize the OrchestrationStack once, wiring the same foundation/auth
 * dependencies and app-level tags that bin/app.ts applies.
 */
function synthTemplate(): Template {
  const app = new App();
  Tags.of(app).add("project", TAGS.project);
  Tags.of(app).add("environment", TAGS.environment);
  Tags.of(app).add("cost-center", TAGS["cost-center"]);

  const foundation = new FoundationStack(app, "TestFoundationStack");
  const auth = new AuthStack(app, "TestAuthStack", { foundation });
  const orchestration = new OrchestrationStack(app, "TestOrchestrationStack", {
    foundation,
    auth,
  });
  return Template.fromStack(orchestration);
}

/** Assert every required tag is present on a resource's Tags array (order-independent). */
function expectRequiredTags(tags: unknown): void {
  const list = (tags ?? []) as Array<{ Key: string; Value: string }>;
  for (const [key, value] of Object.entries(TAGS)) {
    expect(list).toContainEqual({ Key: key, Value: value });
  }
}

describe("OrchestrationStack synthesis", () => {
  let template: Template;

  beforeAll(() => {
    template = synthTemplate();
  });

  describe("EventBridge domain bus (Req 27.4)", () => {
    it("defines a single custom bus named udn-domain-bus", () => {
      template.resourceCountIs("AWS::Events::EventBus", 1);
      template.hasResourceProperties("AWS::Events::EventBus", {
        Name: DOMAIN_EVENT_BUS_NAME,
      });
    });
  });

  describe("Step Functions state machines (Req 27.2)", () => {
    it("defines exactly two state machines", () => {
      template.resourceCountIs("AWS::StepFunctions::StateMachine", 2);
    });

    it("defines the analysis and reanalysis state machines by name", () => {
      const machines = template.findResources(
        "AWS::StepFunctions::StateMachine",
      );
      const names = Object.values(machines).map(
        (m) => m.Properties?.StateMachineName as string,
      );
      expect(names).toContain("udn-analysis-workflow");
      expect(names).toContain("udn-reanalysis-workflow");
    });

    it("carries the required tags on each state machine", () => {
      const machines = template.findResources(
        "AWS::StepFunctions::StateMachine",
      );
      for (const machine of Object.values(machines)) {
        expectRequiredTags(machine.Properties?.Tags);
      }
    });
  });

  describe("Domain event rules (Req 27.4)", () => {
    it("defines a rule per domain event category", () => {
      // knowledge-update + analysis-result + reanalysis-trigger + reminder.
      template.resourceCountIs("AWS::Events::Rule", 4);
    });

    it("routes knowledge-update events into the reanalysis workflow", () => {
      // Locate the reanalysis state machine's logical id.
      const machines = template.findResources(
        "AWS::StepFunctions::StateMachine",
      );
      const reanalysisLogicalId = Object.entries(machines).find(
        ([, m]) => m.Properties?.StateMachineName === "udn-reanalysis-workflow",
      )?.[0];
      expect(reanalysisLogicalId).toBeDefined();

      // Locate the knowledge-update rule by its event pattern.
      const rules = template.findResources("AWS::Events::Rule");
      const knowledgeRule = Object.values(rules).find((r) => {
        const pattern = r.Properties?.EventPattern ?? {};
        const sources = (pattern.source ?? []) as string[];
        const detailTypes = (pattern["detail-type"] ?? []) as string[];
        return (
          sources.includes(EVENT_SOURCES.knowledge) &&
          detailTypes.includes(EVENT_DETAIL_TYPES.knowledgeUpdate)
        );
      });
      expect(knowledgeRule).toBeDefined();

      // Its target must be the reanalysis state machine (the headline loop).
      const targets = (knowledgeRule?.Properties?.Targets ?? []) as Array<{
        Arn: unknown;
      }>;
      const targetArns = JSON.stringify(targets.map((t) => t.Arn));
      expect(targetArns).toContain(reanalysisLogicalId as string);
    });

    it("defines rules for the analysis-result, reanalysis-trigger, and reminder categories", () => {
      const categories: ReadonlyArray<{ source: string; detailType: string }> =
        [
          {
            source: EVENT_SOURCES.analysis,
            detailType: EVENT_DETAIL_TYPES.analysisResult,
          },
          {
            source: EVENT_SOURCES.reanalysis,
            detailType: EVENT_DETAIL_TYPES.reanalysisTrigger,
          },
          {
            source: EVENT_SOURCES.scheduler,
            detailType: EVENT_DETAIL_TYPES.reminder,
          },
        ];

      for (const category of categories) {
        template.hasResourceProperties("AWS::Events::Rule", {
          EventPattern: Match.objectLike({
            source: [category.source],
            "detail-type": [category.detailType],
          }),
        });
      }
    });
  });

  describe("HealthOmics gating (Req 9.7, 27.6)", () => {
    it("grants scoped HealthOmics run-control permissions to the workflow worker", () => {
      template.hasResourceProperties(
        "AWS::IAM::Policy",
        Match.objectLike({
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([
              Match.objectLike({
                Sid: "HealthOmicsRunControl",
                Effect: "Allow",
                Action: Match.arrayWith([
                  "omics:StartRun",
                  "omics:GetRun",
                  "omics:CancelRun",
                ]),
              }),
            ]),
          }),
        }),
      );
    });
  });
});
