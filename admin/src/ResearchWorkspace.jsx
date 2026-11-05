import { useEffect, useMemo, useState } from "react";

const projectStatuses = ["In progress", "Past", "Planned"];

function createProject() {
  return {
    id: crypto.randomUUID(),
    kind: "project",
    isExisting: false,
    status: "In progress",
    title: "",
    subtitle: "",
    overviewTitle: "",
    overview: "",
    note: "",
    updatedAt: null
  };
}

function projectPath(title) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `research/${slug || "untitled"}.html`;
}

function formatDate(value) {
  if (!value) return "Not edited yet";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function Icon({ name, size = 17 }) {
  const paths = {
    arrow: "M5 12h14M13 6l6 6-6 6",
    back: "M19 12H5m7 7-7-7 7-7",
    check: "m5 12 4 4L19 6",
    close: "M6 6l12 12M18 6 6 18",
    edit: "M4 20h4l11-11a2.1 2.1 0 0 0-4-4L4 16v4Z",
    eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    plus: "M12 5v14M5 12h14",
    save: "M5 4h12l3 3v13H4V4h1Zm2 0v6h9V4"
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

function ResearchPreview({ entry }) {
  if (entry.kind === "profile") {
    return (
      <article className="research-preview profile-research-preview">
        <p className="eyebrow">Academic profile · {entry.title}</p>
        <h2>{entry.title}</h2>
        <p className="research-preview-deck">{entry.summary || "A short introduction will appear here."}</p>
        <div className="research-preview-copy">
          {(entry.content || "Your detailed research profile will appear here.")
            .split(/\n\s*\n/)
            .filter(Boolean)
            .map((paragraph, index) => <p key={`${index}-${paragraph}`}>{paragraph}</p>)}
        </div>
      </article>
    );
  }

  return (
    <article className="research-preview">
      <p className="eyebrow">{entry.status || "Research project"} · Research</p>
      <h2>{entry.title || "Untitled research project"}</h2>
      <p className="research-preview-deck">{entry.subtitle || "A concise introduction to the project."}</p>
      <section>
        <p className="eyebrow">Project overview</p>
        <h3>{entry.overviewTitle || "Project overview"}</h3>
        <div className="research-preview-copy">
          {(entry.overview || "Project details will appear here.")
            .split(/\n\s*\n/)
            .filter(Boolean)
            .map((paragraph, index) => <p key={`${index}-${paragraph}`}>{paragraph}</p>)}
        </div>
      </section>
      {entry.note && <aside>{entry.note}</aside>}
    </article>
  );
}

function Field({ label, value, onChange, multiline = false, hint = "" }) {
  const Control = multiline ? "textarea" : "input";
  return (
    <label className="research-field">
      <span>{label}</span>
      <Control onChange={(event) => onChange(event.target.value)} value={value || ""} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function ResearchWorkspace({ initialEntries, onSave, onDelete }) {
  const [entries, setEntries] = useState(initialEntries);
  const [activeId, setActiveId] = useState(null);
  const [working, setWorking] = useState(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => setEntries(initialEntries), [initialEntries]);

  const filteredEntries = useMemo(() => entries.filter((entry) => (
    `${entry.title} ${entry.subtitle || entry.summary || ""}`.toLowerCase().includes(query.toLowerCase())
  )), [entries, query]);

  function openEntry(entry) {
    setActiveId(entry.id);
    setWorking({ ...entry });
    setPreview(false);
    setError("");
    setSavedMessage("");
  }

  function updateField(field, value) {
    setWorking((current) => ({ ...current, [field]: value }));
    setSavedMessage("");
    setError("");
  }

  async function saveEntry() {
    if (!working.title.trim()) {
      setError("Add a title before saving this research draft.");
      return;
    }
    if (working.kind === "project" && !working.subtitle.trim()) {
      setError("Add a short introduction before saving this project.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const saved = await onSave({
        ...working,
        title: working.title.trim(),
        updatedAt: new Date().toISOString()
      });
      setWorking(saved);
      setEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
      setActiveId(saved.id);
      setSavedMessage("Saved in this browser");
    } catch (saveError) {
      setError(saveError.message || "The research draft could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function removeEntry() {
    if (!working || !window.confirm(`Delete "${working.title}" from this browser's research workspace?`)) return;
    try {
      await onDelete(working.id);
      setEntries((current) => current.filter((entry) => entry.id !== working.id));
      setWorking(null);
      setActiveId(null);
      setError("");
      setSavedMessage("");
    } catch (deleteError) {
      setError(deleteError.message || "The research draft could not be deleted.");
    }
  }

  if (working) {
    return (
      <section className="research-workspace research-editor">
        <div className="research-editor-top">
          <button className="text-link" onClick={() => { setWorking(null); setActiveId(null); }} type="button">
            <Icon name="back" size={16} /> Research library
          </button>
          <div className="research-editor-actions">
            {savedMessage && <span className="research-saved"><Icon name="check" size={14} />{savedMessage}</span>}
            <button className="button button-secondary" onClick={() => setPreview(!preview)} type="button">
              <Icon name={preview ? "edit" : "eye"} size={15} /> {preview ? "Edit" : "Preview"}
            </button>
            <button className="button button-primary" disabled={saving} onClick={saveEntry} type="button">
              <Icon name="save" size={15} /> {saving ? "Saving…" : "Save draft"}
            </button>
          </div>
        </div>

        {error && <p className="research-error" role="alert">{error}</p>}

        {preview ? (
          <ResearchPreview entry={working} />
        ) : (
          <div className="research-edit-layout">
            <div className="research-fields-column">
              <div className="research-editor-heading">
                <p className="eyebrow">{working.kind === "profile" ? "Profile research content" : "Research project"}</p>
                <h1>{working.title || (working.kind === "profile" ? "Profile section" : "A new project")}</h1>
                <p>{working.isExisting ? `Based on ${working.sourcePath}` : "New browser-local draft"}</p>
              </div>
              {working.kind === "project" ? (
                <>
                  <Field label="Project title" onChange={(value) => updateField("title", value)} value={working.title} />
                  <Field label="Short introduction" hint="This appears beneath the title on the project page." onChange={(value) => updateField("subtitle", value)} value={working.subtitle} multiline />
                  <label className="research-field">
                    <span>Project stage</span>
                    <select onChange={(event) => updateField("status", event.target.value)} value={working.status || "In progress"}>
                      {projectStatuses.map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </label>
                  <Field label="Overview heading" onChange={(value) => updateField("overviewTitle", value)} value={working.overviewTitle} />
                  <Field label="Project overview" hint="Separate paragraphs with a blank line." onChange={(value) => updateField("overview", value)} value={working.overview} multiline />
                  <Field label="Additional note" hint="Optional context shown below the overview." onChange={(value) => updateField("note", value)} value={working.note} multiline />
                </>
              ) : (
                <>
                  <Field label="Section title" onChange={(value) => updateField("title", value)} value={working.title} />
                  <Field label="Introduction" onChange={(value) => updateField("summary", value)} value={working.summary} multiline />
                  <Field label="Expanded section content" hint="Separate paragraphs with a blank line." onChange={(value) => updateField("content", value)} value={working.content} multiline />
                </>
              )}
              {working.isExisting && <p className="research-source-note">Saving here creates a local draft; it does not change the public page.</p>}
              <div className="research-editor-bottom">
                <button className="text-link research-delete" onClick={removeEntry} type="button">
                  {working.isExisting ? "Remove local copy" : "Delete draft"}
                </button>
                <span>Last saved: {formatDate(working.updatedAt)}</span>
              </div>
            </div>
            <aside className="research-preview-side">
              <p className="eyebrow">Live preview</p>
              <ResearchPreview entry={working} />
              {working.kind === "project" && (
                <p className="research-path-hint">Expected page path: <code>{working.sourcePath || projectPath(working.title)}</code></p>
              )}
            </aside>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="research-workspace">
      <div className="research-library-heading">
        <div>
          <p className="eyebrow">YOUR EDITORIAL WORKSPACE <span className="eyebrow-divider">/</span> RESEARCH</p>
          <h1>Research, <em>in progress.</em></h1>
          <p className="welcome-copy">Manage the four research project pages linked from your profile and showcase.</p>
        </div>
        <button className="button button-primary" onClick={() => openEntry(createProject())} type="button">
          <Icon name="plus" size={16} /> New research project
        </button>
      </div>
      <div className="research-library-toolbar">
        <label className="research-search">
          <span className="visually-hidden">Search research</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Search projects and profile sections" type="search" value={query} />
        </label>
        <span>{filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"}</span>
      </div>
      <div className="research-entry-grid">
        {filteredEntries.map((entry) => (
          <button className="research-entry-card" key={entry.id} onClick={() => openEntry(entry)} type="button">
            <span className="research-entry-type">{entry.kind === "profile" ? "PROFILE SECTION" : (entry.status || "RESEARCH PROJECT").toUpperCase()}</span>
            <strong>{entry.title}</strong>
            <span className="research-entry-description">{entry.subtitle || entry.summary || entry.overview || "A new research project draft."}</span>
            <span className="research-entry-footer">
              <span>{entry.isExisting ? "Existing public content" : "Browser draft"}</span>
              <span>{formatDate(entry.updatedAt)} <Icon name="arrow" size={14} /></span>
            </span>
          </button>
        ))}
        {!filteredEntries.length && (
          <p className="research-empty-state">{query ? "No research matches this search." : "No research has been added yet."}</p>
        )}
      </div>
      <p className="research-storage-note">Drafts are saved in this browser only. They are not yet synced to the cloud or published to the public website.</p>
    </section>
  );
}
