import { useEffect, useMemo, useState } from "react";

const profileOrder = [
  "profile-introduction",
  "profile-biography-title",
  "profile-education-title",
  "profile-interests-title",
  "profile-experience-title",
  "profile-skills-title",
  "profile-cv-title",
  "profile-contact-title"
];

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
    edit: "M4 20h4l11-11a2.1 2.1 0 0 0-4-4L4 16v4Z",
    eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    save: "M5 4h12l3 3v13H4V4h1Zm2 0v6h9V4"
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

function PreviewText({ value }) {
  return value.split(/\n\s*\n/).filter(Boolean).map((block, index) => {
    const lines = block.split("\n").filter(Boolean);
    if (lines.every((line) => line.startsWith("• "))) {
      return (
        <ul key={`${index}-${block}`}>
          {lines.map((line) => <li key={line}>{line.slice(2)}</li>)}
        </ul>
      );
    }
    return lines.map((line, lineIndex) => {
      const heading = line.match(/^##\s+(.+)$/);
      if (heading) return <h3 key={`${index}-${lineIndex}`}>{heading[1]}</h3>;
      return <p key={`${index}-${lineIndex}`}>{line}</p>;
    });
  });
}

function ProfilePreview({ entry }) {
  const isIntroduction = entry.kind === "profile-introduction";
  return (
    <article className={`profile-preview ${isIntroduction ? "is-introduction" : ""}`}>
      <p className="eyebrow">{isIntroduction ? "Academic profile" : "Profile · The Natural Inquiry"}</p>
      <h2>{entry.title || "Untitled profile section"}</h2>
      {!isIntroduction && entry.summary && <p className="profile-preview-summary">{entry.summary}</p>}
      <div className="profile-preview-content"><PreviewText value={entry.content || ""} /></div>
    </article>
  );
}

export default function ProfileWorkspace({ initialEntries, onSave }) {
  const [entries, setEntries] = useState(initialEntries);
  const [working, setWorking] = useState(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setEntries(initialEntries), [initialEntries]);

  const filteredEntries = useMemo(() => entries.filter((entry) => (
    `${entry.title} ${entry.summary || ""} ${entry.content || ""}`
      .toLowerCase()
      .includes(query.toLowerCase())
  )).sort((left, right) => profileOrder.indexOf(left.id) - profileOrder.indexOf(right.id)), [entries, query]);

  function openEntry(entry) {
    setWorking({ ...entry });
    setPreview(false);
    setSavedMessage("");
    setError("");
  }

  function updateField(field, value) {
    setWorking((current) => ({ ...current, [field]: value }));
    setSavedMessage("");
    setError("");
  }

  async function saveEntry() {
    if (!working.title.trim()) {
      setError("Add a section title before saving.");
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
      setEntries((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
      setSavedMessage("Saved in this browser");
    } catch (saveError) {
      setError(saveError.message || "The profile section could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (working) {
    return (
      <section className="profile-workspace profile-editor">
        <div className="profile-editor-top">
          <button className="text-link" onClick={() => setWorking(null)} type="button">
            <Icon name="back" size={16} /> Profile sections
          </button>
          <div className="profile-editor-actions">
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
          <div className="profile-preview-wrap"><ProfilePreview entry={working} /></div>
        ) : (
          <div className="profile-edit-layout">
            <div className="profile-fields-column">
              <div className="research-editor-heading">
                <p className="eyebrow">{working.kind === "profile-introduction" ? "Profile introduction" : "Academic profile section"}</p>
                <h1>{working.title}</h1>
                <p>Based on {working.sourcePath}; saved changes stay in this browser.</p>
              </div>
              <label className="research-field">
                <span>{working.kind === "profile-introduction" ? "Page heading" : "Section heading"}</span>
                <input onChange={(event) => updateField("title", event.target.value)} value={working.title} />
              </label>
              {working.kind !== "profile-introduction" && (
                <label className="research-field">
                  <span>Section introduction</span>
                  <textarea onChange={(event) => updateField("summary", event.target.value)} value={working.summary || ""} />
                </label>
              )}
              <label className="research-field">
                <span>{working.kind === "profile-introduction" ? "Page description" : "Expanded section content"}</span>
                <textarea className="profile-content-input" onChange={(event) => updateField("content", event.target.value)} value={working.content || ""} />
                <small>Separate paragraphs with a blank line. Lines beginning with “## ” preview as subheadings; lines beginning with “• ” preview as bullets.</small>
              </label>
              <p className="research-source-note">
                This is a local draft. Saving does not change profile.html or publish anything.
              </p>
              <div className="research-editor-bottom">
                <span>Last saved: {formatDate(working.updatedAt)}</span>
                <span>Original public page is unchanged</span>
              </div>
            </div>
            <aside className="profile-preview-side">
              <p className="eyebrow">Live preview</p>
              <ProfilePreview entry={working} />
            </aside>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="profile-workspace">
      <div className="profile-library-heading">
        <div>
          <p className="eyebrow">YOUR EDITORIAL WORKSPACE <span className="eyebrow-divider">/</span> PROFILE</p>
          <h1>Profile, <em>in your words.</em></h1>
          <p className="welcome-copy">Edit the background, education, interests, experience, skills, CV information, and contact details that make up your academic profile.</p>
        </div>
      </div>
      <div className="research-library-toolbar">
        <label className="research-search">
          <span className="visually-hidden">Search profile sections</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Search profile sections" type="search" value={query} />
        </label>
        <span>{filteredEntries.length} {filteredEntries.length === 1 ? "section" : "sections"}</span>
      </div>
      <div className="profile-entry-grid">
        {filteredEntries.map((entry) => (
          <button className="profile-entry-card" key={entry.id} onClick={() => openEntry(entry)} type="button">
            <span className="research-entry-type">{entry.kind === "profile-introduction" ? "PAGE INTRODUCTION" : "PROFILE SECTION"}</span>
            <strong>{entry.title}</strong>
            <span className="research-entry-description">{entry.summary || entry.content}</span>
            <span className="research-entry-footer">
              <span>{entry.updatedAt ? "Browser draft" : "Existing profile content"}</span>
              <span>{formatDate(entry.updatedAt)} <Icon name="arrow" size={14} /></span>
            </span>
          </button>
        ))}
        {!filteredEntries.length && (
          <p className="research-empty-state">{query ? "No profile sections match this search." : "No profile sections are available."}</p>
        )}
      </div>
      <p className="research-storage-note">Your profile drafts are stored in this browser. Public profile content stays unchanged until a publishing workflow is added.</p>
    </section>
  );
}
