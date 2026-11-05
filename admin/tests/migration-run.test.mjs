// Synthetic tests for the migration engine. Uses in-memory fakes only: no IndexedDB, no AWS.
// Run from admin/: node tests/migration-run.test.mjs
import assert from "node:assert/strict";
import { buildCreateInput, runMigration, summarizeReport } from "../src/migration-run.js";

const ALL = ["ProfileContent", "ResearchProject", "Publication"];
const STAGE1 = ["ProfileContent", "ResearchProject"];
const STAGE2 = ["Publication"];

const deepFreeze = (o) => {
  Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v));
  return Object.freeze(o);
};

const local = deepFreeze({
  ProfileContent: { records: [
    { id: "profile-introduction", title: "Intro", content: "c", summary: "s", updatedAt: 1700000000000 },
    { id: "profile-biography-title", title: "Bio", content: "b", updatedAt: "2024-01-01" }
  ], skipped: [] },
  ResearchProject: { records: [
    { id: "existing-garibaldi", title: "G", status: "Past", subtitle: "s", overview: "o", overviewTitle: "ot", note: "n", sourcePath: "research/g.html", updatedAt: 5 }
  ], skipped: [] },
  Publication: { records: [
    { id: "pub1", title: "P", subtitle: "s", category: "Essay", status: "Published", archived: false, publishedAt: "2024-05-01", indexCategories: [{ id: "a", subjects: ["x"] }], references: [{ id: "r", title: "t", url: "u" }], bodyHtml: "<p>x</p>", sourcePage: "writing/p.html", createdAt: 1, updatedAt: 2 }
  ], skipped: [] }
});

const JSON_FIELDS = ["indexCategories", "references", "mediaKeys"];

// Fake cloud that behaves like AppSync: AWSJSON must be a string on create and is returned as a string.
function makeHarness(store = new Map(), opts = {}) {
  const calls = [];
  const localReads = [];
  return {
    store,
    calls,
    localReads,
    readLocal: async (model) => { localReads.push(model); return local[model]; },
    io: {
      getRecord: async (model, id) => {
        calls.push(["get", model, id]);
        if (opts.getFails) throw new Error("net down");
        return store.get(`${model}/${id}`) ?? null;
      },
      createRecord: async (model, input) => {
        calls.push(["create", model, input.id]);
        if (opts.createFails === input.id) throw new Error("denied");
        for (const field of JSON_FIELDS) {
          if (field in input && typeof input[field] !== "string") throw new Error(`Validation error: ${field} is not valid JSON`);
        }
        if (store.has(`${model}/${input.id}`)) throw new Error("conditional check failed");
        const saved = { ...input, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
        if (opts.mangle) saved.title = "MANGLED";
        store.set(`${model}/${input.id}`, saved);
        return saved;
      }
    }
  };
}

const run = (h, models = ALL) => runMigration({ models, readLocal: h.readLocal, io: h.io });
const creates = (calls) => calls.filter((call) => call[0] === "create");
const modelsTouched = (calls) => [...new Set(calls.map((call) => call[1]))];
const zero = { created: 0, skipped: 0, conflict: 0, failed: 0, blocked: 0, not_attempted: 0 };
let n = 0;
const pass = (name) => console.log(`${++n} ${name}: ok`);

// buildCreateInput
{
  const a = buildCreateInput({ id: "x", indexCategories: [{ id: "a", subjects: ["s"] }], references: [{ id: "r", title: "t", url: "u" }], mediaKeys: null, title: "T", summary: undefined });
  assert.equal(a.indexCategories, '[{"id":"a","subjects":["s"]}]');
  assert.equal(a.references, '[{"id":"r","title":"t","url":"u"}]');
  assert.ok(!("mediaKeys" in a) && !("summary" in a));
  assert.equal(a.revision, 1);
  assert.equal(buildCreateInput({ mediaKeys: { a: 1 } }).mediaKeys, '{"a":1}');
  assert.equal(buildCreateInput({ references: [] }).references, "[]");
  assert.deepEqual(Object.keys(buildCreateInput({ id: "i", references: null })).sort(), ["id", "revision"]);
  assert.equal(buildCreateInput({ indexCategories: "[1]" }).indexCategories, "[1]");
  pass("JSON serialization, null/undefined omitted, no double encoding");
}

// Full run, order, ids, verification
{
  const h = makeHarness();
  const r = await run(h);
  assert.deepEqual(summarizeReport(r), { ...zero, created: 4 });
  assert.deepEqual(creates(h.calls).map((c) => c[1]), ["ProfileContent", "ProfileContent", "ResearchProject", "Publication"]);
  assert.equal(h.store.get("ResearchProject/existing-garibaldi").projectStage, "PAST");
  assert.equal(typeof h.store.get("Publication/pub1").indexCategories, "string");
  assert.deepEqual(r.selectedModels, ALL);
  pass("full run: order, ids, JSON strings, read-back verification");

  const before = h.calls.length;
  const again = await run(h);
  assert.deepEqual(summarizeReport(again), { ...zero, skipped: 4 });
  assert.equal(creates(h.calls.slice(before)).length, 0);
  pass("rerun is idempotent");

  h.store.delete("Publication/pub1");
  h.store.delete("ResearchProject/existing-garibaldi");
  assert.deepEqual(summarizeReport(await run(h)), { ...zero, created: 2, skipped: 2 });
  pass("resume after partial migration");
}

// Conflict
{
  const h = makeHarness(new Map([["ProfileContent/profile-biography-title", { id: "profile-biography-title", sectionKey: "biography", title: "DIFFERENT", content: "b" }]]));
  const r = await run(h);
  assert.deepEqual(summarizeReport(r), { ...zero, created: 1, conflict: 1, not_attempted: 2 });
  assert.ok(r.stopped);
  assert.equal(h.store.get("ProfileContent/profile-biography-title").title, "DIFFERENT");
  assert.ok(!h.store.has("Publication/pub1") && !h.store.has("ResearchProject/existing-garibaldi"));
  pass("conflict stops the run and never overwrites");
}

// Blocked records
{
  const big = deepFreeze({ ...local, Publication: { records: [
    { id: "big", title: "Big", category: "Essay", bodyHtml: "x".repeat(400000) },
    { id: "bad", title: "", category: "Essay", bodyHtml: "x" }
  ], skipped: [] } });
  const h = makeHarness();
  const r = await runMigration({ models: ALL, readLocal: async (m) => big[m], io: h.io });
  assert.equal(summarizeReport(r).blocked, 2);
  assert.ok(!h.store.has("Publication/big") && !h.store.has("Publication/bad"));
  pass("oversized and unsafe records are blocked");
}

// Failure handling
{
  const h = makeHarness(new Map(), { createFails: "existing-garibaldi" });
  const r = await run(h);
  assert.deepEqual([summarizeReport(r).failed, summarizeReport(r).created], [1, 3]);
  pass("create failure is isolated");

  const g = makeHarness(new Map(), { getFails: true });
  const gr = await run(g);
  assert.equal(creates(g.calls).length, 0);
  assert.equal(summarizeReport(gr).failed, 4);
  pass("nothing is created when the existence check fails");

  const m = makeHarness(new Map(), { mangle: true });
  const mr = await run(m);
  assert.equal(summarizeReport(mr).created, 0);
  assert.ok(summarizeReport(mr).failed >= 1);
  pass("verification mismatch is reported as failed");
}

// Concurrency
{
  const h = makeHarness();
  const p = run(h);
  await assert.rejects(run(h), /already running/);
  await p;
  pass("concurrent run rejected");
}

// Staging: Stage 1 never touches Publication
{
  const h = makeHarness();
  const r = await run(h, STAGE1);
  assert.deepEqual(r.selectedModels, STAGE1);
  assert.deepEqual(r.models.map((m) => m.model), STAGE1);
  assert.deepEqual(summarizeReport(r), { ...zero, created: 3 });
  assert.ok(!h.localReads.includes("Publication"), "Publication was read locally");
  assert.ok(!modelsTouched(h.calls).includes("Publication"), "Publication cloud operation attempted");
  assert.ok(![...h.store.keys()].some((k) => k.startsWith("Publication/")));
  assert.deepEqual(h.localReads, STAGE1);
  pass("Stage 1 (Profile + Research) never reads or writes Publication");
}

// Staging: Stage 2 never touches Profile or Research
{
  const h = makeHarness();
  const r = await run(h, STAGE2);
  assert.deepEqual(r.selectedModels, STAGE2);
  assert.deepEqual(r.models.map((m) => m.model), STAGE2);
  assert.deepEqual(summarizeReport(r), { ...zero, created: 1 });
  assert.deepEqual(h.localReads, STAGE2);
  assert.deepEqual(modelsTouched(h.calls), STAGE2);
  assert.ok(![...h.store.keys()].some((k) => !k.startsWith("Publication/")));
  pass("Stage 2 (Publication only) never reads or writes Profile or Research");
}

// Staging: sequential stages equal a full run; a conflict in another stage is not looked at
{
  const h = makeHarness();
  await run(h, STAGE1);
  await run(h, STAGE2);
  assert.equal(h.store.size, 4);
  assert.deepEqual(summarizeReport(await run(h, ALL)), { ...zero, skipped: 4 });
  pass("Stage 1 then Stage 2 equals a full migration");

  const c = makeHarness(new Map([["Publication/pub1", { id: "pub1", title: "DIFFERENT", category: "Essay" }]]));
  const r1 = await run(c, STAGE1);
  assert.deepEqual(summarizeReport(r1), { ...zero, created: 3 });
  assert.ok(!modelsTouched(c.calls).includes("Publication"));
  pass("a pre-existing Publication conflict is not looked at during Stage 1");
}

// Selection validation and ordering
{
  const h = makeHarness();
  await assert.rejects(runMigration({ readLocal: h.readLocal, io: h.io }), /at least one model/);
  await assert.rejects(runMigration({ models: [], readLocal: h.readLocal, io: h.io }), /at least one model/);
  await assert.rejects(runMigration({ models: ["Bogus"], readLocal: h.readLocal, io: h.io }), /Unknown model/);
  assert.equal(h.calls.length + h.localReads.length, 0, "validation failures must not touch anything");
  const r = await run(h, ["Publication", "ProfileContent"]);
  assert.deepEqual(r.selectedModels, ["ProfileContent", "Publication"]);
  assert.ok(!h.localReads.includes("ResearchProject"));
  pass("selection is required, validated, and always run in fixed order");
}

console.log("frozen local inputs were never mutated: ok");
console.log(`all ${n} test groups passed`);
