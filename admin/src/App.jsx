import { useEffect, useMemo, useRef, useState } from "react";
import "../../natural-inquiry-index-data.js";
import EntryEditor from "./EntryEditor.jsx";
import {
  deleteDraft,
  getDraft,
  listDrafts,
  listProfileEntries,
  listPublications,
  listResearch,
  savePublication,
  saveProfileEntry,
  saveDraft,
  saveResearchEntry,
  seedPublicationsIfNeeded,
  seedProfileIfNeeded,
  seedResearchIfNeeded,
  deleteResearchEntry
} from "./draft-storage.js";
import PublicationsWorkspace from "./PublicationsWorkspace.jsx";
import { getExistingPublications } from "./publication-seeds.js";
import ProfileWorkspace from "./ProfileWorkspace.jsx";
import { getProfileSeeds } from "./profile-seeds.js";
import ResearchWorkspace from "./ResearchWorkspace.jsx";
import { getResearchSeeds } from "./research-seeds.js";
import SubjectIndexWorkspace from "./SubjectIndexWorkspace.jsx";

const navigation = [
  {
    label: "Workspace",
    items: [
      { id: "overview", label: "Overview", icon: "overview" },
      { id: "publications", label: "Publications", icon: "writing" },
      { id: "research", label: "Research projects", icon: "research" },
      { id: "profile", label: "Profile", icon: "writing" },
      { id: "field-notes", label: "Field notes", icon: "notes" }
    ]
  },
  {
    label: "Library",
    items: [
      { id: "subject-index", label: "Subject index", icon: "index" },
      { id: "media-library", label: "Media library", icon: "media" }
    ]
  },
  {
    label: "Site",
    items: [
      { id: "website-editor", label: "Website editor", icon: "site" },
      { id: "settings", label: "Settings", icon: "settings" }
    ]
  }
];

const iconPaths = {
  overview: "M3 10.5 12 3l9 7.5M5.5 9v11h13V9M9 20v-6h6v6",
  writing: "M4 20h4l11-11a2.1 2.1 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4",
  research: "M9 3h6M10 3v6.2L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.2V3M8 15h8",
  notes: "M5 4.5h14v15H5zM8 8h8M8 11.5h8M8 15h5",
  index: "M4 5h16M4 12h16M4 19h16M8 3v4M15 10v4M10 17v4",
  media: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 15l4-4 4 4 3-3 5 5M15.5 8h.01",
  site: "M4 5h16v14H4zM4 9h16M8 7h.01M11 7h.01",
  settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM19 13.5l2-1.5-2-1.5-.5-2.1-2.4-.2L15 6l-2 .9L11 6l-1.1 2.2-2.4.2L7 10.5 5 12l2 1.5.5 2.1 2.4.2L11 18l2-.9 2 .9 1.1-2.2 2.4-.2z",
  search: "m20 20-4.2-4.2M17 9.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z",
  bell: "M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14M13 6l6 6-6 6",
  chevron: "m9 18 6-6-6-6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  close: "M6 6l12 12M18 6 6 18",
  sprig: "M19 5c-8 0-13 3-13 9a5 5 0 0 0 5 5c6 0 8-6 8-14ZM5 21c2-5 5-8 10-11",
  waves: "M3 9c2.2 0 2.2-2 4.5-2S9.8 9 12 9s2.2-2 4.5-2S18.8 9 21 9M3 15c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.2-2 4.5-2 2.3 2 4.5 2M3 20c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.2-2 4.5-2 2.3 2 4.5 2",
  sail: "M12 3v15M12 4 5 16h7M13 7l7 9h-7M3 19c3 2 5 2 9 0 4 2 6 2 9 0",
  wind: "M3 8h12a2.5 2.5 0 1 0-2.5-2.5M2 12h16a2.5 2.5 0 1 1-2.5 2.5M4 16h8a2.5 2.5 0 1 1-2.5 2.5",
  edit: "M4 20h4l11-11a2.1 2.1 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4",
  publish: "M5 12.5 9.5 17 20 6.5M4 4h10M4 8h5",
  clock: "M12 8v4l2.5 1.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  check: "m5 12 4 4L19 6"
};

function Icon({ name, size = 18, className = "" }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={iconPaths[name] || iconPaths.overview} />
    </svg>
  );
}

function Sidebar({ activeSection, onNavigate, isOpen, onClose }) {
  return (
    <>
      <button
        aria-label="Close navigation"
        className={`sidebar-scrim ${isOpen ? "is-visible" : ""}`}
        onClick={onClose}
        tabIndex={isOpen ? 0 : -1}
      />
      <aside className={`sidebar ${isOpen ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <a className="brand-lockup" href="/admin/" aria-label="The Natural Inquiry workspace">
            <span className="brand-seal">N</span>
            <span className="brand-name">The Natural Inquiry</span>
          </a>
          <span className="workspace-label">EDITORIAL WORKSPACE</span>
        </div>

        <nav aria-label="Dashboard navigation" className="sidebar-navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-group-label">{group.label}</p>
              {group.items.map((item) => (
                <button
                  aria-current={activeSection === item.id ? "page" : undefined}
                  className={`nav-item ${activeSection === item.id ? "is-active" : ""}`}
                  key={item.id}
                  onClick={() => {
                    onNavigate(item.id);
                    onClose();
                  }}
                  type="button"
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                  {item.count && <span className="nav-count">{item.count}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="workspace-status">
            <span className="status-mark"><Icon name="sprig" size={16} /></span>
            <span>
              <strong>Local workspace</strong>
              <small>Stored in this browser</small>
            </span>
          </div>
          <button className="profile-switcher" type="button" onClick={() => onNavigate("settings")}>
            <span className="avatar">CE</span>
            <span className="profile-name"><strong>Chloe Elia</strong><small>Editor</small></span>
            <Icon className="profile-chevron" name="chevron" size={15} />
          </button>
        </div>
      </aside>
    </>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${status.toLowerCase()}`}>
      <span className="status-dot" />
      {status}
    </span>
  );
}

function Overview({ drafts, publications, onCreate, search, onOpenEntry, storageError }) {
  const [filter, setFilter] = useState("All");
  const actualPublications = publications.filter((publication) => !publication.archived);
  const publishedEntries = actualPublications.filter((publication) => publication.status === "Published");
  const draftEntries = [
    ...drafts.map((draft) => ({
      id: draft.id,
      isLocalDraft: true,
      title: draft.title || "Untitled draft",
      subtitle: draft.subtitle || `${draft.categoryLabel} · Saved in this browser`,
      kind: draft.categoryLabel,
      section: "This browser",
      status: "Draft",
      date: draft.updatedAt
        ? new Date(draft.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : "Recently",
      icon: draft.category === "Research project" ? "research" : draft.category === "Field note" ? "waves" : "writing"
    })),
    ...actualPublications.filter((publication) => publication.status === "Draft").map((publication) => ({
      ...publication,
      isPublication: true,
      kind: publication.category,
      section: "Saved in this browser",
      status: "Draft",
      date: publication.updatedAt
        ? new Date(publication.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : "Not edited yet",
      icon: "writing"
    }))
  ];
  const allEntries = [
    ...publishedEntries.map((publication) => ({
      ...publication,
      isPublication: true,
      kind: publication.category,
      section: "Existing public work",
      status: "Published",
      date: publication.updatedAt
        ? new Date(publication.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : "On public site",
      icon: "writing"
    })),
    ...draftEntries
  ];
  const researchCount = actualPublications.filter((publication) => publication.category === "Research project").length;
  const fieldNoteCount = actualPublications.filter((publication) => publication.category === "Field note").length;
  const filteredEntries = useMemo(() => allEntries.filter((entry) => {
    const matchesFilter = filter === "All" || entry.status === filter;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${entry.title} ${entry.subtitle} ${entry.kind} ${entry.section}`
      .toLowerCase()
      .includes(query);
    return matchesFilter && matchesSearch;
  }), [allEntries, filter, search]);

  return (
    <>
      <section className="welcome-row">
        <div>
          <p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} <span className="eyebrow-divider">/</span> Your workspace</p>
          <h1>A place for work<br /><em>in progress.</em></h1>
          <p className="welcome-copy">
            A considered home for your existing writing and work taking shape.
          </p>
        </div>
        <button className="button button-primary create-button" onClick={onCreate} type="button">
          <Icon name="plus" size={16} />
          New entry
        </button>
      </section>

      <div className="sample-notice">
        <span className="notice-mark"><Icon name="sprig" size={15} /></span>
        <span>Your existing public writing, alongside drafts saved in this browser.</span>
      </div>
      {storageError && <p className="storage-warning" role="alert">{storageError}</p>}

      <section aria-label="Content overview" className="metric-grid">
        <article className="metric-card">
          <div className="metric-topline"><span>Published writing</span><Icon name="writing" size={17} /></div>
          <div className="metric-value">{String(publishedEntries.length).padStart(2, "0")}</div>
          <p>Existing work on the public site</p>
          <div className="metric-rule"><span style={{ width: `${Math.min(100, publishedEntries.length * 22)}%` }} /></div>
        </article>
        <article className="metric-card">
          <div className="metric-topline"><span>Local drafts</span><Icon name="edit" size={17} /></div>
          <div className="metric-value">{String(draftEntries.length).padStart(2, "0")}</div>
          <p>Saved in this browser</p>
          <div className="metric-rule"><span style={{ width: `${Math.min(100, draftEntries.length * 22)}%` }} /></div>
        </article>
        <article className="metric-card">
          <div className="metric-topline"><span>Research projects</span><Icon name="research" size={17} /></div>
          <div className="metric-value">{String(researchCount).padStart(2, "0")}</div>
          <p>In your publication library</p>
          <div className="metric-rule"><span style={{ width: `${Math.min(100, researchCount * 22)}%` }} /></div>
        </article>
        <article className="metric-card metric-card-note">
          <div className="metric-topline"><span>Field notebook</span><Icon name="notes" size={17} /></div>
          <div className="metric-value">{String(fieldNoteCount).padStart(2, "0")}</div>
          <p>Field notes in your library</p>
          <div className="metric-rule"><span style={{ width: `${Math.min(100, fieldNoteCount * 22)}%` }} /></div>
        </article>
      </section>

      <section className="feature-grid">
        <article className="continue-card">
          <div className="section-kicker"><span className="kicker-line" /> YOUR PUBLIC WRITING</div>
          {publishedEntries[0] ? (
            <>
              <div className="continue-main">
                <div className="continue-copy">
                  <span className="entry-type">ESSAY <span>·</span> ON THE PUBLIC SITE</span>
                  <h2>{publishedEntries[0].title}</h2>
                  <p>{publishedEntries[0].subtitle}</p>
                  <button className="text-link" onClick={() => onOpenEntry({
                    ...publishedEntries[0],
                    isPublication: true
                  })} type="button">
                    Open publication <Icon name="arrow" size={16} />
                  </button>
                </div>
              </div>
              <div className="continue-footer">
                <span><Icon name="clock" size={14} /> Existing public reading page</span>
                <span className="reading-progress">Original work</span>
              </div>
            </>
          ) : (
            <p className="empty-state">Your existing public writing will appear here.</p>
          )}
        </article>

        <article className="activity-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Already on your website</p>
              <h2>Public writing</h2>
            </div>
          </div>
          <div className="activity-list">
            {publishedEntries.map((publication, index) => (
              <button className="activity-item public-writing-item" key={publication.id}
                onClick={() => onOpenEntry({ ...publication, isPublication: true })} type="button">
                <span className={`activity-icon activity-icon-${index}`}><Icon name="writing" size={15} /></span>
                <div className="activity-body">
                  <p><strong>{publication.title}</strong></p>
                  <time>{publication.subtitle}</time>
                </div>
              </button>
            ))}
            {!publishedEntries.length && <p className="empty-state">No public writing has been added yet.</p>}
          </div>
          <button className="activity-link" onClick={() => onOpenEntry({ openLibrary: true })} type="button">
            Open publications library <Icon name="arrow" size={15} />
          </button>
        </article>
      </section>

      <section className="content-section">
        <div className="content-heading">
          <div>
            <p className="eyebrow">Your editorial desk</p>
            <h2>Your writing</h2>
          </div>
          <div aria-label="Filter entries by status" className="filter-tabs" role="group">
            {["All", "Published", "Draft"].map((item) => (
              <button
                aria-pressed={filter === item}
                className={filter === item ? "is-selected" : ""}
                key={item}
                onClick={() => setFilter(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="entry-list">
          {filteredEntries.length ? filteredEntries.map((entry) => (
            <button className="entry-row" key={entry.id || entry.title} onClick={() => onOpenEntry(entry)} type="button">
              <span className={`entry-icon entry-icon-${entry.icon}`}><Icon name={entry.icon} size={18} /></span>
              <span className="entry-main">
                <strong>{entry.title}</strong>
                <small>{entry.subtitle}</small>
              </span>
              <span className="entry-section">{entry.section}</span>
              <span className="entry-kind">{entry.kind}</span>
              <StatusBadge status={entry.status} />
              <time className="entry-date">{entry.date}</time>
              <Icon className="entry-chevron" name="chevron" size={15} />
            </button>
          )) : (
            <p className="empty-state">No matching writing found. Try a different search or status.</p>
          )}
        </div>
        <p className="content-footnote">
          {publishedEntries.length} existing public {publishedEntries.length === 1 ? "publication" : "publications"} and {draftEntries.length} {draftEntries.length === 1 ? "local draft" : "local drafts"}.
        </p>
      </section>
    </>
  );
}

function SectionPlaceholder({ section, onCreate }) {
  const sectionName = navigation.flatMap((group) => group.items).find((item) => item.id === section)?.label;
  return (
    <section className="section-placeholder">
      <p className="eyebrow">YOUR EDITORIAL WORKSPACE <span className="eyebrow-divider">/</span> {sectionName}</p>
      <h1>{sectionName}<br /><em>will find its shape here.</em></h1>
      <p className="welcome-copy">
        This desk is part of the workspace foundation. Its editing tools will be built in a later stage.
      </p>
      <div className="placeholder-note">
        <span className="placeholder-leaf"><Icon name="sprig" size={22} /></span>
        <div>
          <strong>A thoughtful beginning</strong>
          <p>Your existing public writing is available in Overview and Publications. Tools for this section will be added separately.</p>
        </div>
      </div>
      <button className="button button-secondary" onClick={onCreate} type="button">
        <Icon name="plus" size={16} /> Explore a local action
      </button>
    </section>
  );
}

function NewEntryDialog({ onClose, onSelect }) {
  const [step, setStep] = useState(1);
  const [category, setCategory] = useState("");
  const [otherCategory, setOtherCategory] = useState("");
  const categories = [
    ["Essay", "A personal essay, article, or review", "writing"],
    ["Research project", "A question, study, or investigation", "research"],
    ["Field note", "An observation gathered along the way", "notes"],
    ["Other", "Another kind of work for the collection", "index"]
  ];
  const categoryLabel = category === "Other" ? otherCategory.trim() : category;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section aria-labelledby="new-entry-title" aria-modal="true" className="dialog-card new-entry-wizard" role="dialog">
        <button aria-label="Close dialog" className="icon-button dialog-close" onClick={onClose} type="button">
          <Icon name="close" size={18} />
        </button>
        <div className="wizard-progress">
          <span className={step === 1 ? "is-current" : "is-complete"}>01 <small>Category</small></span>
          <span className="wizard-progress-line" />
          <span className={step === 2 ? "is-current" : ""}>02 <small>How to create</small></span>
        </div>
        {step === 1 ? (
          <>
            <p className="eyebrow">A new beginning</p>
            <h2 id="new-entry-title">What kind of work is this?</h2>
            <p className="dialog-intro">Choose a category first. You can decide how to add the material next.</p>
            <div className="category-options">
              {categories.map(([label, description, icon]) => (
                <button
                  aria-pressed={category === label}
                  className={category === label ? "is-selected" : ""}
                  key={label}
                  onClick={() => setCategory(label)}
                  type="button"
                >
                  <span className="dialog-option-icon"><Icon name={icon} size={18} /></span>
                  <span><strong>{label}</strong><small>{description}</small></span>
                  <span className="category-radio" />
                </button>
              ))}
            </div>
            {category === "Other" && (
              <label className="other-category-field">
                <span>Name this category</span>
                <input
                  autoFocus
                  onChange={(event) => setOtherCategory(event.target.value)}
                  placeholder="e.g. Book review"
                  value={otherCategory}
                />
              </label>
            )}
            <div className="wizard-actions">
              <button className="button button-secondary" onClick={onClose} type="button">Cancel</button>
              <button
                className="button button-primary"
                disabled={!category || (category === "Other" && !categoryLabel)}
                onClick={() => setStep(2)}
                type="button"
              >
                Continue <Icon name="arrow" size={15} />
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">CATEGORY <span className="eyebrow-divider">/</span> {categoryLabel.toUpperCase()}</p>
            <h2 id="new-entry-title">How would you like to begin?</h2>
            <p className="dialog-intro">You can write in the workspace or keep an existing PDF with the draft.</p>
            <div className="create-methods">
              <button onClick={() => onSelect({ category, categoryLabel, mode: "write" })} type="button">
                <span className="dialog-option-icon"><Icon name="writing" size={18} /></span>
                <span><strong>Write in the workspace</strong><small>Add a title, description, tags, and your writing.</small></span>
                <Icon className="dialog-option-arrow" name="chevron" size={15} />
              </button>
              <button onClick={() => onSelect({ category, categoryLabel, mode: "upload" })} type="button">
                <span className="dialog-option-icon"><Icon name="media" size={18} /></span>
                <span><strong>Upload a PDF</strong><small>Keep the original document with its archive details.</small></span>
                <Icon className="dialog-option-arrow" name="chevron" size={15} />
              </button>
            </div>
            <div className="wizard-actions">
              <button className="button button-secondary" onClick={() => setStep(1)} type="button">
                <Icon name="back" size={15} /> Back
              </button>
              <button className="button button-secondary" onClick={onClose} type="button">Cancel</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function App() {
  const [activeSection, setActiveSection] = useState("overview");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState(null);
  const [editorDraft, setEditorDraft] = useState(null);
  const [savedDrafts, setSavedDrafts] = useState([]);
  const [savedPublications, setSavedPublications] = useState([]);
  const [savedResearch, setSavedResearch] = useState([]);
  const [savedProfile, setSavedProfile] = useState([]);
  const [requestedPublicationId, setRequestedPublicationId] = useState(null);
  const [taxonomy, setTaxonomy] = useState(() => (
    Array.isArray(window.NaturalInquiryIndexTaxonomy)
      ? window.NaturalInquiryIndexTaxonomy
      : []
  ));
  const [taxonomyLoadError, setTaxonomyLoadError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [toast, setToast] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [publicationEditorLabel, setPublicationEditorLabel] = useState("");
  const searchRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    let active = true;
    fetch("/__admin-api/taxonomy")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The public Subject Index could not be loaded.");
        if (!Array.isArray(result.categories)) throw new Error("The local Subject Index response is invalid.");
        if (active) {
          setTaxonomy(result.categories);
          setTaxonomyLoadError("");
        }
      })
      .catch((error) => {
        if (active) setTaxonomyLoadError(`The local Subject Index could not be loaded. ${error.message}`);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const initializedProfile = seedProfileIfNeeded(getProfileSeeds())
      .then(() => listProfileEntries());
    Promise.all([
      listDrafts(),
      seedPublicationsIfNeeded(getExistingPublications()).then(() => listPublications()),
      initializedProfile,
      initializedProfile.then(() => seedResearchIfNeeded(getResearchSeeds())).then(() => listResearch())
    ])
      .then(([drafts, publications, profile, research]) => {
        if (active) {
          setSavedDrafts(drafts);
          setSavedPublications(publications);
          setSavedProfile(profile);
          setSavedResearch(research);
        }
      })
      .catch((error) => {
        if (active) setStorageError(`Local draft storage is unavailable. ${error.message}`);
      });
    return () => {
      active = false;
    };
  }, [activeSection]);

  useEffect(() => {
    function handleWorkspaceShortcuts(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleWorkspaceShortcuts);
    return () => window.removeEventListener("keydown", handleWorkspaceShortcuts);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  function showToast(message) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }

  function startEntry({ category, categoryLabel, mode }) {
    setDialog(null);
    setActiveSection("overview");
    setEditorDraft({
      category,
      categoryLabel,
      mode,
      title: "",
      subtitle: "",
      tags: "",
      body: "",
      file: null,
      fileName: "",
      fileType: "",
      fileSize: 0,
      updatedAt: null
    });
  }

  async function handleSaveDraft(draft) {
    await saveDraft(draft);
    setSavedDrafts((current) => [
      draft,
      ...current.filter((saved) => saved.id !== draft.id)
    ]);
    setStorageError("");
    showToast("Draft saved in this browser.");
    return draft;
  }

  async function handleSaveResearch(entry) {
    await saveResearchEntry(entry);
    setSavedResearch((current) => [entry, ...current.filter((saved) => saved.id !== entry.id)]);
    setStorageError("");
    showToast("Research draft saved in this browser.");
    return entry;
  }

  async function handleSaveProfile(entry) {
    await saveProfileEntry(entry);
    setSavedProfile((current) => current.map((saved) => saved.id === entry.id ? entry : saved));
    setStorageError("");
    showToast("Profile draft saved in this browser.");
    return entry;
  }

  async function handleSaveTaxonomy(categories) {
    const response = await fetch("/__admin-api/taxonomy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The public Subject Index could not be updated.");
    if (!Array.isArray(result.categories)) throw new Error("The local Subject Index response is invalid.");
    setTaxonomy(result.categories);
    setTaxonomyLoadError("");
    setStorageError("");
    const normalizeFilings = (filings = []) => filings
      .map((filing) => {
        const category = result.categories.find((item) => item.id === filing.id);
        if (!category) return null;
        return {
          ...filing,
          subjects: (filing.subjects || []).filter((subject) => category.subjects.includes(subject))
        };
      })
      .filter(Boolean);
    const reconciledDrafts = savedDrafts.map((draft) => {
      if (!Array.isArray(draft.indexCategories)) return draft;
      const indexCategories = normalizeFilings(draft.indexCategories);
      return JSON.stringify(indexCategories) === JSON.stringify(draft.indexCategories)
        ? draft
        : { ...draft, indexCategories };
    });
    const updatedDrafts = reconciledDrafts.filter((draft, index) => draft !== savedDrafts[index]);
    const reconciledPublications = savedPublications.map((publication) => {
      if (!Array.isArray(publication.indexCategories)) return publication;
      const indexCategories = normalizeFilings(publication.indexCategories);
      return JSON.stringify(indexCategories) === JSON.stringify(publication.indexCategories)
        ? publication
        : { ...publication, indexCategories };
    });
    const updatedPublications = reconciledPublications.filter((publication, index) => publication !== savedPublications[index]);
    try {
      await Promise.all([
        ...updatedDrafts.map((draft) => saveDraft(draft)),
        ...updatedPublications.map((publication) => savePublication(publication))
      ]);
      if (updatedDrafts.length) setSavedDrafts(reconciledDrafts);
      if (updatedPublications.length) setSavedPublications(reconciledPublications);
    } catch (draftError) {
      throw new Error(`The Index was saved to local project files, but some saved publication or draft tags could not be reconciled. ${draftError.message}`);
    }
    showToast(result.changed ? "Local Subject Index updated. Nothing was deployed." : "The Subject Index is already up to date.");
    return result.categories;
  }

  async function handleDeleteResearch(id) {
    await deleteResearchEntry(id);
    setSavedResearch((current) => current.filter((entry) => entry.id !== id));
    showToast("Research copy removed from this browser.");
  }

  async function handleOpenEntry(entry) {
    if (entry?.openLibrary) {
      setActiveSection("publications");
      return;
    }
    if (entry?.isPublication) {
      setRequestedPublicationId(entry.id);
      setActiveSection("publications");
      return;
    }
    try {
      const draft = await getDraft(entry.id);
      if (!draft) {
        throw new Error("This draft is no longer available in this browser.");
      }
      setEditorDraft(draft);
    } catch (error) {
      showToast(error.message || "The local draft could not be opened.");
    }
  }

  async function handleDeleteDraft(id) {
    try {
      await deleteDraft(id);
      setSavedDrafts((current) => current.filter((draft) => draft.id !== id));
      setEditorDraft(null);
      showToast("Local draft deleted.");
    } catch (error) {
      showToast(error.message || "The local draft could not be deleted.");
    }
  }

  async function sendPublicationRequest(endpoint, draft) {
    const { file, ...draftData } = draft;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftData)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The local publishing server rejected the request.");
    return result;
  }

  async function handlePublicationReview(draft) {
    return sendPublicationRequest("/__admin-api/publication-preview", draft);
  }

  async function handlePublish(draft) {
    const result = await sendPublicationRequest("/__admin-api/publish", draft);
    try {
      await deleteDraft(draft.id);
      setSavedDrafts((current) => current.filter((saved) => saved.id !== draft.id));
    } catch (error) {
      setStorageError(`Published to the local site, but the browser draft could not be removed. ${error.message}`);
    }
    showToast(`Published to the local site at ${result.url}. Nothing was deployed.`);
    return result;
  }

  const activeSectionLabel = navigation.flatMap((group) => group.items)
    .find((item) => item.id === activeSection)?.label;

  return (
    <div className="admin-app">
      <Sidebar
        activeSection={activeSection}
        isOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        onNavigate={setActiveSection}
      />

      <div className="workspace-shell">
        <header className="topbar">
          <button
            aria-label="Open navigation"
            className="icon-button mobile-menu-button"
            onClick={() => setMobileNavOpen(true)}
            type="button"
          >
            <span className="menu-lines" />
          </button>
          <div className="breadcrumbs">
            <span>The Natural Inquiry</span>
            <Icon name="chevron" size={14} />
            <strong>{editorDraft
              ? (editorDraft.id ? "Edit local draft" : "New entry")
              : activeSection === "publications" && publicationEditorLabel
                ? publicationEditorLabel
                : activeSectionLabel}</strong>
          </div>
          <div className="topbar-tools">
            <label className="global-search">
              <Icon name="search" size={16} />
              <input
                aria-label="Search this workspace"
                ref={searchRef}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setActiveSection("overview");
                }}
                placeholder="Search your workspace"
                type="search"
                value={search}
              />
              <kbd>⌘ K</kbd>
            </label>
            <div className="notification-wrap">
              <button
                aria-expanded={notificationsOpen}
                aria-label="Notifications"
                className="icon-button notification-button"
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                type="button"
              >
                <Icon name="bell" size={18} />
                <span className="notification-dot" />
              </button>
              {notificationsOpen && (
                <div className="notification-popover">
                  <div className="popover-heading"><strong>A small note</strong><span>Just now</span></div>
                  <p>Your workspace preview is ready to explore.</p>
                  <button onClick={() => setNotificationsOpen(false)} type="button">Lovely, thanks</button>
                </div>
              )}
            </div>
            <span aria-hidden="true" className="topbar-avatar">CE</span>
          </div>
        </header>

        <main className="main-content">
          <div hidden={activeSection !== "publications"}>
            <PublicationsWorkspace
              onEditorStateChange={setPublicationEditorLabel}
              onPublicationRequestHandled={() => setRequestedPublicationId(null)}
              requestedPublicationId={requestedPublicationId}
              taxonomy={taxonomy}
            />
          </div>
          {editorDraft ? (
            <EntryEditor
              initialDraft={editorDraft}
              taxonomy={taxonomy}
              onClose={() => setEditorDraft(null)}
              onDelete={handleDeleteDraft}
              onPublish={handlePublish}
              onReview={handlePublicationReview}
              onSave={handleSaveDraft}
            />
          ) : activeSection === "overview" ? (
            <Overview
              drafts={savedDrafts}
              publications={savedPublications}
              onCreate={() => setDialog({ type: "new" })}
              onOpenEntry={handleOpenEntry}
              search={search}
              storageError={storageError}
            />
          ) : activeSection === "publications" ? null : activeSection === "research" ? (
            <ResearchWorkspace
              initialEntries={savedResearch}
              onDelete={handleDeleteResearch}
              onSave={handleSaveResearch}
            />
          ) : activeSection === "profile" ? (
            <ProfileWorkspace
              initialEntries={savedProfile}
              onSave={handleSaveProfile}
            />
          ) : activeSection === "subject-index" ? (
            <SubjectIndexWorkspace
              initialCategories={taxonomy}
              loadError={taxonomyLoadError}
              onSave={handleSaveTaxonomy}
            />
          ) : (
            <SectionPlaceholder
              onCreate={() => setDialog({ type: "new" })}
              section={activeSection}
            />
          )}
          <footer className="workspace-footer">
            <span>Made for curiosity, saved in this browser.</span>
            <span>The Natural Inquiry <span className="footer-separator">·</span> Workspace preview</span>
          </footer>
        </main>
      </div>

      {dialog?.type === "new" && (
        <NewEntryDialog onClose={() => setDialog(null)} onSelect={startEntry} />
      )}
      {toast && <div className="toast-message" role="status"><Icon name="check" size={16} />{toast}</div>}
    </div>
  );
}
