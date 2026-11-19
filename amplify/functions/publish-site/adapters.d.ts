import type { ManifestStore, SiteUpdateResult } from "./publish-core.js";

export type DispatchTarget = { owner: string; repo: string; workflow: string; ref: string };

export function createS3ManifestStore(options: {
  client: { send(command: unknown): Promise<any> };
  bucket: string | undefined;
}): ManifestStore;

export function validateDispatchTarget(target: unknown): DispatchTarget | null;
export function validateGithubToken(value: unknown): string | null;

export function createGithubDispatcher(options: {
  ssmClient: { send(command: unknown): Promise<any> };
  parameterName: string | undefined;
  target: Partial<DispatchTarget> | undefined;
  fetchImpl?: typeof fetch;
}): (input: { manifestSha256: string; generatedAt: string }) => Promise<SiteUpdateResult>;
