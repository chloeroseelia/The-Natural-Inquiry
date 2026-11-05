import { useState } from "react";
import { KNOWN_STORES, runStorageDiagnostic } from "./storage-diagnostic.js";

function formatBytes(bytes) {
  if (bytes == null) return "unknown";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

export default function StorageDiagnostic({ onClose }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  async function run() {
    setRunning(true);
    try {
      setResult(await runStorageDiagnostic());
    } catch (error) {
      setResult({ origin: window.location.origin, databases: [], error: error?.message || String(error) });
    }
    setRunning(false);
  }

  return (
    <main className="auth-page migration-page">
      <section className="auth-message migration-preview">
        <span className="brand-seal">N</span>
        <h1>Local storage diagnostic</h1>
        <p>
          Temporary and read-only. It reports what this browser origin holds. Browsers keep IndexedDB
          separately for each origin (scheme, host, and port), so data under localhost:5173 is invisible
          at localhost:5174. Nothing is created, copied, changed, or deleted.
        </p>
        <p><b>Current origin:</b> <code>{window.location.origin}</code></p>

        <div className="migration-actions">
          <button className="button button-primary" disabled={running} onClick={run} type="button">
            {running ? "Reading…" : "Run read-only diagnostic"}
          </button>
          <button className="button button-secondary" onClick={onClose} type="button">Back to dashboard</button>
        </div>

        {result?.error && <p className="migration-blocker">{result.error}</p>}

        {result && (
          <>
            {result.storageEstimate && (
              <p>Browser storage used by this origin: {formatBytes(result.storageEstimate.usage)} of {formatBytes(result.storageEstimate.quota)} quota.</p>
            )}
            {!result.error && result.databases.length === 0 && (
              <p className="migration-warning">No IndexedDB databases exist at this origin.</p>
            )}
            {result.databases.map((database) => (
              <section className="migration-model" key={database.name}>
                <h2>{database.name} <small>(version {database.version})</small></h2>
                {database.error ? (
                  <p className="migration-blocker">Could not read: {database.error}</p>
                ) : (
                  <table className="storage-table">
                    <thead>
                      <tr><th>Object store</th><th>Meaning</th><th>Records</th><th>Not seed-style IDs</th></tr>
                    </thead>
                    <tbody>
                      {database.stores.map((store) => (
                        <tr key={store.name}>
                          <td>{store.name}</td>
                          <td>{KNOWN_STORES[store.name] ?? (store.name === "metadata" ? "Seeding markers" : "")}</td>
                          <td>{store.count ?? `error: ${store.error}`}</td>
                          <td>{KNOWN_STORES[store.name] && store.name !== "drafts" ? store.nonSeedIds ?? "" : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            ))}
            <p className="migration-warning">
              "Not seed-style IDs" counts records whose ID does not start with <code>existing-</code> or
              <code> profile-</code>. The dashboard seeds records from the public site's pages on load, so a
              non-zero value suggests records you created or duplicated, while zero suggests seed data only.
              It is a hint, not proof.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
