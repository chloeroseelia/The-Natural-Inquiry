import assert from "node:assert/strict";
import { createLocalBackup, partitionMigrationRecords } from "../src/migration-preview.js";
import { summarizeMigrationAccounting } from "../src/migration-accounting.js";
import { formatExcludedRecord } from "../src/migration-inspection.js";

const excludedSource = { kind: "profile", title: "Legacy profile section", content: "Preserve me", extra: undefined };
const partition = partitionMigrationRecords("ResearchProject", [
  { id: "project-1", kind: "project", title: "A project" },
  excludedSource,
  { kind: "legacy", title: "Missing ID record" }
]);
assert.equal(partition.records.length, 1);
assert.equal(partition.skipped.length, 2);
assert.equal(partition.skipped[0].record, excludedSource, "excluded source objects are retained by reference for inspection");
assert.equal(partition.skipped[0].id, null);
assert.match(partition.skipped[0].reason, /profile/);
const inspected = formatExcludedRecord(partition.skipped[0].record);
assert.match(inspected, /Legacy profile section/);
assert.match(inspected, /Preserve me/);
assert.match(inspected, /\[undefined\]/);
const cyclic = { title: "Circular record" };
cyclic.self = cyclic;
assert.match(formatExcludedRecord(cyclic), /Circular or repeated reference/);
assert.match(formatExcludedRecord({ large: "x".repeat(20000) }), /truncated for display/);
assert.match(formatExcludedRecord({ count: 12n }), /12n/);
assert.match(formatExcludedRecord({ attachment: new Blob(["data"], { type: "text/plain" }) }), /"type": "Blob"/);
console.log("excluded source records retain inspectable contents, missing IDs, cycles, and large values: ok");

const models = [
  {
    model: "Publication",
    sourceCount: 2,
    skipped: [],
    records: [
      { category: "new", blockers: [] },
      { category: "identical", blockers: [] }
    ]
  },
  {
    model: "ResearchProject",
    sourceCount: 3,
    skipped: [{ id: "legacy", reason: "legacy profile record", record: excludedSource }],
    records: [
      { category: "new", blockers: [] },
      { category: "oversized", blockers: [] }
    ]
  },
  {
    model: "ProfileContent",
    sourceCount: 1,
    skipped: [],
    records: [{ category: "conflict", blockers: [] }]
  }
];
const accounting = summarizeMigrationAccounting({
  publications: 2,
  research: 3,
  profile: 1,
  drafts: 4,
  metadata: 2
}, models);
assert.deepEqual(accounting.stores, {
  publications: 2, research: 3, profile: 1, drafts: 4, metadata: 2
});
assert.equal(accounting.overall.sourceRecords, 6);
assert.equal(accounting.overall.migrationInputs, 5);
assert.equal(accounting.overall.eligible, 3);
assert.equal(accounting.overall.excluded, 1);
assert.equal(accounting.overall.blocked, 1);
assert.equal(accounting.overall.conflicts, 1);
assert.equal(accounting.overall.willCreate, 2);
assert.equal(accounting.overall.unavailable, 0);
assert.equal(accounting.stages.stage1.sourceRecords, 4);
assert.equal(accounting.stages.stage1.excluded, 1);
assert.equal(accounting.stages.stage1.blocked, 1);
assert.equal(accounting.stages.stage1.willCreate, 1);
assert.equal(accounting.stages.stage2.sourceRecords, 2);
assert.equal(accounting.stages.stage2.eligible, 2);
assert.equal(accounting.stages.stage2.willCreate, 1);
assert.equal(accounting.stores.drafts, 4, "drafts are counted separately from migration inputs");
const unavailable = summarizeMigrationAccounting({ publications: 2, research: 0, profile: 0, drafts: 0 }, [
  { model: "Publication", sourceCount: 2, skipped: [], records: [] }
]);
assert.equal(unavailable.overall.unavailable, 2, "failed cloud comparisons remain visible as unclassified, not as create candidates");
console.log("overall and per-stage store totals, exclusions, blockers, and create counts: ok");

const fileReaderOriginal = globalThis.FileReader;
globalThis.FileReader = class {
  async readAsDataURL(blob) {
    this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
    this.onload();
  }
};
try {
  const stores = {
    publications: [{ id: "p" }],
    research: [{ id: "r", attachment: new Blob(["blob data"], { type: "text/plain" }) }],
    profile: [{ id: "profile" }],
    drafts: [{ id: "draft" }],
    metadata: [{ key: "seed-marker", value: true }, { key: "seed-version", value: 2 }]
  };
  const backup = await createLocalBackup(stores);
  assert.deepEqual(backup.includedStores, ["publications", "research", "profile", "drafts", "metadata"]);
  assert.deepEqual(backup.stores.metadata, stores.metadata);
  assert.equal(backup.counts.metadata, 2);
  assert.deepEqual(backup.stores.publications, stores.publications);
  assert.equal(backup.stores.research[0].attachment.base64, Buffer.from("blob data").toString("base64"));
  assert.deepEqual(backup.stores.drafts, stores.drafts);
  console.log("backup contains metadata and all existing stores while serializing nested Blob data: ok");
} finally {
  if (fileReaderOriginal === undefined) delete globalThis.FileReader;
  else globalThis.FileReader = fileReaderOriginal;
}
