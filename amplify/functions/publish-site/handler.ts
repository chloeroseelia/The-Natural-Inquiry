import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { S3Client } from "@aws-sdk/client-s3";
import { SSMClient } from "@aws-sdk/client-ssm";
import type { Schema } from "../../data/resource.js";
import { PublishError, runPublish } from "./publish-core.js";
import type { SourceRecords } from "./publish-core.js";
import { createGithubDispatcher, createS3ManifestStore } from "./adapters.js";

// Only the fields the public manifest allowlists are ever requested from the database.
// projectNote, sourceDocumentName, mediaKeys, revision and the imported* timestamps are never loaded.
const PUBLICATION_FIELDS = [
  "id", "title", "subtitle", "category", "summary", "content", "contentFormat", "status", "archived",
  "indexCategories", "references", "publicPath", "publishedAt"
] as const;
const RESEARCH_FIELDS = [
  "id", "title", "summary", "overview", "overviewTitle", "content", "projectStage", "status",
  "indexCategories", "publicPath", "publishedAt"
] as const;
const PROFILE_FIELDS = [
  "id", "sectionKey", "title", "summary", "content", "sortOrder", "status", "publishedAt"
] as const;

const MAX_PAGES = 200;

type Page = { data: unknown[]; errors?: unknown[]; nextToken?: string | null };

// Any error or an unfinished listing aborts the whole publish: a partial read would unpublish content.
async function listAll(fetchPage: (nextToken?: string | null) => Promise<Page>): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let nextToken: string | null | undefined;
  for (let pages = 0; ; pages += 1) {
    if (pages >= MAX_PAGES) throw new Error("too many pages");
    const page = await fetchPage(nextToken);
    if (page.errors?.length) throw new Error("data read failed");
    items.push(...(page.data as Record<string, unknown>[]));
    nextToken = page.nextToken;
    if (!nextToken) return items;
  }
}

let dataClient: ReturnType<typeof generateClient<Schema>> | undefined;

async function getDataClient() {
  if (!dataClient) {
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as never);
    Amplify.configure(resourceConfig, libraryOptions);
    dataClient = generateClient<Schema>({ authMode: "iam" });
  }
  return dataClient;
}

async function loadRecords(): Promise<SourceRecords> {
  const client = await getDataClient();
  const [publications, researchProjects, profileContent] = await Promise.all([
    listAll((nextToken) => client.models.Publication.list({ selectionSet: [...PUBLICATION_FIELDS], limit: 500, nextToken }) as Promise<Page>),
    listAll((nextToken) => client.models.ResearchProject.list({ selectionSet: [...RESEARCH_FIELDS], limit: 500, nextToken }) as Promise<Page>),
    listAll((nextToken) => client.models.ProfileContent.list({ selectionSet: [...PROFILE_FIELDS], limit: 500, nextToken }) as Promise<Page>)
  ]);
  return { publications, researchProjects, profileContent };
}

export const handler: Schema["publishSite"]["functionHandler"] = async (event) => {
  try {
    const result = await runPublish({
      identity: event.identity,
      dryRun: event.arguments.dryRun,
      reviewDigest: event.arguments.reviewDigest,
      loadRecords,
      store: createS3ManifestStore({ client: new S3Client({}), bucket: process.env.PUBLIC_CONTENT_BUCKET }),
      dispatchSiteUpdate: createGithubDispatcher({
        ssmClient: new SSMClient({}),
        parameterName: process.env.GITHUB_TOKEN_PARAMETER,
        target: {
          owner: process.env.GITHUB_OWNER,
          repo: process.env.GITHUB_REPO,
          workflow: process.env.GITHUB_WORKFLOW_FILE,
          ref: process.env.GITHUB_WORKFLOW_REF
        }
      })
    });
    // Counts only. Record contents, ids and the GitHub token are never logged.
    console.log(JSON.stringify({ event: "publish-site", dryRun: result.dryRun, wrote: result.wrote, counts: result.counts }));
    return JSON.stringify(result);
  } catch (error) {
    if (error instanceof PublishError) {
      console.warn(JSON.stringify({ event: "publish-site", refused: error.message }));
      throw error;
    }
    console.error(JSON.stringify({ event: "publish-site", failure: error instanceof Error ? error.name : "unknown" }));
    throw new Error("Publishing failed. Nothing was published.");
  }
};
