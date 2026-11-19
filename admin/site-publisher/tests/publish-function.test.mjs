// Synthetic tests for the publishing function (Publishing Phase 2).
// In-memory fakes only: no AWS, no network, no real records.
// Run from admin/site-publisher: node tests/publish-function.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ADMIN_GROUP, MANIFEST_KEY, PublishError, diffManifests, isAdministrator, isDryRun, runPublish as runPublishCore
} from "../../../amplify/functions/publish-site/publish-core.js";
import { createGithubDispatcher, createS3ManifestStore, validateDispatchTarget, validateGithubToken } from "../../../amplify/functions/publish-site/adapters.js";

let n = 0;
const pass = (name) => console.log(`${++n} ${name}: ok`);

// Any real network use is a failure.
const networkCalls = [];
globalThis.fetch = (...args) => { networkCalls.push(args[0]); throw new Error("network used"); };

const ADMIN = { sub: "u1", groups: [ADMIN_GROUP] };
const ID = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const NOW = () => new Date("2026-11-05T12:00:00.000Z");

async function runPublish(options) {
  if (options.dryRun !== false) return runPublishCore(options);
  const review = await runPublishCore({ ...options, dryRun: true });
  return runPublishCore({ ...options, reviewDigest: review.reviewDigest });
}

const PRIVATE_STRINGS = ["PRIVATE-NOTE-XYZ", "PRIVATE-DOC-XYZ", "admin-media/private-XYZ.png", "OWNER-XYZ"];

// 0. Infrastructure authorization and permissions stay least-privilege
{
  const schema = readFileSync(new URL("../../../amplify/data/resource.ts", import.meta.url), "utf8");
  assert.equal((schema.match(/allow\.resource\(publishSite\)\.to\(\["query"\]\)/g) || []).length, 1,
    "the function resource rule is read-only");
  assert.match(schema, /\}\)\.authorization\(\(allow\) => allow\.resource\(publishSite\)\.to\(\["query"\]\)\)/,
    "Amplify Gen 2 resource authorization is schema-scoped");
  assert.equal((schema.match(/allow\.group\("Administrators"\)/g) || []).length, 4,
    "the mutation and all three models remain Administrators-only");

  const handler = readFileSync(new URL("../../../amplify/functions/publish-site/handler.ts", import.meta.url), "utf8");
  const expectedSelections = {
    PUBLICATION_FIELDS: ["id", "title", "subtitle", "category", "summary", "content", "contentFormat", "status", "archived", "indexCategories", "references", "publicPath", "publishedAt"],
    RESEARCH_FIELDS: ["id", "title", "summary", "overview", "overviewTitle", "content", "projectStage", "status", "indexCategories", "publicPath", "publishedAt"],
    PROFILE_FIELDS: ["id", "sectionKey", "title", "summary", "content", "sortOrder", "status", "publishedAt"]
  };
  for (const [name, fields] of Object.entries(expectedSelections)) {
    const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(handler);
    assert.ok(match, `${name} selection exists`);
    assert.deepEqual([...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]), fields);
  }

  const backend = readFileSync(new URL("../../../amplify/backend.ts", import.meta.url), "utf8");
  assert.match(backend, /actions: \["s3:GetObject", "s3:PutObject"\][\s\S]*?resources: \[manifestArn\]/);
  assert.match(backend, /actions: \["s3:ListBucket"\][\s\S]*?conditions: \{ StringEquals: \{ "s3:prefix": "published\/manifest\.json" \} \}/);
  assert.match(backend, /actions: \["ssm:GetParameter"\][\s\S]*?resourceName: GITHUB_TOKEN_PARAMETER\.slice\(1\)/);

  const bucket = readFileSync(new URL("../../../amplify/public-content/resource.ts", import.meta.url), "utf8");
  for (const setting of ["BlockPublicAccess.BLOCK_ALL", "enforceSSL: true", "BucketEncryption.S3_MANAGED", "versioned: true", "S3BucketOrigin.withOriginAccessControl(bucket)", "AllowedMethods.ALLOW_GET_HEAD"]) {
    assert.ok(bucket.includes(setting), `public-content bucket/distribution must retain ${setting}`);
  }
  pass("publisher access, model field selections, AWS IAM scope and public-content bucket protections");
}

function publication(overrides = {}) {
  return {
    id: ID(1), title: "Tide Pools", subtitle: "Life between tides", category: "Essay", summary: null,
    content: "<p>Hello <strong>world</strong></p>", contentFormat: "RICH_TEXT", status: "PUBLISHED", archived: false,
    indexCategories: JSON.stringify([{ id: "ecology", subjects: ["Intertidal zones"] }]),
    references: JSON.stringify([{ id: "r1", title: "A source", url: "https://example.org/a" }]),
    mediaKeys: JSON.stringify(["admin-media/private-XYZ.png"]), sourceDocumentName: "PRIVATE-DOC-XYZ",
    publicPath: "writing/tide-pools.html", publishedAt: "2026-10-01T00:00:00.000Z", revision: 7, owner: "OWNER-XYZ",
    ...overrides
  };
}
function research(overrides = {}) {
  return {
    id: ID(2), title: "Kelp Study", summary: "A kelp project", overview: "Overview", overviewTitle: "About",
    content: "<p>Kelp body</p>", projectNote: "PRIVATE-NOTE-XYZ", projectStage: "IN_PROGRESS", status: "PUBLISHED",
    indexCategories: null, mediaKeys: JSON.stringify(["admin-media/private-XYZ.png"]),
    publicPath: "research/kelp-study.html", publishedAt: "2026-10-02T00:00:00.000Z", revision: 3, ...overrides
  };
}
function profile(overrides = {}) {
  return {
    id: ID(3), sectionKey: "about", title: "About", content: "<p>Bio</p>", summary: "Short", status: "PUBLISHED",
    sortOrder: 1, publishedAt: "2026-10-03T00:00:00.000Z", revision: 2, ...overrides
  };
}

// Fake collaborators that record every call.
function harness({ records, existing = null, loadError = null, dispatch = { status: "dispatched" }, dispatchError = null, putError = null } = {}) {
  const calls = { load: 0, get: 0, put: [], dispatch: 0, dispatched: [] };
  let stored = existing ? { body: existing, etag: '"etag-1"' } : null;
  return {
    calls,
    get stored() { return stored; },
    setStored(value) { stored = value; },
    options: {
      loadRecords: async () => { calls.load += 1; if (loadError) throw loadError; return records; },
      store: {
        async getManifest() { calls.get += 1; return stored ? { ...stored } : null; },
        async putManifest(input) {
          calls.put.push(input);
          if (putError) throw putError;
          if (input.etag && stored && input.etag !== stored.etag) { const e = new Error("x"); e.code = "CONFLICT"; throw e; }
          stored = { body: input.body, etag: `"etag-${calls.put.length + 1}"` };
        }
      },
      dispatchSiteUpdate: async (input) => { calls.dispatch += 1; calls.dispatched.push(input); if (dispatchError) throw dispatchError; return dispatch; },
      now: NOW
    }
  };
}
const mixedRecords = () => ({
  publications: [
    publication(),
    publication({ id: ID(10), status: "DRAFT", publicPath: "writing/draft.html" }),
    publication({ id: ID(11), archived: true, publicPath: "writing/archived.html" }),
    publication({ id: ID(12), status: "ARCHIVED", archived: true, publicPath: "writing/archived-2.html" }),
    publication({ id: ID(13), status: "SOMETHING_NEW", publicPath: "writing/unknown.html" }),
    publication({ id: ID(14), status: undefined, publicPath: "writing/nostatus.html" }),
    publication({ id: ID(15), title: "", publicPath: "writing/malformed.html" }),
    publication({ id: ID(16), publicPath: "../../escape.html" }),
    null,
    "not-an-object"
  ],
  researchProjects: [research(), research({ id: ID(20), status: "IN_REVIEW", publicPath: "research/review.html" })],
  profileContent: [profile(), profile({ id: ID(30), sectionKey: "draft-section", status: "DRAFT" })]
});

// 1. Authorization is enforced inside the function, before anything is read
{
  for (const identity of [null, undefined, {}, { groups: null }, { groups: [] }, { groups: ["Editors"] }, { groups: "Administrators" },
    { accountId: "123", userArn: "arn:aws:iam::123:role/x" }, "Administrators", 5]) {
    const h = harness({ records: mixedRecords() });
    await assert.rejects(runPublish({ identity, dryRun: true, ...h.options }), (error) => error instanceof PublishError && error.message === "Not authorized.");
    assert.equal(h.calls.load + h.calls.get + h.calls.put.length + h.calls.dispatch, 0, "nothing may run for non-admins");
  }
  assert.ok(isAdministrator({ groups: ["Administrators"] }));
  assert.ok(isAdministrator({ claims: { "cognito:groups": ["Administrators", "x"] } }));
  assert.ok(!isAdministrator({ claims: { "cognito:groups": "Administrators" } }));
  pass("only Administrators may call the function; everyone else is refused before any read or write");
}

// 2. Published / draft / archived / malformed / unknown-status
{
  const h = harness({ records: mixedRecords() });
  const result = await runPublish({ identity: ADMIN, dryRun: true, ...h.options });
  assert.deepEqual(result.manifest.publications.map((item) => item.id), [ID(1)]);
  assert.deepEqual(result.manifest.research.map((item) => item.id), [ID(2)]);
  assert.deepEqual(result.manifest.profile.map((item) => item.id), [ID(3)]);
  const reasons = Object.fromEntries(result.excluded.map((item) => [item.id, item.reason]));
  assert.equal(reasons[ID(10)], "not published");
  assert.equal(reasons[ID(11)], "archived");
  assert.equal(reasons[ID(12)], "not published");
  assert.equal(reasons[ID(13)], "not published");
  assert.equal(reasons[ID(14)], "not published");
  assert.equal(reasons[ID(15)], "missing or oversized title");
  assert.equal(reasons[ID(16)], "invalid public path");
  assert.equal(reasons[ID(20)], "not published");
  assert.equal(reasons[ID(30)], "not published");
  assert.equal(result.excluded.filter((item) => item.reason === "invalid record").length, 2);
  assert.equal(result.excluded.length, 11);
  assert.equal(result.counts.excluded, 11);
  assert.deepEqual(result.pages, ["writing/tide-pools.html", "research/kelp-study.html"]);
  pass("only PUBLISHED, non-archived, well-formed records are included; every exclusion is reported");
}

// 3. Private fields never appear in anything returned
{
  const h = harness({ records: mixedRecords() });
  const result = await runPublish({ identity: ADMIN, dryRun: true, ...h.options });
  const text = JSON.stringify(result);
  for (const secret of PRIVATE_STRINGS) assert.ok(!text.includes(secret), `leaked ${secret}`);
  for (const key of ["mediaKeys", "sourceDocumentName", "projectNote", "revision", "owner", "importedCreatedAt"]) {
    assert.ok(!text.includes(`"${key}"`), `leaked key ${key}`);
  }
  assert.ok(!text.includes("admin-media"));
  assert.ok(!/presign|X-Amz|AWSAccessKeyId|Signature=/i.test(text), "no presigned URLs");
  const real = await runPublish({ identity: ADMIN, dryRun: false, ...harness({ records: mixedRecords() }).options });
  for (const secret of PRIVATE_STRINGS) assert.ok(!JSON.stringify(real).includes(secret));
  pass("private fields never appear in the returned manifest, summary or diff");
}

// 4. Dry run: no writes, no workflow dispatch, no network
{
  for (const value of [true, undefined, null, "false", 0, "no", {}]) {
    assert.ok(isDryRun(value), `${String(value)} must be a dry run`);
  }
  assert.ok(!isDryRun(false));
  for (const dryRun of [true, undefined, null]) {
    const h = harness({ records: mixedRecords() });
    const result = await runPublish({ identity: ADMIN, dryRun, ...h.options });
    assert.equal(result.dryRun, true);
    assert.equal(result.wrote, false);
    assert.equal(h.calls.put.length, 0);
    assert.equal(h.calls.dispatch, 0);
    assert.equal(h.stored, null);
    assert.deepEqual(result.siteUpdate, { status: "not-attempted", reason: "dry run" });
    assert.ok(result.manifest && result.changes.firstPublish);
  }
  assert.deepEqual(networkCalls, []);
  pass("dry run (the default) performs no S3 writes, dispatches no workflow and makes no network calls");
}

// 5. Real publish writes exactly once, conditionally, then dispatches the workflow
{
  const h = harness({ records: mixedRecords() });
  const result = await runPublish({ identity: ADMIN, dryRun: false, ...h.options });
  assert.equal(result.wrote, true);
  assert.equal(h.calls.put.length, 1);
  assert.equal(h.calls.dispatch, 1);
  assert.equal(h.calls.put[0].etag, null, "first publish writes only if nothing exists");
  const written = JSON.parse(h.calls.put[0].body);
  assert.equal(written.schemaVersion, 1);
  assert.equal(written.generatedAt, "2026-11-05T12:00:00.000Z");
  assert.deepEqual(Object.keys(written).sort(), ["generatedAt", "profile", "publications", "research", "schemaVersion"]);
  assert.equal(result.manifest, undefined, "the real run returns a summary, not the manifest");
  assert.equal(result.key, MANIFEST_KEY);
  assert.deepEqual(result.siteUpdate, { status: "dispatched" });
  assert.deepEqual(h.calls.dispatched, [{ manifestSha256: createHash("sha256").update(h.calls.put[0].body).digest("hex"), generatedAt: "2026-11-05T12:00:00.000Z" }]);
  assert.equal(result.manifestSha256, h.calls.dispatched[0].manifestSha256);
  assert.equal(result.changes.added.length, 3);
  pass("real publish writes the manifest once with a create-only condition, then dispatches the workflow");
}

// 5b. Rebuild is requested only after a successful write
{
  const order = [];
  const h = harness({ records: mixedRecords() });
  const options = { ...h.options,
    store: { ...h.options.store, putManifest: async (input) => { order.push("put"); return h.options.store.putManifest(input); } },
    dispatchSiteUpdate: async () => { order.push("dispatch"); return { status: "dispatched" }; } };
  await runPublish({ identity: ADMIN, dryRun: false, ...options });
  assert.deepEqual(order, ["put", "dispatch"]);
  const failing = harness({ records: mixedRecords(), putError: new Error("S3 down") });
  await assert.rejects(runPublish({ identity: ADMIN, dryRun: false, ...failing.options }), /Writing the public manifest failed/);
  assert.equal(failing.calls.dispatch, 0, "no workflow dispatch when the write failed");
  pass("workflow dispatch occurs only after the manifest write succeeds");
}

// 6. Unpublish, archive and delete remove the record from the next manifest
{
  const base = { publications: [publication(), publication({ id: ID(40), title: "Two", publicPath: "writing/two.html" })], researchProjects: [research()], profileContent: [profile()] };
  const first = harness({ records: base });
  await runPublish({ identity: ADMIN, dryRun: false, ...first.options });
  assert.ok(JSON.parse(first.stored.body).publications.some((item) => item.id === ID(40)));

  const scenarios = {
    unpublished: { ...base, publications: [base.publications[0], { ...base.publications[1], status: "DRAFT" }] },
    archived: { ...base, publications: [base.publications[0], { ...base.publications[1], archived: true }] },
    deleted: { ...base, publications: [base.publications[0]] }
  };
  for (const [name, records] of Object.entries(scenarios)) {
    const h = harness({ records, existing: first.stored.body });
    const dry = await runPublish({ identity: ADMIN, dryRun: true, ...h.options });
    assert.deepEqual(dry.changes.removed.map((item) => item.id), [ID(40)], `${name} should be reported as removed`);
    assert.equal(h.calls.put.length, 0);
    const real = await runPublish({ identity: ADMIN, dryRun: false, ...h.options });
    assert.equal(real.wrote, true);
    const next = JSON.parse(h.stored.body);
    assert.ok(!next.publications.some((item) => item.id === ID(40)), `${name} must disappear from the manifest`);
    assert.ok(!real.pages.includes("writing/two.html"));
    assert.equal(h.calls.put[0].etag, '"etag-1"', "updates are conditional on the manifest that was read");
  }
  pass("unpublishing, archiving and deleting remove the page from the next manifest and are reported as removals");
}

// 7. Unchanged content: no write, but retry the exact current manifest.
{
  const records = { publications: [publication()], researchProjects: [], profileContent: [] };
  const first = harness({ records });
  await runPublish({ identity: ADMIN, dryRun: false, ...first.options });
  const second = harness({ records, existing: first.stored.body });
  const again = await runPublish({ identity: ADMIN, dryRun: false, ...{ ...second.options, now: () => new Date("2027-01-01T00:00:00Z") } });
  assert.equal(again.wrote, false);
  assert.equal(again.changes.total, 0);
  assert.equal(second.calls.put.length, 0);
  assert.equal(second.calls.dispatch, 1);
  assert.equal(again.manifestSha256, createHash("sha256").update(first.stored.body).digest("hex"));
  assert.deepEqual(second.calls.dispatched[0], {
    manifestSha256: again.manifestSha256,
    generatedAt: JSON.parse(first.stored.body).generatedAt
  });
  const edited = harness({ records: { ...records, publications: [publication({ title: "Tide Pools, revised" })] }, existing: first.stored.body });
  const changed = await runPublish({ identity: ADMIN, dryRun: true, ...edited.options });
  assert.deepEqual(changed.changes.changed.map((item) => item.id), [ID(1)]);
  pass("unchanged content retries dispatch with the stored manifest hash and timestamp without rewriting it");
}

// 8. Read failures abort everything
{
  for (const options of [
    { loadError: new Error("AppSync unauthorized secret=abc") },
    { records: { publications: [], researchProjects: [], profileContent: null } },
    { records: null }
  ]) {
    const h = harness({ records: options.records, loadError: options.loadError });
    await assert.rejects(runPublish({ identity: ADMIN, dryRun: false, ...h.options }), (error) => {
      assert.ok(error instanceof PublishError);
      assert.ok(!/secret|abc|AppSync/.test(error.message), "internal error details must not leak");
      return true;
    });
    assert.equal(h.calls.put.length, 0);
    assert.equal(h.calls.dispatch, 0);
  }
  const brokenStore = harness({ records: mixedRecords() });
  brokenStore.options.store.getManifest = async () => { throw new Error("S3 denied"); };
  await assert.rejects(runPublish({ identity: ADMIN, dryRun: false, ...brokenStore.options }), /Could not read the currently published manifest/);
  assert.equal(brokenStore.calls.put.length, 0);
  pass("any read failure aborts with a safe message and writes nothing");
}

// 9. An empty read while content is live is refused, but unpublishing everything via real records is allowed
{
  const live = harness({ records: { publications: [publication()], researchProjects: [], profileContent: [] } });
  await runPublish({ identity: ADMIN, dryRun: false, ...live.options });
  const empty = harness({ records: { publications: [], researchProjects: [], profileContent: [] }, existing: live.stored.body });
  await assert.rejects(runPublish({ identity: ADMIN, dryRun: false, ...empty.options }), /Refusing to unpublish everything/);
  assert.equal(empty.calls.put.length, 0);
  const allDrafts = harness({ records: { publications: [publication({ status: "DRAFT" })], researchProjects: [], profileContent: [] }, existing: live.stored.body });
  const result = await runPublish({ identity: ADMIN, dryRun: false, ...allDrafts.options });
  assert.equal(result.wrote, true);
  assert.deepEqual(JSON.parse(allDrafts.stored.body).publications, []);
  pass("a suspicious empty read is refused; deliberately unpublishing every record still works");
}

// 10. Concurrent publish is detected
{
  const h = harness({ records: { publications: [publication()], researchProjects: [], profileContent: [] } });
  await runPublish({ identity: ADMIN, dryRun: false, ...h.options });
  const racing = harness({ records: { publications: [publication({ title: "Edited" })], researchProjects: [], profileContent: [] }, existing: h.stored.body });
  const originalGet = racing.options.store.getManifest;
  let reads = 0;
  racing.options.store.getManifest = async () => {
    const value = await originalGet();
    reads += 1;
    if (reads === 2) racing.setStored({ body: value.body, etag: '"someone-else"' });
    return value;
  };
  await assert.rejects(runPublish({ identity: ADMIN, dryRun: false, ...racing.options }), /changed while publishing/);
  assert.equal(racing.calls.dispatch, 0);
  pass("a publish that races another one is rejected without writing or dispatching");
}

// A real publish must match a fresh review of both public content and its manifest baseline.
{
  const records = { publications: [publication()], researchProjects: [], profileContent: [] };
  const h = harness({ records });
  const review = await runPublishCore({ identity: ADMIN, dryRun: true, ...h.options });
  assert.match(review.reviewDigest, /^[0-9a-f]{64}$/);
  for (const digest of [undefined, null, "", "a".repeat(63), "G".repeat(64)]) {
    const before = h.calls.load;
    await assert.rejects(runPublishCore({ identity: ADMIN, dryRun: false, reviewDigest: digest, ...h.options }), /valid review/);
    assert.equal(h.calls.load, before);
  }
  records.publications[0].content = "<p>Changed after review</p>";
  await assert.rejects(runPublishCore({ identity: ADMIN, dryRun: false, reviewDigest: review.reviewDigest, ...h.options }), /changed since review/);
  assert.equal(h.calls.put.length, 0);
  assert.equal(h.calls.dispatch, 0);
  records.publications[0].content = "<p>Hello <strong>world</strong></p>";
  records.publications.push(publication({ id: ID(7), status: "DRAFT" }));
  await assert.rejects(runPublishCore({ identity: ADMIN, dryRun: false, reviewDigest: review.reviewDigest, ...h.options }), /changed since review/);
  assert.equal(h.calls.put.length + h.calls.dispatch, 0);
  records.publications.pop();
  h.setStored({ body: JSON.stringify(review.manifest), etag: '"existing"' });
  await assert.rejects(runPublishCore({ identity: ADMIN, dryRun: false, reviewDigest: review.reviewDigest, ...h.options }), /changed since review/);
  assert.equal(h.calls.put.length, 0);
  assert.equal(h.calls.dispatch, 0);
  const fresh = await runPublishCore({ identity: ADMIN, dryRun: true, ...h.options });
  const retried = await runPublishCore({ identity: ADMIN, dryRun: false, reviewDigest: fresh.reviewDigest, ...h.options, now: () => new Date("2027-01-01T00:00:00Z") });
  assert.equal(retried.siteUpdate.status, "dispatched");
  assert.equal(h.calls.put.length, 0);
  const missingEtag = harness({ records, existing: JSON.stringify(review.manifest) });
  missingEtag.setStored({ body: JSON.stringify(review.manifest), etag: null });
  await assert.rejects(runPublishCore({ identity: ADMIN, dryRun: true, ...missingEtag.options }), /manifest version/);
  assert.equal(missingEtag.calls.put.length + missingEtag.calls.dispatch, 0);
  const shuffled = harness({ records: { publications: [publication({ id: ID(8), status: "DRAFT" }), publication({ id: ID(9), status: "DRAFT" })], researchProjects: [], profileContent: [] } });
  const firstReview = await runPublishCore({ identity: ADMIN, dryRun: true, ...shuffled.options });
  const reversed = harness({ records: { publications: [publication({ id: ID(9), status: "DRAFT" }), publication({ id: ID(8), status: "DRAFT" })], researchProjects: [], profileContent: [] } });
  const secondReview = await runPublishCore({ identity: ADMIN, dryRun: true, ...reversed.options });
  assert.equal(firstReview.reviewDigest, secondReview.reviewDigest, "source order does not invalidate review");
  await assert.rejects(runPublishCore({ identity: { groups: [] }, dryRun: false, reviewDigest: firstReview.reviewDigest, ...shuffled.options }), /Not authorized/);
  pass("real publish requires a matching review, rejects stale content and baseline, and requires a versioned manifest");
}

// 11. Rebuild problems never undo or hide a successful write
{
  const failed = harness({ records: mixedRecords(), dispatchError: new Error("dispatch down github_pat_SECRETSECRETSECRET1234") });
  const result = await runPublish({ identity: ADMIN, dryRun: false, ...failed.options });
  assert.equal(result.wrote, true);
  assert.equal(result.siteUpdate.status, "failed");
  assert.ok(!JSON.stringify(result).includes("SECRETSECRET"));
  assert.ok(failed.stored);
  const retry = harness({ records: mixedRecords(), existing: failed.stored.body });
  const retried = await runPublish({ identity: ADMIN, dryRun: false, ...retry.options });
  assert.equal(retried.wrote, false);
  assert.equal(retried.siteUpdate.status, "dispatched");
  assert.equal(retry.calls.put.length, 0);
  assert.equal(retry.calls.dispatched[0].manifestSha256, createHash("sha256").update(failed.stored.body).digest("hex"));
  const unconfigured = harness({ records: mixedRecords(), dispatch: { status: "not-configured", reason: "x" } });
  assert.equal((await runPublish({ identity: ADMIN, dryRun: false, ...unconfigured.options })).siteUpdate.status, "not-configured");
  pass("workflow dispatch failures or a missing token are reported without losing the written manifest");
}

// 12. Unreadable current manifest is treated as empty with a warning
{
  const h = harness({ records: mixedRecords(), existing: "{not json" });
  const result = await runPublish({ identity: ADMIN, dryRun: true, ...h.options });
  assert.equal(result.warnings.length, 1);
  assert.ok(result.changes.firstPublish);
  const tampered = harness({ records: mixedRecords(), existing: JSON.stringify({ schemaVersion: 1, generatedAt: "x", publications: [{ id: "x" }], research: [], profile: [], extra: 1 }) });
  assert.equal((await runPublish({ identity: ADMIN, dryRun: true, ...tampered.options })).warnings.length, 1);
  pass("an unreadable or invalid current manifest is ignored with a warning");
}

// 13. Oversized output is refused
{
  const huge = "<p>" + "x".repeat(400_000) + "</p>";
  const records = { publications: Array.from({ length: 12 }, (_, i) => publication({ id: ID(100 + i), title: `Big ${i}`, publicPath: `writing/big-${i}.html`, content: huge })), researchProjects: [], profileContent: [] };
  const h = harness({ records });
  await assert.rejects(runPublish({ identity: ADMIN, dryRun: true, ...h.options }), /too large/);
  assert.equal(h.calls.put.length, 0);
  pass("a manifest over the size limit is refused");
}

// 14. Diff helper
{
  const a = { publications: [{ id: "a", title: "A", publicPath: "writing/a.html" }], research: [], profile: [] };
  const b = { publications: [{ id: "a", title: "A2", publicPath: "writing/a.html" }, { id: "b", title: "B", publicPath: "writing/b.html" }], research: [], profile: [] };
  const diff = diffManifests(a, b);
  assert.deepEqual([diff.added.length, diff.changed.length, diff.removed.length, diff.total], [1, 1, 0, 2]);
  assert.equal(diffManifests(null, b).firstPublish, true);
  assert.equal(diffManifests({ publications: [{ b: 1, a: 2, id: "x", title: "t" }], research: [], profile: [] }, { publications: [{ id: "x", title: "t", a: 2, b: 1 }], research: [], profile: [] }).total, 0);
  pass("diffing ignores key order and classifies added, changed and removed records");
}

// 15. S3 adapter: exact-prefix probe, one key, conditional writes
{
  const sent = [];
  const makeClient = (handler) => ({ send: async (command) => { sent.push(command); return handler(command); } });
  const body = (text) => ({ transformToString: async () => text });

  const missing = createS3ManifestStore({ client: makeClient(() => ({ Contents: [] })), bucket: "public-bucket" });
  assert.equal(await missing.getManifest(), null);
  assert.equal(sent[0].input.Prefix, MANIFEST_KEY);
  assert.equal(sent[0].input.MaxKeys, 1);
  assert.equal(sent[0].input.Bucket, "public-bucket");

  sent.length = 0;
  const present = createS3ManifestStore({ client: makeClient((command) => command.input.Prefix
    ? { Contents: [{ Key: `${MANIFEST_KEY}.backup` }, { Key: MANIFEST_KEY }] }
    : { Body: body("{}"), ETag: '"e1"' }), bucket: "public-bucket" });
  assert.deepEqual(await present.getManifest(), { body: "{}", etag: '"e1"' });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].input.Key, MANIFEST_KEY);

  const denied = createS3ManifestStore({ client: makeClient(() => { const e = new Error("denied"); e.name = "AccessDenied"; throw e; }), bucket: "b" });
  await assert.rejects(denied.getManifest(), /denied/);

  sent.length = 0;
  const writer = createS3ManifestStore({ client: makeClient(() => ({})), bucket: "public-bucket" });
  await writer.putManifest({ body: "{}", etag: null });
  await writer.putManifest({ body: "{}", etag: '"e1"' });
  assert.equal(sent[0].input.IfNoneMatch, "*");
  assert.equal(sent[1].input.IfMatch, '"e1"');
  for (const [index, command] of sent.entries()) {
    assert.equal(command.input.Key, MANIFEST_KEY);
    assert.equal(command.input.Bucket, "public-bucket");
    assert.equal(command.input.CacheControl, "no-store");
    assert.equal(command.input.ACL, undefined, "no ACLs");
    assert.deepEqual(Object.keys(command.input).sort(), ["Body", "Bucket", "CacheControl", "ContentType", index === 0 ? "IfNoneMatch" : "IfMatch", "Key"].sort());
  }
  const conflicting = createS3ManifestStore({ client: makeClient(() => { const e = new Error("pre"); e.name = "PreconditionFailed"; throw e; }), bucket: "b" });
  await assert.rejects(conflicting.putManifest({ body: "{}", etag: '"x"' }), (error) => error.code === "CONFLICT");
  assert.throws(() => createS3ManifestStore({ client: makeClient(() => ({})), bucket: undefined }), /not configured/);
  pass("the S3 adapter touches only the manifest key, writes conditionally and sets no ACLs");
}

// 16. GitHub dispatch adapter: fixed target, validated token, nothing sensitive sent or returned
{
  const good = `github_pat_${"A1b2C3d4E5".repeat(4)}`;
  assert.equal(validateGithubToken(`  ${good}\n`), good);
  for (const bad of ["http://webhooks.amplify.us-east-2.amazonaws.com/prod/webhooks?id=1", "https://evil.example/prod/webhooks?id=1",
    "https://webhooks.amplify.us-east-2.amazonaws.com.evil.example/prod/webhooks", "https://webhooks.amplify.us-east-2.amazonaws.com/other",
    "https://user:pw@webhooks.amplify.us-east-2.amazonaws.com/prod/webhooks", "https://webhooks.amplify.us-east-2.amazonaws.com:8443/prod/webhooks",
    "https://169.254.169.254/prod/webhooks", "ftp://x", "", null, 5]) {
    assert.equal(validateGithubToken(bad), null, String(bad));
  }
  const ssm = (value, error) => ({ send: async (command) => { ssm.last = command; if (error) throw error; return { Parameter: { Value: value } }; } });
  const fetched = [];
  const fetchImpl = async (url, init) => { fetched.push([url, init]); return { ok: true, status: 204 }; };
  const target = { owner: "chloeroseelia", repo: "The-Natural-Inquiry", workflow: "publish-content.yml", ref: "main" };
  const input = { manifestSha256: "a".repeat(64), generatedAt: "2026-11-05T12:00:00.000Z" };
  const make = (overrides = {}) => createGithubDispatcher({ ssmClient: ssm(good), parameterName: "/natural-inquiry/github-dispatch-token", target, fetchImpl, ...overrides });

  const ok = await make()(input);
  assert.deepEqual(ok, { status: "dispatched" });
  assert.equal(ssm.last.input.Name, "/natural-inquiry/github-dispatch-token");
  assert.equal(ssm.last.input.WithDecryption, true);
  assert.equal(fetched.length, 1);
  const [url, init] = fetched[0];
  assert.equal(url, "https://api.github.com/repos/chloeroseelia/The-Natural-Inquiry/actions/workflows/publish-content.yml/dispatches");
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.equal(init.headers.Authorization, `Bearer ${good}`);
  assert.deepEqual(JSON.parse(init.body), { ref: "main", inputs: { manifest_sha256: "a".repeat(64), manifest_generated_at: input.generatedAt } });
  // Only the hash and timestamp travel to GitHub: no content, ids or titles.
  assert.deepEqual(Object.keys(JSON.parse(init.body).inputs).sort(), ["manifest_generated_at", "manifest_sha256"]);
  assert.ok(!init.body.includes(good), "the token is never in the request body");

  fetched.length = 0;
  const missingParam = Object.assign(new Error("x"), { name: "ParameterNotFound" });
  assert.equal((await make({ ssmClient: ssm(null, missingParam) })(input)).status, "not-configured");
  assert.equal((await make({ ssmClient: ssm("not a token!") })(input)).status, "not-configured");
  assert.equal((await make({ parameterName: undefined })(input)).status, "not-configured");
  for (const badTarget of [undefined, { ...target, owner: "evil/owner" }, { ...target, repo: "../x" }, { ...target, workflow: "../../x.yml" }, { ...target, workflow: "a.sh" }, { ...target, ref: ".hidden" }, { ...target, repo: "" }]) {
    assert.equal((await make({ target: badTarget })(input)).status, "not-configured");
  }
  assert.equal((await make()({ manifestSha256: "xyz", generatedAt: "t" })).status, "failed");
  assert.equal(fetched.length, 0, "no request for missing, invalid or malformed configuration");
  assert.deepEqual(validateDispatchTarget(target), target);

  const rejected = await make({ fetchImpl: async () => ({ ok: false, status: 403 }) })(input);
  assert.deepEqual(rejected, { status: "failed", reason: "GitHub rejected the workflow request (HTTP 403)." });
  assert.ok(!JSON.stringify(rejected).includes("github_pat"));
  const notNoContent = await make({ fetchImpl: async () => ({ ok: true, status: 200 }) })(input);
  assert.equal(notNoContent.status, "failed", "only 204 counts as dispatched");
  await assert.rejects(make({ ssmClient: ssm(null, Object.assign(new Error("boom"), { name: "AccessDeniedException" })) })(input));
  assert.deepEqual(networkCalls, []);
  pass("the GitHub dispatcher sends one fixed, validated request carrying only the manifest hash, and never leaks the token");
}

console.log(`\nAll ${n} publish-function test groups passed.`);
