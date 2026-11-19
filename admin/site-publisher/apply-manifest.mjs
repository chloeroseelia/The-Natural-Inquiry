/*
 * Applies a sanitized published manifest to a checkout of the public site (used by the GitHub
 * Actions workflow). It never touches AWS or the network.
 *
 * Safety rules:
 *   - the manifest bytes can be checked against an expected SHA-256 before anything is parsed
 *   - only writing/<slug>.html, research/<slug>.html and the published-entries data file are written
 *   - existing pages without the generator marker (hand-written pages) are never overwritten
 *   - a page is deleted only if it carries the generator marker and is no longer in the manifest
 *   - nothing is deleted outside writing/ and research/, symlinks are never followed or removed
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { GENERATED_MARKER, PUBLISHED_DATA_PATH, generateSite } from "./generate.js";

export const GENERATED_DIRECTORIES = ["writing", "research"];
const SHA256 = /^[0-9a-f]{64}$/;

function isWithin(root, target) {
  const path = relative(root, target);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function isAllowedOutput(path) {
  return path === PUBLISHED_DATA_PATH || GENERATED_DIRECTORIES.some((directory) => new RegExp(`^${directory}/[^/\\\\]+\\.html$`).test(path));
}

function assertRealDirectory(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing to use ${label}: expected a real directory.`);
}

function assertSiteLayout(root) {
  assertRealDirectory(root, "site root");
  for (const directory of GENERATED_DIRECTORIES) {
    const path = join(root, directory);
    if (!existsSync(path)) throw new Error(`Refusing to use ${directory}/: expected a real directory.`);
    assertRealDirectory(path, `${directory}/`);
  }
}

function readIfRegularFile(path) {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing to touch a non-regular file: ${path}`);
  return readFileSync(path, "utf8");
}

export function findGeneratedPages(siteRoot) {
  const found = [];
  for (const directory of GENERATED_DIRECTORIES) {
    const folder = join(siteRoot, directory);
    if (!existsSync(folder)) throw new Error(`Refusing to inspect ${directory}/: expected a real directory.`);
    assertRealDirectory(folder, `${directory}/`);
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.name.endsWith(".html")) continue;
      const path = `${directory}/${entry.name}`;
      const target = join(siteRoot, path);
      if (entry.isSymbolicLink()) throw new Error(`Refusing to inspect symlinked generated-page candidate: ${path}`);
      if (!entry.isFile()) continue;
      if (readFileSync(target, "utf8").includes(GENERATED_MARKER)) found.push(path);
    }
  }
  return found.sort();
}

export async function applyManifest({ manifestPath, siteRoot, expectedSha256, dryRun = false, artifactDir = null, baseSha = null }) {
  const root = resolve(siteRoot);
  assertSiteLayout(root);
  if (!SHA256.test(expectedSha256 ?? "")) throw new Error("A valid expected manifest SHA-256 is required. Nothing was changed.");
  const bytes = await readFile(manifestPath);
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (expectedSha256 !== actualSha256) throw new Error("The downloaded manifest does not match the published hash. Nothing was changed.");

  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("The manifest is not valid JSON. Nothing was changed.");
  }

  const readExisting = (path) => {
    const target = resolve(root, path);
    if (!isWithin(root, target)) throw new Error(`Path escapes the site root: ${path}`);
    return readIfRegularFile(target);
  };
  const { files, report } = generateSite(manifest, { readExisting });

  for (const file of files) {
    if (!isAllowedOutput(file.path)) throw new Error(`Refusing to write an unexpected path: ${file.path}`);
  }

  const keep = new Set(files.map((file) => file.path));
  const stale = findGeneratedPages(root).filter((path) => !keep.has(path));

  const result = { manifestSha256: actualSha256, dryRun, written: [], unchanged: [], deleted: [], protectedPages: report.skipped, counts: report.counts };
  const artifactRoot = artifactDir == null ? null : resolve(artifactDir);
  if (artifactRoot && (artifactRoot === root || isWithin(root, artifactRoot) || isWithin(artifactRoot, root))) {
    throw new Error("The output artifact directory must be outside and separate from the site root.");
  }
  if (artifactRoot && (!/^[0-9a-f]{40}$/.test(baseSha ?? "") || existsSync(artifactRoot))) {
    throw new Error("A valid base commit SHA and a new output artifact directory are required.");
  }

  const outputs = [];
  for (const file of files) {
    const target = resolve(root, file.path);
    if (!isWithin(root, target)) throw new Error(`Refusing to write outside the site root: ${file.path}`);
    const current = readIfRegularFile(target);
    if (current === file.content) {
      result.unchanged.push(file.path);
      continue;
    }
    result.written.push(file.path);
    outputs.push({ path: file.path, content: file.content });
    if (!dryRun) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
  }
  for (const path of stale) {
    result.deleted.push(path);
    if (!dryRun) await unlink(resolve(root, path));
  }

  if (artifactRoot) {
    await mkdir(artifactRoot);
    await mkdir(resolve(artifactRoot, "files"));
    for (const file of outputs) {
      const target = resolve(artifactRoot, "files", file.path);
      if (!isWithin(artifactRoot, target)) throw new Error(`Refusing to write outside the output artifact: ${file.path}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
    await writeFile(resolve(artifactRoot, "changes.json"), JSON.stringify({
      version: 1,
      baseSha,
      manifestSha256: actualSha256,
      written: result.written,
      deleted: result.deleted
    }), "utf8");
  }
  return result;
}

if (process.argv[1]?.endsWith("apply-manifest.mjs")) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (key === "--dry-run") args.set(key, true);
    else args.set(key, process.argv[++index]);
  }
  const manifestPath = args.get("--manifest");
  const siteRoot = args.get("--site-root");
  const expectedSha256 = args.get("--expect-sha256");
  const artifactDir = args.get("--artifact-dir") ?? null;
  const baseSha = args.get("--base-sha") ?? null;
  if (!manifestPath || !siteRoot || !expectedSha256 || !SHA256.test(expectedSha256)) {
    console.error("Usage: node apply-manifest.mjs --manifest <file> --site-root <dir> --expect-sha256 <hex> [--artifact-dir <dir> --base-sha <commit>] [--dry-run]");
    process.exit(2);
  }
  try {
    const result = await applyManifest({
      manifestPath, siteRoot, expectedSha256, artifactDir, baseSha, dryRun: args.get("--dry-run") === true
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
