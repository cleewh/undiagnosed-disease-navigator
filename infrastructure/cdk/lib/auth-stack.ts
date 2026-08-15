import {
  Stack,
  type StackProps,
  RemovalPolicy,
  Duration,
  CfnOutput,
  aws_cognito as cognito,
  aws_lambda as lambda,
} from "aws-cdk-lib";
import type { Construct } from "constructs";
import { USER_ROLES } from "@udn/domain";
import type { FoundationStack } from "./foundation-stack.js";

/** Inactivity window enforced by the authorizer (Req 21.6), in seconds. */
const SESSION_INACTIVITY_TIMEOUT_SECONDS = 15 * 60;

/**
 * Fail-closed placeholder implementation for the authorizer Lambda.
 *
 * The verified, unit-tested authorizer lives in `@udn/api`
 * (`src/auth/authorizer.ts` + `cognito-verifier.ts`). Bundling that handler
 * (with its `aws-jwt-verify` dependency) into this function is wired by the
 * API / orchestration stack in task 34.1. Until then this inline code denies
 * every request so the resource never fails open.
 */
const PLACEHOLDER_AUTHORIZER_CODE = [
  "exports.handler = async () => {",
  "  // Replaced at deploy time by the bundled @udn/api authorizer (task 34.1).",
  "  throw new Error('Unauthorized');",
  "};",
].join("\n");

/**
 * Properties for {@link AuthStack}.
 */
export interface AuthStackProps extends StackProps {
  /**
   * The foundation stack whose shared resources (encryption key, table,
   * buckets) later auth-related wiring may consume. Accepted here so the auth
   * stack composes with the rest of the app; the authorizer itself is
   * stateless and needs no foundation grants at this stage.
   */
  readonly foundation: FoundationStack;
}

/**
 * Auth stack: Amazon Cognito user pool, one group per role, an app client, and
 * the Lambda authorizer resource.
 *
 * Implements the infrastructure half of task 5.1 (Requirements 21.1, 21.2,
 * 21.6). Authentication uses a Cognito user pool with one group per role
 * (design "Auth_Service, Cognito, and the RBAC Matrix"). A Lambda authorizer
 * validates the Cognito JWT on every API call, enforces the 15-minute
 * inactivity session timeout, and injects the caller's identity + role(s) into
 * the request context for the downstream RBAC checks added in tasks 5.2/5.3.
 *
 * The user pool, app client, role groups, and authorizer function are exposed
 * as public readonly members so the API / orchestration stack (task 34.1) can
 * attach the authorizer to API Gateway without redeclaring them.
 */
export class AuthStack extends Stack {
  /** Cognito user pool backing authentication for all interactive roles. */
  public readonly userPool: cognito.UserPool;
  /** App client used by the web application to obtain tokens. */
  public readonly userPoolClient: cognito.UserPoolClient;
  /** One Cognito group per {@link USER_ROLES} value (Req 21.2). */
  public readonly roleGroups: readonly cognito.CfnUserPoolGroup[];
  /** Lambda authorizer function resource (Req 21.1, 21.6). */
  public readonly authorizerFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    // --- Cognito user pool (Req 21.1) ----------------------------------------
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "udn-navigator",
      selfSignUpEnabled: false, // interactive roles are provisioned, not self-registered
      signInAliases: { email: true, username: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.PLUS,
      standardThreatProtectionMode:
        cognito.StandardThreatProtectionMode.FULL_FUNCTION,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      removalPolicy: RemovalPolicy.DESTROY, // demonstration environment
    });

    // --- One group per role (Req 21.2) ---------------------------------------
    // Group names are the canonical UserRole values from @udn/domain so the
    // authorizer and the RBAC matrix share a single source of truth.
    this.roleGroups = USER_ROLES.map(
      (role, index) =>
        new cognito.CfnUserPoolGroup(this, `RoleGroup${role}`, {
          userPoolId: this.userPool.userPoolId,
          groupName: role,
          description: `Role group for ${role}`,
          precedence: index + 1,
        }),
    );

    // --- App client ----------------------------------------------------------
    // Public SPA client (no secret). Short access/id token lifetimes bound the
    // window a leaked token is usable; the Lambda authorizer additionally
    // enforces the 15-minute inactivity timeout (Req 21.6).
    this.userPoolClient = this.userPool.addClient("WebClient", {
      userPoolClientName: "udn-web",
      generateSecret: false,
      authFlows: {
        userSrp: true,
        custom: false,
        userPassword: false,
        adminUserPassword: false,
      },
      accessTokenValidity: Duration.minutes(15),
      idTokenValidity: Duration.minutes(15),
      refreshTokenValidity: Duration.hours(8),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });

    // --- Lambda authorizer (Req 21.1, 21.6) ----------------------------------
    this.authorizerFunction = new lambda.Function(this, "AuthorizerFunction", {
      functionName: "udn-authorizer",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline(PLACEHOLDER_AUTHORIZER_CODE),
      timeout: Duration.seconds(10),
      memorySize: 256,
      description:
        "Validates Cognito JWTs, enforces the 15-minute inactivity timeout, and injects caller identity/roles (Req 21.1, 21.6)",
      environment: {
        USER_POOL_ID: this.userPool.userPoolId,
        CLIENT_ID: this.userPoolClient.userPoolClientId,
        TOKEN_USE: "access",
        SESSION_INACTIVITY_TIMEOUT_SECONDS: String(
          SESSION_INACTIVITY_TIMEOUT_SECONDS,
        ),
      },
    });

    // Foundation is accepted for app composition; the stateless authorizer
    // needs no foundation grants at this stage (see AuthStackProps).
    void props.foundation;

    // --- Outputs for cross-stack consumption ---------------------------------
    new CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      description: "Cognito user pool id",
    });
    new CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      description: "Cognito app client id",
    });
    new CfnOutput(this, "AuthorizerFunctionArn", {
      value: this.authorizerFunction.functionArn,
      description: "Lambda authorizer function ARN",
    });
  }
}
