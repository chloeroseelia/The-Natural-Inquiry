// Subject Index <-> cloud content reconciliation.
//
// The Index taxonomy (disciplines and topics) lives in local project files and is edited through
// the local-dev endpoint. Publications filed under it keep their filings in the cloud
// `indexCategories` field. This module is pure: it never touches IndexedDB, never calls a local
// endpoint, and writes to the cloud only through the injected `save` function (which in the app
// is the revision-checked `saveCloudRecord`). Changes here affect the cloud workspace only; they
// do not publish anything to the public website.
//
// ResearchProject has an `indexCategories` field in the schema, but the dashboard has no way to
// file research and the mapper always stores null there, so research projects are treated as
// read-only by the Subject Index.

export const READ_ONLY_MODELS = ["ResearchProject"];

export function normalizeFilings(filings, categories) {
  if (!Array.isArray(filings)) return [];
  const byId = new Map((categories || []).map((category) => [category.id, category]));
  const result = [];
  for (const filing of filings) {
    if (!filing || typeof filing !== "object") continue;
    const category = byId.get(filing.id);
    if (!category) continue;
    const allowed = new Set(category.subjects || []);
    result.push({ ...filing, subjects: (Array.isArray(filing.subjects) ? filing.subjects : []).filter((subject) => allowed.has(subject)) });
  }
  return result;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Which cloud publications hold filings that no longer match the taxonomy.
export function planPublicationReconciliation(categories, publications) {
  const changes = [];
  for (const publication of publications || []) {
    if (!Array.isArray(publication.indexCategories) || publication.indexCategories.length === 0) continue;
    const next = normalizeFilings(publication.indexCategories, categories);
    if (!same(next, publication.indexCategories)) {
      changes.push({ id: publication.id, title: publication.title || publication.id, before: publication.indexCategories, after: next });
    }
  }
  return changes;
}

// Applies the plan one record at a time. Conflicts and failures never stop the remaining records
// and never overwrite anything: the caller's `save` is responsible for the conflict check.
export async function reconcilePublications({ categories, publications, save, onApplied = () => {} }) {
  const plan = planPublicationReconciliation(categories, publications);
  const byId = new Map((publications || []).map((publication) => [publication.id, publication]));
  const results = [];
  for (const change of plan) {
    const current = byId.get(change.id);
    try {
      const saved = await save({ ...current, indexCategories: change.after });
      await onApplied(saved);
      results.push({ id: change.id, title: change.title, status: "updated" });
    } catch (error) {
      results.push({
        id: change.id,
        title: change.title,
        status: error?.code === "conflict" || error?.name === "CloudConflictError" ? "conflict" : "failed",
        message: error?.message || "Unknown error."
      });
    }
  }
  const count = (status) => results.filter((result) => result.status === status).length;
  return { planned: plan.length, updated: count("updated"), conflicts: count("conflict"), failed: count("failed"), results };
}

// Read-only view: which cloud publications are filed under each category and topic.
export function describeFilings(categories, publications) {
  const summary = new Map((categories || []).map((category) => [category.id, { id: category.id, publications: [], topics: new Map() }]));
  let unknown = 0;
  for (const publication of publications || []) {
    const filings = Array.isArray(publication.indexCategories) ? publication.indexCategories : [];
    for (const filing of filings) {
      const entry = summary.get(filing?.id);
      if (!entry) {
        unknown += 1;
        continue;
      }
      entry.publications.push({ id: publication.id, title: publication.title || publication.id, archived: Boolean(publication.archived) });
      for (const subject of Array.isArray(filing.subjects) ? filing.subjects : []) {
        entry.topics.set(subject, (entry.topics.get(subject) || 0) + 1);
      }
    }
  }
  return { byCategory: summary, unknownFilings: unknown };
}

// Local drafts keep their filings in IndexedDB; this only computes the reconciled copies.
export function reconcileDraftFilings(drafts, categories) {
  return (drafts || []).map((draft) => {
    if (!Array.isArray(draft.indexCategories)) return draft;
    const indexCategories = normalizeFilings(draft.indexCategories, categories);
    return same(indexCategories, draft.indexCategories) ? draft : { ...draft, indexCategories };
  });
}
