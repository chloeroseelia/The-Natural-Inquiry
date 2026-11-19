import { defineBackend } from "@aws-amplify/backend";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";
import { storage } from "./storage/resource.js";
import { publishSite } from "./functions/publish-site/resource.js";
import { createPublicContent } from "./public-content/resource.js";

const GITHUB_TOKEN_PARAMETER = "/natural-inquiry/github-dispatch-token";

const backend = defineBackend({
  auth,
  data,
  storage,
  publishSite
});

backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true
};

const { bucket } = createPublicContent(backend.createStack("PublicContent"));
const publishFunction = backend.publishSite.resources.lambda;
const manifestArn = bucket.arnForObjects("published/manifest.json");

backend.publishSite.addEnvironment("PUBLIC_CONTENT_BUCKET", bucket.bucketName);
backend.publishSite.addEnvironment("GITHUB_TOKEN_PARAMETER", GITHUB_TOKEN_PARAMETER);
// Fixed, non-secret target: the public GitHub Pages repository and its dedicated workflow file.
backend.publishSite.addEnvironment("GITHUB_OWNER", "chloeroseelia");
backend.publishSite.addEnvironment("GITHUB_REPO", "The-Natural-Inquiry");
backend.publishSite.addEnvironment("GITHUB_WORKFLOW_FILE", "publish-content.yml");
backend.publishSite.addEnvironment("GITHUB_WORKFLOW_REF", "main");

// Least privilege: one object key, no delete, no ACLs, no bucket-wide access.
publishFunction.addToRolePolicy(new PolicyStatement({
  actions: ["s3:GetObject", "s3:PutObject"],
  resources: [manifestArn]
}));
// Lets a missing manifest return "not found" instead of "access denied"; limited to that one key.
publishFunction.addToRolePolicy(new PolicyStatement({
  actions: ["s3:ListBucket"],
  resources: [bucket.bucketArn],
  conditions: { StringEquals: { "s3:prefix": "published/manifest.json" } }
}));
// Reads exactly one SecureString parameter that holds the fine-grained GitHub token.
publishFunction.addToRolePolicy(new PolicyStatement({
  actions: ["ssm:GetParameter"],
  resources: [backend.stack.formatArn({
    service: "ssm",
    resource: "parameter",
    resourceName: GITHUB_TOKEN_PARAMETER.slice(1)
  })]
}));
