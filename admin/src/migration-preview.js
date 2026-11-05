import { createCloudRecord, getCloudRecord, listAllRecords } from "./cloud-client.js";
import { classifyRecord } from "./cloud-mapping.js";
import { runMigration } from "./migration-run.js";
import {
  listDrafts,
  listProfileEntries,
  listPublications,
  listResearch
} from "./draft-storage.js";

// Only read-only list functions are imported; no save, delete, or seed function is used here.
const SOURCES = [
  { model: "Publication", label: "Publications", readLocal: listPublications },
  { model: "ResearchProject", label: "Research projects", readLocal: listResearch },
  { model: "ProfileContent", label: "Profile content", readLocal: listProfileEntries }
];

export async function readLocalForModel(model) {
  const source = SOURCES.find((item) => item.model === model);
  let records = await source.readLocal();
  let skipped = [];
  if (model === "ResearchProject") {
    // Legacy profile entries can linger in the research store; they belong to ProfileContent.
    skipped = records
      .filter((record) => record.kind && record.kind !== "project")
      .map((record) => ({ id: record.id, reason: `Stored with kind "${record.kind}", not a research project.` }));
    records = records.filter((record) => !record.kind || record.kind === "project");
  }
  return { records, skipped };
}

// Creates missing cloud records only. Local IndexedDB is read, never written.
export function runLocalToCloudMigration(models, onProgress) {
  return runMigration({
    models,
    readLocal: readLocalForModel,
    io: { getRecord: getCloudRecord, createRecord: createCloudRecord },
    onProgress
  });
}

export async function runMigrationPreview() {
  const models = [];

  for (const source of SOURCES) {
    const entry = { model: source.model, label: source.label, records: [], skipped: [], cloudCount: 0, error: null };
    try {
      const local = await readLocalForModel(source.model);
      const localRecords = local.records;
      entry.skipped = local.skipped;
      const cloudRecords = await listAllRecords(source.model);
      entry.cloudCount = cloudRecords.length;
      const cloudById = new Map(cloudRecords.map((record) => [record.id, record]));

      entry.records = localRecords
        .map((record) => classifyRecord(source.model, record, cloudById))
        .sort((a, b) => String(a.title).localeCompare(String(b.title)));
    } catch (error) {
      entry.error = error?.message || String(error);
    }
    models.push(entry);
  }

  return { generatedAt: new Date().toISOString(), models };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function serialize(value) {
  if (value instanceof Blob) {
    return {
      __blob: true,
      name: value.name ?? null,
      type: value.type,
      size: value.size,
      base64: await blobToBase64(value)
    };
  }
  if (Array.isArray(value)) return Promise.all(value.map(serialize));
  if (value && typeof value === "object") {
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await serialize(item)]));
    return Object.fromEntries(entries);
  }
  return value;
}

export async function buildLocalBackup() {
  const [publications, research, profile, drafts] = await Promise.all([
    listPublications(),
    listResearch(),
    listProfileEntries(),
    listDrafts()
  ]);

  return serialize({
    app: "The Natural Inquiry admin dashboard",
    kind: "indexeddb-backup",
    database: "natural-inquiry-editorial-workspace",
    createdAt: new Date().toISOString(),
    counts: {
      publications: publications.length,
      research: research.length,
      profile: profile.length,
      drafts: drafts.length
    },
    stores: { publications, research, profile, drafts }
  });
}

export async function downloadLocalBackup() {
  const backup = await buildLocalBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `natural-inquiry-local-backup-${backup.createdAt.replace(/[:.]/g, "-")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return backup.counts;
}
