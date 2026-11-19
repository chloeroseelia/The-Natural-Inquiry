import { useState } from "react";
import { getDataClient } from "./cloud-client.js";

export const PUBLIC_SITE_URL = "https://chloeroseelia.github.io/The-Natural-Inquiry/";

function parseResult(data, invalidMessage) {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    throw new Error(invalidMessage);
  }
}

function getMutation(client) {
  const mutation = client.mutations?.publishSite;
  if (typeof mutation !== "function") {
    throw new Error("The publishing backend is not configured in this dashboard's Amplify outputs.");
  }
  return mutation;
}

export async function requestPublishReview(client = getDataClient()) {
  const mutation = getMutation(client);
  const { data, errors } = await mutation({ dryRun: true });
  if (errors?.length) throw new Error(errors.map((error) => error.message).join("; "));
  const result = parseResult(data, "The publishing backend returned an invalid review.");
  if (!result || result.dryRun !== true || result.wrote !== false ||
      !result.manifest || !Array.isArray(result.excluded) ||
      typeof result.reviewDigest !== "string" || !/^[0-9a-f]{64}$/.test(result.reviewDigest) ||
      !result.changes || !Array.isArray(result.notes) || !Array.isArray(result.warnings) ||
      !["publications", "research", "profile"].every((key) => Array.isArray(result.manifest[key]))) {
    throw new Error("The publishing backend returned an incomplete review.");
  }
  return result;
}

// Publishes exactly the reviewed content: the backend refuses if anything changed since the review.
export async function requestPublish(reviewDigest, client = getDataClient()) {
  if (typeof reviewDigest !== "string" || !/^[0-9a-f]{64}$/.test(reviewDigest)) {
    throw new Error("Run a review before publishing.");
  }
  const mutation = getMutation(client);
  const { data, errors } = await mutation({ dryRun: false, reviewDigest });
  if (errors?.length) throw new Error(errors.map((error) => error.message).join("; "));
  const result = parseResult(data, "The publishing backend returned an invalid response.");
  if (!result || result.dryRun !== false || typeof result.wrote !== "boolean" ||
      !result.siteUpdate || typeof result.siteUpdate.status !== "string") {
    throw new Error("The publishing backend returned an incomplete response. Check GitHub Actions before trying again.");
  }
  return result;
}

// Turns the backend's site-update status into a message for the person publishing.
export function describePublishResult(result) {
  const { status, reason } = result.siteUpdate;
  if (status === "dispatched") {
    return {
      tone: "success",
      title: "Published.",
      detail: `${result.wrote ? "Your content was sent to the website." : "Nothing changed since the last publish, so the website was asked to rebuild."} The site usually updates within 2–5 minutes. If it doesn't, check the Actions tab of the GitHub repository.`
    };
  }
  if (status === "not-configured") {
    return {
      tone: "warning",
      title: "Saved for publishing, but the website was not updated.",
      detail: `${reason || "The GitHub connection is not set up yet."} Your reviewed content is stored and will go live once the connection works and you publish again.`
    };
  }
  return {
    tone: "warning",
    title: "The website update did not start.",
    detail: `${reason || "GitHub did not accept the update request."} Your reviewed content is stored; publish again to retry.`
  };
}

const plural = (count, one, many) => `${count === 1 ? one : many}`;

function countChanges(changes) {
  if (!changes || typeof changes !== "object") return null;
  const lists = ["added", "changed", "removed"].map((key) => (Array.isArray(changes[key]) ? changes[key].length : 0));
  return { added: lists[0], changed: lists[1], removed: lists[2] };
}

export default function PublishReview({ review = requestPublishReview, publish = requestPublish }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(null);

  async function runReview() {
    setRunning(true);
    setError("");
    setResult(null);
    setConfirmed(false);
    setPublished(null);
    try {
      setResult(await review());
    } catch (reviewError) {
      setError(reviewError.message || "The publishing review failed.");
    } finally {
      setRunning(false);
    }
  }

  async function runPublish() {
    if (!result || !confirmed) return;
    setPublishing(true);
    setError("");
    try {
      setPublished(await publish(result.reviewDigest));
      setResult(null);
      setConfirmed(false);
    } catch (publishError) {
      const message = publishError.message || "Publishing failed. Nothing was published.";
      setError(message);
      // A changed-since-review refusal means this review is stale: require a fresh one.
      if (/review again/i.test(message)) {
        setResult(null);
        setConfirmed(false);
      }
    } finally {
      setPublishing(false);
    }
  }

  const counts = result ? countChanges(result.changes) : null;
  const pages = Array.isArray(result?.pages) ? result.pages : [];
  const outcome = published ? describePublishResult(published) : null;

  return (
    <section className="profile-workspace">
      <div className="profile-library-heading">
        <p className="eyebrow">SITE / PUBLISHING</p>
        <h1>Publish to the <em>website.</em></h1>
        <p className="welcome-copy">
          Review what will change on the public website, then publish. Only saved cloud records
          marked Published are included; drafts, archived records and unsaved edits are not.
        </p>
        <p className="storage-warning" role="note">
          Not published yet: PDF uploads, images and the Profile page. Typed essays and research
          projects are published as text pages. Pages you wrote by hand are never overwritten.
        </p>
        <button className="button button-secondary" disabled={running || publishing} onClick={runReview} type="button">
          {running ? "Preparing review..." : result ? "Run the review again" : "Review changes"}
        </button>
      </div>

      {error && <p className="storage-warning" role="alert">{error}</p>}

      {outcome && (
        <div className={`publish-outcome publish-outcome-${outcome.tone}`} role="status">
          <strong>{outcome.title}</strong>
          <p>{outcome.detail}</p>
          {outcome.tone === "success" && (
            <p><a href={PUBLIC_SITE_URL} rel="noopener noreferrer" target="_blank">Open the website ↗</a></p>
          )}
        </div>
      )}

      {result && (
        <div className="publish-review">
          <p role="status">Review complete. Nothing has been published yet.</p>
          <ul className="publish-summary">
            <li><strong>{result.manifest.publications.length}</strong> {plural(result.manifest.publications.length, "publication", "publications")}</li>
            <li><strong>{result.manifest.research.length}</strong> {plural(result.manifest.research.length, "research project", "research projects")}</li>
            <li><strong>{pages.length}</strong> {plural(pages.length, "page", "pages")} will be generated</li>
            {counts && (
              <li>
                Since the last publish: <strong>{counts.added}</strong> added, <strong>{counts.changed}</strong> changed,{" "}
                <strong>{counts.removed}</strong> removed
              </li>
            )}
            {result.excluded.length > 0 && <li><strong>{result.excluded.length}</strong> {plural(result.excluded.length, "record", "records")} left out (see below)</li>}
          </ul>

          {pages.length > 0 && (
            <details>
              <summary>Pages that will be generated ({pages.length})</summary>
              <ul>{pages.map((page) => <li key={page}><code>{page}</code></li>)}</ul>
            </details>
          )}

          {["publications", "research", "profile"].map((section) => (
            <details key={section}>
              <summary>{section} ({result.manifest[section].length})</summary>
              {result.manifest[section].map((record, index) => (
                <details key={`${record.id}-${index}`}>
                  <summary>{record.title} {record.publicPath ? `- ${record.publicPath}` : ""}</summary>
                  <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(record, null, 2)}</pre>
                </details>
              ))}
            </details>
          ))}
          {[
            ["Changes since the last publish", result.changes],
            ["Records left out", result.excluded],
            ["Cleanup notes", result.notes],
            ["Warnings", result.warnings]
          ].map(([label, value]) => (
            <details key={label}>
              <summary>{label}</summary>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(value, null, 2)}</pre>
            </details>
          ))}

          <div className="publish-confirm">
            <label htmlFor="publish-confirm-check">
              <input
                checked={confirmed}
                disabled={publishing}
                id="publish-confirm-check"
                onChange={(event) => setConfirmed(event.target.checked)}
                type="checkbox"
              />
              {" "}I've reviewed these changes and want them on the public website.
            </label>
            <button
              className="button button-primary"
              disabled={!confirmed || publishing}
              onClick={runPublish}
              type="button"
            >
              {publishing ? "Publishing..." : "Publish to website"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
