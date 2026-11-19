export const MANIFEST_KEY: string;
export const ADMIN_GROUP: string;
export const MAX_MANIFEST_BYTES: number;

export class PublishError extends Error {}

export type SourceRecords = {
  publications: Record<string, unknown>[];
  researchProjects: Record<string, unknown>[];
  profileContent: Record<string, unknown>[];
};

export type ManifestStore = {
  getManifest(): Promise<{ body: string; etag: string | null } | null>;
  putManifest(input: { body: string; etag: string | null }): Promise<void>;
};

export type SiteUpdateResult = { status: string; reason?: string };

export function isAdministrator(identity: unknown): boolean;
export function isDryRun(value: unknown): boolean;
export function diffManifests(previous: unknown, next: unknown): Record<string, unknown>;
export function runPublish(options: {
  identity: unknown;
  dryRun: unknown;
  reviewDigest?: string | null;
  loadRecords: () => Promise<SourceRecords>;
  store: ManifestStore;
  dispatchSiteUpdate: (input: { manifestSha256: string; generatedAt: string }) => Promise<SiteUpdateResult>;
  now?: () => Date;
}): Promise<Record<string, unknown>>;
