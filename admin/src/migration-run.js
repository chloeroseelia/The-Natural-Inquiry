import { classifyRecord, diffRecords } from "./cloud-mapping.js";

// Migration order is fixed by the approved plan.
export const MIGRATION_ORDER = ["ProfileContent", "ResearchProject", "Publication"];

// Result statuses: created, skipped, conflict, failed, blocked, not_attempted.
let migrationRunning = false;

// AWSJSON fields must be sent as JSON strings; the Amplify client does not stringify them.
const JSON_FIELDS = new Set(["indexCategories", "references", "mediaKeys"]);

export function buildCreateInput(mapped) {
  const input = { revision: 1 };
  for (const [key, value] of Object.entries(mapped)) {
    if (value === null || value === undefined) continue;
    input[key] = JSON_FIELDS.has(key) && typeof value !== "string" ? JSON.stringify(value) : value;
  }
  return input;
}

function errorText(error) {
  return error?.message || String(error);
}

// readLocal(model) -> { records, skipped } and io = { getRecord, createRecord } are injected so
// the engine has no direct dependency on IndexedDB or the network. It never updates or deletes.
// Migration stops at the first conflict; records after it are reported as not attempted.
export function validateSelectedModels(models) {
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error("Select at least one model to migrate.");
  }
  const unknown = models.filter((model) => !MIGRATION_ORDER.includes(model));
  if (unknown.length) throw new Error(`Unknown model(s): ${unknown.join(", ")}.`);
  // Always run in the fixed order, regardless of the order selected.
  return MIGRATION_ORDER.filter((model) => models.includes(model));
}

// `models` is required: only these models are read locally, looked up in the cloud, or created.
export async function runMigration({ models, readLocal, io, onProgress = () => {} }) {
  const selected = validateSelectedModels(models);
  if (migrationRunning) throw new Error("A migration is already running.");
  migrationRunning = true;

  const report = { startedAt: new Date().toISOString(), finishedAt: null, stopped: null, selectedModels: selected, models: [] };
  let stopReason = null;

  try {
    for (const model of selected) {
      const entry = { model, results: [], error: null };
      report.models.push(entry);

      let local;
      try {
        local = await readLocal(model);
      } catch (error) {
        entry.error = `Could not read local records: ${errorText(error)}`;
        stopReason = stopReason ?? entry.error;
        continue;
      }

      for (const localRecord of local.records) {
        const planned = classifyRecord(model, localRecord, new Map());
        const result = { id: planned.id, title: planned.title, status: null, detail: "", differences: [] };
        entry.results.push(result);

        if (stopReason) {
          result.status = "not_attempted";
          result.detail = "Migration stopped earlier; this record was not touched.";
          continue;
        }

        if (planned.category === "oversized" || planned.blockers.length) {
          result.status = "blocked";
          result.detail = planned.category === "oversized"
            ? "Estimated size is too close to the 400 KB item limit."
            : planned.blockers.join(" ");
          onProgress({ model, result });
          continue;
        }

        try {
          const existing = await io.getRecord(model, planned.id);

          if (existing) {
            const differences = diffRecords(model, planned.mapped, existing);
            if (differences.length === 0) {
              result.status = "skipped";
              result.detail = "Identical record already in the cloud.";
            } else {
              result.status = "conflict";
              result.detail = "A different cloud record has this ID. Nothing was changed, and the migration was stopped.";
              result.differences = differences;
              stopReason = `Conflict on ${model} ${planned.id}`;
            }
            onProgress({ model, result });
            continue;
          }

          await io.createRecord(model, buildCreateInput(planned.mapped));

          const readBack = await io.getRecord(model, planned.id);
          if (!readBack) {
            result.status = "failed";
            result.detail = "Created, but the record could not be read back for verification.";
          } else {
            const mismatches = diffRecords(model, planned.mapped, readBack);
            if (mismatches.length) {
              result.status = "failed";
              result.detail = `Created, but verification found ${mismatches.length} differing field(s). The cloud record was left as is.`;
              result.differences = mismatches;
            } else {
              result.status = "created";
              result.detail = "Created and verified by reading it back.";
            }
          }
        } catch (error) {
          result.status = "failed";
          result.detail = errorText(error);
        }
        onProgress({ model, result });
      }
    }

    report.stopped = stopReason;
    report.finishedAt = new Date().toISOString();
    return report;
  } finally {
    migrationRunning = false;
  }
}

export function summarizeReport(report) {
  const totals = { created: 0, skipped: 0, conflict: 0, failed: 0, blocked: 0, not_attempted: 0 };
  for (const model of report.models) {
    for (const result of model.results) totals[result.status] += 1;
  }
  return totals;
}
