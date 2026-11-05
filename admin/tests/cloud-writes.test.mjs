// Synthetic tests for cloud writes (create / update / delete), client-side conflict detection,
// failed writes, cache refresh, and field serialization.
// In-memory only: no IndexedDB, no AWS. Run from admin/: node tests/cloud-writes.test.mjs
import assert from "node:assert/strict";
import {
  CloudConflictError,
  buildUpdateInput,
  deleteCloudContent,
  detectConflict,
  saveCloudRecord,
  serializeJsonFields
} from "../src/cloud-writes.js";
import { createCachedCloudContent } from "../src/cloud-repository.js";

let n = 0;
const pass = (name) => console.log(`${++n} ${name}: ok`);

// ---- in-memory fake cloud ----------------------------------------------------------------
function makeCloud() {
  const store = new Map();
  const calls = [];
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 5, 12, 0, 0) + (++tick) * 1000).toISOString();
  const key = (model, id) => `${model}:${id}`;
  const fail = { get: null, create: null, update: null, delete: null };

  const io = {
    async get(model, id) {
      calls.push(["get", model, id]);
      if (fail.get) throw new Error(fail.get);
      const found = store.get(key(model, id));
      return found ? structuredClone(found) : null;
    },
    async create(model, input) {
      calls.push(["create", model, input]);
      if (fail.create) throw new Error(fail.create);
      if (store.has(key(model, input.id))) throw new Error("The conditional request failed");
      const record = { ...input, createdAt: stamp(), updatedAt: stamp() };
      store.set(key(model, input.id), record);
      return structuredClone(record);
    },
    async update(model, input) {
      calls.push(["update", model, input]);
      if (fail.update) throw new Error(fail.update);
      const existing = store.get(key(model, input.id));
      if (!existing) throw new Error("Cannot update a missing record");
      const record = { ...existing, ...input, updatedAt: stamp() };
      store.set(key(model, input.id), record);
      return structuredClone(record);
    },
    async delete(model, id) {
      calls.push(["delete", model, id]);
      if (fail.delete) throw new Error(fail.delete);
      const existing = store.get(key(model, id));
      store.delete(key(model, id));
      return existing ?? null;
    }
  };

  // Puts a record directly into the store, as if written by an earlier migration.
  function seed(model, record) {
    const full = { revision: 1, createdAt: stamp(), updatedAt: stamp(), ...record };
    store.set(key(model, record.id), full);
    return structuredClone(full);
  }
  const writes = () => calls.filter(([name]) => name !== "get");
  return { io, store, calls, seed, writes, fail, key };
}

const researchCloud = {
  id: "existing-garibaldi",
  title: "Garibaldi",
  summary: "Intro",
  overview: "Overview text",
  overviewTitle: "Overview",
  projectNote: "A note",
  projectStage: "PAST",
  status: "DRAFT",
  publicPath: "research/garibaldi.html",
  indexCategories: JSON.stringify([{ id: "a", subjects: ["x"] }]),
  mediaKeys: JSON.stringify(["media/one.jpg"]),
  publishedAt: "2024-05-01T00:00:00.000Z",
  importedCreatedAt: "2024-01-01T00:00:00.000Z",
  importedUpdatedAt: null
};
const profileCloud = {
  id: "profile-biography-title",
  sectionKey: "biography",
  title: "Biography",
  summary: "Summary",
  content: "Bio text",
  status: "DRAFT",
  sortOrder: 1,
  publicPath: "profile.html",
  importedCreatedAt: null,
  importedUpdatedAt: null
};

import { cloudToLocal } from "../src/cloud-mapping.js";
const loaded = (model, cloud) => cloudToLocal(model, cloud).record;

// ---- 1. create ---------------------------------------------------------------------------
{
  const cloud = makeCloud();
  const local = { id: "new-uuid-1", kind: "project", isExisting: false, status: "Planned", title: "New project", subtitle: "Short intro", overviewTitle: "", overview: "Body", note: "", sourcePath: "", updatedAt: null };
  const result = await saveCloudRecord({ modelName: "ResearchProject", local, io: cloud.io, now: () => "2026-11-05T10:00:00.000Z" });

  assert.equal(result.action, "created");
  assert.deepEqual(cloud.calls.map(([name]) => name), ["get", "create"], "looks up before creating, never updates");
  const sent = cloud.calls[1][2];
  assert.equal(sent.id, "new-uuid-1");
  assert.equal(sent.revision, 1);
  assert.equal(sent.projectStage, "PLANNED");
  assert.equal(sent.summary, "Short intro");
  assert.equal(sent.importedCreatedAt, "2026-11-05T10:00:00.000Z");
  assert.equal(sent.importedUpdatedAt, "2026-11-05T10:00:00.000Z");
  assert.ok(!("mediaKeys" in sent) && !("indexCategories" in sent), "missing optional fields stay omitted");
  assert.equal(result.record.id, "new-uuid-1");
  assert.equal(result.record.status, "Planned");
  assert.equal(result.record.subtitle, "Short intro");
  assert.equal(result.record.revision, 1);
  assert.ok(result.record.cloudUpdatedAt, "returned record carries the next baseline");
  assert.equal(cloud.store.size, 1);
  pass("create: lookup then create-only, revision 1, optional fields omitted, baseline returned");
}

// ---- 2. create refuses an existing id ----------------------------------------------------
{
  const cloud = makeCloud();
  cloud.seed("ResearchProject", researchCloud);
  const local = { id: "existing-garibaldi", kind: "project", status: "Past", title: "Other", subtitle: "x" };
  await assert.rejects(
    saveCloudRecord({ modelName: "ResearchProject", local, io: cloud.io }),
    (error) => error instanceof CloudConflictError && /already exists/.test(error.message)
  );
  assert.equal(cloud.writes().length, 0, "no write attempted");
  assert.equal(cloud.store.get("ResearchProject:existing-garibaldi").title, "Garibaldi", "existing record untouched");
  pass("create never overwrites an existing id");
}

// ---- 3. update research: only editable fields, nothing else changes -----------------------
{
  const cloud = makeCloud();
  cloud.seed("ResearchProject", researchCloud);
  const before = structuredClone(cloud.store.get("ResearchProject:existing-garibaldi"));
  const local = { ...loaded("ResearchProject", cloud.store.get("ResearchProject:existing-garibaldi")), title: "Garibaldi (edited)", note: "", status: "In progress" };
  const result = await saveCloudRecord({ modelName: "ResearchProject", local, io: cloud.io, now: () => "2026-11-05T11:00:00.000Z" });

  assert.equal(result.action, "updated");
  assert.deepEqual(cloud.calls.map(([name]) => name), ["get", "update"], "fetches latest before updating");
  const input = cloud.calls[1][2];
  assert.deepEqual(Object.keys(input).sort(), ["id", "importedUpdatedAt", "overview", "overviewTitle", "projectNote", "projectStage", "revision", "summary", "title"].sort());
  assert.equal(input.revision, 2);
  assert.equal(input.projectNote, null, "blank optional text is cleared");
  assert.equal(input.projectStage, "IN_PROGRESS");

  const after = cloud.store.get("ResearchProject:existing-garibaldi");
  for (const untouched of ["mediaKeys", "indexCategories", "publishedAt", "status", "publicPath", "importedCreatedAt", "createdAt"]) {
    assert.deepEqual(after[untouched], before[untouched], `${untouched} was preserved`);
  }
  assert.equal(after.title, "Garibaldi (edited)");
  assert.equal(result.record.revision, 2);
  assert.equal(result.record.note, "");
  assert.equal(result.record.status, "In progress");
  pass("update research: latest fetched, only editable fields sent, revision +1, others preserved");
}

// ---- 4. update profile ----------------------------------------------------------------------
{
  const cloud = makeCloud();
  cloud.seed("ProfileContent", profileCloud);
  const local = { ...loaded("ProfileContent", cloud.store.get("ProfileContent:profile-biography-title")), content: "New bio" };
  const result = await saveCloudRecord({ modelName: "ProfileContent", local, io: cloud.io, now: () => "2026-11-05T11:00:00.000Z" });
  const input = cloud.calls.find(([name]) => name === "update")[2];
  assert.deepEqual(Object.keys(input).sort(), ["content", "id", "importedUpdatedAt", "revision", "summary", "title"].sort());
  const after = cloud.store.get("ProfileContent:profile-biography-title");
  assert.equal(after.content, "New bio");
  assert.equal(after.sectionKey, "biography");
  assert.equal(after.sortOrder, 1);
  assert.equal(after.publicPath, "profile.html");
  assert.equal(result.record.content, "New bio");
  pass("update profile: sectionKey, sortOrder and publicPath are never sent");
}

// ---- 5. conflict detection --------------------------------------------------------------------
{
  const cloud = makeCloud();
  cloud.seed("ResearchProject", researchCloud);
  const stale = loaded("ResearchProject", cloud.store.get("ResearchProject:existing-garibaldi"));

  // Someone else saves first.
  await saveCloudRecord({ modelName: "ResearchProject", local: { ...stale, title: "Other writer" }, io: cloud.io });
  const writesBefore = cloud.writes().length;

  await assert.rejects(
    saveCloudRecord({ modelName: "ResearchProject", local: { ...stale, title: "Stale write" }, io: cloud.io }),
    (error) => error instanceof CloudConflictError && /changed in the cloud/.test(error.message) && /Nothing was saved/.test(error.message)
  );
  assert.equal(cloud.writes().length, writesBefore, "stale update did not write");
  assert.equal(cloud.store.get("ResearchProject:existing-garibaldi").title, "Other writer", "newer cloud content not overwritten");

  // Same revision but newer updatedAt is still a conflict.
  const sameRevision = { ...cloud.store.get("ResearchProject:existing-garibaldi") };
  assert.match(detectConflict({ revision: sameRevision.revision, cloudUpdatedAt: "2000-01-01T00:00:00.000Z" }, sameRevision), /changed in the cloud/);
  assert.equal(detectConflict({ revision: sameRevision.revision, cloudUpdatedAt: sameRevision.updatedAt }, sameRevision), null);
  // Equivalent timestamp formats do not cause false conflicts.
  assert.equal(detectConflict({ revision: 1, cloudUpdatedAt: "2026-11-05T12:00:01Z" }, { revision: 1, updatedAt: "2026-11-05T12:00:01.000Z" }), null);

  // Deleted in the cloud.
  cloud.store.delete("ResearchProject:existing-garibaldi");
  const fresh = { ...stale, revision: 2, cloudUpdatedAt: "2026-11-05T12:00:00.000Z" };
  await assert.rejects(
    saveCloudRecord({ modelName: "ResearchProject", local: fresh, io: cloud.io }),
    (error) => error instanceof CloudConflictError && /no longer exists/.test(error.message)
  );
  assert.equal(cloud.store.size, 0, "a missing record is not recreated by an update");

  // Unknown baseline cannot be verified, so it is refused.
  assert.match(detectConflict({}, { revision: 1, updatedAt: "x" }), /unknown/);
  pass("conflicts: revision change, timestamp change, deleted record, unknown baseline; nothing overwritten");
}

// ---- 6. sequential saves use the returned baseline ---------------------------------------------
{
  const cloud = makeCloud();
  cloud.seed("ProfileContent", profileCloud);
  const original = loaded("ProfileContent", cloud.store.get("ProfileContent:profile-biography-title"));
  const first = await saveCloudRecord({ modelName: "ProfileContent", local: { ...original, content: "v2" }, io: cloud.io });
  const second = await saveCloudRecord({ modelName: "ProfileContent", local: { ...first.record, content: "v3" }, io: cloud.io });
  assert.equal(second.record.revision, 3);
  await assert.rejects(
    saveCloudRecord({ modelName: "ProfileContent", local: { ...original, content: "stale" }, io: cloud.io }),
    CloudConflictError
  );
  assert.equal(cloud.store.get("ProfileContent:profile-biography-title").content, "v3");
  pass("sequential saves chain revisions; the original baseline is rejected as stale");
}

// ---- 7. failed writes ---------------------------------------------------------------------------
{
  const cloud = makeCloud();
  cloud.seed("ResearchProject", researchCloud);
  const local = loaded("ResearchProject", cloud.store.get("ResearchProject:existing-garibaldi"));
  const snapshot = structuredClone(cloud.store.get("ResearchProject:existing-garibaldi"));

  cloud.fail.update = "Network error";
  await assert.rejects(saveCloudRecord({ modelName: "ResearchProject", local: { ...local, title: "X" }, io: cloud.io }), /Network error/);
  assert.deepEqual(cloud.store.get("ResearchProject:existing-garibaldi"), snapshot, "failed update left the record unchanged");

  cloud.fail.update = null;
  cloud.fail.get = "Not authorized";
  await assert.rejects(saveCloudRecord({ modelName: "ResearchProject", local: { ...local, title: "X" }, io: cloud.io }), /Not authorized/);
  assert.equal(cloud.writes().filter(([name]) => name === "update").length, 1, "no write when the pre-check fails");

  cloud.fail.get = null;
  cloud.fail.create = "Create failed";
  await assert.rejects(saveCloudRecord({ modelName: "ResearchProject", local: { id: "n1", kind: "project", status: "Past", title: "T", subtitle: "s" }, io: cloud.io }), /Create failed/);
  assert.equal(cloud.store.has("ResearchProject:n1"), false);

  cloud.fail.delete = "Delete failed";
  await assert.rejects(deleteCloudContent({ modelName: "ResearchProject", record: local, io: cloud.io }), /Delete failed/);
  assert.ok(cloud.store.has("ResearchProject:existing-garibaldi"), "failed delete kept the record");

  // The lock is released after failures, so a retry works.
  cloud.fail.delete = null;
  const retry = await saveCloudRecord({ modelName: "ResearchProject", local: { ...local, title: "Retry works" }, io: cloud.io });
  assert.equal(retry.record.title, "Retry works");
  pass("failed writes reject, leave records unchanged, and allow a retry");
}

// ---- 8. delete -----------------------------------------------------------------------------------
{
  const cloud = makeCloud();
  cloud.seed("ResearchProject", researchCloud);
  const local = loaded("ResearchProject", cloud.store.get("ResearchProject:existing-garibaldi"));

  // Conflict: cloud changed since load.
  await saveCloudRecord({ modelName: "ResearchProject", local: { ...local, title: "Changed elsewhere" }, io: cloud.io });
  await assert.rejects(deleteCloudContent({ modelName: "ResearchProject", record: local, io: cloud.io }), CloudConflictError);
  assert.ok(!cloud.calls.some(([name]) => name === "delete"), "delete not attempted on conflict");
  assert.ok(cloud.store.has("ResearchProject:existing-garibaldi"));

  // Up-to-date baseline deletes.
  const latest = loaded("ResearchProject", cloud.store.get("ResearchProject:existing-garibaldi"));
  const deleted = await deleteCloudContent({ modelName: "ResearchProject", record: latest, io: cloud.io });
  assert.equal(deleted.action, "deleted");
  assert.equal(cloud.store.size, 0);

  // Already gone is idempotent.
  const again = await deleteCloudContent({ modelName: "ResearchProject", record: latest, io: cloud.io });
  assert.equal(again.action, "already_deleted");
  assert.equal(cloud.calls.filter(([name]) => name === "delete").length, 1);
  pass("delete: conflict blocks, current baseline deletes, repeat is idempotent");
}

// ---- 9. scope: Profile can only be updated -------------------------------------------------------
{
  const cloud = makeCloud();
  await assert.rejects(saveCloudRecord({ modelName: "ProfileContent", local: { id: "profile-new", title: "t" }, io: cloud.io }), /cannot be created/);
  await assert.rejects(deleteCloudContent({ modelName: "ProfileContent", record: { id: "profile-biography-title" }, io: cloud.io }), /cannot be deleted/);
  await assert.rejects(saveCloudRecord({ modelName: "Bogus", local: { id: "x" }, io: cloud.io }), /cannot be created/);
  assert.equal(cloud.calls.length, 0, "no cloud call was made");
  pass("scope: Profile can only be updated; unknown models are refused");
}

// ---- 10. validation before any network call ---------------------------------------------------
{
  const cloud = makeCloud();
  await assert.rejects(saveCloudRecord({ modelName: "ResearchProject", local: { id: "x", kind: "project", status: "Past", title: "", subtitle: "s" }, io: cloud.io }), /Title is required/);
  const huge = { id: "big", kind: "project", status: "Past", title: "Big", subtitle: "s", overview: "x".repeat(400 * 1024) };
  await assert.rejects(saveCloudRecord({ modelName: "ResearchProject", local: huge, io: cloud.io }), /400 KB/);
  await assert.rejects(saveCloudRecord({ modelName: "ResearchProject", local: { kind: "project" }, io: cloud.io }), /no id/);
  assert.equal(cloud.calls.length, 0, "validation failures make no cloud calls");
  pass("blocked and oversized records are refused before any cloud call");
}

// ---- 11. concurrent saves of one record are serialised -------------------------------------------
{
  const cloud = makeCloud();
  cloud.seed("ProfileContent", profileCloud);
  const local = loaded("ProfileContent", cloud.store.get("ProfileContent:profile-biography-title"));
  const slowIo = { ...cloud.io, get: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 20)); return cloud.io.get(...args); } };
  const results = await Promise.allSettled([
    saveCloudRecord({ modelName: "ProfileContent", local: { ...local, content: "a" }, io: slowIo }),
    saveCloudRecord({ modelName: "ProfileContent", local: { ...local, content: "b" }, io: slowIo })
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  assert.match(results.find((r) => r.status === "rejected").reason.message, /already in progress/);
  assert.equal(cloud.writes().length, 1);
  pass("double-submit: second concurrent save is rejected");
}

// ---- 12. field serialization ----------------------------------------------------------------------
{
  const out = serializeJsonFields({
    id: "x",
    indexCategories: [{ id: "a", subjects: ["s"] }],
    references: [],
    mediaKeys: { a: 1 },
    title: "plain",
    summary: null
  });
  assert.equal(out.indexCategories, '[{"id":"a","subjects":["s"]}]', "arrays become JSON strings");
  assert.equal(out.references, "[]", "empty arrays are preserved");
  assert.equal(out.mediaKeys, '{"a":1}', "objects become JSON strings");
  assert.equal(out.title, "plain");
  assert.equal(out.summary, null, "null is not stringified");
  assert.equal(serializeJsonFields({ indexCategories: '["already"]' }).indexCategories, '["already"]', "strings are not double-encoded");
  assert.ok(!("x" in serializeJsonFields({})));

  const input = buildUpdateInput("ResearchProject", { id: "r", kind: "project", status: "Past", title: "T", subtitle: "S", overview: "", overviewTitle: "H", note: "N" }, 5, () => "2026-11-05T00:00:00.000Z");
  assert.deepEqual(input, {
    id: "r", revision: 5, title: "T", summary: "S", overview: null, overviewTitle: "H",
    projectNote: "N", projectStage: "PAST", importedUpdatedAt: "2026-11-05T00:00:00.000Z"
  });
  pass("serialization: AWSJSON strings, empty arrays, null handling, update input shape");
}

// ---- 13. cache refresh after writes ---------------------------------------------------------------
{
  let listCalls = 0;
  const base = [
    { id: "a", title: "A", revision: 1, cloudUpdatedAt: "t1" },
    { id: "c", title: "C", revision: 1, cloudUpdatedAt: "t1" }
  ];
  const repo = {
    listPublications: async () => ({ records: [], issues: [] }),
    listProfileContent: async () => ({ records: [], issues: [] }),
    listResearchProjects: async () => { listCalls += 1; return { records: base.map((r) => ({ ...r })), issues: [{ id: "c", warnings: ["w"] }] }; }
  };
  const content = createCachedCloudContent(repo);

  assert.equal(await content.applyWrite("research", { record: { id: "z" } }), undefined, "no-op when nothing is cached");

  await content.load("research");
  await content.applyWrite("research", { record: { id: "a", title: "A2", revision: 2, cloudUpdatedAt: "t2" } });
  let current = await content.load("research");
  assert.deepEqual(current.records.map((r) => [r.id, r.title, r.revision]), [["a", "A2", 2], ["c", "C", 1]], "update replaces in place");

  await content.applyWrite("research", { record: { id: "b", title: "B", revision: 1, cloudUpdatedAt: "t3" } });
  current = await content.load("research");
  assert.deepEqual(current.records.map((r) => r.id), ["a", "b", "c"], "new record is added in id order");

  await content.applyWrite("research", { removeId: "a" });
  current = await content.load("research");
  assert.deepEqual(current.records.map((r) => r.id), ["b", "c"], "delete removes the record");
  assert.equal(current.issues.length, 1, "issues are preserved");
  assert.equal(listCalls, 1, "no refetch was needed after writes");

  content.reset();
  await content.load("research");
  assert.equal(listCalls, 2, "reset forces a fresh read from the cloud");
  pass("cache refresh: replace, add, remove without refetch; reset refetches");
}

// ---- 14. cache is only touched after a confirmed write ----------------------------------------------
{
  const cloud = makeCloud();
  cloud.seed("ProfileContent", profileCloud);
  const local = loaded("ProfileContent", cloud.store.get("ProfileContent:profile-biography-title"));
  const content = createCachedCloudContent({
    listPublications: async () => ({ records: [], issues: [] }),
    listResearchProjects: async () => ({ records: [], issues: [] }),
    listProfileContent: async () => ({ records: [local], issues: [] })
  });
  await content.load("profile");

  // Mirrors the App handler: the cache is updated only if saveCloudRecord resolves.
  async function handler(entry) {
    const { record } = await saveCloudRecord({ modelName: "ProfileContent", local: entry, io: cloud.io });
    await content.applyWrite("profile", { record });
    return record;
  }
  cloud.fail.update = "boom";
  await assert.rejects(handler({ ...local, content: "lost" }), /boom/);
  assert.equal((await content.load("profile")).records[0].content, "Bio text", "failed write did not change the cache");
  cloud.fail.update = null;
  await handler({ ...local, content: "kept" });
  assert.equal((await content.load("profile")).records[0].content, "kept");
  pass("cache reflects only confirmed writes");
}

// ---- 15. publications: create / edit / publish / archive / delete -----------------------------------
const publicationCloud = {
  id: "existing-publication-seaweed",
  title: "Seaweed Made Simple",
  subtitle: "Quick meals",
  category: "Essay",
  content: "<p>Body é “q”</p>",
  contentFormat: "RICH_TEXT",
  status: "PUBLISHED",
  archived: false,
  indexCategories: JSON.stringify([{ id: "a", subjects: ["x", "y"] }]),
  references: JSON.stringify([{ id: "r1", title: "Ref", url: "https://example.org" }]),
  mediaKeys: JSON.stringify(["media/seaweed.jpg"]),
  sourceDocumentName: "Seaweed.pdf",
  publicPath: "writing/seaweed.html",
  publishedAt: "2024-05-01T00:00:00.000Z",
  importedCreatedAt: "2024-01-01T00:00:00.000Z",
  importedUpdatedAt: "2024-02-01T00:00:00.000Z"
};

{
  const cloud = makeCloud();
  const local = { id: "pub-new", title: "Fresh", subtitle: "", category: "Essay", status: "Draft", archived: false, publishedAt: "", indexCategories: [], references: [], bodyHtml: "<p>Hi</p>", sourcePage: "", sourceDocumentName: "", createdAt: "2026-11-05T09:00:00.000Z", updatedAt: "2026-11-05T09:00:00.000Z" };
  const result = await saveCloudRecord({ modelName: "Publication", local, io: cloud.io });
  assert.equal(result.action, "created");
  assert.deepEqual(cloud.calls.map(([name]) => name), ["get", "create"]);
  const sent = cloud.calls[1][2];
  assert.equal(sent.status, "DRAFT");
  assert.equal(sent.archived, false);
  assert.equal(sent.content, "<p>Hi</p>");
  assert.ok(!("indexCategories" in sent) && !("references" in sent) && !("mediaKeys" in sent), "empty arrays and missing fields are omitted, never sent as 'null' or '[]'");
  assert.equal(result.record.revision, 1);
  assert.equal(result.record.bodyHtml, "<p>Hi</p>");

  // Publishing a new record with no date stamps one.
  const published = await saveCloudRecord({ modelName: "Publication", local: { ...local, id: "pub-new-2", status: "Published" }, io: cloud.io, now: () => "2026-11-05T10:00:00.000Z" });
  assert.equal(cloud.calls.filter(([n]) => n === "create").at(-1)[2].publishedAt, "2026-11-05T10:00:00.000Z");
  assert.equal(published.record.status, "Published");
  pass("publication create: create-only, optional JSON omitted, publish date stamped");
}

{
  const cloud = makeCloud();
  cloud.seed("Publication", publicationCloud);
  const key = "Publication:existing-publication-seaweed";
  const before = structuredClone(cloud.store.get(key));
  const local = { ...loaded("Publication", before), title: "Seaweed (edited)", bodyHtml: "<p>New</p>" };
  const result = await saveCloudRecord({ modelName: "Publication", local, io: cloud.io, now: () => "2026-11-05T11:00:00.000Z" });

  assert.equal(result.action, "updated");
  const input = cloud.calls.find(([n]) => n === "update")[2];
  for (const forbidden of ["mediaKeys", "publicPath", "contentFormat", "importedCreatedAt", "summary", "id2"]) {
    assert.ok(!(forbidden in input), `${forbidden} is never sent on update`);
  }
  assert.equal(typeof input.indexCategories, "string", "AWSJSON sent as a JSON string");
  assert.equal(typeof input.references, "string");
  assert.deepEqual(JSON.parse(input.indexCategories), [{ id: "a", subjects: ["x", "y"] }]);
  assert.equal(input.revision, 2);
  const after = cloud.store.get(key);
  assert.equal(after.title, "Seaweed (edited)");
  assert.equal(after.content, "<p>New</p>");
  for (const preserved of ["mediaKeys", "publicPath", "contentFormat", "importedCreatedAt", "sourceDocumentName", "publishedAt", "status", "references", "indexCategories"]) {
    assert.deepEqual(after[preserved], before[preserved], `${preserved} preserved`);
  }
  pass("publication edit: media keys, public path and all metadata preserved; AWSJSON stays a string");
}

{
  const cloud = makeCloud();
  cloud.seed("Publication", publicationCloud);
  const key = "Publication:existing-publication-seaweed";
  let local = loaded("Publication", cloud.store.get(key));

  // Unpublish keeps the publication date.
  let result = await saveCloudRecord({ modelName: "Publication", local: { ...local, status: "Draft" }, io: cloud.io });
  assert.equal(cloud.store.get(key).status, "DRAFT");
  assert.equal(cloud.store.get(key).publishedAt, "2024-05-01T00:00:00.000Z");

  // Archive then restore.
  result = await saveCloudRecord({ modelName: "Publication", local: { ...result.record, archived: true }, io: cloud.io });
  assert.equal(cloud.store.get(key).archived, true);
  assert.equal(result.record.archived, true);
  result = await saveCloudRecord({ modelName: "Publication", local: { ...result.record, archived: false }, io: cloud.io });
  assert.equal(cloud.store.get(key).archived, false);

  // Publish again: existing date is kept, not restamped.
  result = await saveCloudRecord({ modelName: "Publication", local: { ...result.record, status: "Published" }, io: cloud.io, now: () => "2030-01-01T00:00:00.000Z" });
  assert.equal(cloud.store.get(key).status, "PUBLISHED");
  assert.equal(cloud.store.get(key).publishedAt, "2024-05-01T00:00:00.000Z");
  assert.equal(cloud.store.get(key).revision, 5);
  pass("publication publish/unpublish and archive/restore");
}

{
  // Draft-like cloud statuses are not silently downgraded, and restoring leaves ARCHIVED.
  const cloud = makeCloud();
  cloud.seed("Publication", { ...publicationCloud, id: "in-review", status: "IN_REVIEW" });
  cloud.seed("Publication", { ...publicationCloud, id: "was-archived", status: "ARCHIVED", archived: true });
  const review = loaded("Publication", cloud.store.get("Publication:in-review"));
  await saveCloudRecord({ modelName: "Publication", local: { ...review, title: "Edited review" }, io: cloud.io });
  assert.equal(cloud.store.get("Publication:in-review").status, "IN_REVIEW", "IN_REVIEW kept");

  const archived = loaded("Publication", cloud.store.get("Publication:was-archived"));
  assert.equal(archived.archived, true);
  await saveCloudRecord({ modelName: "Publication", local: { ...archived, archived: false }, io: cloud.io });
  assert.equal(cloud.store.get("Publication:was-archived").status, "DRAFT", "restored record leaves ARCHIVED");
  assert.equal(cloud.store.get("Publication:was-archived").archived, false);
  pass("publication statuses: IN_REVIEW not downgraded; restore leaves ARCHIVED");
}

{
  // Clearing filings/references writes null, not "[]"; null is not stringified.
  const cloud = makeCloud();
  cloud.seed("Publication", publicationCloud);
  const key = "Publication:existing-publication-seaweed";
  const local = { ...loaded("Publication", cloud.store.get(key)), indexCategories: [], references: [] };
  await saveCloudRecord({ modelName: "Publication", local, io: cloud.io });
  const input = cloud.calls.find(([n]) => n === "update")[2];
  assert.equal(input.indexCategories, null);
  assert.equal(input.references, null);
  assert.equal(cloud.store.get(key).indexCategories, null);
  const reread = cloudToLocal("Publication", cloud.store.get(key)).record;
  assert.deepEqual([reread.indexCategories, reread.references], [[], []]);
  pass("publication: emptied JSON fields are stored as null and read back as []");
}

{
  // Conflicts, failures, delete.
  const cloud = makeCloud();
  cloud.seed("Publication", publicationCloud);
  const key = "Publication:existing-publication-seaweed";
  const stale = loaded("Publication", cloud.store.get(key));
  await saveCloudRecord({ modelName: "Publication", local: { ...stale, title: "Other tab" }, io: cloud.io });

  await assert.rejects(saveCloudRecord({ modelName: "Publication", local: { ...stale, title: "Stale" }, io: cloud.io }), CloudConflictError);
  assert.equal(cloud.store.get(key).title, "Other tab");
  await assert.rejects(deleteCloudContent({ modelName: "Publication", record: stale, io: cloud.io }), CloudConflictError);
  assert.ok(cloud.store.has(key), "stale delete blocked");

  const latest = loaded("Publication", cloud.store.get(key));
  cloud.fail.delete = "Delete failed";
  await assert.rejects(deleteCloudContent({ modelName: "Publication", record: latest, io: cloud.io }), /Delete failed/);
  assert.ok(cloud.store.has(key));
  cloud.fail.delete = null;
  assert.equal((await deleteCloudContent({ modelName: "Publication", record: latest, io: cloud.io })).action, "deleted");
  assert.equal(cloud.store.size, 0);

  // Validation: category and title required, oversized refused.
  await assert.rejects(saveCloudRecord({ modelName: "Publication", local: { id: "v", title: "T", category: "", status: "Draft" }, io: cloud.io }), /Category is required/);
  await assert.rejects(saveCloudRecord({ modelName: "Publication", local: { id: "v", title: "", category: "Essay", status: "Draft" }, io: cloud.io }), /Title is required/);
  await assert.rejects(saveCloudRecord({ modelName: "Publication", local: { id: "v", title: "T", category: "Essay", status: "Draft", bodyHtml: "x".repeat(400 * 1024) }, io: cloud.io }), /400 KB/);
  pass("publication conflicts, failed delete, delete, and validation");
}

{
  // The two migrated publications round-trip through an unchanged save without losing anything.
  const cloud = makeCloud();
  cloud.seed("Publication", publicationCloud);
  const key = "Publication:existing-publication-seaweed";
  const before = structuredClone(cloud.store.get(key));
  const local = loaded("Publication", before);
  await saveCloudRecord({ modelName: "Publication", local, io: cloud.io });
  const after = cloud.store.get(key);
  for (const field of ["title", "subtitle", "category", "content", "contentFormat", "status", "archived", "indexCategories", "references", "mediaKeys", "sourceDocumentName", "publicPath", "publishedAt", "importedCreatedAt"]) {
    assert.deepEqual(after[field], before[field], `${field} unchanged by a no-op save`);
  }
  pass("an unchanged save of a migrated publication preserves every stored field");
}

{
  // Every UI-editable field changes in one save; each lands in the right cloud field.
  const cloud = makeCloud();
  cloud.seed("Publication", publicationCloud);
  const key = "Publication:existing-publication-seaweed";
  const before = structuredClone(cloud.store.get(key));
  const local = {
    ...loaded("Publication", before),
    title: "T2", subtitle: "S2", category: "Review", bodyHtml: "<p>B2</p>", status: "Draft", archived: true,
    indexCategories: [{ id: "b", subjects: ["z"] }], references: [{ id: "r2", title: "R2" }],
    sourceDocumentName: "New.pdf", publishedAt: "2025-02-03"
  };
  const { record } = await saveCloudRecord({ modelName: "Publication", local, io: cloud.io });
  const after = cloud.store.get(key);
  assert.equal(after.title, "T2");
  assert.equal(after.subtitle, "S2");
  assert.equal(after.category, "Review");
  assert.equal(after.content, "<p>B2</p>");
  assert.equal(after.status, "DRAFT");
  assert.equal(after.archived, true);
  assert.deepEqual(JSON.parse(after.indexCategories), [{ id: "b", subjects: ["z"] }]);
  assert.deepEqual(JSON.parse(after.references), [{ id: "r2", title: "R2" }]);
  assert.equal(after.sourceDocumentName, "New.pdf");
  assert.equal(after.publishedAt, "2025-02-03T00:00:00.000Z");
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.id, before.id, "id unchanged");
  assert.equal(record.title, "T2");
  assert.equal(record.publishedAt, "2025-02-03");
  pass("publication: every editable field edited in one save, id and revision handled");
}

console.log(`all ${n} test groups passed`);
