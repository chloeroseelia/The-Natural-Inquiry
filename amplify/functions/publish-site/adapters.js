/*
 * Thin AWS adapters. Clients are injected so tests can verify the exact requests without AWS.
 * The S3 store can only ever touch the single manifest key.
 * The GitHub dispatcher can only ever start one fixed workflow in one fixed repository.
 */
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { GetParameterCommand } from "@aws-sdk/client-ssm";
import { MANIFEST_KEY } from "./publish-core.js";

export function createS3ManifestStore({ client, bucket }) {
  if (!bucket) throw new Error("Public content bucket is not configured.");
  return {
    async getManifest() {
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: MANIFEST_KEY,
        MaxKeys: 1
      }));
      if (!listed.Contents?.some((item) => item.Key === MANIFEST_KEY)) return null;
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: MANIFEST_KEY }));
        return { body: await response.Body.transformToString("utf-8"), etag: response.ETag ?? null };
      } catch (error) {
        if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async putManifest({ body, etag }) {
      const conditional = etag ? { IfMatch: etag } : { IfNoneMatch: "*" };
      try {
        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: MANIFEST_KEY,
          Body: body,
          ContentType: "application/json; charset=utf-8",
          CacheControl: "no-store",
          ...conditional
        }));
      } catch (error) {
        if (["PreconditionFailed", "ConditionalRequestConflict"].includes(error?.name)
          || [409, 412].includes(error?.$metadata?.httpStatusCode)) {
          const conflict = new Error("conflict");
          conflict.code = "CONFLICT";
          throw conflict;
        }
        throw error;
      }
    }
  };
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const WORKFLOW = /^[A-Za-z0-9._-]{1,100}\.ya?ml$/;
const REF = /^[A-Za-z0-9._-]{1,100}$/;
// GitHub fine-grained tokens (github_pat_...) and classic tokens (ghp_...) use only these characters.
const TOKEN = /^[A-Za-z0-9_]{20,255}$/;

export function validateDispatchTarget(target) {
  if (!target || typeof target !== "object") return null;
  const { owner, repo, workflow, ref } = target;
  if (!OWNER.test(owner ?? "") || !REPO.test(repo ?? "") || !WORKFLOW.test(workflow ?? "") || !REF.test(ref ?? "")) return null;
  if (repo === "." || repo === ".." || ref.startsWith(".") || ref.endsWith(".")) return null;
  return { owner, repo, workflow, ref };
}

export function validateGithubToken(value) {
  return typeof value === "string" && TOKEN.test(value.trim()) ? value.trim() : null;
}

/*
 * Starts the fixed GitHub Actions workflow with a workflow_dispatch event. The only data sent is
 * the manifest's SHA-256 and timestamp: the workflow downloads the manifest itself and verifies
 * the hash. The token is read at call time from a SecureString SSM parameter (never an
 * environment variable, never logged, never included in any result). A missing parameter just
 * means site updates are not configured yet.
 */
export function createGithubDispatcher({ ssmClient, parameterName, target, fetchImpl = globalThis.fetch }) {
  return async function dispatchSiteUpdate({ manifestSha256, generatedAt }) {
    const fixed = validateDispatchTarget(target);
    if (!parameterName || !fixed) return { status: "not-configured", reason: "The GitHub workflow target or token parameter is not configured." };
    if (!/^[0-9a-f]{64}$/.test(manifestSha256 ?? "") || typeof generatedAt !== "string" || generatedAt.length > 40) {
      return { status: "failed", reason: "The site update request was malformed and was not sent." };
    }

    let token;
    try {
      const response = await ssmClient.send(new GetParameterCommand({ Name: parameterName, WithDecryption: true }));
      token = validateGithubToken(response.Parameter?.Value);
    } catch (error) {
      if (error?.name === "ParameterNotFound") {
        return { status: "not-configured", reason: "The GitHub dispatch token has not been set up yet." };
      }
      throw error;
    }
    if (!token) return { status: "not-configured", reason: "The stored GitHub token is not in a recognized format." };

    const url = `https://api.github.com/repos/${encodeURIComponent(fixed.owner)}/${encodeURIComponent(fixed.repo)}/actions/workflows/${encodeURIComponent(fixed.workflow)}/dispatches`;
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "natural-inquiry-publisher",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({ ref: fixed.ref, inputs: { manifest_sha256: manifestSha256, manifest_generated_at: generatedAt } })
    });
    // GitHub answers a successful dispatch with 204 No Content.
    return response.status === 204
      ? { status: "dispatched" }
      : { status: "failed", reason: `GitHub rejected the workflow request (HTTP ${response.status}).` };
  };
}
