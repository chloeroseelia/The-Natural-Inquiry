/*
 * Publishing core. Pure decision logic with every side effect injected, so it can be tested
 * without AWS. It reuses the Phase 1 manifest contract, allowlists, sanitization and
 * generator unchanged.
 *
 * Order of operations for every call:
 *   1. authorize (Administrators only)
 *   2. read ALL current records server-side (any read problem aborts everything)
 *   3. build + validate the sanitized manifest, and prove it generates a site
 *   4. diff against the manifest that is currently public
 *   5. dry run: stop here. Real run: conditionally write changed content, then dispatch the
 *      GitHub Actions workflow; unchanged content retries using the stored manifest's hash.
 */
import { createHash } from "node:crypto";
import { buildManifest, validateManifest } from "../../../admin/site-publisher/manifest.js";
import { generateSite } from "../../../admin/site-publisher/generate.js";

export const MANIFEST_KEY = "published/manifest.json";
export const ADMIN_GROUP = "Administrators";
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export class PublishError extends Error {
  constructor(message) {
    super(message);
    this.name = "PublishError";
  }
}

export function isAdministrator(identity) {
  if (!identity || typeof identity !== "object") return false;
  const claimGroups = identity.claims && typeof identity.claims === "object" ? identity.claims["cognito:groups"] : undefined;
  const groups = Array.isArray(identity.groups) ? identity.groups : Array.isArray(claimGroups) ? claimGroups : [];
  return groups.includes(ADMIN_GROUP);
}

// Only an explicit `false` performs a real publish. Missing, null or any other value is a dry run.
export function isDryRun(value) {
  return value !== false;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sortedByContent(items) {
  return [...items].sort((a, b) => {
    const first = stableStringify(a);
    const second = stableStringify(b);
    return first < second ? -1 : first > second ? 1 : 0;
  });
}

const SECTIONS = ["publications", "research", "profile"];

export function diffManifests(previous, next) {
  const changes = { firstPublish: !previous, added: [], removed: [], changed: [], unchanged: 0 };
  const describe = (section, item) => ({ section, id: item.id, title: item.title, publicPath: item.publicPath ?? null });
  for (const section of SECTIONS) {
    const before = new Map((previous?.[section] || []).map((item) => [item.id, item]));
    const after = new Map((next[section] || []).map((item) => [item.id, item]));
    for (const [id, item] of after) {
      if (!before.has(id)) changes.added.push(describe(section, item));
      else if (stableStringify(before.get(id)) !== stableStringify(item)) changes.changed.push(describe(section, item));
      else changes.unchanged += 1;
    }
    for (const [id, item] of before) if (!after.has(id)) changes.removed.push(describe(section, item));
  }
  changes.total = changes.added.length + changes.removed.length + changes.changed.length;
  return changes;
}

function parsePrevious(body) {
  if (body == null) return { manifest: null, warning: null };
  try {
    const manifest = JSON.parse(body);
    const check = validateManifest(manifest);
    if (check.ok) return { manifest, warning: null };
  } catch {
    // fall through
  }
  return { manifest: null, warning: "The currently published manifest was unreadable and was treated as empty." };
}

function countRecords(records) {
  return ["publications", "researchProjects", "profileContent"].reduce((sum, key) => sum + records[key].length, 0);
}

export async function runPublish({ identity, dryRun, reviewDigest, loadRecords, store, dispatchSiteUpdate, now = () => new Date() }) {
  if (!isAdministrator(identity)) throw new PublishError("Not authorized.");
  const dry = isDryRun(dryRun);
  if (!dry && (typeof reviewDigest !== "string" || !/^[0-9a-f]{64}$/.test(reviewDigest))) {
    throw new PublishError("A valid review is required before publishing. Nothing was changed.");
  }

  let records;
  try {
    records = await loadRecords();
  } catch {
    throw new PublishError("Could not read the current records, so nothing was published.");
  }
  for (const key of ["publications", "researchProjects", "profileContent"]) {
    if (!records || !Array.isArray(records[key])) throw new PublishError("Could not read the current records, so nothing was published.");
  }

  const { manifest, excluded, notes } = buildManifest(records, { generatedAt: now().toISOString() });
  const validation = validateManifest(manifest);
  if (!validation.ok) throw new PublishError("The generated manifest failed validation, so nothing was published.");
  let site;
  try {
    site = generateSite(manifest);
  } catch {
    throw new PublishError("The generated manifest could not produce a site, so nothing was published.");
  }

  const body = JSON.stringify(manifest);
  if (Buffer.byteLength(body, "utf8") > MAX_MANIFEST_BYTES) {
    throw new PublishError("The generated manifest is too large to publish.");
  }

  let current;
  try {
    current = await store.getManifest();
  } catch {
    throw new PublishError("Could not read the currently published manifest, so nothing was published.");
  }
  if (current && (typeof current.body !== "string" || typeof current.etag !== "string" || !current.etag)) {
    throw new PublishError("Could not verify the current manifest version. Nothing was changed.");
  }
  const previous = parsePrevious(current?.body ?? null);
  const warnings = previous.warning ? [previous.warning] : [];

  // A read that returned nothing at all, while content is public, looks like a read failure. Refuse rather than unpublish everything.
  if (countRecords(records) === 0 && previous.manifest && SECTIONS.some((section) => previous.manifest[section].length)) {
    throw new PublishError("No records were returned while content is currently published. Refusing to unpublish everything; check the data source.");
  }

  const changes = diffManifests(previous.manifest, manifest);
  const { generatedAt: _generatedAt, ...reviewedContent } = manifest;
  const calculatedReviewDigest = sha256(stableStringify({
    version: 1,
    content: reviewedContent,
    currentManifestSha256: current ? sha256(current.body) : null,
    excluded: sortedByContent(excluded),
    notes: sortedByContent(notes),
    warnings: sortedByContent(warnings)
  }));
  const summary = {
    dryRun: dry,
    wrote: false,
    key: MANIFEST_KEY,
    counts: {
      publications: manifest.publications.length,
      research: manifest.research.length,
      profile: manifest.profile.length,
      excluded: excluded.length,
      pagesToGenerate: site.report.included.length
    },
    pages: site.report.included.map((page) => page.path),
    changes,
    excluded,
    notes,
    warnings,
    manifestSha256: sha256(body),
    reviewDigest: calculatedReviewDigest,
    siteUpdate: { status: "not-attempted", reason: dry ? "dry run" : "not yet dispatched" }
  };

  if (dry) return { ...summary, manifest };
  if (reviewDigest !== calculatedReviewDigest) {
    throw new PublishError("Content or the public manifest changed since review. Review again; nothing was changed.");
  }
  let dispatchTime = manifest.generatedAt;
  if (current && previous.manifest && changes.total === 0) {
    summary.manifestSha256 = sha256(current.body);
    dispatchTime = previous.manifest.generatedAt;
  } else {
    try {
      await store.putManifest({ body, etag: current?.etag ?? null });
    } catch (error) {
      if (error?.code === "CONFLICT") throw new PublishError("The public manifest changed while publishing. Nothing was written; please try again.");
      throw new PublishError("Writing the public manifest failed. Nothing was changed.");
    }
    summary.wrote = true;
  }

  try {
    summary.siteUpdate = await dispatchSiteUpdate({ manifestSha256: summary.manifestSha256, generatedAt: dispatchTime });
  } catch {
    summary.siteUpdate = { status: "failed", reason: "The site update request failed; the existing manifest can be retried or the workflow run manually from GitHub Actions." };
  }
  return summary;
}
