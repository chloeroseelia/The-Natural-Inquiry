// Synthetic tests for the cloud -> local mapping and the read-only repository.
// In-memory only: no IndexedDB, no AWS. Run from admin/: node tests/cloud-repository.test.mjs
import assert from "node:assert/strict";
import { classifyRecord, cloudToLocal, diffRecords } from "../src/cloud-mapping.js";
import { buildCreateInput } from "../src/migration-run.js";
import { createCloudRepository } from "../src/cloud-repository.js";

let n = 0;
const pass = (name) => console.log(`${++n} ${name}: ok`);

const META = ["revision", "cloudUpdatedAt"];
const strip = (record) => Object.fromEntries(Object.entries(record).filter(([key]) => !META.includes(key)));

// What the cloud returns after migration: create input as stored, JSON as strings, missing fields null.
const ALL_FIELDS = {
  Publication: ["id", "title", "subtitle", "category", "summary", "content", "contentFormat", "status", "archived", "indexCategories", "references", "mediaKeys", "sourceDocumentName", "publicPath", "publishedAt", "importedCreatedAt", "importedUpdatedAt", "revision", "createdAt", "updatedAt"],
  ResearchProject: ["id", "title", "summary", "overview", "overviewTitle", "content", "projectNote", "projectStage", "status", "indexCategories", "mediaKeys", "publicPath", "publishedAt", "importedCreatedAt", "importedUpdatedAt", "revision", "createdAt", "updatedAt"],
  ProfileContent: ["id", "sectionKey", "title", "content", "summary", "status", "sortOrder", "publicPath", "publishedAt", "importedCreatedAt", "importedUpdatedAt", "revision", "createdAt", "updatedAt"]
};

function storedInCloud(model, local) {
  const planned = classifyRecord(model, local, new Map());
  assert.deepEqual(planned.blockers, [], "fixture must be migratable");
  const input = buildCreateInput(planned.mapped);
  const cloud = Object.fromEntries(ALL_FIELDS[model].map((field) => [field, null]));
  Object.assign(cloud, input, { createdAt: "2026-11-05T18:00:00.000Z", updatedAt: "2026-11-05T18:00:00.000Z" });
  return cloud;
}

const fixtures = {
  seededPublication: { id: "existing-publication-seaweed-made-simple", title: "Seaweed Made Simple", subtitle: "Quick meals", category: "Essay", status: "Published", archived: false, publishedAt: "", indexCategories: [], references: [], bodyHtml: "<p>Body</p>", sourcePage: "writing/seaweed-made-simple.html", sourceDocumentName: "Seaweed Made Simple.pdf", createdAt: null, updatedAt: null },
  editedPublication: { id: "pub-uuid-1", title: "Edited", subtitle: "s", category: "Field note", status: "Draft", archived: true, publishedAt: "2024-05-01", indexCategories: [{ id: "a", subjects: ["x", "y"] }], references: [{ id: "r1", title: "Ref", url: "https://example.org" }], bodyHtml: "<p>é — “quotes”</p>", sourcePage: "", sourceDocumentName: "", createdAt: "2024-01-02T03:04:05.000Z", updatedAt: "2024-06-07T08:09:10.000Z" },
  seededResearch: { id: "existing-garibaldi", kind: "project", sourcePath: "research/garibaldi.html", isExisting: true, status: "Past", title: "Garibaldi", subtitle: "Intro", overviewTitle: "Overview", overview: "Text", note: "Note", updatedAt: null },
  newResearch: { id: "11111111-2222-3333-4444-555555555555", kind: "project", sourcePath: "", isExisting: false, status: "Planned", title: "New", subtitle: "S", overviewTitle: "", overview: "", note: "", updatedAt: "2025-02-03T04:05:06.000Z" },
  profileIntro: { id: "profile-introduction", kind: "profile-introduction", sourcePath: "profile.html", isExisting: true, title: "Intro", summary: "Hi", content: "Welcome", updatedAt: null },
  profileSection: { id: "profile-biography-title", kind: "profile", sourcePath: "profile.html", isExisting: true, title: "Biography", summary: "", content: "Bio text", updatedAt: "2025-03-04T05:06:07.000Z" }
};
const modelOf = { seededPublication: "Publication", editedPublication: "Publication", seededResearch: "ResearchProject", newResearch: "ResearchProject", profileIntro: "ProfileContent", profileSection: "ProfileContent" };

// Round trip: local -> cloud -> local reproduces every UI field exactly (all three models).
for (const [name, local] of Object.entries(fixtures)) {
  const model = modelOf[name];
  const cloud = storedInCloud(model, local);
  const { record, warnings } = cloudToLocal(model, cloud);
  assert.deepEqual(strip(record), local, `${name} round trip`);
  assert.deepEqual(warnings, [], `${name} warnings`);
  assert.equal(record.revision, 1);
  assert.equal(record.cloudUpdatedAt, "2026-11-05T18:00:00.000Z");
  // cloud -> local -> cloud is identical after normalization
  assert.deepEqual(diffRecords(model, classifyRecord(model, strip(record), new Map()).mapped, cloud), [], `${name} reverse round trip`);
}
pass("round trip local->cloud->local and cloud->local->cloud for all three models");

// Publication details
{
  const cloud = storedInCloud("Publication", fixtures.editedPublication);
  const { record } = cloudToLocal("Publication", cloud);
  assert.equal(record.publishedAt, "2024-05-01", "midnight UTC dates return to date-only form");
  assert.equal(record.bodyHtml, fixtures.editedPublication.bodyHtml);
  assert.equal(record.sourcePage, "");
  assert.equal(record.archived, true);
  assert.equal(record.status, "Draft", "archived is separate from the editorial status");
  const seeded = cloudToLocal("Publication", storedInCloud("Publication", fixtures.seededPublication)).record;
  assert.equal(seeded.publishedAt, "");
  assert.equal(seeded.createdAt, null);
  assert.equal(seeded.updatedAt, null, "no invented timestamps for seeded records");
  const withTime = cloudToLocal("Publication", { ...cloud, publishedAt: "2024-05-01T10:30:00.000Z" }).record;
  assert.equal(withTime.publishedAt, "2024-05-01T10:30:00.000Z");
  pass("publication field names, dates, archived flag, no invented timestamps");
}

// Enum conversions
{
  for (const [cloudStatus, local, warns] of [["PUBLISHED", "Published", 0], ["DRAFT", "Draft", 0], ["IN_REVIEW", "Draft", 1], ["APPROVED", "Draft", 1], ["ARCHIVED", "Draft", 0]]) {
    const { record, warnings } = cloudToLocal("Publication", { id: "p", title: "T", category: "Essay", status: cloudStatus });
    assert.equal(record.status, local, cloudStatus);
    assert.equal(warnings.length, warns, `${cloudStatus} warnings`);
    assert.equal(record.archived, cloudStatus === "ARCHIVED");
  }
  assert.equal(cloudToLocal("Publication", { id: "p", title: "T", category: "E", status: null }).record.status, "Draft");
  for (const [stage, label] of [["IN_PROGRESS", "In progress"], ["PAST", "Past"], ["PLANNED", "Planned"]]) {
    assert.equal(cloudToLocal("ResearchProject", { id: "r", title: "T", projectStage: stage }).record.status, label);
  }
  const noStage = cloudToLocal("ResearchProject", { id: "r", title: "T", projectStage: null });
  assert.equal(noStage.record.status, "In progress");
  assert.equal(noStage.warnings.length, 1);
  const pdf = cloudToLocal("Publication", { id: "p", title: "T", category: "E", contentFormat: "PDF" });
  assert.equal(pdf.warnings.length, 1);
  pass("enum conversions: status, archived, projectStage, contentFormat");
}

// Field-name conversions and derived fields
{
  const research = cloudToLocal("ResearchProject", { id: "existing-x", title: "T", summary: "SUM", projectNote: "NOTE", publicPath: "research/x.html", projectStage: "PAST" }).record;
  assert.deepEqual([research.subtitle, research.note, research.sourcePath, research.kind, research.isExisting], ["SUM", "NOTE", "research/x.html", "project", true]);
  assert.equal(cloudToLocal("ResearchProject", { id: "abc-uuid", title: "T" }).record.isExisting, false);
  const intro = cloudToLocal("ProfileContent", { id: "profile-introduction", sectionKey: "introduction", title: "T" }).record;
  assert.deepEqual([intro.kind, intro.isExisting], ["profile-introduction", true]);
  const section = cloudToLocal("ProfileContent", { id: "profile-cv-title", sectionKey: "cv", title: "CV" }).record;
  assert.deepEqual([section.kind, section.isExisting], ["profile", true]);
  const custom = cloudToLocal("ProfileContent", { id: "custom-section", sectionKey: "custom-section", title: "C" });
  assert.equal(custom.record.isExisting, false);
  assert.deepEqual(custom.warnings, []);
  const mismatch = cloudToLocal("ProfileContent", { id: "profile-cv-title", sectionKey: "wrong", title: "CV" });
  assert.equal(mismatch.warnings.length, 1);
  pass("field-name conversions and derived kind/isExisting");
}

// Null and missing optional fields
{
  for (const model of Object.keys(ALL_FIELDS)) {
    const minimal = { id: "m1", title: "T", category: "C", sectionKey: "m1" };
    const { record, warnings } = cloudToLocal(model, minimal);
    assert.equal(record.id, "m1");
    assert.equal(record.title, "T");
    for (const [key, value] of Object.entries(record)) {
      assert.notEqual(value, undefined, `${model}.${key} is undefined`);
    }
    assert.deepEqual(warnings.filter((w) => !/projectStage/.test(w)), []);
    const allNull = Object.fromEntries(ALL_FIELDS[model].map((field) => [field, null]));
    Object.assign(allNull, { id: "m2", title: "T", category: "C", sectionKey: "m2" });
    assert.doesNotThrow(() => cloudToLocal(model, allNull));
  }
  const nulls = cloudToLocal("Publication", { id: "p", title: "T", category: "C", subtitle: null, content: null, indexCategories: null, references: null, publishedAt: null }).record;
  assert.deepEqual([nulls.subtitle, nulls.bodyHtml, nulls.indexCategories, nulls.references, nulls.publishedAt], ["", "", [], [], ""]);
  assert.throws(() => cloudToLocal("Publication", { title: "no id" }), /no id/);
  assert.throws(() => cloudToLocal("Bogus", { id: "x" }), /Unknown model/);
  pass("null and missing optional fields never produce undefined");
}

// JSON strings, parsed objects, empty, malformed
{
  const arr = [{ id: "a", subjects: ["x"] }];
  const asString = cloudToLocal("Publication", { id: "p", title: "T", category: "C", indexCategories: JSON.stringify(arr), references: "[]" });
  const asObject = cloudToLocal("Publication", { id: "p", title: "T", category: "C", indexCategories: arr, references: [] });
  assert.deepEqual(asString.record.indexCategories, arr);
  assert.deepEqual(asObject.record.indexCategories, arr);
  assert.deepEqual(asString.warnings, []);
  assert.deepEqual(asObject.warnings, []);
  assert.deepEqual(cloudToLocal("Publication", { id: "p", title: "T", category: "C", indexCategories: "" }).record.indexCategories, []);
  assert.deepEqual(cloudToLocal("Publication", { id: "p", title: "T", category: "C", indexCategories: "null" }).warnings, []);

  const malformed = cloudToLocal("Publication", { id: "p", title: "T", category: "C", indexCategories: "{not json", references: "[1,2" });
  assert.deepEqual([malformed.record.indexCategories, malformed.record.references], [[], []]);
  assert.equal(malformed.warnings.length, 2);
  assert.ok(malformed.warnings.every((w) => /malformed/.test(w)));

  const wrongShape = cloudToLocal("Publication", { id: "p", title: "T", category: "C", indexCategories: '{"a":1}', references: 42 });
  assert.deepEqual([wrongShape.record.indexCategories, wrongShape.record.references], [[], []]);
  assert.equal(wrongShape.warnings.length, 2);
  assert.ok(wrongShape.warnings.every((w) => /not a JSON array/.test(w)));
  pass("JSON strings and parsed objects, empty, malformed, and wrong-shaped JSON");
}

// Repository
{
  const cloud = {
    Publication: [
      storedInCloud("Publication", fixtures.editedPublication),
      storedInCloud("Publication", fixtures.seededPublication)
    ],
    ResearchProject: [
      storedInCloud("ResearchProject", fixtures.seededResearch),
      storedInCloud("ResearchProject", fixtures.newResearch)
    ],
    ProfileContent: [
      storedInCloud("ProfileContent", fixtures.profileSection),
      storedInCloud("ProfileContent", fixtures.profileIntro),
      { ...Object.fromEntries(ALL_FIELDS.ProfileContent.map((f) => [f, null])), id: "profile-contact-title", sectionKey: "contact", title: "Contact", sortOrder: 7 }
    ]
  };
  const calls = [];
  const repo = createCloudRepository(async (model) => { calls.push(model); return cloud[model]; });

  const publications = await repo.listPublications();
  assert.deepEqual(calls, ["Publication"], "only the requested model is listed");
  assert.deepEqual(publications.records.map((r) => r.id), ["existing-publication-seaweed-made-simple", "pub-uuid-1"]);
  assert.deepEqual(publications.issues, []);

  const research = await repo.listResearchProjects();
  assert.equal(research.records.length, 2);

  const profile = await repo.listProfileContent();
  assert.deepEqual(profile.records.map((r) => r.id), ["profile-introduction", "profile-biography-title", "profile-contact-title"], "profile follows sortOrder");

  const input = JSON.stringify(cloud);
  await repo.loadAll();
  assert.equal(JSON.stringify(cloud), input, "cloud input records were not mutated");
  pass("repository lists each model, converts, sorts, and never mutates input");
}

// Repository: issues, bad records, and per-model failures
{
  const cloud = {
    Publication: [
      { id: "ok", title: "OK", category: "C" },
      { id: "bad-json", title: "Bad", category: "C", indexCategories: "{oops" },
      { title: "no id" }
    ],
    ResearchProject: [],
    ProfileContent: []
  };
  const repo = createCloudRepository(async (model) => {
    if (model === "ResearchProject") throw new Error("Not authorized");
    return cloud[model];
  });
  const publications = await repo.listPublications();
  assert.equal(publications.records.length, 2, "records with no id are skipped, not thrown");
  assert.equal(publications.issues.length, 2);
  assert.ok(publications.issues.some((i) => i.id === "bad-json" && /malformed/.test(i.warnings[0])));
  assert.ok(publications.issues.some((i) => i.skipped));

  await assert.rejects(repo.listResearchProjects(), /Not authorized/);
  const all = await repo.loadAll();
  assert.equal(all.errors.research, "Not authorized");
  assert.equal(all.research, null);
  assert.ok(all.publications && all.profile, "other models still load");
  pass("repository reports issues, skips bad records, isolates per-model failures");
}

// Read-only surface
{
  const repo = createCloudRepository(async () => []);
  const methods = Object.keys(repo);
  assert.deepEqual(methods.sort(), ["listProfileContent", "listPublications", "listResearchProjects", "loadAll"]);
  pass("repository exposes list functions only");
}

// Cached loader shared by App and PublicationsWorkspace
{
  const { createCachedCloudContent } = await import("../src/cloud-repository.js");
  let calls = 0;
  let fail = true;
  const fakeRepo = {
    listPublications: async () => { calls += 1; if (fail) throw new Error("offline"); return { records: [{ id: "p" }], issues: [] }; },
    listResearchProjects: async () => ({ records: [], issues: [] }),
    listProfileContent: async () => ({ records: [], issues: [] })
  };
  const content = createCachedCloudContent(fakeRepo);
  await assert.rejects(content.load("publications"), /offline/);
  fail = false;
  const [a, b] = await Promise.all([content.load("publications"), content.load("publications")]);
  assert.equal(calls, 2, "a failed load is not cached; concurrent callers share one fetch");
  assert.equal(a, b);
  await content.load("publications");
  assert.equal(calls, 2, "successful loads are cached across section changes");
  content.reset();
  await content.load("publications");
  assert.equal(calls, 3, "reset (retry) refetches");
  await content.load("publications", { force: true });
  assert.equal(calls, 4);
  await assert.rejects(content.load("bogus"), /Unknown cloud content/);
  pass("cached loader: single shared fetch, failures not cached, reset/force refetch");
}

console.log(`all ${n} test groups passed`);
