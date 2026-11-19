/*
 * Public manifest contract (schemaVersion 1)
 *
 *   {
 *     schemaVersion: 1,
 *     generatedAt: <ISO string supplied by the caller>,
 *     publications: [ ...PUBLICATION_FIELDS ],
 *     research:     [ ...RESEARCH_FIELDS ],
 *     profile:      [ ...PROFILE_FIELDS ]
 *   }
 *
 * Every public record is built field by field from the allowlists below. Source records are
 * never spread or copied wholesale, so a field added to the database later stays private until
 * it is deliberately added here.
 */
import { cleanText, sanitizeHtml, safeUrl } from "./sanitize.js";

export const SCHEMA_VERSION = 1;

export const PUBLICATION_FIELDS = Object.freeze([
  "id", "title", "subtitle", "category", "summary", "contentHtml", "references",
  "indexCategories", "publicPath", "publishedAt"
]);
export const RESEARCH_FIELDS = Object.freeze([
  "id", "title", "summary", "overview", "overviewTitle", "contentHtml", "projectStage",
  "indexCategories", "publicPath", "publishedAt"
]);
export const PROFILE_FIELDS = Object.freeze([
  "id", "sectionKey", "title", "summary", "contentHtml", "sortOrder", "publishedAt"
]);
export const FIELD_ALLOWLISTS = Object.freeze({
  publications: PUBLICATION_FIELDS,
  research: RESEARCH_FIELDS,
  profile: PROFILE_FIELDS
});

// Source fields that must never appear anywhere in a public manifest.
export const PRIVATE_FIELDS = Object.freeze([
  "status", "archived", "revision", "mediaKeys", "sourceDocumentName", "projectNote",
  "importedCreatedAt", "importedUpdatedAt", "createdAt", "updatedAt", "owner", "content",
  "contentFormat", "__typename"
]);

const CATEGORIES = new Set(["Essay", "Research project", "Field note", "Other"]);
const STAGES = new Set(["IN_PROGRESS", "PAST", "PLANNED"]);
const RESERVED_SLUGS = new Set(["template", "index"]);
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const LIMITS = { title: 300, description: 1000, contentChars: 500_000, subjects: 50, filings: 40, references: 200 };

export function safeSlug(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "untitled";
}

export function isValidPublicPath(path, directory) {
  if (typeof path !== "string") return false;
  const match = new RegExp(`^${directory}/(${SLUG})\\.html$`).exec(path);
  return Boolean(match) && !RESERVED_SLUGS.has(match[1]);
}

function parseJsonValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeDate(value) {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function normalizeFilings(value) {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) return [];
  const seen = new Set();
  const filings = [];
  for (const item of parsed.slice(0, LIMITS.filings)) {
    const id = typeof item?.categoryId === "string" ? item.categoryId : item?.id;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(id) || seen.has(id)) continue;
    seen.add(id);
    const subjects = [...new Set((Array.isArray(item.subjects) ? item.subjects : [])
      .filter((subject) => typeof subject === "string")
      .map(cleanText)
      .filter((subject) => subject && subject.length <= 120))].slice(0, LIMITS.subjects);
    filings.push({ categoryId: id, subjects });
  }
  return filings;
}

function normalizeReferences(value) {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) return [];
  const references = [];
  for (const item of parsed.slice(0, LIMITS.references)) {
    const title = cleanText(item?.title);
    if (!title || title.length > LIMITS.title) continue;
    const reference = { title };
    const url = safeUrl(item?.url);
    if (url) reference.url = url;
    references.push(reference);
  }
  return references;
}

function optionalText(value, max) {
  const text = cleanText(value);
  return text && text.length <= max ? text : null;
}

// Fail closed: only an explicit PUBLISHED status, and never an archived record.
function isPublishable(record) {
  if (!record || typeof record !== "object") return "invalid record";
  if (record.status !== "PUBLISHED") return "not published";
  if (record.archived != null && record.archived !== false) return "archived";
  return null;
}

function resolvePath(record, directory, title) {
  const supplied = typeof record.publicPath === "string" ? record.publicPath.trim() : "";
  if (!supplied) return { path: `${directory}/${safeSlug(title)}.html` };
  return isValidPublicPath(supplied, directory) ? { path: supplied } : { error: "invalid public path" };
}

function buildPublication(record) {
  const title = optionalText(record.title, LIMITS.title);
  if (!title) return { reason: "missing or oversized title" };
  if (!CATEGORIES.has(record.category)) return { reason: "unsupported category" };
  if (record.contentFormat != null && record.contentFormat !== "RICH_TEXT") {
    return { reason: "PDF publications need public media support (not available yet)" };
  }
  const subtitle = optionalText(record.subtitle, LIMITS.description);
  const summary = optionalText(record.summary, LIMITS.description);
  if (!subtitle && !summary) return { reason: "missing description" };
  const content = sanitizeHtml(record.content);
  if (!content.text || content.html.length > LIMITS.contentChars) return { reason: "missing or oversized content" };
  const publishedAt = normalizeDate(record.publishedAt);
  if (!publishedAt) return { reason: "missing or invalid publishedAt" };
  const directory = record.category === "Research project" ? "research" : "writing";
  const resolved = resolvePath(record, directory, title);
  if (resolved.error) return { reason: resolved.error };

  return {
    value: {
      id: cleanText(record.id),
      title,
      subtitle,
      category: record.category,
      summary,
      contentHtml: content.html,
      references: normalizeReferences(record.references),
      indexCategories: normalizeFilings(record.indexCategories),
      publicPath: resolved.path,
      publishedAt
    },
    notes: content.stats.removedMedia ? [`${content.stats.removedMedia} media element(s) removed`] : []
  };
}

function buildResearch(record) {
  const title = optionalText(record.title, LIMITS.title);
  if (!title) return { reason: "missing or oversized title" };
  const summary = optionalText(record.summary, LIMITS.description);
  const overview = optionalText(record.overview, LIMITS.contentChars);
  if (!summary && !overview) return { reason: "missing description" };
  const content = sanitizeHtml(record.content);
  if (content.html.length > LIMITS.contentChars) return { reason: "oversized content" };
  const publishedAt = normalizeDate(record.publishedAt);
  if (!publishedAt) return { reason: "missing or invalid publishedAt" };
  const resolved = resolvePath(record, "research", title);
  if (resolved.error) return { reason: resolved.error };

  return {
    value: {
      id: cleanText(record.id),
      title,
      summary,
      overview,
      overviewTitle: optionalText(record.overviewTitle, LIMITS.title),
      contentHtml: content.html,
      projectStage: STAGES.has(record.projectStage) ? record.projectStage : null,
      indexCategories: normalizeFilings(record.indexCategories),
      publicPath: resolved.path,
      publishedAt
    },
    notes: content.stats.removedMedia ? [`${content.stats.removedMedia} media element(s) removed`] : []
  };
}

function buildProfile(record) {
  const title = optionalText(record.title, LIMITS.title);
  const sectionKey = typeof record.sectionKey === "string" && /^[a-z0-9][a-z0-9-_]{0,63}$/i.test(record.sectionKey)
    ? record.sectionKey
    : null;
  if (!title || !sectionKey) return { reason: "missing title or invalid sectionKey" };
  const content = sanitizeHtml(record.content);
  if (content.html.length > LIMITS.contentChars) return { reason: "oversized content" };
  return {
    value: {
      id: cleanText(record.id),
      sectionKey,
      title,
      summary: optionalText(record.summary, LIMITS.description),
      contentHtml: content.html,
      sortOrder: Number.isInteger(record.sortOrder) ? record.sortOrder : 0,
      publishedAt: normalizeDate(record.publishedAt)
    },
    notes: []
  };
}

const BUILDERS = { publications: buildPublication, research: buildResearch, profile: buildProfile };

function byPublishedThenId(a, b) {
  return (b.publishedAt || "").localeCompare(a.publishedAt || "") || a.id.localeCompare(b.id);
}

export function buildManifest({ publications = [], researchProjects = [], profileContent = [] }, { generatedAt }) {
  if (!normalizeDate(generatedAt)) throw new Error("generatedAt must be a valid ISO date.");
  const excluded = [];
  const notes = [];
  const sources = { publications, research: researchProjects, profile: profileContent };
  const manifest = { schemaVersion: SCHEMA_VERSION, generatedAt: new Date(generatedAt).toISOString(), publications: [], research: [], profile: [] };

  for (const [section, records] of Object.entries(sources)) {
    for (const record of Array.isArray(records) ? records : []) {
      const id = typeof record?.id === "string" ? record.id : "(unknown)";
      const blocked = isPublishable(record);
      if (blocked) {
        excluded.push({ section, id, reason: blocked });
        continue;
      }
      if (!/^[\w-]{8,64}$/.test(id)) {
        excluded.push({ section, id, reason: "invalid id" });
        continue;
      }
      const built = BUILDERS[section](record);
      if (!built.value) {
        excluded.push({ section, id, reason: built.reason });
        continue;
      }
      manifest[section].push(built.value);
      for (const note of built.notes) notes.push({ section, id, note });
    }
  }

  // Records that would publish to the same page are all held back, including across models.
  const owners = new Map();
  for (const section of ["publications", "research"]) {
    for (const item of manifest[section]) owners.set(item.publicPath, (owners.get(item.publicPath) || 0) + 1);
  }
  for (const section of ["publications", "research"]) {
    for (const item of manifest[section]) {
      if (owners.get(item.publicPath) > 1) excluded.push({ section, id: item.id, reason: "public path collision" });
    }
    manifest[section] = manifest[section].filter((item) => owners.get(item.publicPath) === 1);
  }

  manifest.publications.sort(byPublishedThenId);
  manifest.research.sort(byPublishedThenId);
  manifest.profile.sort((a, b) => a.sortOrder - b.sortOrder || a.sectionKey.localeCompare(b.sectionKey));
  return { manifest, excluded, notes };
}

function findForbiddenKeys(value, path, found) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${path}[${index}]`, found));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (PRIVATE_FIELDS.includes(key)) found.push(`${path}.${key}`);
      findForbiddenKeys(child, `${path}.${key}`, found);
    }
  }
}

// Independent check used by the generator: a manifest is untrusted input.
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return { ok: false, errors: ["manifest is not an object"] };
  if (manifest.schemaVersion !== SCHEMA_VERSION) errors.push(`unsupported schemaVersion ${manifest.schemaVersion}`);
  if (!normalizeDate(manifest.generatedAt)) errors.push("invalid generatedAt");
  const expectedKeys = ["schemaVersion", "generatedAt", "publications", "research", "profile"];
  for (const key of Object.keys(manifest)) if (!expectedKeys.includes(key)) errors.push(`unexpected top-level key ${key}`);

  const paths = new Set();
  for (const [section, allowed] of Object.entries(FIELD_ALLOWLISTS)) {
    if (!Array.isArray(manifest[section])) {
      errors.push(`${section} must be an array`);
      continue;
    }
    manifest[section].forEach((item, index) => {
      const label = `${section}[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`${label} is not an object`);
        return;
      }
      for (const key of Object.keys(item)) if (!allowed.includes(key)) errors.push(`${label} has non-allowlisted field ${key}`);
      if (typeof item.id !== "string" || !/^[\w-]{8,64}$/.test(item.id)) errors.push(`${label} has an invalid id`);
      if (typeof item.title !== "string" || !item.title) errors.push(`${label} has no title`);
      if (section !== "profile") {
        if (!isValidPublicPath(item.publicPath, section === "research" ? "research" : item.category === "Research project" ? "research" : "writing")) {
          errors.push(`${label} has an invalid publicPath`);
        }
        if (paths.has(item.publicPath)) errors.push(`${label} duplicates publicPath ${item.publicPath}`);
        paths.add(item.publicPath);
        if (!normalizeDate(item.publishedAt)) errors.push(`${label} has an invalid publishedAt`);
      }
    });
  }
  const forbidden = [];
  findForbiddenKeys(manifest, "manifest", forbidden);
  for (const path of forbidden) errors.push(`private field present at ${path}`);
  return { ok: errors.length === 0, errors };
}
