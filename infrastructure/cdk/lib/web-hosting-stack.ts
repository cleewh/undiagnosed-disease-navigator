import {
  Stack,
  type StackProps,
  RemovalPolicy,
  CfnOutput,
  Duration,
  aws_s3 as s3,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_s3_deployment as s3deploy,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

/**
 * Properties for {@link WebHostingStack}.
 */
export interface WebHostingStackProps extends StackProps {
  /**
   * Absolute path to the built SPA (the Vite `build/` output for apps/web).
   * The directory must exist at synth time; run `vite build` first.
   */
  readonly webBuildPath: string;
}

/**
 * Static hosting for the React single-page application (apps/web).
 *
 * Serves the pre-built SPA from a private, encrypted S3 bucket fronted by a
 * CloudFront distribution (private bucket via OAC, HTTPS redirect, SPA error
 * routing, cache invalidation on deploy). The distribution is public and serves
 * synthetic demonstration data only. The AI copilot backend is a separate stack
 * (CopilotStack) reached cross-origin. Everything is removable via `cdk destroy`.
 */
export class WebHostingStack extends Stack {
  public readonly siteBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebHostingStackProps) {
    super(scope, id, props);

    this.siteBucket = new s3.Bucket(this, "SiteBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "UDN Navigator web portal (synthetic demo SPA)",
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      // SPA client-side routing: serve index.html for unknown paths.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) },
      ],
    });

    new s3deploy.BucketDeployment(this, "DeploySite", {
      sources: [s3deploy.Source.asset(props.webBuildPath)],
      destinationBucket: this.siteBucket,
      distribution: this.distribution,
      distributionPaths: ["/*"],
    });

    new CfnOutput(this, "PortalUrl", {
      value: `https://${this.distribution.distributionDomainName}`,
      description: "Public HTTPS URL of the UDN Navigator web portal",
    });
    new CfnOutput(this, "DistributionId", {
      value: this.distribution.distributionId,
      description: "CloudFront distribution id",
    });
  }
}
