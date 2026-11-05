import { useEffect, useMemo, useRef, useState } from "react";
import { deletePublication, listPublications, savePublication, seedPublicationsIfNeeded } from "./draft-storage.js";
import { getExistingPublications } from "./publication-seeds.js";

const FILTERS = ["All", "Published", "Drafts", "Archived"];
const CATEGORIES = ["Essay", "Research project", "Field note", "Other"];
const ALLOWED_TAGS = new Set([
  "p", "h2", "h3", "strong", "b", "em", "i", "blockquote", "a", "ul", "ol",
  "li", "br", "figure", "img", "figcaption"
]);
const BLOCKED_TAGS = new Set(["script", "style", "iframe", "object", "embed", "form"]);

function createPublication() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    subtitle: "",
    category: "Essay",
    status: "Draft",
    archived: false,
    publishedAt: "",
    indexCategories: [],
    references: [],
    bodyHtml: "<p><br></p>",
    createdAt: now,
    updatedAt: now
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isSafeLink(value) {
  return /^(https?:|mailto:|\/(?!\/)|#)/i.test(value || "");
}

function sanitizeHtml(value) {
  const document = new DOMParser().parseFromString(value || "", "text/html");
  const clean = (parent) => {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = node.tagName.toLowerCase();
      if (BLOCKED_TAGS.has(tag)) {
        node.remove();
        continue;
      }
      clean(node);
      if (!ALLOWED_TAGS.has(tag)) {
        node.replaceWith(...node.childNodes);
        continue;
      }
      for (const attribute of [...node.attributes]) {
        const name = attribute.name.toLowerCase();
        const allowed = (tag === "a" && name === "href")
          || (tag === "img" && ["src", "alt", "width", "height"].includes(name));
        if (!allowed) node.removeAttribute(attribute.name);
      }
      if (tag === "a" && !isSafeLink(node.getAttribute("href"))) node.removeAttribute("href");
      if (tag === "img" && !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(node.getAttribute("src") || "")) {
        node.remove();
      }
    }
  };
  clean(document.body);
  return document.body.innerHTML;
}

function hasPublicationContent(publication) {
  const body = sanitizeHtml(publication.bodyHtml || "");
  const text = body.replace(/<[^>]*>/g, "").trim();
  return Boolean(
    publication.title.trim()
    || publication.subtitle.trim()
    || text
    || /<img\b/i.test(body)
    || publication.publishedAt
    || publication.references.length
    || publication.indexCategories.length
  );
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Not set"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function Icon({ name, size = 16 }) {
  const paths = {
    arrow: "M5 12h14M13 6l6 6-6 6",
    back: "M19 12H5m7 7-7-7 7-7",
    bold: "M7 5h6a3 3 0 0 1 0 6H7zm0 6h7a4 4 0 0 1 0 8H7z",
    check: "m5 12 4 4L19 6",
    close: "M6 6l12 12M18 6 6 18",
    copy: "M8 8V4h12v12h-4M4 8h12v12H4z",
    image: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 15l4-4 4 4 3-3 5 5M15.5 8h.01",
    italic: "M14 4h6M4 20h6M15 4 9 20",
    link: "M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1m3.1 6a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1",
    list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
    quote: "M10 11H5V6h5v5Zm9 0h-5V6h5v5ZM5 11c0 4 1 6 4 7m5-7c0 4 1 6 4 7",
    preview: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    save: "M5 4h12l3 3v13H4V4h1Zm2 0v6h9V4M8 20v-6h8v6",
    trash: "M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5",
    archive: "M4 5h16v4H4zM6 9v11h12V9m-8 4h4",
    restore: "M4 7v5h5M5 12a7 7 0 1 0 2-5",
    h2: "M4 5v14M14 5v14M4 12h10M20 19h-5l5-6a2.5 2.5 0 1 0-4-2",
    search: "m20 20-4.2-4.2M17 9.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z"
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] || paths.arrow} />
    </svg>
  );
}

function StatusMark({ status, archived }) {
  const label = archived ? "Archived" : status;
  return <span className={`publication-status status-${label.toLowerCase()}`}><i />{label}</span>;
}

function PublicationPreview({ publication }) {
  const paragraphs = publication.bodyHtml ? sanitizeHtml(publication.bodyHtml) : "";
  return (
    <article className="publication-preview">
      <p className="eyebrow">{publication.category} <span className="eyebrow-divider">/</span> THE NATURAL INQUIRY</p>
      <h1>{publication.title || "Untitled publication"}</h1>
      {publication.subtitle && <p className="publication-preview-deck">{publication.subtitle}</p>}
      <div className="publication-preview-meta">
        <span>Chloe Elia</span>
        {publication.publishedAt && <span>{formatDate(publication.publishedAt)}</span>}
        <span>{publication.category}</span>
      </div>
      {paragraphs && <div className="publication-preview-content" dangerouslySetInnerHTML={{ __html: paragraphs }} />}
      {publication.sourceDocumentName && (
        <aside className="publication-source-note">
          <strong>Original work on the public site</strong>
          <span>{publication.sourcePage}</span>
          <small>Provided document: {publication.sourceDocumentName}</small>
        </aside>
      )}
      {publication.references.length > 0 && (
        <section className="publication-preview-references">
          <h2>References</h2>
          <ol>{publication.references.map((reference) => (
            <li key={reference.id}>
              {reference.url && isSafeLink(reference.url)
                ? <a href={reference.url} rel="noreferrer" target="_blank">{reference.title}</a>
                : reference.title}
            </li>
          ))}</ol>
        </section>
      )}
    </article>
  );
}

function ImageDialog({ onClose, onInsert }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit(event) {
    event.preventDefault();
    if (!file || !alt.trim()) {
      setError("Choose an image and add a short image description.");
      return;
    }
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      setError("Choose a PNG, JPEG, GIF, or WebP image.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Choose an image smaller than 4 MB.");
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("The image could not be read."));
      reader.readAsDataURL(file);
    }).catch((readError) => {
      setError(readError.message);
      return "";
    });
    if (!dataUrl) return;
    onInsert(dataUrl, alt.trim(), caption.trim());
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form aria-labelledby="publication-image-title" aria-modal="true" className="dialog-card publication-image-dialog"
        onSubmit={submit} role="dialog">
        <button aria-label="Close image dialog" className="icon-button dialog-close" onClick={onClose} type="button">
          <Icon name="close" />
        </button>
        <p className="eyebrow">IN THE MANUSCRIPT</p>
        <h2 id="publication-image-title">Place an image</h2>
        <label className="publication-form-field">
          <span>Image file</span>
          <input accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} type="file" />
        </label>
        {previewUrl && <img alt="" className="publication-image-dialog-preview" src={previewUrl} />}
        <label className="publication-form-field">
          <span>Image description <b>Required for accessibility</b></span>
          <input onChange={(event) => setAlt(event.target.value)} placeholder="Describe what the image shows" value={alt} />
        </label>
        <label className="publication-form-field">
          <span>Caption <small>Optional</small></span>
          <input onChange={(event) => setCaption(event.target.value)} placeholder="Add context or credit" value={caption} />
        </label>
        {error && <p className="editor-error" role="alert">{error}</p>}
        <div className="wizard-actions">
          <button className="button button-secondary" onClick={onClose} type="button">Cancel</button>
          <button className="button button-primary" type="submit"><Icon name="image" /> Insert image</button>
        </div>
      </form>
    </div>
  );
}

function LinkDialog({ onClose, onInsert }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  function submit(event) {
    event.preventDefault();
    if (!isSafeLink(url.trim())) {
      setError("Enter a web address beginning with https:// or http://.");
      return;
    }
    onInsert(url.trim());
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form aria-labelledby="publication-link-title" aria-modal="true" className="dialog-card publication-image-dialog"
        onSubmit={submit} role="dialog">
        <button aria-label="Close link dialog" className="icon-button dialog-close" onClick={onClose} type="button">
          <Icon name="close" />
        </button>
        <p className="eyebrow">IN THE MANUSCRIPT</p>
        <h2 id="publication-link-title">Add a link</h2>
        <label className="publication-form-field">
          <span>Web address</span>
          <input autoFocus onChange={(event) => setUrl(event.target.value)} placeholder="https://example.org" value={url} />
        </label>
        {error && <p className="editor-error" role="alert">{error}</p>}
        <div className="wizard-actions">
          <button className="button button-secondary" onClick={onClose} type="button">Cancel</button>
          <button className="button button-primary" type="submit"><Icon name="link" /> Add link</button>
        </div>
      </form>
    </div>
  );
}

export default function PublicationsWorkspace({
  taxonomy,
  onEditorStateChange,
  requestedPublicationId,
  onPublicationRequestHandled
}) {
  const [publications, setPublications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(null);
  const [editorView, setEditorView] = useState("edit");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState("saved");
  const [error, setError] = useState("");
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [referenceTitle, setReferenceTitle] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const editorRef = useRef(null);
  const savedSelection = useRef(null);
  const autoSaveTimer = useRef(null);
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    let active = true;
    seedPublicationsIfNeeded(getExistingPublications())
      .then(() => listPublications())
      .then((items) => {
        if (active) {
          setPublications(items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")));
          setLoading(false);
        }
      })
      .catch((storageError) => {
        if (active) {
          setLoadError(`The publication library could not be opened. ${storageError.message}`);
          setLoading(false);
        }
      });
    return () => {
      active = false;
      if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (loading || !requestedPublicationId) return;
    const publication = publications.find((item) => item.id === requestedPublicationId);
    if (publication) openPublication(publication);
    onPublicationRequestHandled?.();
  }, [loading, onPublicationRequestHandled, publications, requestedPublicationId]);

  useEffect(() => {
    onEditorStateChange?.(current ? (editorView === "preview" ? "Publication preview" : "Publication editor") : "");
  }, [current, editorView, onEditorStateChange]);

  useEffect(() => {
    if (!current || !dirty) return undefined;
    if (!hasPublicationContent(current)) {
      setSaveState("saved");
      return undefined;
    }
    setSaveState("saving");
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(async () => {
      try {
        const saved = { ...current, bodyHtml: sanitizeHtml(current.bodyHtml), updatedAt: new Date().toISOString() };
        await savePublication(saved);
        setPublications((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
          if (currentRef.current === current) {
            setCurrent(saved);
            setDirty(false);
            setSaveState("saved");
            setError("");
          }
      } catch (saveError) {
        setSaveState("error");
        setError(`Autosave could not finish. ${saveError.message}`);
      }
    }, 650);
    return () => window.clearTimeout(autoSaveTimer.current);
  }, [current, dirty]);

  useEffect(() => {
    if (!current || editorView !== "edit" || !editorRef.current) return;
    editorRef.current.innerHTML = sanitizeHtml(current.bodyHtml) || "<p><br></p>";
  }, [current?.id, editorView]);

  useEffect(() => {
    let active = true;
    const normalizeFilings = (filings = []) => filings
      .map((filing) => {
        const category = taxonomy.find((item) => item.id === filing.id);
        if (!category) return null;
        return {
          ...filing,
          subjects: (filing.subjects || []).filter((subject) => category.subjects.includes(subject))
        };
      })
      .filter(Boolean);

    const normalizedPublications = publications.map((publication) => {
      const indexCategories = normalizeFilings(publication.indexCategories || []);
      return JSON.stringify(indexCategories) === JSON.stringify(publication.indexCategories || [])
        ? publication
        : { ...publication, indexCategories };
    });
    const changedPublications = normalizedPublications.filter((publication, index) => publication !== publications[index]);
    if (!changedPublications.length) return undefined;

    Promise.all(changedPublications.map((publication) => savePublication(publication)))
      .then(() => {
        if (!active) return;
        setPublications(normalizedPublications);
        if (current) {
          const indexCategories = normalizeFilings(current.indexCategories || []);
          if (JSON.stringify(indexCategories) !== JSON.stringify(current.indexCategories || [])) {
            setCurrent({ ...current, indexCategories });
            setDirty(true);
          }
        }
      })
      .catch((saveError) => {
        if (active) setLoadError(`Index filing changes could not be saved to local publications. ${saveError.message}`);
      });

    return () => {
      active = false;
    };
  }, [current, publications, taxonomy]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return publications.filter((item) => {
      const matchesFilter = filter === "All"
        || (filter === "Archived" ? item.archived : !item.archived && item.status === ({ Published: "Published", Drafts: "Draft" })[filter]);
      const terms = `${item.title} ${item.subtitle} ${item.category} ${item.sourceDocumentName || ""} ${(item.indexCategories || []).flatMap((category) => category.subjects || []).join(" ")}`.toLowerCase();
      return matchesFilter && (!text || terms.includes(text));
    }).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }, [filter, publications, query]);

  function update(patch) {
    setCurrent((item) => ({ ...item, ...patch }));
    setDirty(true);
    setError("");
  }

  function startNew() {
    const publication = createPublication();
    setCurrent(publication);
    setEditorView("edit");
    setDirty(true);
    setSaveState("saving");
    setError("");
  }

  function openPublication(publication, view = "edit") {
    setCurrent({ ...publication, references: publication.references || [], indexCategories: publication.indexCategories || [] });
    setEditorView(view);
    setDirty(false);
    setSaveState("saved");
    setError("");
  }

  async function saveNow() {
    if (!current) return;
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    if (!hasPublicationContent(current)) {
      setError("Add a title, description, writing, or another publication detail before saving.");
      return null;
    }
    setSaveState("saving");
    try {
      const saved = { ...current, bodyHtml: sanitizeHtml(current.bodyHtml), updatedAt: new Date().toISOString() };
      await savePublication(saved);
      setPublications((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setCurrent(saved);
      setDirty(false);
      setSaveState("saved");
      setError("");
      return saved;
    } catch (saveError) {
      setSaveState("error");
      setError(`This publication could not be saved. ${saveError.message}`);
      return null;
    }
  }

  async function closeEditor() {
    if (dirty) {
      if (!hasPublicationContent(current)) {
        setCurrent(null);
        setDirty(false);
        return;
      }
      const saved = await saveNow();
      if (!saved) return;
    }
    setCurrent(null);
    setError("");
  }

  async function duplicate(publication) {
    const copy = {
      ...publication,
      id: crypto.randomUUID(),
      title: publication.title ? `${publication.title} — copy` : "Untitled copy",
      status: "Draft",
      archived: false,
      publishedAt: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    try {
      await savePublication(copy);
      setPublications((items) => [copy, ...items]);
      openPublication(copy);
    } catch (saveError) {
      setLoadError(`The publication could not be duplicated. ${saveError.message}`);
    }
  }

  async function toggleArchive(publication) {
    const updated = { ...publication, archived: !publication.archived, updatedAt: new Date().toISOString() };
    try {
      await savePublication(updated);
      setPublications((items) => [updated, ...items.filter((item) => item.id !== updated.id)]);
    } catch (saveError) {
      setLoadError(`The publication could not be updated. ${saveError.message}`);
    }
  }

  async function removePublication(publication) {
    if (!window.confirm(`Delete “${publication.title || "Untitled publication"}” from this browser? This cannot be undone.`)) return;
    try {
      await deletePublication(publication.id);
      setPublications((items) => items.filter((item) => item.id !== publication.id));
    } catch (deleteError) {
      setLoadError(`The publication could not be deleted. ${deleteError.message}`);
    }
  }

  function updateIndexCategory(categoryId) {
    const existing = current.indexCategories || [];
    const found = existing.some((item) => item.id === categoryId);
    update({
      indexCategories: found
        ? existing.filter((item) => item.id !== categoryId)
        : [...existing, { id: categoryId, subjects: [] }]
    });
  }

  function updateIndexSubject(categoryId, subject) {
    update({
      indexCategories: (current.indexCategories || []).map((item) => {
        if (item.id !== categoryId) return item;
        const hasSubject = item.subjects.includes(subject);
        return { ...item, subjects: hasSubject ? item.subjects.filter((entry) => entry !== subject) : [...item.subjects, subject] };
      })
    });
  }

  function rememberSelection() {
    const selection = window.getSelection();
    if (selection?.rangeCount) savedSelection.current = selection.getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    if (!editorRef.current) return;
    editorRef.current.focus();
    const selection = window.getSelection();
    if (savedSelection.current && editorRef.current.contains(savedSelection.current.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(savedSelection.current);
    } else {
      const range = document.createRange();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    savedSelection.current = null;
  }

  function syncEditor() {
    if (editorRef.current) update({ bodyHtml: sanitizeHtml(editorRef.current.innerHTML) });
  }

  function format(command, value = null) {
    restoreSelection();
    document.execCommand(command, false, value);
    syncEditor();
  }

  function addLink(url) {
    restoreSelection();
    document.execCommand("createLink", false, url);
    syncEditor();
    setLinkDialogOpen(false);
  }

  function addImage(src, alt, caption) {
    restoreSelection();
    const figure = `<figure><img src="${src}" alt="${escapeHtml(alt)}">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure><p><br></p>`;
    document.execCommand("insertHTML", false, figure);
    syncEditor();
    setImageDialogOpen(false);
  }

  async function addReference(event) {
    event.preventDefault();
    if (!referenceTitle.trim()) return;
    if (referenceUrl && !isSafeLink(referenceUrl.trim())) {
      setError("Reference links must use http://, https://, or mailto:.");
      return;
    }
    update({
      references: [...(current.references || []), {
        id: crypto.randomUUID(),
        title: referenceTitle.trim(),
        url: referenceUrl.trim()
      }]
    });
    setReferenceTitle("");
    setReferenceUrl("");
  }

  if (current) {
    const previewing = editorView === "preview";
    return (
      <section aria-label={previewing ? "Publication preview" : "Publication editor"} className="publications-workspace publication-editor-view">
        <div className="publication-editor-top">
          <button className="text-link" onClick={closeEditor} type="button"><Icon name="back" /> Back to publications</button>
          <div className="publication-save-indicator" role="status">
            <span className={`save-indicator-dot ${saveState}`} />
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved in this browser"}
          </div>
        </div>
        <div className="publication-editor-heading">
          <div>
            <p className="eyebrow">THE NATURAL INQUIRY <span className="eyebrow-divider">/</span> PUBLICATIONS</p>
            <h1>{current.title || "A new publication"}<br /><em>{previewing ? "preview" : "in progress."}</em></h1>
          </div>
          <div className="publication-editor-actions">
            <button className={`button ${previewing ? "button-secondary" : "button-secondary"}`} onClick={() => setEditorView(previewing ? "edit" : "preview")} type="button">
              <Icon name={previewing ? "back" : "preview"} /> {previewing ? "Return to editing" : "Preview"}
            </button>
            {!previewing && <button className="button button-primary" onClick={saveNow} type="button"><Icon name="save" /> {current.status === "Draft" ? "Save draft" : "Save changes"}</button>}
          </div>
        </div>
        <p className="publication-local-note"><Icon name="check" size={14} /> Your work is saved only in this browser. Publication status here does not update the public website.</p>
        {error && <p className="storage-warning" role="alert">{error}</p>}

        {previewing ? (
          <div className="publication-preview-shell">
            <PublicationPreview publication={current} />
            <div className="publication-preview-footer">
              <button className="button button-secondary" onClick={() => setEditorView("edit")} type="button"><Icon name="back" /> Return to editing</button>
            </div>
          </div>
        ) : (
          <div className="publication-composer-grid">
            <div className="publication-manuscript-column">
              <section className="publication-manuscript">
                <input aria-label="Publication title" className="publication-title-input"
                  onChange={(event) => update({ title: event.target.value })}
                  placeholder="The title of your work" value={current.title} />
                <textarea aria-label="Publication subtitle" className="publication-subtitle-input"
                  onChange={(event) => update({ subtitle: event.target.value })}
                  placeholder="A short, inviting description for your readers" rows={2} value={current.subtitle} />
                <div aria-label="Writing format" className="publication-toolbar" role="toolbar">
                  <button aria-label="Heading 2" title="Heading" onMouseDown={(event) => event.preventDefault()} onClick={() => format("formatBlock", "h2")} type="button"><Icon name="h2" /></button>
                  <button aria-label="Heading 3" title="Subheading" onMouseDown={(event) => event.preventDefault()} onClick={() => format("formatBlock", "h3")} type="button"><span className="toolbar-subheading">H3</span></button>
                  <span className="toolbar-divider" />
                  <button aria-label="Bold" title="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => format("bold")} type="button"><Icon name="bold" /></button>
                  <button aria-label="Italic" title="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => format("italic")} type="button"><Icon name="italic" /></button>
                  <button aria-label="Block quotation" title="Block quotation" onMouseDown={(event) => event.preventDefault()} onClick={() => format("formatBlock", "blockquote")} type="button"><Icon name="quote" /></button>
                  <span className="toolbar-divider" />
                  <button aria-label="Bulleted list" title="Bulleted list" onMouseDown={(event) => event.preventDefault()} onClick={() => format("insertUnorderedList")} type="button"><Icon name="list" /></button>
                  <button aria-label="Numbered list" title="Numbered list" onMouseDown={(event) => event.preventDefault()} onClick={() => format("insertOrderedList")} type="button"><span className="toolbar-numbered">1.</span></button>
                  <button aria-label="Add hyperlink" title="Add hyperlink" onMouseDown={(event) => { event.preventDefault(); rememberSelection(); }} onClick={() => setLinkDialogOpen(true)} type="button"><Icon name="link" /></button>
                  <button aria-label="Insert image" title="Insert image" onMouseDown={(event) => { event.preventDefault(); rememberSelection(); }} onClick={() => setImageDialogOpen(true)} type="button"><Icon name="image" /></button>
                </div>
                <div className="publication-writing-surface">
                  <div
                    aria-label="Publication manuscript"
                    className="publication-writing-area"
                    contentEditable
                    onInput={syncEditor}
                    ref={editorRef}
                    role="textbox"
                    suppressContentEditableWarning
                    tabIndex={0}
                  />
                </div>
                <p className="publication-word-note">A quiet space for the whole piece, from first observation to final thought.</p>
              </section>
            </div>

            <aside className="publication-settings">
              <section className="publication-settings-card">
                <p className="eyebrow">PUBLICATION DETAILS</p>
                {current.sourceDocumentName && (
                  <div className="publication-source-setting">
                    <strong>Existing public work</strong>
                    <span>{current.sourcePage}</span>
                    <small>Provided paper: {current.sourceDocumentName}</small>
                  </div>
                )}
                <label className="publication-form-field">
                  <span>Category</span>
                  <select onChange={(event) => update({ category: event.target.value })} value={current.category}>
                    {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </label>
                <label className="publication-form-field">
                  <span>Publication date</span>
                  <input onChange={(event) => update({ publishedAt: event.target.value })} type="date" value={current.publishedAt || ""} />
                </label>
                <label className="publication-form-field">
                  <span>Status</span>
                  <select onChange={(event) => update({ status: event.target.value, archived: false })} value={current.status}>
                    <option>Draft</option><option>Published</option>
                  </select>
                </label>
                {current.status === "Published" && <p className="publication-status-note">This is a local workspace label only; it does not publish to the public site.</p>}
              </section>

              <section className="publication-settings-card">
                <p className="eyebrow">SUBJECT INDEX</p>
                <p className="publication-settings-intro">File this work under subjects from the public Index.</p>
                {taxonomy.map((category) => {
                  const selected = (current.indexCategories || []).find((item) => item.id === category.id);
                  return (
                    <details className="publication-taxonomy-group" key={category.id}>
                      <summary>
                        <input aria-label={`Add ${category.title} discipline`} checked={Boolean(selected)}
                          onChange={() => updateIndexCategory(category.id)} onClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()} type="checkbox" />
                        <span>{category.title}</span><small>{category.subjects.length}</small>
                      </summary>
                      {selected && <div className="publication-subject-options">
                        {category.subjects.map((subject) => (
                          <label key={subject}><input checked={selected.subjects.includes(subject)}
                            onChange={() => updateIndexSubject(category.id, subject)} type="checkbox" />{subject}</label>
                        ))}
                      </div>}
                    </details>
                  );
                })}
              </section>

              <section className="publication-settings-card">
                <p className="eyebrow">REFERENCES & CITATIONS</p>
                <form className="publication-reference-form" onSubmit={addReference}>
                  <input aria-label="Reference citation" onChange={(event) => setReferenceTitle(event.target.value)}
                    placeholder="Citation or source title" value={referenceTitle} />
                  <input aria-label="Reference URL" onChange={(event) => setReferenceUrl(event.target.value)}
                    placeholder="https:// (optional)" value={referenceUrl} />
                  <button className="text-link" type="submit"><span>+</span> Add a reference</button>
                </form>
                {current.references.length > 0 && <ol className="publication-reference-list">
                  {current.references.map((reference) => (
                    <li key={reference.id}>
                      <span>{reference.title}</span>
                      <button aria-label={`Remove ${reference.title}`} onClick={() => update({
                        references: current.references.filter((item) => item.id !== reference.id)
                      })} type="button"><Icon name="close" size={14} /></button>
                    </li>
                  ))}
                </ol>}
              </section>
            </aside>
          </div>
        )}
        {imageDialogOpen && <ImageDialog onClose={() => setImageDialogOpen(false)} onInsert={addImage} />}
        {linkDialogOpen && <LinkDialog onClose={() => setLinkDialogOpen(false)} onInsert={addLink} />}
      </section>
    );
  }

  const visibleCounts = {
    All: publications.length,
    Published: publications.filter((item) => !item.archived && item.status === "Published").length,
    Drafts: publications.filter((item) => !item.archived && item.status === "Draft").length,
    Archived: publications.filter((item) => item.archived).length
  };

  return (
    <section aria-label="Publications library" className="publications-workspace">
      <div className="publications-library-heading">
        <div>
          <p className="eyebrow">YOUR EDITORIAL WORKSPACE <span className="eyebrow-divider">/</span> PUBLICATIONS</p>
          <h1>A library of<br /><em>work in progress.</em></h1>
          <p className="welcome-copy">A considered home for essays, research writing, and the ideas taking shape.</p>
        </div>
        <button className="button button-primary" onClick={startNew} type="button"><span className="publication-plus">+</span> New publication</button>
      </div>
      <div className="publication-library-note">
        <span className="notice-mark"><Icon name="check" size={14} /></span>
        <span>Saved in this browser only. Changing a status here does not alter the public website.</span>
      </div>
      {loadError && <p className="storage-warning" role="alert">{loadError}</p>}

      <div className="publication-library-controls">
        <div aria-label="Filter publications" className="filter-tabs publication-filter-tabs" role="group">
          {FILTERS.map((item) => (
            <button aria-pressed={filter === item} className={filter === item ? "is-selected" : ""}
              key={item} onClick={() => setFilter(item)} type="button">
              {item}<span>{visibleCounts[item]}</span>
            </button>
          ))}
        </div>
        <label className="publication-search">
          <Icon name="search" size={15} />
          <input aria-label="Search publications" onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles, subjects, writing" type="search" value={query} />
        </label>
      </div>

      {loading ? (
        <p className="publication-empty-state">Opening your publication library…</p>
      ) : filtered.length ? (
        <div className="publication-library-list">
          {filtered.map((publication) => (
            <article className="publication-library-row" key={publication.id}>
              <button className="publication-row-main" onClick={() => openPublication(publication)} type="button">
                <span className="publication-row-title">{publication.title || "Untitled publication"}</span>
                <span className="publication-row-description">{publication.subtitle || "No description yet"}</span>
                <span className="publication-row-category">{publication.category}</span>
                <StatusMark archived={publication.archived} status={publication.status} />
                <time className="publication-row-date">
                  {publication.updatedAt ? formatDate(publication.updatedAt) : publication.sourcePage ? "Existing public work" : "Not edited yet"}
                </time>
                <Icon className="publication-row-chevron" name="arrow" size={15} />
              </button>
              <div aria-label={`Actions for ${publication.title || "Untitled publication"}`} className="publication-row-actions">
                <button onClick={() => openPublication(publication, "preview")} type="button"><Icon name="preview" size={14} />Preview</button>
                <button onClick={() => openPublication(publication)} type="button"><Icon name="h2" size={14} />Edit</button>
                <button onClick={() => duplicate(publication)} type="button"><Icon name="copy" size={14} />Duplicate</button>
                <button onClick={() => toggleArchive(publication)} type="button">
                  <Icon name={publication.archived ? "restore" : "archive"} size={14} />{publication.archived ? "Restore" : "Archive"}
                </button>
                <button className="publication-delete-action" onClick={() => removePublication(publication)} type="button"><Icon name="trash" size={14} />Delete</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="publication-empty-state">
          <span className="publication-empty-mark"><Icon name="h2" size={22} /></span>
          <p className="eyebrow">{query || filter !== "All" ? "NO MATCHING WORK" : "A CLEAR PAGE"}</p>
          <h2>{query || filter !== "All" ? "Nothing found just yet." : "Your publication library is ready."}</h2>
          <p>{query || filter !== "All"
            ? "Try another title, subject, or status filter."
            : "Create a first draft, gather your references, and give the writing room to grow."}</p>
          {!query && filter === "All" && <button className="button button-primary" onClick={startNew} type="button"><span className="publication-plus">+</span> Begin a publication</button>}
        </div>
      )}
      <p className="publication-library-footnote">
        {publications.length} {publications.length === 1 ? "publication" : "publications"} in this browser library
      </p>
    </section>
  );
}
