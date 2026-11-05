const DATABASE_NAME = "natural-inquiry-editorial-workspace";
const DATABASE_VERSION = 5;
const DRAFT_STORE = "drafts";
const PUBLICATION_STORE = "publications";
const RESEARCH_STORE = "research";
const PROFILE_STORE = "profile";
const METADATA_STORE = "metadata";

let databasePromise;

function openDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("This browser does not support local draft storage."));
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DRAFT_STORE)) {
          database.createObjectStore(DRAFT_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(PUBLICATION_STORE)) {
          database.createObjectStore(PUBLICATION_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(RESEARCH_STORE)) {
          database.createObjectStore(RESEARCH_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(PROFILE_STORE)) {
          database.createObjectStore(PROFILE_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(METADATA_STORE)) {
          database.createObjectStore(METADATA_STORE);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("The browser could not open local draft storage."));
      request.onblocked = () => reject(new Error("Draft storage is busy in another tab. Close other workspace tabs and try again."));
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}

function runTransaction(storeName, mode, operation) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(new Error("The browser could not finish the local draft operation."));
    transaction.onabort = () => reject(new Error("The local draft operation was cancelled by the browser."));

    try {
      const request = operation(store);
      if (request) {
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(new Error("The browser could not read local drafts."));
      }
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  }));
}

export function listDrafts() {
  return runTransaction(DRAFT_STORE, "readonly", (store) => store.getAll());
}

export function saveDraft(draft) {
  return runTransaction(DRAFT_STORE, "readwrite", (store) => store.put(draft));
}

export function getDraft(id) {
  return runTransaction(DRAFT_STORE, "readonly", (store) => store.get(id));
}

export function deleteDraft(id) {
  return runTransaction(DRAFT_STORE, "readwrite", (store) => store.delete(id));
}

export function listPublications() {
  return runTransaction(PUBLICATION_STORE, "readonly", (store) => store.getAll());
}

export function seedPublicationsIfNeeded(publications) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction([PUBLICATION_STORE, METADATA_STORE], "readwrite");
    const publicationStore = transaction.objectStore(PUBLICATION_STORE);
    const metadataStore = transaction.objectStore(METADATA_STORE);
    let seeded = false;

    transaction.oncomplete = () => resolve(seeded);
    transaction.onerror = () => reject(new Error("The browser could not initialize the publication library."));
    transaction.onabort = () => reject(new Error("The publication library setup was cancelled by the browser."));

    const marker = metadataStore.get("provided-publications-seeded");
    marker.onerror = () => reject(new Error("The browser could not check the initial publication state."));
    marker.onsuccess = () => {
      if (marker.result) return;
      const count = publicationStore.count();
      count.onerror = () => reject(new Error("The browser could not inspect the publication library."));
      count.onsuccess = () => {
        if (count.result === 0) {
          publications.forEach((publication) => publicationStore.put(publication));
          seeded = true;
        }
        metadataStore.put(true, "provided-publications-seeded");
      };
    };
  }));
}

export function savePublication(publication) {
  return runTransaction(PUBLICATION_STORE, "readwrite", (store) => store.put(publication));
}

export function deletePublication(id) {
  return runTransaction(PUBLICATION_STORE, "readwrite", (store) => store.delete(id));
}

export function listResearch() {
  return runTransaction(RESEARCH_STORE, "readonly", (store) => store.getAll());
}

export function seedResearchIfNeeded(entries) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction([RESEARCH_STORE, METADATA_STORE], "readwrite");
    const researchStore = transaction.objectStore(RESEARCH_STORE);
    const metadataStore = transaction.objectStore(METADATA_STORE);
    let seeded = false;

    transaction.oncomplete = () => resolve(seeded);
    transaction.onerror = () => reject(new Error("The browser could not initialize the research workspace."));
    transaction.onabort = () => reject(new Error("The research workspace setup was cancelled by the browser."));

    const version = metadataStore.get("provided-research-seed-version");
    version.onerror = () => reject(new Error("The browser could not check the initial research state."));
    version.onsuccess = () => {
      if (version.result === 2) return;
      const currentEntries = researchStore.getAll();
      currentEntries.onerror = () => reject(new Error("The browser could not inspect the research workspace."));
      currentEntries.onsuccess = () => {
        const currentById = new Map(currentEntries.result.map((entry) => [entry.id, entry]));
        entries.forEach((entry) => {
          const current = currentById.get(entry.id);
          if (!current || !current.updatedAt) {
            researchStore.put(entry);
            seeded = true;
          }
        });
        metadataStore.put(2, "provided-research-seed-version");
        metadataStore.put(true, "provided-research-seeded");
      };
    };
  }));
}

export function saveResearchEntry(entry) {
  return runTransaction(RESEARCH_STORE, "readwrite", (store) => store.put(entry));
}

export function deleteResearchEntry(id) {
  return runTransaction(RESEARCH_STORE, "readwrite", (store) => store.delete(id));
}

export function listProfileEntries() {
  return runTransaction(PROFILE_STORE, "readonly", (store) => store.getAll());
}

export function seedProfileIfNeeded(entries) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction([RESEARCH_STORE, PROFILE_STORE, METADATA_STORE], "readwrite");
    const researchStore = transaction.objectStore(RESEARCH_STORE);
    const profileStore = transaction.objectStore(PROFILE_STORE);
    const metadataStore = transaction.objectStore(METADATA_STORE);
    let migrated = false;

    transaction.oncomplete = () => resolve(migrated);
    transaction.onerror = () => reject(new Error("The browser could not initialize the profile workspace."));
    transaction.onabort = () => reject(new Error("The profile workspace setup was cancelled by the browser."));

    const existingProfiles = profileStore.getAll();
    existingProfiles.onerror = () => reject(new Error("The browser could not inspect the profile workspace."));
    existingProfiles.onsuccess = () => {
      const currentById = new Map(existingProfiles.result.map((entry) => [entry.id, entry]));
      const researchEntries = researchStore.getAll();
      researchEntries.onerror = () => reject(new Error("The browser could not migrate the saved profile sections."));
      researchEntries.onsuccess = () => {
        researchEntries.result
          .filter((entry) => entry.kind === "profile")
          .forEach((entry) => {
            if (!currentById.has(entry.id)) {
              const { kind: _kind, ...profileEntry } = entry;
              if (entry.updatedAt) {
                const migratedEntry = { ...profileEntry, kind: "profile" };
                profileStore.put(migratedEntry);
                currentById.set(entry.id, migratedEntry);
              }
            }
            researchStore.delete(entry.id);
            migrated = true;
          });

        const marker = metadataStore.get("provided-profile-seeded");
        marker.onerror = () => reject(new Error("The browser could not check the initial profile state."));
        marker.onsuccess = () => {
          if (marker.result) return;
          entries.forEach((entry) => {
            if (!currentById.has(entry.id)) profileStore.put(entry);
          });
          metadataStore.put(true, "provided-profile-seeded");
          migrated = true;
        };
      };
    };
  }));
}

export function saveProfileEntry(entry) {
  return runTransaction(PROFILE_STORE, "readwrite", (store) => store.put(entry));
}

export function deleteProfileEntry(id) {
  return runTransaction(PROFILE_STORE, "readwrite", (store) => store.delete(id));
}
