import { useState } from "react";
import { MIGRATION_ORDER, summarizeReport } from "./migration-run.js";
import { runLocalToCloudMigration } from "./migration-preview.js";

const STATUS_LABELS = {
  created: "Created",
  skipped: "Skipped (identical)",
  conflict: "Conflict",
  failed: "Failed",
  blocked: "Blocked",
  not_attempted: "Not attempted"
};

function preview(value) {
  if (value === null || value === undefined) return "(empty)";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

const STAGES = [
  { id: "stage1", label: "Stage 1: Profile content and Research projects", models: ["ProfileContent", "ResearchProject"] },
  { id: "stage2", label: "Stage 2: Publications", models: ["Publication"] }
];

// `result` is the output of the read-only preview; the button is only offered after it ran.
export default function MigrationRunner({ result, onFinished }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState([]);
  const [report, setReport] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [stageId, setStageId] = useState(STAGES[0].id);

  const stage = STAGES.find((item) => item.id === stageId);
  const selectedModels = stage.models;
  const selectedResults = result.models.filter((model) => selectedModels.includes(model.model));
  const records = selectedResults.flatMap((model) => model.records);
  const modelErrors = selectedResults.filter((model) => model.error);
  const toCreate = records.filter((record) => record.category === "new" && !record.blockers.length).length;
  const toSkip = records.filter((record) => record.category === "identical").length;
  const conflicts = records.filter((record) => record.category === "conflict").length;
  const blocked = records.filter((record) => record.category === "oversized" || record.blockers.length);

  const cannotStart = running || Boolean(report) || toCreate === 0 || conflicts > 0 || modelErrors.length > 0;

  async function start() {
    setRunning(true);
    setProgress([]);
    setFatal(null);
    try {
      const finished = await runLocalToCloudMigration(selectedModels, ({ model, result: item }) => {
        setProgress((current) => [...current, { model, ...item }]);
      });
      setReport(finished);
      onFinished?.();
    } catch (error) {
      setFatal(error?.message || String(error));
    }
    setRunning(false);
  }

  const totals = report ? summarizeReport(report) : null;

  return (
    <section className="migration-model migration-runner">
      <h2>Migrate to the cloud</h2>

      {!report && (
        <div className="migration-confirm">
          <fieldset className="migration-stages" disabled={running}>
            <legend>Choose the stage to run</legend>
            {STAGES.map((item) => (
              <label key={item.id}>
                <input checked={stageId === item.id} name="migration-stage" onChange={() => setStageId(item.id)} type="radio" />
                {item.label}
              </label>
            ))}
          </fieldset>
          <p>
            <b>Models included in this run:</b> {selectedModels.join(", ")}. Other models are not read, looked up, or written.
          </p>
          <p className="migration-warning">
            <b>This will create records in the cloud database.</b> Only missing records are created, in the order
            Profile, Research, then Publications. Existing cloud records are never overwritten or deleted, and local
            browser data is never changed. Nothing is published to the public website. Make sure you have saved the
            local backup first.
          </p>
          <ul>
            <li><b>{toCreate}</b> record{toCreate === 1 ? "" : "s"} will be created.</li>
            <li><b>{toSkip}</b> identical record{toSkip === 1 ? "" : "s"} will be skipped.</li>
            <li><b>{conflicts}</b> conflict{conflicts === 1 ? "" : "s"}{conflicts ? " — migration is disabled until these are resolved." : "."}</li>
            <li><b>{blocked.length}</b> blocked record{blocked.length === 1 ? "" : "s"}{blocked.length ? " will not be migrated:" : "."}</li>
          </ul>
          {blocked.map((record) => (
            <p className="migration-blocker" key={record.id}>
              {record.title} ({record.id}): {record.blockers.join(" ") || "Too large for a single cloud record."}
            </p>
          ))}
          {modelErrors.length > 0 && (
            <p className="migration-blocker">The preview had errors; fix them and re-run the preview before migrating.</p>
          )}
          {toCreate === 0 && conflicts === 0 && modelErrors.length === 0 && (
            <p className="migration-ok">Nothing to create. All migratable records already exist in the cloud.</p>
          )}
          <button className="button button-primary" disabled={cannotStart} onClick={start} type="button">
            {running ? "Migrating…" : "Start Migration"}
          </button>
        </div>
      )}

      {running && (
        <div role="status">
          <p>Migrating… {progress.length} record{progress.length === 1 ? "" : "s"} processed.</p>
          <ul>
            {progress.map((item) => (
              <li key={`${item.model}-${item.id}`}>{item.model}: {item.title} — {STATUS_LABELS[item.status]}</li>
            ))}
          </ul>
        </div>
      )}

      {fatal && <p className="migration-blocker">Migration did not run: {fatal}</p>}

      {report && (
        <div className="migration-report">
          <h2>Migration report</h2>
          <p>
            <b>Models included:</b> {report.selectedModels.join(", ")}.{" "}
            <b>Records processed:</b> {report.models.reduce((sum, model) => sum + model.results.length, 0)}
            {" "}({report.models.map((model) => `${model.model}: ${model.results.length}`).join("; ")}).
            Models not listed were not touched.
          </p>
          <p className={totals.failed || totals.conflict ? "migration-blocker" : "migration-ok"}>
            {totals.created} created, {totals.skipped} skipped, {totals.conflict} conflict, {totals.failed} failed,
            {" "}{totals.blocked} blocked, {totals.not_attempted} not attempted.
          </p>
          {report.stopped && <p className="migration-blocker">Stopped: {report.stopped}. Remaining records were not touched.</p>}
          <p>
            Verification: each created record was read back from the cloud and compared field by field. Run the
            preview again to confirm everything now shows as identical.
          </p>
          {MIGRATION_ORDER.map((modelName) => {
            const model = report.models.find((item) => item.model === modelName);
            if (!model) return null;
            const verified = model.results.filter((item) => item.status === "created").length;
            return (
              <section key={modelName}>
                <h3>{modelName} <small>({verified} verified)</small></h3>
                {model.error && <p className="migration-blocker">{model.error}</p>}
                {model.results.map((item) => (
                  <details className="migration-record" data-category={item.status === "conflict" || item.status === "failed" ? "conflict" : item.status} key={item.id}>
                    <summary>
                      <span className="migration-badge">{STATUS_LABELS[item.status]}</span>
                      <strong>{item.title}</strong>
                    </summary>
                    <div className="migration-record-body">
                      <p><b>ID:</b> {item.id}</p>
                      <p>{item.detail}</p>
                      {item.differences.length > 0 && (
                        <table>
                          <thead><tr><th>Field</th><th>Intended</th><th>Cloud</th></tr></thead>
                          <tbody>
                            {item.differences.map((difference) => (
                              <tr key={difference.field}>
                                <td>{difference.field}</td><td>{preview(difference.local)}</td><td>{preview(difference.cloud)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </details>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
