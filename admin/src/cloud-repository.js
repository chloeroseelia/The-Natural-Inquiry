import { listAllRecords } from "./cloud-client.js";
import { cloudToLocal } from "./cloud-mapping.js";

// Read-only repository: lists cloud records and converts them to the dashboard's existing
// local record shapes. It has no create, update, or delete path and never touches IndexedDB.
// Pagination is handled by listAllRecords in cloud-client.js, which throws rather than
// returning a partial list.

const PROFILE_ORDER_FALLBACK = Number.MAX_SAFE_INTEGER;

const byId = (a, b) => String(a.id).localeCompare(String(b.id));

const MODELS = {
  publications: { model: "Publication", sort: byId },
  research: { model: "ResearchProject", sort: byId },
  profile: {
    model: "ProfileContent",
    sort: (a, b) => (a.sortOrder - b.sortOrder) || byId(a, b)
  }
};

// listAll is injectable so the repository can be tested without a network.
async function loadModel(key, listAll) {
  const { model, sort } = MODELS[key];
  const cloudRecords = await listAll(model);

  // Sort on cloud fields first (profile uses sortOrder), then convert.
  const ordered = [...cloudRecords]
    .map((record) => ({ ...record, sortOrder: record.sortOrder ?? PROFILE_ORDER_FALLBACK }))
    .sort(sort);

  const records = [];
  const issues = [];
  for (const cloud of ordered) {
    try {
      const { record, warnings } = cloudToLocal(model, cloud);
      records.push(record);
      if (warnings.length) issues.push({ model, id: record.id, warnings });
    } catch (error) {
      issues.push({ model, id: cloud?.id ?? null, warnings: [error.message], skipped: true });
    }
  }
  return { records, issues };
}

export function createCloudRepository(listAll = listAllRecords) {
  return {
    listPublications: () => loadModel("publications", listAll),
    listResearchProjects: () => loadModel("research", listAll),
    listProfileContent: () => loadModel("profile", listAll),

    // Loads all three models. A failure in one model is reported for that model only.
    async loadAll() {
      const result = { publications: null, research: null, profile: null, errors: {} };
      for (const [key, name] of [["publications", "listPublications"], ["research", "listResearchProjects"], ["profile", "listProfileContent"]]) {
        try {
          result[key] = await this[name]();
        } catch (error) {
          result.errors[key] = error?.message || String(error);
        }
      }
      return result;
    }
  };
}

const LIST_METHODS = {
  publications: "listPublications",
  research: "listResearchProjects",
  profile: "listProfileContent"
};

// Memoizes one successful (or in-flight) load per model so several components can share a
// single fetch. A failed load is never cached: the next call, or force, retries.
export function createCachedCloudContent(repository) {
  const cache = new Map();
  return {
    reset() {
      cache.clear();
    },
    // Applies a confirmed write to an already-cached model so the UI shows the cloud's saved copy
    // without a refetch. Does nothing if that model is not cached. Never touches IndexedDB.
    applyWrite(key, { record, removeId } = {}) {
      const cached = cache.get(key);
      if (!cached) return Promise.resolve();
      const next = cached.then((result) => {
        let records = result.records.filter((item) => item.id !== (record?.id ?? removeId));
        if (record) {
          const index = result.records.findIndex((item) => item.id === record.id);
          if (index >= 0) records.splice(index, 0, record);
          else records = [...records, record].sort(MODELS[key].sort);
        }
        return { ...result, records };
      });
      cache.set(key, next);
      next.catch(() => {
        if (cache.get(key) === next) cache.delete(key);
      });
      return next;
    },
    load(key, { force = false } = {}) {
      const method = LIST_METHODS[key];
      if (!method) return Promise.reject(new Error(`Unknown cloud content: ${key}`));
      if (force) cache.delete(key);
      if (!cache.has(key)) {
        const promise = repository[method]().catch((error) => {
          if (cache.get(key) === promise) cache.delete(key);
          throw error;
        });
        cache.set(key, promise);
      }
      return cache.get(key);
    }
  };
}

export const cloudRepository = createCloudRepository();
export const cloudContent = createCachedCloudContent(cloudRepository);

export const CLOUD_READ_ONLY_MESSAGE = "Cloud editing is not enabled yet. The dashboard is read-only in this phase, so nothing was saved.";
