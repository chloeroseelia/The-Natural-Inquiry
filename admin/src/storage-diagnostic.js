// Read-only storage diagnostic. It never creates, upgrades, writes to, or deletes a database.
// Only databases already reported by indexedDB.databases() are opened, and any attempted
// upgrade (which would mean the database did not exist) is aborted.

const KNOWN_STORES = {
  publications: "Publications",
  research: "Research projects",
  profile: "Profile content",
  drafts: "Drafts"
};

const SEED_ID = /^(existing-|profile-)/;

function openExisting(name, version) {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      request.transaction.abort();
      reject(new Error("Refused to open: the database would have been created or upgraded."));
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open database."));
    request.onblocked = () => reject(new Error("Database is blocked by another tab."));
  });
}

function readStore(database, storeName) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const countRequest = store.count();
    const keysRequest = store.getAllKeys();
    transaction.oncomplete = () => {
      const keys = keysRequest.result.map(String);
      resolve({
        name: storeName,
        count: countRequest.result,
        nonSeedIds: keys.filter((key) => !SEED_ID.test(key)).length
      });
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Read aborted."));
  });
}

export async function runStorageDiagnostic() {
  const result = {
    origin: window.location.origin,
    databasesApi: typeof window.indexedDB?.databases === "function",
    databases: [],
    storageEstimate: null,
    error: null
  };

  if (!("indexedDB" in window)) {
    result.error = "This browser does not support IndexedDB.";
    return result;
  }

  if (navigator.storage?.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      result.storageEstimate = { usage, quota };
    } catch {
      result.storageEstimate = null;
    }
  }

  if (!result.databasesApi) {
    result.error = "indexedDB.databases() is unavailable in this browser, so existing databases cannot be listed without risking creating one.";
    return result;
  }

  const listed = await window.indexedDB.databases();
  for (const info of listed) {
    const entry = { name: info.name, version: info.version, stores: [], error: null };
    try {
      const database = await openExisting(info.name, info.version);
      try {
        const storeNames = Array.from(database.objectStoreNames);
        for (const storeName of storeNames) {
          try {
            entry.stores.push(await readStore(database, storeName));
          } catch (error) {
            entry.stores.push({ name: storeName, count: null, error: error?.message || String(error) });
          }
        }
      } finally {
        database.close();
      }
    } catch (error) {
      entry.error = error?.message || String(error);
    }
    result.databases.push(entry);
  }

  return result;
}

export { KNOWN_STORES };
