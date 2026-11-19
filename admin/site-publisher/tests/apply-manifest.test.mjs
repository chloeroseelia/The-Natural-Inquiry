// Synthetic tests for apply-manifest.mjs and the GitHub workflow template.
// Uses temporary directories and fake records only: no AWS, no network, no real site files.
// Run from admin/site-publisher: node tests/apply-manifest.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyManifest, findGeneratedPages } from "../apply-manifest.mjs";
import { GENERATED_MARKER, PUBLISHED_DATA_PATH, generateSite } from "../generate.js";
import { buildManifest } from "../manifest.js";

let n = 0;
const pass = (name) => console.log(`${++n} ${name}: ok`);
const here = dirname(fileURLToPath(import.meta.url));
const temps = [];

const ID = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const publication = (suffix, overrides = {}) => ({
  id: ID(suffix), title: `Essay ${suffix}`, subtitle: "A synthetic essay", category: "Essay", content: "<p>Body <strong>text</strong></p>",
  contentFormat: "RICH_TEXT", status: "PUBLISHED", archived: false, indexCategories: null, references: null,
  publicPath: `writing/essay-${suffix}.html`, publishedAt: "2026-10-01T00:00:00.000Z", ...overrides
});
const research = (suffix, overrides = {}) => ({
  id: ID(suffix), title: `Project ${suffix}`, summary: "A synthetic project", overview: "Overview", content: "<p>Project body</p>",
  projectStage: "IN_PROGRESS", status: "PUBLISHED", indexCategories: null, publicPath: `research/project-${suffix}.html`,
  publishedAt: "2026-10-02T00:00:00.000Z", ...overrides
});
const manifestFor = (records) => buildManifest({ publications: [], researchProjects: [], profileContent: [], ...records }, { generatedAt: "2026-11-05T12:00:00.000Z" }).manifest;

async function put(root, path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}
async function manifestFile(root, manifest) {
  const path = join(root, "..", `manifest-${Math.random().toString(16).slice(2)}.json`);
  await writeFile(path, JSON.stringify(manifest), "utf8");
  return path;
}
async function applyValid(options) {
  const expectedSha256 = createHash("sha256").update(readFileSync(options.manifestPath)).digest("hex");
  return applyManifest({ ...options, expectedSha256 });
}

const HAND_WRITTEN = {
  "index.html": "<html><body>Home page</body></html>",
  "styles.css": "body { color: #333; }",
  "script.js": "console.log('site');",
  "interests.html": "<html>interests</html>",
  "images/photo.png": "PNGDATA",
  "writing/seaweed-made-simple.html": "<html>hand-written seaweed page</html>",
  "writing/chinook-salmon.html": "<html>hand-written salmon page</html>",
  "research/hand-written-project.html": "<html>hand-written research page</html>",
  "natural-inquiry-index.html": "<html>subject index</html>",
  [PUBLISHED_DATA_PATH]: "window.NaturalInquiryPublishedEntries = [];\n"
};

async function makeSite() {
  const root = mkdtempSync(join(tmpdir(), "ni-site-"));
  temps.push(root);
  for (const [path, content] of Object.entries(HAND_WRITTEN)) await put(root, path, content);
  return root;
}
function snapshot(root) {
  const out = {};
  (function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else out[path.slice(root.length + 1).replaceAll("\\", "/")] = readFileSync(path, "utf8");
    }
  })(root);
  return out;
}
const handWrittenIntact = (root) => {
  const now = snapshot(root);
  for (const [path, content] of Object.entries(HAND_WRITTEN)) {
    if (path !== PUBLISHED_DATA_PATH) assert.equal(now[path], content, `${path} must be untouched`);
  }
};

try {
  // 1. Generates pages and the index data; hand-written files are untouched
  {
    const root = await makeSite();
    const manifest = manifestFor({ publications: [publication(1), publication(2)], researchProjects: [research(3)] });
    const result = await applyValid({ manifestPath: await manifestFile(root, manifest), siteRoot: root });
    assert.deepEqual(result.written.sort(), [PUBLISHED_DATA_PATH, "research/project-3.html", "writing/essay-1.html", "writing/essay-2.html"].sort());
    assert.deepEqual(result.deleted, []);
    const page = readFileSync(join(root, "writing/essay-1.html"), "utf8");
    assert.ok(page.includes(GENERATED_MARKER) && page.includes("Essay 1"));
    assert.ok(readFileSync(join(root, PUBLISHED_DATA_PATH), "utf8").includes("Essay 2"));
    handWrittenIntact(root);
    pass("pages and index data are generated while every hand-written file stays byte-identical");
  }

  // 2. Only expected paths change
  {
    const root = await makeSite();
    const before = snapshot(root);
    const manifest = manifestFor({ publications: [publication(1)], researchProjects: [research(3)] });
    await applyValid({ manifestPath: await manifestFile(root, manifest), siteRoot: root });
    const after = snapshot(root);
    const changed = Object.keys(after).filter((path) => before[path] !== after[path]).sort();
    assert.deepEqual(changed, [PUBLISHED_DATA_PATH, "research/project-3.html", "writing/essay-1.html"].sort());
    assert.deepEqual(Object.keys(before).filter((path) => !(path in after)), []);
    pass("a run changes only generated pages and the index data file");
  }

  // 3. Removed records disappear; hand-written pages never do
  {
    const root = await makeSite();
    const first = manifestFor({ publications: [publication(1), publication(2)], researchProjects: [research(3)] });
    await applyValid({ manifestPath: await manifestFile(root, first), siteRoot: root });
    assert.deepEqual(findGeneratedPages(root), ["research/project-3.html", "writing/essay-1.html", "writing/essay-2.html"]);

    const second = manifestFor({ publications: [publication(1)], researchProjects: [] });
    const result = await applyValid({ manifestPath: await manifestFile(root, second), siteRoot: root });
    assert.deepEqual(result.deleted.sort(), ["research/project-3.html", "writing/essay-2.html"]);
    assert.ok(existsSync(join(root, "writing/essay-1.html")));
    assert.ok(!existsSync(join(root, "writing/essay-2.html")));
    assert.ok(!existsSync(join(root, "research/project-3.html")));
    assert.ok(!readFileSync(join(root, PUBLISHED_DATA_PATH), "utf8").includes("Essay 2"));
    handWrittenIntact(root);

    const empty = manifestFor({});
    const emptied = await applyValid({ manifestPath: await manifestFile(root, empty), siteRoot: root });
    assert.deepEqual(emptied.deleted, ["writing/essay-1.html"]);
    assert.equal(readFileSync(join(root, PUBLISHED_DATA_PATH), "utf8").trim().endsWith("[];"), true);
    handWrittenIntact(root);
    pass("unpublished, archived or deleted pages are removed on the next run, hand-written pages never are");
  }

  // 4. A hand-written page at a manifest path is protected
  {
    const root = await makeSite();
    const manifest = manifestFor({ publications: [publication(9, { publicPath: "writing/seaweed-made-simple.html" }), publication(1)] });
    const result = await applyValid({ manifestPath: await manifestFile(root, manifest), siteRoot: root });
    assert.ok(result.protectedPages.some((item) => item.path === "writing/seaweed-made-simple.html"));
    assert.equal(snapshot(root)["writing/seaweed-made-simple.html"], HAND_WRITTEN["writing/seaweed-made-simple.html"]);
    assert.ok(result.written.includes("writing/essay-1.html"));
    pass("an existing hand-written page is never overwritten, even if a record points at its URL");
  }

  // 5. Marker files outside writing/ and research/ are never deleted; non-html and nested files are ignored
  {
    const root = await makeSite();
    await put(root, "images/fake.html", `${GENERATED_MARKER}<p>x</p>`);
    await put(root, "index-copy.html", `${GENERATED_MARKER}<p>x</p>`);
    await put(root, "writing/notes.txt", GENERATED_MARKER);
    await put(root, "writing/sub/nested.html", `${GENERATED_MARKER}<p>x</p>`);
    const before = snapshot(root);
    await applyValid({ manifestPath: await manifestFile(root, manifestFor({})), siteRoot: root });
    const after = snapshot(root);
    for (const path of ["images/fake.html", "index-copy.html", "writing/notes.txt", "writing/sub/nested.html"]) assert.equal(after[path], before[path], path);
    pass("cleanup is limited to marker-bearing .html files directly inside writing/ and research/");
  }

  // 6. Idempotent, and dry run changes nothing
  {
    const root = await makeSite();
    const path = await manifestFile(root, manifestFor({ publications: [publication(1)] }));
    const before = snapshot(root);
    const dry = await applyValid({ manifestPath: path, siteRoot: root, dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.ok(dry.written.length > 0);
    assert.deepEqual(snapshot(root), before, "dry run must not write");
    await applyValid({ manifestPath: path, siteRoot: root });
    const second = await applyValid({ manifestPath: path, siteRoot: root });
    assert.deepEqual([second.written, second.deleted], [[], []]);
    pass("a second run is a no-op (no empty commits) and a dry run writes nothing");
  }

  // 7. Hash verification
  {
    const root = await makeSite();
    const manifest = manifestFor({ publications: [publication(1)] });
    const path = await manifestFile(root, manifest);
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    const before = snapshot(root);
    for (const bad of ["0".repeat(64), "A".repeat(64), "short", hash.slice(1)]) {
      await assert.rejects(applyManifest({ manifestPath: path, siteRoot: root, expectedSha256: bad }));
    }
    assert.deepEqual(snapshot(root), before, "a hash mismatch must change nothing");
    const ok = await applyManifest({ manifestPath: path, siteRoot: root, expectedSha256: hash });
    assert.equal(ok.manifestSha256, hash);
    const afterValidApply = snapshot(root);
    await assert.rejects(applyManifest({ manifestPath: path, siteRoot: root, expectedSha256: "" }), /valid expected manifest SHA-256/);
    await assert.rejects(applyManifest({ manifestPath: path, siteRoot: root }), /valid expected manifest SHA-256/);
    assert.deepEqual(snapshot(root), afterValidApply);
    pass("missing, malformed or mismatched hashes are rejected before anything is written");
  }

  // 8. Invalid or hostile manifests change nothing
  {
    const root = await makeSite();
    const good = manifestFor({ publications: [publication(1)] });
    const hostile = [
      "not json",
      JSON.stringify({ schemaVersion: 1 }),
      JSON.stringify({ ...good, publications: [{ ...good.publications[0], publicPath: "../../index.html" }] }),
      JSON.stringify({ ...good, publications: [{ ...good.publications[0], publicPath: "index.html" }] }),
      JSON.stringify({ ...good, publications: [{ ...good.publications[0], publicPath: "writing/..%2f..%2findex.html" }] }),
      JSON.stringify({ ...good, extra: "<script>alert(1)</script>" })
    ];
    const before = snapshot(root);
    for (const [index, body] of hostile.entries()) {
      const path = join(root, "..", `hostile-${index}.json`);
      await writeFile(path, body, "utf8");
      const expectedSha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
      await assert.rejects(applyManifest({ manifestPath: path, siteRoot: root, expectedSha256 }), undefined, `hostile manifest ${index}`);
    }
    assert.deepEqual(snapshot(root), before);
    // Script content is stripped even if a hostile manifest were somehow accepted.
    const scripted = manifestFor({ publications: [publication(1, { content: "<p>ok</p><script>alert(1)</script><img src=x onerror=alert(1)>" })] });
    await applyValid({ manifestPath: await manifestFile(root, scripted), siteRoot: root });
    const html = readFileSync(join(root, "writing/essay-1.html"), "utf8");
    assert.ok(!/<script>alert|onerror/i.test(html));
    pass("invalid, traversing or hostile manifests are rejected without touching the site, and scripts are stripped");
  }

  // 9. Draft/archived/private data cannot reach the site via a manifest built by the Phase 1 rules
  {
    const root = await makeSite();
    const manifest = manifestFor({
      publications: [publication(1), publication(2, { status: "DRAFT" }), publication(3, { archived: true }), publication(4, { mediaKeys: "[\"admin-media/secret.png\"]", sourceDocumentName: "PRIVATE-DOC" })],
      researchProjects: [research(5, { projectNote: "PRIVATE-NOTE", revision: 12 })]
    });
    await applyValid({ manifestPath: await manifestFile(root, manifest), siteRoot: root });
    const all = JSON.stringify(snapshot(root));
    for (const needle of ["Essay 2", "Essay 3", "PRIVATE-NOTE", "PRIVATE-DOC", "admin-media", "revision"]) assert.ok(!all.includes(needle), needle);
    assert.ok(all.includes("Essay 1") && all.includes("Essay 4") && all.includes("Project 5"));
    pass("draft, archived and private data never reach the generated site");
  }

  // 10. Workflow template security properties
  {
    const text = readFileSync(join(here, "..", "github", "publish-content.yml"), "utf8");
    const lines = text.split(/\r?\n/);
    const code = lines.filter((line) => !line.trim().startsWith("#")).join("\n");
    const triggers = /^on:\n((?:[ ]{2,}.*\n)+)/m.exec(code)?.[1] ?? "";
    assert.ok(/^ {2}workflow_dispatch:/m.test(triggers));
    assert.deepEqual([...code.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]).filter((key) => ["push", "pull_request", "pull_request_target", "schedule", "workflow_run", "repository_dispatch", "workflow_dispatch"].includes(key)), ["workflow_dispatch"]);
    assert.ok(/^ {8}required: true$/m.test(code), "the manifest hash input is mandatory");
    assert.ok(/MANIFEST_SHA256.*\[0-9a-f\]\{64\}/.test(code), "hash format is checked");
    assert.ok(!/secrets\./.test(code), "no GitHub secrets are used");
    assert.ok(!/amplify\.yml|amplify_outputs/i.test(code), "no admin Amplify config is referenced");
    assert.ok(!/aws-actions|AWS_|AKIA|aws-access|configure-aws/i.test(code), "no AWS credentials in the workflow body");
    const generateJob = code.slice(code.indexOf("  generate:"), code.indexOf("  commit:"));
    const commitJob = code.slice(code.indexOf("  commit:"));
    assert.ok(/^    permissions:\n      contents: read$/m.test(generateJob), "generator has read-only contents access");
    assert.ok(!/contents: write|GITHUB_TOKEN|github\.token/.test(generateJob), "generator has no write token");
    assert.ok(/^    permissions:\n      contents: write$/m.test(commitJob), "only the minimal commit job has repository write");
    assert.ok(/github\.ref == 'refs\/heads\/main'/.test(code));
    assert.ok(/concurrency:\n {2}group: publish-content\n {2}cancel-in-progress: false/.test(code));
    for (const run of code.split(/\n {6}- /).filter((step) => /\brun: /.test(step))) {
      assert.ok(!/\$\{\{/.test(run.slice(run.indexOf("run:"))), "no expression interpolation inside shell scripts");
    }
    assert.ok(/--proto '=https'/.test(code) && /--max-filesize/.test(code));
    assert.ok(/--expect-sha256 "\$MANIFEST_SHA256"/.test(code));
    assert.ok(/--artifact-dir publish-artifact/.test(generateJob));
    assert.ok(/name: Upload generated output only/.test(generateJob));
    assert.ok(/name: Download generated output artifact/.test(commitJob));
    assert.ok(/git clone --quiet --branch main --single-branch https:\/\/github\.com\/chloeroseelia\/The-Natural-Inquiry\.git site/.test(commitJob));
    assert.ok(/name: Validate artifact, apply allowlisted files, and create commit/.test(commitJob));
    assert.ok(!/PUBLISHER_TOOLS_REF|admin\/site-publisher|node tools\//.test(commitJob), "commit job does not retrieve or execute generator code");
    assert.ok(/"add", "-A", "--", \.\.\.paths/.test(commitJob), "commit stages only validated artifact paths");
    assert.ok(/persist-credentials: false/.test(generateJob));
    const tokenRefs = [...code.matchAll(/\$\{\{\s*github\.token\s*\}\}/g)];
    assert.equal(tokenRefs.length, 1, "write token is exposed only once");
    const pushStep = commitJob.slice(commitJob.indexOf("- name: Push generated-content commit"));
    assert.ok(pushStep.includes("GH_TOKEN: ${{ github.token }}"));
    assert.ok(/credential\.helper=/.test(pushStep));
    assert.ok(!/git config .*credential|\.git\/config|GITHUB_TOKEN/.test(pushStep), "push credentials are not persisted");
    assert.ok(!/@v\d/.test(code), "actions are pinned to immutable commit SHAs");
    for (const sha of [
      "11bd71901bbe5b1630ceea73d27597364c9af683",
      "49933ea5288caeca8642d1e84afbd3f7d6820020",
      "ea165f8d65b6e75b540449e92b4886f43607fa02",
      "d3f86a106a0bac45b974a628896c90dbdf5c8093"
    ]) assert.ok(code.includes(sha), `verified action SHA missing: ${sha}`);
    assert.ok(/PUBLISHER_TOOLS_REF.*\[0-9a-f\]\{40\}/.test(code), "tools are pinned to a full commit SHA");
    pass("the workflow is split by permission, pins actions, requires a hash, and isolates the write token to the final push step");
  }

  // 10b. Publishing deploys Pages itself, and the deploy workflow serves only public site files
  {
    const strip = (text) => text.split(/\r?\n/).filter((line) => !line.trim().startsWith("#")).join("\n");
    const publish = strip(readFileSync(join(here, "..", "github", "publish-content.yml"), "utf8"));
    const deployJob = publish.slice(publish.indexOf("\n  deploy:"));
    assert.ok(deployJob.length > 1, "publish workflow has a deploy job");
    assert.ok(/needs: commit/.test(deployJob) && /needs\.commit\.outputs\.created == 'true'/.test(deployJob), "deploys only after a new commit");
    assert.ok(/uses: \.\/\.github\/workflows\/deploy-pages\.yml/.test(deployJob));
    assert.ok(/pages: write/.test(deployJob) && /id-token: write/.test(deployJob) && /contents: read/.test(deployJob) && !/contents: write/.test(deployJob));
    assert.ok(/created: \$\{\{ steps\.commit\.outputs\.created \}\}/.test(publish), "commit job exposes whether it pushed");

    const deploy = strip(readFileSync(join(here, "..", "github", "deploy-pages.yml"), "utf8"));
    const triggers = /^on:\n((?:[ ]{2,}.*\n)+)/m.exec(deploy)?.[1] ?? "";
    assert.deepEqual([...triggers.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]), ["push", "workflow_dispatch", "workflow_call"]);
    assert.ok(/^permissions:\n {2}contents: read$/m.test(deploy), "workflow default is read-only");
    assert.ok(!/contents: write|secrets\.|github\.token|GITHUB_TOKEN/.test(deploy), "deploy never gets a repository write token");
    assert.ok(/ref: main/.test(deploy), "always deploys the newest main");
    assert.ok(/persist-credentials: false/.test(deploy));
    assert.ok(/for f in \*\.html \*\.css \*\.js \*\.svg \*\.xml \*\.pdf \*\.txt/.test(deploy) && /for d in images writing research/.test(deploy), "only allowlisted files are staged");
    assert.ok(!/cp -R[^\n]*(admin|amplify|node_modules|\.github)/.test(deploy) && !/amplify\.yml|amplify_outputs/.test(deploy), "admin and backend files are never staged");
    assert.ok(/path: _public/.test(deploy));
    assert.ok(!/@v\d/.test(deploy), "deploy actions are pinned to commit SHAs");
    for (const sha of ["11bd71901bbe5b1630ceea73d27597364c9af683", "56afc609e74202658d3ffba0e8f6dda462b719fa", "d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e"]) {
      assert.ok(deploy.includes(sha), `verified action SHA missing: ${sha}`);
    }
    for (const run of deploy.split(/\n {6}- /).filter((step) => /\brun: /.test(step))) {
      assert.ok(!/\$\{\{/.test(run.slice(run.indexOf("run:"))), "no expression interpolation inside shell scripts");
    }
    pass("publishing deploys Pages through a pinned, read-only workflow that stages only public site files");
  }

  // 11. The template is not in an active location and the admin amplify.yml is not referenced as a public build file
  {
    const templateRoot = join(here, "..", "github");
    assert.ok(existsSync(join(templateRoot, "publish-content.yml")));
    assert.ok(existsSync(join(templateRoot, "deploy-pages.yml")));
    const repoRoot = join(here, "..", "..", "..");
    assert.ok(!existsSync(join(repoRoot, ".github", "workflows", "publish-content.yml")), "template must not be active in this repo");
    assert.ok(!existsSync(join(repoRoot, ".github", "workflows", "deploy-pages.yml")), "deploy template must not be active in this repo");
    assert.ok(statSync(join(repoRoot, "amplify.yml")).isFile());
    pass("the workflow is only a template (inactive) and the admin amplify.yml is untouched");
  }

  // 12. Directory symlinks are refused before any site file changes
  {
    for (const directory of ["writing", "research"]) {
      const root = await makeSite();
      const outside = mkdtempSync(join(tmpdir(), "ni-outside-"));
      temps.push(outside);
      await put(outside, "unrelated.txt", "keep me");
      const before = snapshot(root);
      const link = join(root, directory);
      rmSync(link, { recursive: true, force: true });
      symlinkSync(outside, link, "junction");
      const path = await manifestFile(root, manifestFor({ publications: [publication(1)], researchProjects: [research(2)] }));
      await assert.rejects(applyValid({ manifestPath: path, siteRoot: root }), /expected a real directory/);
      assert.equal(readFileSync(join(outside, "unrelated.txt"), "utf8"), "keep me");
      for (const [file, content] of Object.entries(before)) {
        if (!file.startsWith(`${directory}/`)) assert.equal(readFileSync(join(root, file), "utf8"), content);
      }
      assert.ok(!existsSync(join(root, "writing", "essay-1.html")));
      unlinkSync(link);
    }
    pass("writing/ and research/ symlinks are rejected before touching site or outside files");
  }

  // 13. Symlinked generated-page candidates are rejected before any writes/deletes
  {
    const root = await makeSite();
    const outside = mkdtempSync(join(tmpdir(), "ni-outside-cleanup-"));
    temps.push(outside);
    await put(outside, "outside.html", `${GENERATED_MARKER}<p>outside</p>`);
    const before = snapshot(root);
    const link = join(root, "writing", "stale.html");
    symlinkSync(outside, link, "junction");
    const path = await manifestFile(root, manifestFor({ publications: [publication(1)] }));
    await assert.rejects(applyValid({ manifestPath: path, siteRoot: root }), /symlinked generated-page candidate/);
    assert.equal(readFileSync(join(outside, "outside.html"), "utf8"), `${GENERATED_MARKER}<p>outside</p>`);
    unlinkSync(link);
    assert.deepEqual(snapshot(root), before);
    pass("a symlink in the cleanup scan aborts before any generated output changes");
  }

  // 14. The generation job artifact contains only generated deltas and validated metadata
  {
    const root = await makeSite();
    const firstPath = await manifestFile(root, manifestFor({ publications: [publication(1), publication(2)] }));
    const firstHash = createHash("sha256").update(readFileSync(firstPath)).digest("hex");
    const artifactParent = mkdtempSync(join(tmpdir(), "ni-output-artifact-"));
    temps.push(artifactParent);
    const artifact = join(artifactParent, "first");
    const firstResult = await applyManifest({
      manifestPath: firstPath, siteRoot: root, expectedSha256: firstHash,
      artifactDir: artifact, baseSha: "a".repeat(40)
    });
    const firstMeta = JSON.parse(readFileSync(join(artifact, "changes.json"), "utf8"));
    assert.equal(firstMeta.baseSha, "a".repeat(40));
    assert.deepEqual(firstMeta.written.sort(), firstResult.written.sort());
    assert.deepEqual(firstMeta.deleted, []);

    const secondPath = await manifestFile(root, manifestFor({ publications: [publication(2)] }));
    const secondHash = createHash("sha256").update(readFileSync(secondPath)).digest("hex");
    const artifact2 = join(artifactParent, "second");
    const secondResult = await applyManifest({
      manifestPath: secondPath, siteRoot: root, expectedSha256: secondHash,
      artifactDir: artifact2, baseSha: "b".repeat(40)
    });
    const metadata = JSON.parse(readFileSync(join(artifact2, "changes.json"), "utf8"));
    assert.deepEqual(metadata.deleted, secondResult.deleted);
    assert.deepEqual(metadata.deleted, ["writing/essay-1.html"]);
    assert.equal(existsSync(join(artifact2, "files", "writing", "essay-1.html")), false);
    const thirdParent = mkdtempSync(join(tmpdir(), "ni-output-noop-"));
    temps.push(thirdParent);
    const thirdArtifact = join(thirdParent, "output");
    const unchanged = await applyManifest({
      manifestPath: secondPath, siteRoot: root, expectedSha256: secondHash,
      artifactDir: thirdArtifact, baseSha: "c".repeat(40)
    });
    const unchangedMetadata = JSON.parse(readFileSync(join(thirdArtifact, "changes.json"), "utf8"));
    assert.deepEqual([unchanged.written, unchanged.deleted, unchangedMetadata.written, unchangedMetadata.deleted], [[], [], [], []]);
    assert.ok(existsSync(join(thirdArtifact, "files")));
    pass("the artifact contains only changed generated files plus an explicit deletion list and base revision");
  }

  // 15. The commit job validates the artifact without executing any artifact-provided code
  {
    const text = readFileSync(join(here, "..", "github", "publish-content.yml"), "utf8");
    const workflowLines = text.split(/\r?\n/);
    const step = workflowLines.indexOf("      - name: Validate artifact, apply allowlisted files, and create commit");
    const run = workflowLines.indexOf("        run: |", step);
    const end = workflowLines.indexOf("      - name: Push generated-content commit", run);
    assert.ok(step >= 0 && run > step && end > run);
    const shellLines = workflowLines.slice(run + 1, end).map((line) => line.startsWith("          ") ? line.slice(10) : line);
    const nodeStart = shellLines.indexOf("node <<'NODE'");
    const nodeEnd = shellLines.indexOf("NODE", nodeStart + 1);
    assert.ok(nodeStart >= 0 && nodeEnd > nodeStart);
    const rawScript = shellLines.slice(nodeStart + 1, nodeEnd).join("\n");
    const childProcessImport = 'const { execFileSync, spawnSync } = require("node:child_process");';
    assert.ok(rawScript.includes(childProcessImport));
    const script = rawScript.replace(childProcessImport, `
const recordGit = (kind, args) => fs.appendFileSync(process.env.TEST_GIT_LOG, JSON.stringify({ kind, args }) + "\\n");
const execFileSync = (_command, args) => {
  recordGit("exec", args);
  if (args.includes("rev-parse")) return process.env.TEST_CURRENT_BASE_SHA + "\\n";
  return "";
};
const spawnSync = (_command, args) => {
  recordGit("spawn", args);
  return { status: 1 };
};`);
    const root = mkdtempSync(join(tmpdir(), "ni-commit-job-"));
    temps.push(root);
    const site = join(root, "site");
    const artifact = join(root, "publish-artifact");
    const output = join(root, "github-output.txt");
    const gitLog = join(root, "git-calls.jsonl");
    await put(site, "writing/old.html", `${GENERATED_MARKER}<p>old generated</p>`);
    await put(site, "writing/hand.html", "<html>hand page</html>");
    await put(site, "research/hand-project.html", "<html>hand project</html>");
    await put(site, "index.html", "<html>home</html>");
    await put(site, "styles.css", "body{}");
    await put(site, PUBLISHED_DATA_PATH, "window.NaturalInquiryPublishedEntries = [];\\n");
    const baseSha = "a".repeat(40);
    const manifestSha256 = "f".repeat(64);
    await put(artifact, "files/writing/new.html", `${GENERATED_MARKER}<p>new generated</p>`);
    await put(artifact, `files/${PUBLISHED_DATA_PATH}`, "window.NaturalInquiryPublishedEntries = [];\\n");
    await writeFile(join(artifact, "changes.json"), JSON.stringify({
      version: 1, baseSha, manifestSha256,
      written: ["writing/new.html", PUBLISHED_DATA_PATH],
      deleted: ["writing/old.html"]
    }));
    const runCommitScript = (expectedBase = baseSha) => spawnSync(process.execPath, ["-e", script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env, EXPECTED_BASE_SHA: expectedBase, EXPECTED_MANIFEST_SHA256: manifestSha256,
        GITHUB_OUTPUT: output, TEST_GIT_LOG: gitLog,
        TEST_CURRENT_BASE_SHA: process.env.TEST_CURRENT_BASE_SHA || baseSha
      }
    });

    delete process.env.TEST_CURRENT_BASE_SHA;
    const applied = runCommitScript();
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(readFileSync(join(site, "writing/new.html"), "utf8"), `${GENERATED_MARKER}<p>new generated</p>`);
    assert.equal(existsSync(join(site, "writing/old.html")), false);
    assert.equal(readFileSync(join(site, "writing/hand.html"), "utf8"), "<html>hand page</html>");
    assert.equal(readFileSync(join(site, "research/hand-project.html"), "utf8"), "<html>hand project</html>");
    assert.equal(readFileSync(join(site, "index.html"), "utf8"), "<html>home</html>");
    assert.equal(readFileSync(join(site, "styles.css"), "utf8"), "body{}");
    const calls = readFileSync(gitLog, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(calls.filter(({ kind, args }) => kind === "exec" && args.includes("commit")).length, 1);
    assert.deepEqual(calls.find(({ kind, args }) => kind === "exec" && args.includes("add")).args.slice(-3),
      ["writing/new.html", PUBLISHED_DATA_PATH, "writing/old.html"]);
    assert.ok(readFileSync(output, "utf8").includes("created=true"));

    const indexBefore = readFileSync(join(site, "index.html"), "utf8");
    const badMetadata = {
      version: 1, baseSha, manifestSha256,
      written: ["../../index.html"], deleted: []
    };
    await writeFile(join(artifact, "changes.json"), JSON.stringify(badMetadata));
    await writeFile(gitLog, "", "utf8");
    const malicious = runCommitScript(badMetadata.baseSha);
    assert.notEqual(malicious.status, 0);
    assert.equal(readFileSync(join(site, "index.html"), "utf8"), indexBefore);
    assert.equal(existsSync(gitLog) && readFileSync(gitLog, "utf8"), "", "invalid paths are rejected before Git operations");

    const newerBaseSha = "b".repeat(40);
    await writeFile(join(artifact, "changes.json"), JSON.stringify({
      version: 1, baseSha: newerBaseSha, manifestSha256,
      written: ["writing/new.html"], deleted: []
    }));
    process.env.TEST_CURRENT_BASE_SHA = baseSha;
    const stale = runCommitScript(newerBaseSha);
    delete process.env.TEST_CURRENT_BASE_SHA;
    assert.notEqual(stale.status, 0, "old artifact base revision must not be applied to a newer main");
    assert.equal(readFileSync(join(site, "writing/new.html"), "utf8"), `${GENERATED_MARKER}<p>new generated</p>`);
    pass("the commit job applies only validated generated paths, leaves unrelated files intact and rejects stale or malicious artifacts");

    await writeFile(join(artifact, "changes.json"), JSON.stringify({
      version: 1, baseSha, manifestSha256, written: [], deleted: ["writing/new.html"]
    }));
    rmSync(join(artifact, "files"), { recursive: true, force: true });
    const deletionOnly = runCommitScript();
    assert.equal(deletionOnly.status, 0, deletionOnly.stderr);
    assert.equal(existsSync(join(site, "writing/new.html")), false);

    await writeFile(join(artifact, "changes.json"), JSON.stringify({
      version: 1, baseSha, manifestSha256, written: [], deleted: []
    }));
    const noChanges = runCommitScript();
    assert.equal(noChanges.status, 0, noChanges.stderr);
    assert.ok(readFileSync(output, "utf8").includes("created=false"));
    pass("the commit job accepts deletion-only and no-op artifacts without an empty files directory");
  }
} finally {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
}

console.log(`\nAll ${n} apply-manifest test groups passed.`);
