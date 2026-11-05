import { useEffect, useMemo, useState } from "react";
import { describeFilings, planPublicationReconciliation } from "./subject-index-reconcile.js";

function categoryId(title, categories) {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "new-category";
  const usedIds = new Set(categories.map((category) => category.id));
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) id = `${base}-${suffix++}`;
  return id;
}

function Icon({ name, size = 16 }) {
  const paths = {
    check: "m5 12 4 4L19 6",
    plus: "M12 5v14M5 12h14",
    save: "M5 4h12l3 3v13H4V4h1Zm2 0v6h9V4",
    trash: "M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

export default function SubjectIndexWorkspace({
  initialCategories,
  loadError,
  onSave,
  publications = [],
  research = [],
  cloudState = { publications: "loading", research: "loading" },
  filingSync = { state: "idle", message: "", result: null },
  onReconcileCloud,
  editable = true,
  readOnlyNotice = ""
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [query, setQuery] = useState("");
  const [newCategoryTitle, setNewCategoryTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => setCategories(initialCategories), [initialCategories]);

  const isDirty = useMemo(
    () => JSON.stringify(categories) !== JSON.stringify(initialCategories),
    [categories, initialCategories]
  );
  const filteredCategories = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return categories;
    return categories.filter((category) => (
      category.title.toLowerCase().includes(search)
      || category.subjects.some((subject) => subject.toLowerCase().includes(search))
    ));
  }, [categories, query]);
  const topicCount = categories.reduce((total, category) => total + category.subjects.length, 0);
  const cloudReady = cloudState.publications === "ready";
  const filings = useMemo(() => describeFilings(initialCategories, publications), [initialCategories, publications]);
  const stalePlan = useMemo(
    () => (cloudReady ? planPublicationReconciliation(initialCategories, publications) : []),
    [cloudReady, initialCategories, publications]
  );

  function updateCategory(categoryIdValue, updates) {
    if (!editable) return;
    setCategories((current) => current.map((category) => (
      category.id === categoryIdValue ? { ...category, ...updates } : category
    )));
    setError("");
    setSavedMessage("");
  }

  function addCategory(event) {
    event.preventDefault();
    if (!editable) return;
    const title = newCategoryTitle.trim();
    if (!title) return;
    const added = { id: categoryId(title, categories), title, subjects: [] };
    setCategories((current) => [...current, added]);
    setNewCategoryTitle("");
    setError("");
    setSavedMessage("");
  }

  function removeCategory(category) {
    if (!editable) return;
    if (!window.confirm(
      `Remove "${category.title}" from the directory? Any publications filed under it will remain intact but be unfiled from this Index category.`
    )) return;
    setCategories((current) => current.filter((entry) => entry.id !== category.id));
    setError("");
    setSavedMessage("");
  }

  function addSubject(category, event) {
    event.preventDefault();
    if (!editable) return;
    const form = event.currentTarget;
    const input = form.elements.namedItem("new-subject");
    const subject = input.value.trim();
    if (!subject) return;
    if (category.subjects.some((existing) => existing.toLowerCase() === subject.toLowerCase())) {
      setError(`"${subject}" is already listed in ${category.title}.`);
      return;
    }
    updateCategory(category.id, { subjects: [...category.subjects, subject] });
    form.reset();
  }

  function removeSubject(category, subject) {
    if (!editable) return;
    if (!window.confirm(
      `Remove "${subject}" from "${category.title}"? Publications filed under this topic will remain intact but be unfiled from it.`
    )) return;
    updateCategory(category.id, {
      subjects: category.subjects.filter((entry) => entry !== subject)
    });
  }

  async function saveChanges() {
    if (!editable) return;
    setSaving(true);
    setError("");
    setSavedMessage("");
    try {
      const saved = await onSave(categories);
      setCategories(saved);
      setSavedMessage("Saved to the local public Index. Not deployed.");
    } catch (saveError) {
      setError(saveError.message || "The Subject Index could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="subject-index-workspace">
      <div className="subject-index-heading">
        <div>
          <p className="eyebrow">YOUR EDITORIAL WORKSPACE <span className="eyebrow-divider">/</span> SUBJECT INDEX</p>
          <h1>Directory, <em>well rooted.</em></h1>
          <p className="welcome-copy">
            Manage the scientific disciplines and topics used by the public Natural Inquiry Index and the publication editor.
          </p>
        </div>
        <button className="button button-primary" disabled={!editable || !isDirty || saving} onClick={saveChanges} type="button">
          <Icon name="save" size={15} /> {saving ? "Saving…" : "Save Index"}
        </button>
      </div>

      <div className="subject-index-status-row">
        <p><strong>{categories.length}</strong> disciplines <span>·</span> <strong>{topicCount}</strong> topics</p>
        {isDirty && <span className="subject-index-unsaved">Unsaved changes</span>}
        {savedMessage && <span className="research-saved"><Icon name="check" size={14} />{savedMessage}</span>}
      </div>

      {!editable && readOnlyNotice && <p className="storage-warning" role="note">{readOnlyNotice}</p>}
      {loadError && <p className="research-error" role="alert">{loadError}</p>}
      {error && <p className="research-error" role="alert">{error}</p>}

      <div className="subject-index-cloud-status" role="status">
        {cloudState.publications === "loading" && <p>Loading cloud publications…</p>}
        {cloudState.publications === "error" && (
          <p className="research-error" role="alert">Cloud publications could not be loaded, so filings are not shown and cloud filings will not be changed. Use Retry on the Publications page.</p>
        )}
        {cloudReady && (
          <p>
            <strong>{publications.length}</strong> cloud {publications.length === 1 ? "publication" : "publications"} loaded.
            {" "}{research.length ? <>{research.length} research {research.length === 1 ? "project is" : "projects are"} listed in the cloud but cannot be filed in the Index, so they are read-only here.</> : null}
          </p>
        )}
        {cloudReady && stalePlan.length > 0 && (
          <p className="research-error" role="alert">
            {stalePlan.length} cloud {stalePlan.length === 1 ? "publication is" : "publications are"} filed under topics that are no longer in the Index.{" "}
            {editable && <button className="text-link" disabled={filingSync.state === "saving"} onClick={onReconcileCloud} type="button">Re-check cloud filings</button>}
          </p>
        )}
        {filingSync.state === "saving" && <p>{filingSync.message}</p>}
        {filingSync.state === "done" && <p className="research-saved"><Icon name="check" size={14} />{filingSync.message}</p>}
        {filingSync.state === "error" && (
          <div className="research-error" role="alert">
            <p>{filingSync.message}</p>
            {filingSync.result?.results.filter((item) => item.status !== "updated").map((item) => (
              <p key={item.id}>{item.title}: {item.status === "conflict" ? "changed elsewhere (conflict)" : "failed"} — {item.message}</p>
            ))}
          </div>
        )}
        <p className="subject-index-note">Cloud filings are saved to your AWS workspace only. Filing or unfiling a publication here does not publish it to the public website.</p>
      </div>

      <div className="subject-index-controls">
        <label className="research-search">
          <span className="visually-hidden">Search directory topics</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Find a discipline or topic" type="search" value={query} />
        </label>
        <form className="subject-index-add-category" onSubmit={addCategory} hidden={!editable}>
          <label className="visually-hidden" htmlFor="new-index-category">New discipline name</label>
          <input id="new-index-category" onChange={(event) => setNewCategoryTitle(event.target.value)}
            placeholder="Add a new discipline" value={newCategoryTitle} />
          <button aria-label="Add discipline" className="button button-secondary" disabled={!newCategoryTitle.trim()} type="submit">
            <Icon name="plus" size={15} /> Add discipline
          </button>
        </form>
      </div>

      <div className="subject-index-category-list">
        {filteredCategories.map((category) => (
          <article className="subject-index-category-card" key={category.id}>
            <header className="subject-index-category-header">
              <label className="subject-index-title-field">
                <span>Discipline</span>
                <input aria-label={`Discipline name for ${category.title}`} readOnly={!editable}
                  onChange={(event) => updateCategory(category.id, { title: event.target.value })}
                  value={category.title} />
              </label>
              <button className="subject-index-delete" disabled={!editable} hidden={!editable} onClick={() => removeCategory(category)} type="button">
                <Icon name="trash" size={14} /> Remove discipline
              </button>
            </header>

            <div className="subject-index-topics-heading">
              <h2>Topics <span>{category.subjects.length}</span></h2>
              <p>These are the selectable subtopics shown in the public directory and publication tags.</p>
            </div>

            {cloudReady && (() => {
              const filed = filings.byCategory.get(category.id)?.publications || [];
              return (
                <details className="subject-index-filed">
                  <summary>{filed.length} cloud {filed.length === 1 ? "publication" : "publications"} filed here</summary>
                  {filed.length ? (
                    <ul>{filed.map((item) => <li key={item.id}>{item.title}{item.archived ? " (archived)" : ""}</li>)}</ul>
                  ) : <p>None yet. File publications from the Publications editor.</p>}
                </details>
              );
            })()}

            {category.subjects.length ? (
              <div className="subject-index-topic-list">
                {category.subjects.map((subject, index) => (
                  <div className="subject-index-topic-row" key={`${category.id}-${index}-${subject}`}>
                    <label>
                      <span className="visually-hidden">Topic name</span>
                      <input aria-label={`Topic ${index + 1} in ${category.title}`} readOnly={!editable}
                        onChange={(event) => {
                          const replacement = event.target.value;
                          updateCategory(category.id, {
                            subjects: category.subjects.map((entry, entryIndex) => entryIndex === index ? replacement : entry)
                          });
                        }}
                        value={subject} />
                    </label>
                    <button aria-label={`Remove ${subject} from ${category.title}`} className="subject-index-topic-delete" disabled={!editable} hidden={!editable}
                      onClick={() => removeSubject(category, subject)} type="button">×</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="subject-index-empty-topics">No topics yet. Add the first one below.</p>
            )}

            <form className="subject-index-add-topic" hidden={!editable} onSubmit={(event) => addSubject(category, event)}>
              <label className="visually-hidden" htmlFor={`new-topic-${category.id}`}>New topic for {category.title}</label>
              <input id={`new-topic-${category.id}`} name="new-subject" placeholder="Add a topic or subtopic" />
              <button className="text-link" type="submit"><Icon name="plus" size={14} /> Add topic</button>
            </form>
          </article>
        ))}
        {!filteredCategories.length && (
          <p className="research-empty-state">{query ? "No disciplines or topics match this search." : "No Index disciplines are available."}</p>
        )}
      </div>

      <p className="subject-index-note">
        {editable
          ? "Saving updates the directory data in this local project and refreshes the tags available to Publications. Removed topics are unfiled from drafts in this browser and from cloud publications (after confirmation, using the same conflict checks as other cloud edits); the publications themselves are not deleted. Nothing is pushed to GitHub, deployed, or published to the public website."
          : "Read-only: nothing on this page can change the Index, your cloud publications, or the public website."}
      </p>
    </section>
  );
}
