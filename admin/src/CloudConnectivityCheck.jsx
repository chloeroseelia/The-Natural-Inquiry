import { useState } from "react";
import { CLOUD_MODELS, countModelRecords } from "./cloud-client.js";

export default function CloudConnectivityCheck({ onClose }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState({});

  async function runCheck() {
    setRunning(true);
    setResults({});
    for (const name of CLOUD_MODELS) {
      setResults((current) => ({ ...current, [name]: { state: "checking" } }));
      try {
        const outcome = await countModelRecords(name);
        setResults((current) => ({ ...current, [name]: { state: "ok", ...outcome } }));
      } catch (error) {
        setResults((current) => ({
          ...current,
          [name]: { state: "error", message: error?.message || String(error) }
        }));
      }
    }
    setRunning(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-message cloud-check">
        <span className="brand-seal">N</span>
        <h1>Cloud connectivity check</h1>
        <p>
          Temporary, read-only test. It lists records from each cloud model and shows counts only.
          Nothing is created, changed, or deleted.
        </p>
        <ul className="cloud-check-results">
          {CLOUD_MODELS.map((name) => {
            const result = results[name];
            return (
              <li key={name} data-state={result?.state || "idle"}>
                <strong>{name}</strong>
                <span>
                  {!result && "Not checked"}
                  {result?.state === "checking" && "Checking…"}
                  {result?.state === "ok" &&
                    `Connected. ${result.total} record${result.total === 1 ? "" : "s"} found${
                      result.truncated ? " (stopped at the page limit)" : ""
                    }.`}
                  {result?.state === "error" && `Error: ${result.message}`}
                </span>
              </li>
            );
          })}
        </ul>
        <button className="button button-primary" disabled={running} onClick={runCheck} type="button">
          {running ? "Checking…" : "Run read-only check"}
        </button>
        <button className="button button-secondary" onClick={onClose} type="button">
          Back to dashboard
        </button>
      </section>
    </main>
  );
}
