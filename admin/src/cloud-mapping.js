// Pure, read-only mapping and comparison helpers for the migration preview.
// Nothing here touches IndexedDB or the network.

// Mirrors profileOrder in ProfileWorkspace.jsx.
const PROFILE_ORDER = [
  "profile-introduction",
  "profile-biography-title",
  "profile-education-title",
  "profile-interests-title",
  "profile-experience-title",
  "profile-skills-title",
  "profile-cv-title",
  "profile-contact-title"
];

// DynamoDB's item limit is 400 KB. The estimate is conservative and flags records from 350 KB.
export const ITEM_LIMIT_BYTES = 400 * 1024;
export const OVERSIZE_THRESHOLD_BYTES = 350 * 1024;
const ITEM_OVERHEAD_BYTES = 1024;

const FIELD_SPECS = {
  Publication: {
    title: "string",
    subtitle: "string",
    category: "string",
    summary: "string",
    content: "string",
    contentFormat: "string",
    status: "string",
    archived: "boolean",
    indexCategories: "json",
    references: "json",
    mediaKeys: "json",
    sourceDocumentName: "string",
    publicPath: "string",
    publishedAt: "datetime",
    importedCreatedAt: "datetime",
    importedUpdatedAt: "datetime"
  },
  ResearchProject: {
    title: "string",
    summary: "string",
    overview: "string",
    overviewTitle: "string",
    content: "string",
    projectNote: "string",
    projectStage: "string",
    status: "string",
    indexCategories: "json",
    mediaKeys: "json",
    publicPath: "string",
    publishedAt: "datetime",
    importedCreatedAt: "datetime",
    importedUpdatedAt: "datetime"
  },
  ProfileContent: {
    sectionKey: "string",
    title: "string",
    content: "string",
    summary: "string",
    status: "string",
    sortOrder: "number",
    publicPath: "string",
    publishedAt: "datetime",
    importedCreatedAt: "datetime",
    importedUpdatedAt: "datetime"
  }
};

const PROJECT_STAGES = {
  "in progress": "IN_PROGRESS",
  past: "PAST",
  planned: "PLANNED"
};

function isBlank(value) {
  return value === undefined || value === null || value === "";
}

// Returns an ISO string, null when empty, or undefined when the value cannot be parsed.
function toIso(value) {
  if (isBlank(value)) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function mapDate(record, field, value, warnings, blockers) {
  const iso = toIso(value);
  if (iso === undefined) {
    blockers.push(`${field} has an unparseable date value (${JSON.stringify(value)}).`);
    record[field] = null;
  } else {
    record[field] = iso;
  }
}

function jsonOrNull(value) {
  if (isBlank(value)) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return value;
}

function mapPublication(local) {
  const warnings = [];
  const blockers = [];
  const record = {
    id: local.id,
    title: local.title,
    subtitle: local.subtitle,
    category: local.category,
    summary: null,
    content: local.bodyHtml,
    contentFormat: "RICH_TEXT",
    archived: Boolean(local.archived),
    indexCategories: jsonOrNull(local.indexCategories),
    references: jsonOrNull(local.references),
    mediaKeys: null,
    sourceDocumentName: local.sourceDocumentName,
    publicPath: local.sourcePage
  };

  if (local.status === "Published") record.status = "PUBLISHED";
  else if (local.status === "Draft" || isBlank(local.status)) record.status = "DRAFT";
  else {
    record.status = "DRAFT";
    warnings.push(`Unknown status "${local.status}" would be stored as DRAFT.`);
  }

  if (isBlank(local.title)) blockers.push("Title is required by the cloud model.");
  if (isBlank(local.category)) blockers.push("Category is required by the cloud model.");

  mapDate(record, "publishedAt", local.publishedAt, warnings, blockers);
  mapDate(record, "importedCreatedAt", local.createdAt, warnings, blockers);
  mapDate(record, "importedUpdatedAt", local.updatedAt, warnings, blockers);

  if (typeof local.bodyHtml === "string" && /src=["']data:/i.test(local.bodyHtml)) {
    warnings.push("Body contains inline base64 images. They would stay inline until the Storage phase and add to the record size.");
  }
  return { record, warnings, blockers };
}

function mapResearch(local) {
  const warnings = [];
  const blockers = [];
  const stage = PROJECT_STAGES[String(local.status ?? "").trim().toLowerCase()] ?? null;
  if (!stage) warnings.push(`Project stage "${local.status ?? ""}" is not recognised; projectStage would be empty.`);

  const record = {
    id: local.id,
    title: local.title,
    summary: isBlank(local.subtitle) ? local.summary : local.subtitle,
    overview: local.overview,
    overviewTitle: local.overviewTitle,
    content: null,
    projectNote: local.note,
    projectStage: stage,
    status: "DRAFT",
    indexCategories: null,
    mediaKeys: null,
    publicPath: local.sourcePath
  };

  if (isBlank(local.title)) blockers.push("Title is required by the cloud model.");

  mapDate(record, "publishedAt", null, warnings, blockers);
  mapDate(record, "importedCreatedAt", local.createdAt, warnings, blockers);
  mapDate(record, "importedUpdatedAt", local.updatedAt, warnings, blockers);
  return { record, warnings, blockers };
}

function profileSectionKey(id) {
  if (id === "profile-introduction") return "introduction";
  const match = /^profile-(.+)-title$/.exec(id ?? "");
  return match ? match[1] : id;
}

function mapProfile(local) {
  const warnings = [];
  const blockers = [];
  const order = PROFILE_ORDER.indexOf(local.id);
  if (order === -1) warnings.push("Not in the known profile order; sortOrder would be empty.");

  const record = {
    id: local.id,
    sectionKey: profileSectionKey(local.id),
    title: local.title,
    content: local.content,
    summary: local.summary,
    status: "DRAFT",
    sortOrder: order === -1 ? null : order,
    publicPath: local.sourcePath
  };

  if (isBlank(record.sectionKey)) blockers.push("sectionKey is required by the cloud model.");
  if (isBlank(local.title)) blockers.push("Title is required by the cloud model.");

  mapDate(record, "publishedAt", null, warnings, blockers);
  mapDate(record, "importedCreatedAt", local.createdAt, warnings, blockers);
  mapDate(record, "importedUpdatedAt", local.updatedAt, warnings, blockers);
  return { record, warnings, blockers };
}

export const MODEL_MAPPERS = {
  Publication: mapPublication,
  ResearchProject: mapResearch,
  ProfileContent: mapProfile
};

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeValue(type, value) {
  if (type === "boolean") return Boolean(value);
  if (isBlank(value)) return null;

  if (type === "json") {
    let parsed = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        return value;
      }
    }
    const trimmed = jsonOrNull(parsed);
    return trimmed === null ? null : canonicalJson(trimmed);
  }

  if (type === "datetime") {
    const iso = toIso(value);
    return iso ? new Date(iso).getTime() : null;
  }

  if (type === "number") return Number(value);
  return typeof value === "string" ? value.replace(/\r\n/g, "\n") : value;
}

export function normalizeRecord(modelName, record) {
  const normalized = {};
  for (const [field, type] of Object.entries(FIELD_SPECS[modelName])) {
    normalized[field] = normalizeValue(type, record?.[field]);
  }
  return normalized;
}

export function diffRecords(modelName, mappedRecord, cloudRecord) {
  const local = normalizeRecord(modelName, mappedRecord);
  const cloud = normalizeRecord(modelName, cloudRecord);
  return Object.keys(local)
    .filter((field) => local[field] !== cloud[field])
    .map((field) => ({ field, local: local[field], cloud: cloud[field] }));
}

export function estimateItemBytes(mappedRecord) {
  const encoder = new TextEncoder();
  let bytes = ITEM_OVERHEAD_BYTES;
  for (const [key, value] of Object.entries(mappedRecord)) {
    if (value === null || value === undefined) continue;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    bytes += encoder.encode(key).length + encoder.encode(text).length;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Cloud -> local (read-only). Produces the record shapes the dashboard already uses.
// Each function returns { record, warnings }; nothing here touches the network or IndexedDB.
// ---------------------------------------------------------------------------

const STAGE_LABELS = {
  IN_PROGRESS: "In progress",
  PAST: "Past",
  PLANNED: "Planned"
};

// Returns { value, warning }. Accepts a JSON string or an already-parsed array.
// Malformed or non-array input yields [] plus a warning so callers can refuse to save over it.
function parseJsonArray(field, raw) {
  if (isBlank(raw)) return { value: [], warning: null };
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { value: [], warning: `${field} contains malformed JSON and was read as empty.` };
    }
  }
  if (parsed === null) return { value: [], warning: null };
  if (!Array.isArray(parsed)) {
    return { value: [], warning: `${field} is not a JSON array and was read as empty.` };
  }
  return { value: parsed, warning: null };
}

// Local dates are stored either as a date-only string (publishedAt) or an ISO timestamp.
function isoToDateOnlyIfMidnight(value) {
  const iso = toIso(value);
  if (iso === null) return "";
  if (iso === undefined) return String(value);
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}

function isoOrNull(value) {
  const iso = toIso(value);
  return iso === undefined ? String(value) : iso;
}

function textOr(value, fallback = "") {
  return isBlank(value) ? fallback : value;
}

function cloudMeta(cloud) {
  return {
    revision: cloud.revision ?? null,
    cloudUpdatedAt: cloud.updatedAt ?? null
  };
}

function publicationFromCloud(cloud) {
  const warnings = [];
  const indexCategories = parseJsonArray("indexCategories", cloud.indexCategories);
  const references = parseJsonArray("references", cloud.references);
  if (indexCategories.warning) warnings.push(indexCategories.warning);
  if (references.warning) warnings.push(references.warning);

  if (cloud.contentFormat && cloud.contentFormat !== "RICH_TEXT") {
    warnings.push(`contentFormat ${cloud.contentFormat} is not supported by the editor yet.`);
  }

  // The local workflow only has Draft/Published plus a separate archived flag.
  const archived = Boolean(cloud.archived) || cloud.status === "ARCHIVED";
  const status = cloud.status === "PUBLISHED" ? "Published" : "Draft";
  if (cloud.status === "IN_REVIEW" || cloud.status === "APPROVED") {
    warnings.push(`Cloud status ${cloud.status} is shown as Draft.`);
  }

  return {
    record: {
      id: cloud.id,
      title: textOr(cloud.title),
      subtitle: textOr(cloud.subtitle),
      category: textOr(cloud.category),
      status,
      archived,
      publishedAt: isoToDateOnlyIfMidnight(cloud.publishedAt),
      indexCategories: indexCategories.value,
      references: references.value,
      bodyHtml: textOr(cloud.content),
      sourcePage: textOr(cloud.publicPath),
      sourceDocumentName: textOr(cloud.sourceDocumentName),
      createdAt: isoOrNull(cloud.importedCreatedAt),
      updatedAt: isoOrNull(cloud.importedUpdatedAt),
      ...cloudMeta(cloud)
    },
    warnings
  };
}

function researchFromCloud(cloud) {
  const warnings = [];
  const status = STAGE_LABELS[cloud.projectStage];
  if (!status) warnings.push("projectStage is missing; the project is shown as In progress.");

  return {
    record: {
      id: cloud.id,
      kind: "project",
      sourcePath: textOr(cloud.publicPath),
      isExisting: String(cloud.id).startsWith("existing-"),
      status: status ?? "In progress",
      title: textOr(cloud.title),
      subtitle: textOr(cloud.summary),
      overviewTitle: textOr(cloud.overviewTitle),
      overview: textOr(cloud.overview),
      note: textOr(cloud.projectNote),
      ...(isBlank(cloud.importedCreatedAt) ? {} : { createdAt: isoOrNull(cloud.importedCreatedAt) }),
      updatedAt: isoOrNull(cloud.importedUpdatedAt),
      ...cloudMeta(cloud)
    },
    warnings
  };
}

function profileFromCloud(cloud) {
  const warnings = [];
  const isIntroduction = cloud.id === "profile-introduction";
  const expectedKey = profileSectionKey(cloud.id);
  if (cloud.sectionKey && cloud.sectionKey !== expectedKey) {
    warnings.push(`sectionKey "${cloud.sectionKey}" does not match the ID-derived key "${expectedKey}".`);
  }

  return {
    record: {
      id: cloud.id,
      kind: isIntroduction ? "profile-introduction" : "profile",
      sourcePath: textOr(cloud.publicPath),
      isExisting: PROFILE_ORDER.includes(cloud.id),
      title: textOr(cloud.title),
      summary: textOr(cloud.summary),
      content: textOr(cloud.content),
      ...(isBlank(cloud.importedCreatedAt) ? {} : { createdAt: isoOrNull(cloud.importedCreatedAt) }),
      updatedAt: isoOrNull(cloud.importedUpdatedAt),
      ...cloudMeta(cloud)
    },
    warnings
  };
}

export const CLOUD_TO_LOCAL_MAPPERS = {
  Publication: publicationFromCloud,
  ResearchProject: researchFromCloud,
  ProfileContent: profileFromCloud
};

export function cloudToLocal(modelName, cloudRecord) {
  const mapper = CLOUD_TO_LOCAL_MAPPERS[modelName];
  if (!mapper) throw new Error(`Unknown model: ${modelName}`);
  if (!cloudRecord || isBlank(cloudRecord.id)) throw new Error(`${modelName} record has no id.`);
  return mapper(cloudRecord);
}

export function classifyRecord(modelName, local, cloudById) {
  const { record, warnings, blockers } = MODEL_MAPPERS[modelName](local);
  const sizeBytes = estimateItemBytes(record);
  const cloudRecord = cloudById.get(record.id);
  const differences = cloudRecord ? diffRecords(modelName, record, cloudRecord) : [];

  let category;
  if (sizeBytes >= OVERSIZE_THRESHOLD_BYTES) category = "oversized";
  else if (!cloudRecord) category = "new";
  else if (differences.length === 0) category = "identical";
  else category = "conflict";

  return {
    id: record.id,
    title: record.title ?? record.sectionKey ?? record.id,
    category,
    sizeBytes,
    warnings,
    blockers,
    differences,
    mapped: record
  };
}
