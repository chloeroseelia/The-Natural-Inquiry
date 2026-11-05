import { useState } from "react";
import { downloadLocalBackup, runMigrationPreview } from "./migration-preview.js";
import MigrationRunner from "./MigrationRunner.jsx";

const CATEGORIES = [
  { key: "new", label: "New", hint: "No matching cloud record. Would be created." },
  { key: "identical", label: "Identical", hint: "Cloud record matches after normalization. Would be skipped." },
  { key: "conflict", label: "Conflict", hint: "Cloud record differs. Needs your decision; never overwritten automatically." },
  { key: "oversized", label: "Oversized", hint: "Estimated near or above DynamoDB's 400 KB item limit. Cannot be migrated as is." }
];

function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

function preview(value) {
  if (value === null || value === undefined) return "(empty)";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 240 ? `${text.slice(0, 240)}… (${text.length.toLocaleString()} characters)` : text;
}

function RecordDetails({ record }) {
  return (
    <details className="migration-record" data-category={record.category}>
      <summary>
        <span className="migration-badge">{record.category}</span>
        <strong>{record.title}</strong>
        <small>{formatBytes(record.sizeBytes)}</small>
      </summary>
      <div className="migration-record-body">
        <p><b>ID:</b> {record.id}</p>
        {record.blockers.map((text) => <p className="migration-blocker" key={text}>Cannot migrate safely: {text}</p>)}
        {record.warnings.map((text) => <p className="migration-warning" key={text}>Note: {text}</p>)}
        {record.category === "oversized" && (
          <p className="migration-blocker">
            Estimated size {formatBytes(record.sizeBytes)} is at or above the 350 KB safety threshold. The body likely needs its images moved to Storage first.
          </p>
        )}
        {record.category === "conflict" && (
          <table>
            <thead><tr><th>Field</th><th>Local (mapped)</th><th>Cloud</th></tr></thead>
            <tbody>
              {record.differences.map((difference) => (
                <tr key={difference.field}>
                  <td>{difference.field}</td>
                  <td>{preview(difference.local)}</td>
                  <td>{preview(difference.cloud)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {record.category !== "conflict" && (
          <table>
            <thead><tr><th>Cloud field</th><th>Value that would be written</th></tr></thead>
            <tbody>
              {Object.entries(record.mapped).map(([field, value]) => (
                <tr key={field}><td>{field}</td><td>{preview(value)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}

export default function MigrationPreview({ onClose }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [backupState, setBackupState] = useState(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      setResult(await runMigrationPreview());
    } catch (error) {
      setResult({ fatal: error?.message || String(error), models: [] });
    }
    setRunning(false);
  }

  async function backup() {
    setBackupState({ state: "working" });
    try {
      const counts = await downloadLocalBackup();
      setBackupState({ state: "ok", counts });
    } catch (error) {
      setBackupState({ state: "error", message: error?.message || String(error) });
    }
  }

  const totals = { new: 0, identical: 0, conflict: 0, oversized: 0, blocked: 0, local: 0 };
  for (const model of result?.models ?? []) {
    for (const record of model.records) {
      totals[record.category] += 1;
      totals.local += 1;
      if (record.blockers.length && record.category !== "oversized") totals.blocked += 1;
    }
  }
  const unsafe = totals.oversized + totals.blocked;

  return (
    <main className="auth-page migration-page">
      <section className="auth-message migration-preview">
        <span className="brand-seal">N</span>
        <h1>Migration preview</h1>
        <p>
          Read-only comparison of this browser's local records with the cloud database. It reads
          IndexedDB and lists cloud records only. Nothing is created, changed, deleted, or resolved.
        </p>

        <div className="migration-actions">
          <button className="button button-primary" disabled={running} onClick={run} type="button">
            {running ? "Comparing…" : "Run read-only preview"}
          </button>
          <button className="button button-secondary" disabled={backupState?.state === "working"} onClick={backup} type="button">
            Download local backup (JSON)
          </button>
          <button className="button button-secondary" onClick={onClose} type="button">Back to dashboard</button>
        </div>

        {backupState?.state === "ok" && (
          <p className="migration-ok">
            Backup downloaded: {backupState.counts.publications} publications, {backupState.counts.research} research,
            {" "}{backupState.counts.profile} profile, {backupState.counts.drafts} drafts.
          </p>
        )}
        {backupState?.state === "error" && <p className="migration-blocker">Backup failed: {backupState.message}</p>}
        {result?.fatal && <p className="migration-blocker">Preview failed: {result.fatal}</p>}

        {result && !result.fatal && (
          <>
            <div className="migration-summary">
              <h2>Overall summary</h2>
              <p>
                {totals.local} local record{totals.local === 1 ? "" : "s"} checked:
                {" "}{totals.new} new, {totals.identical} identical, {totals.conflict} conflict, {totals.oversized} oversized.
              </p>
              <p className={unsafe ? "migration-blocker" : "migration-ok"}>
                {unsafe
                  ? `${unsafe} record${unsafe === 1 ? "" : "s"} cannot be migrated safely yet. Expand the flagged records below.`
                  : "No records are blocked from migration."}
              </p>
              {totals.conflict > 0 && (
                <p className="migration-warning">Conflicts are never overwritten automatically; each needs an explicit decision in a later step.</p>
              )}
              <p>Generated {new Date(result.generatedAt).toLocaleString()}.</p>
            </div>

            <MigrationRunner result={result} />

            {result.models.map((model) => (
              <section className="migration-model" key={model.model}>
                <h2>{model.label} <small>({model.model})</small></h2>
                {model.error ? (
                  <p className="migration-blocker">Error: {model.error}</p>
                ) : (
                  <>
                    <p>{model.records.length} local, {model.cloudCount} in cloud.</p>
                    <ul className="migration-counts">
                      {CATEGORIES.map((category) => (
                        <li key={category.key} title={category.hint}>
                          <strong>{model.records.filter((record) => record.category === category.key).length}</strong>
                          <span>{category.label}</span>
                        </li>
                      ))}
                    </ul>
                    {model.skipped.map((item) => (
                      <p className="migration-warning" key={item.id}>Skipped {item.id}: {item.reason}</p>
                    ))}
                    {model.records.map((record) => <RecordDetails key={record.id} record={record} />)}
                  </>
                )}
              </section>
            ))}
          </>
        )}

        <dl className="migration-legend">
          {CATEGORIES.map((category) => (
            <div key={category.key}><dt>{category.label}</dt><dd>{category.hint}</dd></div>
          ))}
        </dl>
      </section>
    </main>
  );
}
