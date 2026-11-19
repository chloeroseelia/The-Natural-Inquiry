import { CfnOutput, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  AllowedMethods, CachePolicy, Distribution, HttpVersion, PriceClass, ResponseHeadersPolicy,
  SecurityPolicyProtocol, ViewerProtocolPolicy
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from "aws-cdk-lib/aws-s3";

// Separate from the private admin-media bucket. Nothing here is ever public except through
// CloudFront (origin access control); the bucket itself blocks all public access and listing.
export function createPublicContent(stack: Stack) {
  const bucket = new Bucket(stack, "PublicContentBucket", {
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    encryption: BucketEncryption.S3_MANAGED,
    objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
    versioned: true,
    removalPolicy: RemovalPolicy.RETAIN,
    lifecycleRules: [{
      noncurrentVersionExpiration: Duration.days(90),
      abortIncompleteMultipartUploadAfter: Duration.days(7)
    }]
  });

  const distribution = new Distribution(stack, "PublicContentDistribution", {
    comment: "The Natural Inquiry public content (read-only, sanitized manifest)",
    defaultBehavior: {
      origin: S3BucketOrigin.withOriginAccessControl(bucket),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
      // The public build fetches the manifest right after a publish; it must never see a stale copy.
      cachePolicy: CachePolicy.CACHING_DISABLED,
      responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS
    },
    minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
    httpVersion: HttpVersion.HTTP2_AND_3,
    priceClass: PriceClass.PRICE_CLASS_100
  });

  new CfnOutput(stack, "PublicContentDomain", { value: distribution.distributionDomainName });
  new CfnOutput(stack, "PublicContentBucketName", { value: bucket.bucketName });
  return { bucket, distribution };
}
