import {
  Stack,
  type StackProps,
  CfnOutput,
  Duration,
  aws_lambda as lambda,
  aws_iam as iam,
  aws_apigatewayv2 as apigwv2,
  aws_bedrock as bedrock,
} from "aws-cdk-lib";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { Construct } from "constructs";

/**
 * Properties for {@link CopilotStack}.
 */
export interface CopilotStackProps extends StackProps {
  /** Absolute path to the Lambda asset directory (contains index.js). */
  readonly lambdaAssetPath: string;
  /** Exact browser origin allowed by CORS (the CloudFront URL). */
  readonly allowedOrigin: string;
  /** Bedrock model id to invoke (defaults to in-country Claude 3 Haiku). */
  readonly modelId?: string;
}

/**
 * Backend for the AI case copilot: a Lambda that calls Amazon Bedrock
 * (Converse) with the synthetic case grounded server-side, protected by a
 * Bedrock Guardrail, exposed through an Amazon API Gateway HTTP API.
 *
 * Security posture:
 * - The Lambda has NO Function URL (not world-accessible); only this API
 *   Gateway can invoke it.
 * - The API is CORS-restricted to the CloudFront origin and throttled.
 * - A Bedrock Guardrail filters harmful content, blocks prompt-injection, denies
 *   prescriptive treatment/dosing advice, and redacts PII.
 * - Deployed in-region (default ap-southeast-1) with an in-country on-demand
 *   model (Claude 3 Haiku), so inference stays in-country.
 */
export class CopilotStack extends Stack {
  public readonly fn: lambda.Function;
  public readonly httpApi: apigwv2.HttpApi;
  public readonly guardrail: bedrock.CfnGuardrail;

  constructor(scope: Construct, id: string, props: CopilotStackProps) {
    super(scope, id, props);

    const modelId = props.modelId ?? "anthropic.claude-3-haiku-20240307-v1:0";

    // --- Bedrock Guardrail ---------------------------------------------------
    this.guardrail = new bedrock.CfnGuardrail(this, "Guardrail", {
      name: `udn-copilot-guardrail-${this.region}`,
      description: "Guardrail for the UDN clinical copilot: harmful-content, prompt-attack, denied treatment/dosing advice, PII redaction.",
      blockedInputMessaging: "This request can't be processed by the clinical demonstration assistant.",
      blockedOutputsMessaging: "This response was withheld by the safety guardrail. Please rephrase, and consult a qualified clinician.",
      contentPolicyConfig: {
        filtersConfig: [
          { type: "SEXUAL", inputStrength: "HIGH", outputStrength: "HIGH" },
          { type: "VIOLENCE", inputStrength: "HIGH", outputStrength: "HIGH" },
          { type: "HATE", inputStrength: "HIGH", outputStrength: "HIGH" },
          { type: "INSULTS", inputStrength: "HIGH", outputStrength: "HIGH" },
          { type: "MISCONDUCT", inputStrength: "HIGH", outputStrength: "HIGH" },
          { type: "PROMPT_ATTACK", inputStrength: "HIGH", outputStrength: "NONE" },
        ],
      },
      topicPolicyConfig: {
        topicsConfig: [
          {
            name: "PrescriptiveTreatmentOrDosing",
            definition:
              "Prescriptive medical treatment selection, medication choice, or dosing instructions presented as advice to act on for a patient.",
            examples: [
              "What dose of trofinetide should this patient take?",
              "Prescribe an anticonvulsant regimen for this child.",
              "Which medication should we start and at what dose?",
            ],
            type: "DENY",
          },
        ],
      },
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: [
          { type: "EMAIL", action: "ANONYMIZE" },
          { type: "PHONE", action: "ANONYMIZE" },
          { type: "US_SOCIAL_SECURITY_NUMBER", action: "BLOCK" },
          { type: "CREDIT_DEBIT_CARD_NUMBER", action: "BLOCK" },
        ],
      },
    });
    const guardrailVersion = new bedrock.CfnGuardrailVersion(this, "GuardrailVersion", {
      guardrailIdentifier: this.guardrail.attrGuardrailId,
    });

    // --- Lambda --------------------------------------------------------------
    this.fn = new lambda.Function(this, "CopilotFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(props.lambdaAssetPath),
      timeout: Duration.seconds(30),
      memorySize: 256,
      reservedConcurrentExecutions: 5,
      environment: {
        MODEL_ID: modelId,
        ALLOWED_ORIGIN: props.allowedOrigin,
        GUARDRAIL_ID: this.guardrail.attrGuardrailId,
        GUARDRAIL_VERSION: guardrailVersion.attrVersion,
      },
      description:
        "UDN copilot: grounded, non-diagnostic Bedrock (Converse) assistant with Guardrail, invoked only via API Gateway",
    });

    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/${modelId}`],
      })
    );
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:ApplyGuardrail"],
        resources: [this.guardrail.attrGuardrailArn],
      })
    );

    // --- API Gateway HTTP API ------------------------------------------------
    this.httpApi = new apigwv2.HttpApi(this, "CopilotApi", {
      description: "UDN copilot HTTP API (CORS-locked, throttled)",
      corsPreflight: {
        allowOrigins: [props.allowedOrigin],
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ["content-type"],
        maxAge: Duration.hours(1),
      },
    });

    this.httpApi.addRoutes({
      path: "/copilot",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("CopilotIntegration", this.fn),
    });

    const defaultStage = this.httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = { throttlingRateLimit: 2, throttlingBurstLimit: 5 };
    }

    new CfnOutput(this, "CopilotEndpoint", {
      value: `${this.httpApi.apiEndpoint}/copilot`,
      description: "HTTPS endpoint for the AI copilot (POST { task | question })",
    });
    new CfnOutput(this, "GuardrailId", {
      value: this.guardrail.attrGuardrailId,
      description: "Bedrock Guardrail id applied to copilot calls",
    });
  }
}
