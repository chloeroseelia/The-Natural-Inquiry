// Synthetic tests for Subject Index <-> cloud reconciliation (Phase 4e).
// In-memory only: no IndexedDB, no AWS, no local endpoints. Run from admin/: node tests/subject-index.test.mjs
import assert from "node:assert/strict";
import {
  READ_ONLY_MODELS,
  describeFilings,
  normalizeFilings,
  planPublicationReconciliation,
  reconcileDraftFilings,
  reconcilePublications
} from "../src/subject-index-reconcile.js";
import { buildUpdateInput, saveCloudRecord } from "../src/cloud-writes.js";
import { cloudToLocal } from "../src/cloud-mapping.js";
import { createCachedCloudContent } from "../src/cloud-repository.js";

let n = 0;
const pass = (name) => console.log(`${++n} ${name}: ok`);

// Any IndexedDB or local endpoint use during these tests is a failure.
const forbidden = [];
globalThis.fetch = (...args) => { forbidden.push(["fetch", args[0]]); throw new Error("local endpoint called"); };
Object.defineProperty(globalThis, "indexedDB", { configurable: true, get() { forbidden.push(["indexedDB"]); throw new Error("IndexedDB used"); } });

function makeCloud() {
  const store = new Map();
  const calls = [];
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 5, 12, 0, 0) + (++tick) * 1000).toISOString();
  const key = (model, id) => `${model}:${id}`;
  const fail = { update: null };
  const io = {
    async get(model, id) { calls.push(["get", model, id]); const f = store.get(key(model, id)); return f ? structuredClone(f) : null; },
    async create(model, input) { calls.push(["create", model, input]); throw new Error("create must not be called"); },
    async update(model, input) {
      calls.push(["update", model, input]);
      if (fail.update) throw new Error(fail.update);
      const record = { ...store.get(key(model, input.id)), ...input, updatedAt: stamp() };
      store.set(key(model, input.id), record);
      return structuredClone(record);
    },
    async delete(model, id) { calls.push(["delete", model, id]); throw new Error("delete must not be called"); }
  };
  const seed = (model, record) => {
    const full = { revision: 1, createdAt: stamp(), updatedAt: stamp(), ...record };
    store.set(key(model, record.id), full);
    return structuredClone(full);
  };
  return { io, store, calls, seed, fail, key, writes: () => calls.filter(([c]) => c !== "get") };
}

const taxonomy = [
  { id: "biology", title: "Biology", subjects: ["Marine biology", "Genetics"] },
  { id: "earth", title: "Earth science", subjects: ["Geology"] }
];

const basePub = {
  title: "Seaweed", subtitle: "Sub", category: "Essay", content: "<p>Body</p>", contentFormat: "RICH_TEXT",
  status: "PUBLISHED", archived: false,
  references: JSON.stringify([{ id: "r", title: "Ref" }]),
  mediaKeys: JSON.stringify(["media/a.jpg"]), sourceDocumentName: "a.pdf", publicPath: "writing/a.html",
  publishedAt: "2024-05-01T00:00:00.000Z", importedCreatedAt: "2024-01-01T00:00:00.000Z", importedUpdatedAt: "2024-02-01T00:00:00.000Z"
};
const filings = (list) => JSON.stringify(list);
const loadedAll = (cloud, ids) => ids.map((id) => cloudToLocal("Publication", cloud.store.get(cloud.key("Publication", id))).record);
const saver = (cloud) => (record) => saveCloudRecord({ modelName: "Publication", local: record, io: cloud.io }).then((r) => r.record);

// ---- 1. display of existing associations, empty and missing data ------------------------------
{
  const cloud = makeCloud();
  cloud.seed("Publication", { ...basePub, id: "p1", indexCategories: filings([{ id: "biology", subjects: ["Marine biology"] }]) });
  cloud.seed("Publication", { ...basePub, id: "p2", indexCategories: null, archived: true, status: "ARCHIVED" });
  cloud.seed("Publication", { ...basePub, id: "p3", indexCategories: "not json {" });
  cloud.seed("Publication", { ...basePub, id: "p4", indexCategories: filings([]) });
  const pubs = loadedAll(cloud, ["p1", "p2", "p3", "p4"]);
  const view = describeFilings(taxonomy, pubs);
  assert.deepEqual(view.byCategory.get("biology").publications.map((p) => p.id), ["p1"]);
  assert.equal(view.byCategory.get("biology").topics.get("Marine biology"), 1);
  assert.equal(view.byCategory.get("earth").publications.length, 0);
  assert.deepEqual(describeFilings([], []).byCategory.size, 0);
  assert.equal(describeFilings(taxonomy, undefined).unknownFilings, 0);
  assert.equal(describeFilings(taxonomy, [{ id: "x", indexCategories: [{ id: "gone", subjects: [] }] }]).unknownFilings, 1);
  assert.deepEqual(planPublicationReconciliation(taxonomy, pubs), [], "null, [] and malformed filings need no reconciliation");
  assert.deepEqual(normalizeFilings(null, taxonomy), []);
  assert.deepEqual(normalizeFilings([null, "x", { id: "biology" }], taxonomy), [{ id: "biology", subjects: [] }]);
  pass("display: existing associations shown; empty, null, malformed and missing data handled");
}

// ---- 2. unfiling a removed topic updates only that record, preserving everything else -----------
{
  const cloud = makeCloud();
  cloud.seed("Publication", { ...basePub, id: "p1", indexCategories: filings([{ id: "biology", subjects: ["Marine biology", "Genetics"] }, { id: "earth", subjects: ["Geology"] }]) });
  cloud.seed("Publication", { ...basePub, id: "p2", indexCategories: filings([{ id: "earth", subjects: ["Geology"] }]) });
  const before = structuredClone(cloud.store.get(cloud.key("Publication", "p1")));
  const untouchedBefore = structuredClone(cloud.store.get(cloud.key("Publication", "p2")));
  const shrunk = [{ id: "biology", title: "Biology", subjects: ["Genetics"] }, taxonomy[1]];
  const applied = [];
  const result = await reconcilePublications({ categories: shrunk, publications: loadedAll(cloud, ["p1", "p2"]), save: saver(cloud), onApplied: (r) => applied.push(r.id) });

  assert.deepEqual([result.planned, result.updated, result.conflicts, result.failed], [1, 1, 0, 0]);
  assert.deepEqual(applied, ["p1"]);
  const after = cloud.store.get(cloud.key("Publication", "p1"));
  assert.deepEqual(JSON.parse(after.indexCategories), [{ id: "biology", subjects: ["Genetics"] }, { id: "earth", subjects: ["Geology"] }]);
  assert.equal(typeof after.indexCategories, "string", "AWSJSON stays a string");
  assert.equal(after.revision, before.revision + 1, "revision incremented");
  for (const field of Object.keys(before)) {
    if (["indexCategories", "revision", "updatedAt"].includes(field)) continue;
    assert.deepEqual(after[field], before[field], `${field} preserved`);
  }
  assert.deepEqual(cloud.store.get(cloud.key("Publication", "p2")), untouchedBefore, "unaffected record untouched");
  assert.equal(cloud.writes().length, 1);
  assert.equal(cloud.writes()[0][2].id, "p1", "the correct record was updated");
  pass("unfile: only the affected record is updated; unrelated fields, mediaKeys and publicPath preserved");
}

// ---- 3. removing a whole category, and adding topics (no writes) --------------------------------
{
  const cloud = makeCloud();
  cloud.seed("Publication", { ...basePub, id: "p1", indexCategories: filings([{ id: "earth", subjects: ["Geology"] }]) });
  const pubs = loadedAll(cloud, ["p1"]);
  const grown = [{ ...taxonomy[0], subjects: [...taxonomy[0].subjects, "Ecology"] }, taxonomy[1]];
  const none = await reconcilePublications({ categories: grown, publications: pubs, save: saver(cloud) });
  assert.equal(none.planned, 0);
  assert.equal(cloud.writes().length, 0, "adding topics never writes to the cloud");

  const result = await reconcilePublications({ categories: [taxonomy[0]], publications: pubs, save: saver(cloud) });
  assert.equal(result.updated, 1);
  const after = cloud.store.get(cloud.key("Publication", "p1"));
  assert.equal(after.indexCategories, null, "an emptied filing list is stored as null, not '[]'");
  assert.equal(after.status, "PUBLISHED");
  assert.deepEqual(cloudToLocal("Publication", after).record.indexCategories, []);
  pass("removed category empties filings as null; adding topics causes no writes");
}

// ---- 4. conflicts: stale record is refused, others continue, nothing overwritten ------------------
{
  const cloud = makeCloud();
  const filed = filings([{ id: "biology", subjects: ["Genetics"] }]);
  cloud.seed("Publication", { ...basePub, id: "stale", indexCategories: filed });
  cloud.seed("Publication", { ...basePub, id: "fresh", indexCategories: filed });
  const pubs = loadedAll(cloud, ["stale", "fresh"]);
  // Another tab edits "stale" after it was loaded.
  await cloud.io.update("Publication", { id: "stale", title: "Edited elsewhere", revision: 2 });
  const result = await reconcilePublications({ categories: [{ ...taxonomy[0], subjects: ["Marine biology"] }], publications: pubs, save: saver(cloud) });
  assert.deepEqual([result.updated, result.conflicts, result.failed], [1, 1, 0]);
  assert.equal(result.results.find((r) => r.id === "stale").status, "conflict");
  assert.equal(cloud.store.get(cloud.key("Publication", "stale")).title, "Edited elsewhere");
  assert.equal(cloud.store.get(cloud.key("Publication", "stale")).indexCategories, filed, "conflicting record not overwritten");
  assert.equal(JSON.parse(cloud.store.get(cloud.key("Publication", "fresh")).indexCategories)[0].subjects.length, 0);
  pass("conflict: stale record refused and reported; remaining records still reconciled");
}

// ---- 5. failed writes and cache behavior -----------------------------------------------------------
{
  const cloud = makeCloud();
  const filed = filings([{ id: "biology", subjects: ["Genetics"] }]);
  cloud.seed("Publication", { ...basePub, id: "p1", indexCategories: filed });
  const pubs = loadedAll(cloud, ["p1"]);
  const cache = createCachedCloudContent({
    listPublications: async () => ({ records: pubs, issues: [] }),
    listResearchProjects: async () => ({ records: [], issues: [] }),
    listProfileContent: async () => ({ records: [], issues: [] })
  });
  await cache.load("publications");
  const onApplied = (record) => cache.applyWrite("publications", { record });
  const categories = [{ ...taxonomy[0], subjects: ["Marine biology"] }];

  cloud.fail.update = "AccessDenied";
  const failed = await reconcilePublications({ categories, publications: pubs, save: saver(cloud), onApplied });
  assert.deepEqual([failed.updated, failed.failed], [0, 1]);
  assert.match(failed.results[0].message, /AccessDenied/);
  assert.deepEqual((await cache.load("publications")).records[0].indexCategories, [{ id: "biology", subjects: ["Genetics"] }], "cache unchanged after failed write");
  assert.equal(cloud.store.get(cloud.key("Publication", "p1")).indexCategories, filed);

  cloud.fail.update = null;
  const ok = await reconcilePublications({ categories, publications: pubs, save: saver(cloud), onApplied });
  assert.equal(ok.updated, 1);
  const cached = (await cache.load("publications")).records[0];
  assert.deepEqual(cached.indexCategories, [{ id: "biology", subjects: [] }], "cache updated only after success");
  assert.equal(cached.revision, 2);
  pass("failed write leaves cloud and cache unchanged and is retryable; success refreshes the cache");
}

// ---- 6. read-only models and unsafe records ----------------------------------------------------------
{
  assert.deepEqual(READ_ONLY_MODELS, ["ResearchProject"]);
  const research = cloudToLocal("ResearchProject", { id: "r1", title: "R", revision: 1, updatedAt: "t", indexCategories: filings([{ id: "biology", subjects: ["x"] }]) }).record;
  const input = buildUpdateInput("ResearchProject", research, 2);
  assert.ok(!("indexCategories" in input), "research updates never send indexCategories");

  // A blocked/oversized publication fails cleanly and is not written.
  const cloud = makeCloud();
  cloud.seed("Publication", { ...basePub, id: "big", indexCategories: filings([{ id: "biology", subjects: ["Genetics"] }]) });
  const pubs = loadedAll(cloud, ["big"]);
  pubs[0].bodyHtml = "x".repeat(400 * 1024);
  const result = await reconcilePublications({ categories: [{ ...taxonomy[0], subjects: ["Marine biology"] }], publications: pubs, save: saver(cloud) });
  assert.equal(result.failed, 1);
  assert.equal(cloud.writes().length, 0);
  pass("research stays read-only; oversized publications are left unchanged and reported");
}

// ---- 7. drafts: pure reconciliation, no mutation, PDFs untouched --------------------------------------
{
  const pdf = new Uint8Array([1, 2, 3]);
  const drafts = [
    { id: "d1", indexCategories: [{ id: "biology", subjects: ["Marine biology", "Gone"] }], pdfData: pdf },
    { id: "d2", indexCategories: [{ id: "biology", subjects: ["Genetics"] }] },
    { id: "d3" }
  ];
  const snapshot = structuredClone(drafts.map(({ pdfData, ...rest }) => rest));
  const next = reconcileDraftFilings(drafts, taxonomy);
  assert.deepEqual(next[0].indexCategories, [{ id: "biology", subjects: ["Marine biology"] }]);
  assert.equal(next[0].pdfData, pdf, "PDF data carried through unchanged");
  assert.equal(next[1], drafts[1], "unchanged drafts keep identity");
  assert.equal(next[2], drafts[2]);
  assert.deepEqual(drafts.map(({ pdfData, ...rest }) => rest), snapshot, "input drafts not mutated");
  assert.deepEqual(reconcileDraftFilings(undefined, taxonomy), []);
  pass("drafts: reconciliation unchanged in behavior; PDFs and untouched drafts preserved");
}

// ---- 8. migrated publications: matching taxonomy causes no writes; nothing created or deleted -------------
{
  const cloud = makeCloud();
  for (const id of ["existing-publication-a", "existing-publication-b"]) {
    cloud.seed("Publication", { ...basePub, id, indexCategories: filings([{ id: "biology", subjects: ["Genetics"] }]) });
  }
  const pubs = loadedAll(cloud, ["existing-publication-a", "existing-publication-b"]);
  const result = await reconcilePublications({ categories: taxonomy, publications: pubs, save: saver(cloud) });
  assert.equal(result.planned, 0);
  assert.equal(cloud.calls.length, 0, "no cloud calls at all");
  assert.equal(cloud.store.size, 2, "no duplicates");

  await reconcilePublications({ categories: [taxonomy[1]], publications: pubs, save: saver(cloud) });
  assert.equal(cloud.store.size, 2, "updates never duplicate or delete");
  assert.ok(!cloud.calls.some(([c]) => c === "create" || c === "delete"));
  pass("migrated publications: no writes when matching; updates never create or delete");
}

assert.deepEqual(forbidden, [], "no IndexedDB access and no local publishing endpoint calls");
pass("no IndexedDB access and no local endpoint calls for cloud-backed records");

console.log(`all ${n} test groups passed`);
