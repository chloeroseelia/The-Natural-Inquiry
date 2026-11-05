import {
  MODEL_MAPPERS,
  OVERSIZE_THRESHOLD_BYTES,
  cloudToLocal,
  estimateItemBytes
} from "./cloud-mapping.js";
import { buildCreateInput } from "./migration-run.js";
import {
  createCloudRecord,
  deleteCloudRecord,
  getCloudRecord,
  updateCloudRecord
} from "./cloud-client.js";

// Cloud writes for Research Projects and Profile content.
//
// IMPORTANT: the conflict check below is a CLIENT-SIDE check, not an atomic backend guarantee.
// It fetches the latest record and compares its revision/updatedAt with the version that was
// loaded, then issues an unconditional update or delete. Another writer who changes the record
// between that fetch and the write will be overwritten. The window is small for a single
// administrator, but closing it would need a conditional write in a backend resolver, which is
// a schema/infrastructure change outside this phase.

// Only these fields are sent on update, so a partial update can never clear fields the editor
// does not show (mediaKeys, contentFormat, publicPath, importedCreatedAt, ...).
const EDITABLE_FIELDS = {
  ResearchProject: ["title", "summary", "overview", "overviewTitle", "projectNote", "projectStage", "importedUpdatedAt"],
  ProfileContent: ["title", "summary", "content", "importedUpdatedAt"],
  Publication: ["title", "subtitle", "category", "content", "status", "archived", "indexCategories", "references", "sourceDocumentName", "publishedAt", "importedUpdatedAt"]
};

const WRITABLE_ACTIONS = {
  ResearchProject: ["create", "update", "delete"],
  ProfileContent: ["update"],
  Publication: ["create", "update", "delete"]
};

// Cloud statuses the dashboard shows as "Draft". An unchanged "Draft" must not downgrade them.
const DRAFT_LIKE_STATUSES = new Set(["DRAFT", "IN_REVIEW", "APPROVED", "ARCHIVED"]);

const REQUIRED_FIELDS = new Set(["title", "category"]);
const JSON_FIELDS = new Set(["indexCategories", "references", "mediaKeys"]);

export class CloudConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "CloudConflictError";
    this.code = "conflict";
  }
}

const inFlight = new Set();

const defaultIo = {
  get: getCloudRecord,
  create: createCloudRecord,
  update: updateCloudRecord,
  delete: deleteCloudRecord
};

function assertWritable(modelName, action) {
  if (!WRITABLE_ACTIONS[modelName]?.includes(action)) {
    throw new Error(`${modelName} records cannot be ${action}d from the dashboard yet.`);
  }
}

// AWSJSON fields must be JSON strings; the Amplify client does not stringify them.
export function serializeJsonFields(input) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = JSON_FIELDS.has(key) && value !== null && value !== undefined && typeof value !== "string"
      ? JSON.stringify(value)
      : value;
  }
  return output;
}

function mapOrThrow(modelName, local) {
  const { record, blockers } = MODEL_MAPPERS[modelName](local);
  if (blockers.length) throw new Error(`This record cannot be saved: ${blockers.join(" ")}`);
  const sizeBytes = estimateItemBytes(record);
  if (sizeBytes >= OVERSIZE_THRESHOLD_BYTES) {
    throw new Error(`This record is about ${Math.round(sizeBytes / 1024)} KB, which is too close to the 400 KB database item limit. Shorten it before saving.`);
  }
  return record;
}

export function buildUpdateInput(modelName, local, nextRevision, now = () => new Date().toISOString(), latest = null) {
  assertWritable(modelName, "update");
  const mapped = mapOrThrow(modelName, { ...local, updatedAt: local.updatedAt || now() });
  const input = { id: local.id, revision: nextRevision };
  for (const field of EDITABLE_FIELDS[modelName]) {
    const value = mapped[field];
    // Blank optional text is cleared (null) rather than stored as an empty string.
    input[field] = value === "" && !REQUIRED_FIELDS.has(field) ? null : value ?? null;
  }
  if (modelName === "Publication") {
    // The dashboard only knows Draft/Published. If the cloud holds IN_REVIEW/APPROVED/ARCHIVED and
    // the editor still says Draft, keep the cloud status instead of silently downgrading it.
    if (input.status === "DRAFT" && latest && DRAFT_LIKE_STATUSES.has(latest.status)) input.status = latest.status;
    // Restoring an ARCHIVED record must also move it out of the ARCHIVED status.
    if (!input.archived && input.status === "ARCHIVED") input.status = "DRAFT";
    // Publishing stamps a date when none was chosen; unpublishing keeps the existing date.
    if (input.status === "PUBLISHED" && !input.publishedAt) input.publishedAt = now();
    // Empty filings/references are stored as null, never as the strings "[]" or "null".
    for (const field of ["indexCategories", "references"]) {
      if (Array.isArray(local[field]) && local[field].length === 0) input[field] = null;
    }
  }
  return serializeJsonFields(input);
}

function timeOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? String(value) : time;
}

// Returns a message when the cloud copy is no longer the version that was loaded, else null.
export function detectConflict(baseline, latest) {
  const baseRevision = baseline?.revision ?? null;
  const baseUpdated = timeOf(baseline?.cloudUpdatedAt);
  if (baseRevision === null && baseUpdated === null) {
    return "The version this edit started from is unknown, so it cannot be safely compared with the cloud.";
  }
  if (!latest) return "This record no longer exists in the cloud.";
  if ((latest.revision ?? null) !== baseRevision) {
    return `This record was changed in the cloud (revision ${baseRevision ?? "none"} → ${latest.revision ?? "none"}) after you opened it.`;
  }
  if (timeOf(latest.updatedAt) !== baseUpdated) {
    return "This record was changed in the cloud after you opened it.";
  }
  return null;
}

function conflict(message) {
  return new CloudConflictError(`${message} Nothing was saved. Reload the dashboard to see the latest version, then re-apply your edit.`);
}

async function withLock(modelName, id, work) {
  const key = `${modelName}:${id}`;
  if (inFlight.has(key)) throw new Error("A save for this record is already in progress.");
  inFlight.add(key);
  try {
    return await work();
  } finally {
    inFlight.delete(key);
  }
}

// Creates (no cloud baseline on `local`) or updates (baseline = local.revision + local.cloudUpdatedAt).
// Resolves { action: "created" | "updated", record } where record is the cloud's saved copy in
// dashboard shape, including the new revision/cloudUpdatedAt to use as the next baseline.
export async function saveCloudRecord({ modelName, local, io = defaultIo, now = () => new Date().toISOString() }) {
  if (!local?.id) throw new Error("This record has no id.");
  const isUpdate = local.revision != null || local.cloudUpdatedAt != null;
  assertWritable(modelName, isUpdate ? "update" : "create");

  return withLock(modelName, local.id, async () => {
    if (!isUpdate) {
      const stamp = now();
      const mapped = mapOrThrow(modelName, {
        ...local,
        createdAt: local.createdAt || stamp,
        updatedAt: local.updatedAt || stamp
      });
      // Create-only: refuse if anything already has this id, then rely on the create condition too.
      if (await io.get(modelName, local.id)) {
        throw conflict("A record with this id already exists in the cloud.");
      }
      const createInput = serializeJsonFields(buildCreateInput(mapped));
      if (modelName === "Publication" && createInput.status === "PUBLISHED" && !createInput.publishedAt) {
        createInput.publishedAt = stamp;
      }
      const created = await io.create(modelName, createInput);
      return { action: "created", record: cloudToLocal(modelName, created).record };
    }

    const latest = await io.get(modelName, local.id);
    const message = detectConflict(local, latest);
    if (message) throw conflict(message);

    const input = buildUpdateInput(modelName, local, (latest.revision ?? 0) + 1, now, latest);
    const updated = await io.update(modelName, input);
    return { action: "updated", record: cloudToLocal(modelName, updated).record };
  });
}

// Deletes a Research Project or Publication after the same latest-version check. Resolves
// { action: "deleted" | "already_deleted", id }.
export async function deleteCloudContent({ modelName, record, io = defaultIo }) {
  assertWritable(modelName, "delete");
  if (!record?.id) throw new Error("This record has no id.");

  return withLock(modelName, record.id, async () => {
    const latest = await io.get(modelName, record.id);
    if (!latest) return { action: "already_deleted", id: record.id };
    const message = detectConflict(record, latest);
    if (message) throw conflict(message);
    await io.delete(modelName, record.id);
    return { action: "deleted", id: record.id };
  });
}
