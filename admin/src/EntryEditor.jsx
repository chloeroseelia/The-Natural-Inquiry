import { useEffect, useMemo, useState } from "react";

const CATEGORY_PATHS = {
  Essay: "writing",
  "Research project": "research",
  "Field note": "writing"
};

function createSlug(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "untitled";
}

function splitParagraphs(text) {
  return text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function makeHandoff(draft) {
  const section = CATEGORY_PATHS[draft.category] || "writing";
  return {
    schemaVersion: 1,
    status: "draft",
    category: draft.categoryLabel,
    title: draft.title,
    subtitle: draft.subtitle,
    description: draft.subtitle,
    indexCategories: (draft.indexCategories || []).map(({ id, subjects }) => ({ id, subjects })),
    contentFormat: draft.mode === "upload" ? "pdf" : "plain-text",
    content: draft.mode === "write" ? draft.body : null,
    attachment: draft.mode === "upload"
      ? { fileName: draft.fileName, contentType: draft.fileType, size: draft.fileSize }
      : null,
    intendedPublicPage: `${section}/${createSlug(draft.title)}.html`,
    archiveEntry: {
      title: draft.title,
      type: draft.categoryLabel,
      description: draft.subtitle,
      url: `${section}/${createSlug(draft.title)}.html`
    },
    updatedAt: draft.updatedAt || null,
    publishingNote: "This handoff file does not publish or deploy on its own. Use the reviewed local publishing flow to update the working copy."
  };
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function Icon({ name, size = 17 }) {
  const paths = {
    arrow: "M5 12h14M13 6l6 6-6 6",
    back: "M19 12H5m7 7-7-7 7-7",
    check: "m5 12 4 4L19 6",
    close: "M6 6l12 12M18 6 6 18",
    download: "M12 3v12m-5-5 5 5 5-5M4 20h16",
    file: "M7 3h7l5 5v13H7zM14 3v6h5M10 14h6M10 17h6",
    leaf: "M19 5c-8 0-13 3-13 9a5 5 0 0 0 5 5c6 0 8-6 8-14ZM5 21c2-5 5-8 10-11",
    preview: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    save: "M5 4h12l3 3v13H4V4h1Zm2 0v6h9V4M8 20v-6h8v6",
    upload: "M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EntryEditor({ initialDraft, taxonomy, onClose, onSave, onDelete, onReview, onPublish }) {
  const [draft, setDraft] = useState({
    ...initialDraft,
    indexCategories: initialDraft.indexCategories || []
  });
  const [dirty, setDirty] = useState(!initialDraft.id);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [fileUrl, setFileUrl] = useState("");
  const [reviewPlan, setReviewPlan] = useState(null);

  useEffect(() => {
    if (!draft.file) {
      setFileUrl("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(draft.file);
    setFileUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [draft.file]);

  const handoff = useMemo(() => makeHandoff(draft), [draft]);
  const paragraphs = useMemo(() => splitParagraphs(draft.body), [draft.body]);
  const publicPage = handoff.intendedPublicPage;

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setError("");
  }

  function toggleIndexCategory(categoryId) {
    const current = draft.indexCategories || [];
    const exists = current.some((category) => category.id === categoryId);
    updateField(
      "indexCategories",
      exists
        ? current.filter((category) => category.id !== categoryId)
        : [...current, { id: categoryId, subjects: [] }]
    );
  }

  function toggleIndexSubject(categoryId, subject) {
    const current = draft.indexCategories || [];
    updateField("indexCategories", current.map((category) => {
      if (category.id !== categoryId) return category;
      const selected = category.subjects.includes(subject);
      return {
        ...category,
        subjects: selected
          ? category.subjects.filter((entry) => entry !== subject)
          : [...category.subjects, subject]
      };
    }));
  }

  async function handleSave() {
    if (!draft.title.trim()) {
      setError("Add a title before saving this draft.");
      return;
    }
    if (draft.mode === "write" && !draft.body.trim()) {
      setError("Add some writing before saving this draft.");
      return;
    }
    if (draft.mode === "upload" && !draft.file) {
      setError("Choose a PDF before saving this draft.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const saved = await onSave({
        ...draft,
        id: draft.id || crypto.randomUUID(),
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim(),
        updatedAt: new Date().toISOString()
      });
      setDraft(saved);
      setDirty(false);
    } catch (saveError) {
      setError(saveError.message || "The draft could not be saved in this browser.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReview() {
    if (!draft.title.trim()) {
      setError("Add a title before reviewing this public update.");
      return;
    }
    if (!draft.subtitle.trim()) {
      setError("Add a short description for the public archive.");
      return;
    }
    if (draft.indexCategories.length === 0) {
      setError("Choose at least one public Index discipline before reviewing.");
      return;
    }
    if (draft.mode === "write" && !draft.body.trim()) {
      setError("Add some writing before reviewing this public update.");
      return;
    }
    if (draft.mode === "upload" && !draft.file) {
      setError("Choose a PDF before reviewing this public update.");
      return;
    }

    setReviewing(true);
    setError("");
    try {
      const saved = await onSave({
        ...draft,
        id: draft.id || crypto.randomUUID(),
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim(),
        updatedAt: new Date().toISOString()
      });
      setDraft(saved);
      setDirty(false);
      setReviewPlan(await onReview(saved));
    } catch (reviewError) {
      setError(reviewError.message || "The public update could not be reviewed.");
    } finally {
      setReviewing(false);
    }
  }

  async function handlePublish() {
    if (!reviewPlan) return;
    setPublishing(true);
    setError("");
    try {
      let attachmentData = null;
      if (draft.mode === "upload") {
        attachmentData = bytesToBase64(await draft.file.arrayBuffer());
      }
      const result = await onPublish({ ...draft, attachmentData });
      setReviewPlan(null);
      onClose();
      return result;
    } catch (publishError) {
      setError(publishError.message || "The reviewed public update could not be applied.");
    } finally {
      setPublishing(false);
    }
  }

  function downloadHandoff() {
    const file = new Blob([JSON.stringify(makeHandoff(draft), null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${createSlug(draft.title || draft.categoryLabel)}-draft.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadPdf() {
    if (!draft.file) return;
    const url = URL.createObjectURL(draft.file);
    const link = document.createElement("a");
    link.href = url;
    link.download = draft.fileName || "publication.pdf";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function closeEditor() {
    if (dirty && !window.confirm("This draft has unsaved changes. Leave without saving?")) return;
    onClose();
  }

  async function handleFileChange(event) {
    const input = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please choose a PDF. Other document formats are not previewable yet.");
      input.value = "";
      return;
    }

    let signature;
    try {
      signature = await file.slice(0, 5).text();
    } catch {
      setError("The selected file could not be read. Please choose another PDF.");
      input.value = "";
      return;
    }
    if (signature !== "%PDF-") {
      setError("The selected file does not appear to be a valid PDF.");
      input.value = "";
      return;
    }
    setDraft((current) => ({
      ...current,
      file,
      fileName: file.name,
      fileType: "application/pdf",
      fileSize: file.size
    }));
    setDirty(true);
    setError("");
  }

  return (
    <section className="entry-editor" aria-labelledby="editor-heading">
      <div className="editor-topline">
        <button className="editor-back-link" onClick={closeEditor} type="button">
          <Icon name="back" size={15} /> Back to workspace
        </button>
        <span className="editor-local-badge"><span /> Local draft</span>
      </div>

      <div className="editor-heading">
        <div>
          <p className="eyebrow">NEW {draft.categoryLabel.toUpperCase()} <span className="eyebrow-divider">/</span> EDITOR</p>
          <h1 id="editor-heading">Give the work<br /><em>a place to grow.</em></h1>
          <p className="welcome-copy">
            Write directly here or keep the original document alongside its public-page details.
          </p>
        </div>
        <div className="editor-stepper" aria-label="Entry creation steps">
          <span className="step-complete"><Icon name="check" size={13} /> Category</span>
          <span className="step-rule" />
          <span className="step-current">Create</span>
          <span className="step-rule" />
          <span>Review</span>
        </div>
      </div>

      <div className="editor-privacy-note">
        <Icon name="leaf" size={16} />
        <span>
          Drafts and uploaded PDFs stay in this browser on this device. This workspace has no sign-in or cloud backup yet; drafts are not private from other users of this device.
        </span>
      </div>

      <div className="editor-grid">
        <div className="editor-primary">
          <section className="editor-panel">
            <div className="editor-panel-heading">
              <div>
                <p className="eyebrow">01 <span className="eyebrow-divider">/</span> THE ESSENTIALS</p>
                <h2>Start with the story</h2>
              </div>
              <span className="editor-category-chip">{draft.categoryLabel}</span>
            </div>

            <label className="editor-field">
              <span>Title <b>Required</b></span>
              <input
                autoFocus
                maxLength={140}
                onChange={(event) => updateField("title", event.target.value)}
                placeholder="A clear, considered title"
                value={draft.title}
              />
            </label>

            <label className="editor-field">
              <span>Short description <b>For the archive</b></span>
              <textarea
                maxLength={240}
                onChange={(event) => updateField("subtitle", event.target.value)}
                placeholder="A sentence to help readers find their way in"
                rows={2}
                value={draft.subtitle}
              />
            </label>

            <div className="editor-field">
              <span>Public Index filing <b>Select disciplines and specific subjects</b></span>
              <div className="taxonomy-picker" aria-label="Public Index disciplines">
              {taxonomy.map((category) => {
                const selected = draft.indexCategories.find((entry) => entry.id === category.id);
                return (
                  <section className={`taxonomy-group ${selected ? "is-selected" : ""}`} key={category.id}>
                    <label className="taxonomy-category">
                      <input
                        checked={Boolean(selected)}
                        onChange={() => toggleIndexCategory(category.id)}
                        type="checkbox"
                      />
                      <span className="taxonomy-check" aria-hidden="true"><Icon name="check" size={12} /></span>
                      <span className="taxonomy-category-copy">
                        <strong>{category.title}</strong>
                        <small>{category.subjects.length} public subjects</small>
                      </span>
                    </label>
                    {selected && (
                      <div className="taxonomy-subjects">
                        {category.subjects.map((subject) => (
                          <label className="taxonomy-subject" key={subject}>
                            <input
                              checked={selected.subjects.includes(subject)}
                              onChange={() => toggleIndexSubject(category.id, subject)}
                              type="checkbox"
                            />
                            <span>{subject}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
              {taxonomy.length === 0 && (
                <p className="taxonomy-empty" role="alert">
                  The public Index subjects could not be loaded. Restart the local admin server and try again.
                </p>
              )}
              <p className="taxonomy-selection-note">
                Selected disciplines and subjects will be added to their matching public Index tabs after you review and publish.
              </p>
              </div>
            </div>
          </section>

          <section className="editor-panel writing-panel">
            <div className="editor-panel-heading">
              <div>
                <p className="eyebrow">02 <span className="eyebrow-divider">/</span> YOUR MATERIAL</p>
                <h2>{draft.mode === "write" ? "Write in your own words" : "Keep the original document"}</h2>
              </div>
              <button
                aria-pressed={previewOpen}
                className={`editor-preview-toggle ${previewOpen ? "is-active" : ""}`}
                onClick={() => setPreviewOpen(!previewOpen)}
                type="button"
              >
                <Icon name="preview" size={15} /> {previewOpen ? "Edit" : "Preview"}
              </button>
            </div>

            {draft.mode === "write" ? (
              previewOpen ? (
                <article className="writing-preview">
                  <p className="preview-label">READING PREVIEW <span>·</span> NOT PUBLISHED</p>
                  <h2>{draft.title || "Your title will appear here"}</h2>
                  {draft.subtitle && <p className="preview-deck">{draft.subtitle}</p>}
                  <div className="preview-byline">Chloe Elia <span>·</span> {draft.categoryLabel}</div>
                  {paragraphs.length
                    ? paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 20)}`}>{paragraph}</p>)
                    : <p className="preview-placeholder">Your writing preview will appear here as you begin.</p>}
                </article>
              ) : (
                <label className="editor-field body-field">
                  <span>Writing <b>Plain text with paragraph breaks</b></span>
                  <textarea
                    className="writing-input"
                    onChange={(event) => updateField("body", event.target.value)}
                    placeholder="Begin with an observation, a question, or a detail worth keeping..."
                    value={draft.body}
                  />
                </label>
              )
            ) : (
              <div className="upload-area">
                {!draft.file ? (
                  <label className="upload-dropzone">
                    <input accept="application/pdf,.pdf" onChange={handleFileChange} type="file" />
                    <span className="upload-mark"><Icon name="upload" size={20} /></span>
                    <strong>Choose a PDF from this device</strong>
                    <small>The original will be stored in this browser and kept with your draft.</small>
                    <span className="button button-secondary">Browse files</span>
                  </label>
                ) : (
                  <div className="uploaded-file-card">
                    <span className="uploaded-file-icon"><Icon name="file" size={20} /></span>
                    <span className="uploaded-file-details">
                      <strong>{draft.fileName}</strong>
                      <small>PDF document <span>·</span> {formatBytes(draft.fileSize || draft.file.size)}</small>
                    </span>
                    <button
                      aria-label="Remove uploaded PDF"
                      className="remove-file-button"
                      onClick={() => {
                        setDraft((current) => ({ ...current, file: null, fileName: "", fileType: "", fileSize: 0 }));
                        setDirty(true);
                      }}
                      type="button"
                    >
                      <Icon name="close" size={16} />
                    </button>
                    <button className="text-link file-download-link" onClick={downloadPdf} type="button">
                      <Icon name="download" size={14} /> Download a copy
                    </button>
                  </div>
                )}
                {draft.file && previewOpen && fileUrl && (
                  <iframe className="uploaded-pdf-preview" src={fileUrl} title={`Preview of ${draft.fileName}`} />
                )}
                {draft.mode === "upload" && (
                  <label className="editor-field upload-summary-field">
                    <span>Reader-facing note <b>For the public archive</b></span>
                    <textarea
                      maxLength={240}
                      onChange={(event) => updateField("subtitle", event.target.value)}
                      placeholder="What should readers know about this document?"
                      rows={3}
                      value={draft.subtitle}
                    />
                  </label>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="editor-aside">
          <section className="editor-panel destination-panel">
            <p className="eyebrow">03 <span className="eyebrow-divider">/</span> PUBLIC INDEX PLACEMENT</p>
            <h2>A path for the work</h2>
            <p className="destination-copy">
              Review and publish to add this entry to the homepage archive and the selected Index tabs in this local project.
            </p>
            <div className="destination-url">
              <span>thenaturalinquiry.com/</span>
              <strong>{publicPage}</strong>
            </div>
            <div className="destination-status"><span /> Not live <span className="destination-dot">·</span> Local draft only</div>
            <div className="destination-filings">
              {(draft.indexCategories || []).length === 0 ? (
                <small>No Index filing selected</small>
              ) : draft.indexCategories.map((filing) => {
                const category = taxonomy.find((item) => item.id === filing.id);
                if (!category) return null;
                return (
                  <div className="destination-filing" key={filing.id}>
                    <strong>{category.title}</strong>
                    <small>{filing.subjects.length ? filing.subjects.join(" · ") : "Discipline tab only"}</small>
                  </div>
                );
              })}
            </div>
            <div className="destination-separator" />
            <p className="destination-copy">
              Publishing creates the reading page and updates its Index associations. GitHub and AWS remain untouched.
            </p>
            <button className="text-link handoff-download" onClick={downloadHandoff} type="button">
              <Icon name="download" size={15} /> Download metadata handoff
            </button>
          </section>

          <section className="editor-panel save-panel">
            <p className="eyebrow">KEEP THIS WORK</p>
            <h2>{draft.id ? "Continue this draft" : "Save as a draft"}</h2>
            <p>Stored in this browser only. It will be here when you return on this device.</p>
            <button className="button button-primary save-draft-button" disabled={saving} onClick={handleSave} type="button">
              <Icon name="save" size={16} /> {saving ? "Saving…" : "Save draft"}
            </button>
            <button className="button button-secondary leave-editor-button" onClick={closeEditor} type="button">
              Back to overview
            </button>
            <button
              className="button button-publish-review"
              disabled={reviewing || publishing || taxonomy.length === 0}
              onClick={handleReview}
              type="button"
            >
              <Icon name="preview" size={15} />
              {reviewing ? "Preparing review…" : "Review public changes"}
            </button>
            {draft.id && (
              <button
                className="delete-draft-button"
                onClick={async () => {
                  if (window.confirm("Delete this local draft from this browser?")) await onDelete(draft.id);
                }}
                type="button"
              >
                Delete local draft
              </button>
            )}
            {dirty && <small className="unsaved-label">Unsaved changes</small>}
            {!dirty && draft.id && <small className="saved-label"><Icon name="check" size={13} /> Saved on this browser</small>}
          </section>
        </aside>
      </div>

      {error && <p className="editor-error" role="alert">{error}</p>}
      <p className="editor-footer-note">
        Publishing writes only to this local project folder. It does not push to GitHub or deploy to AWS.
      </p>
      {reviewPlan && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !publishing) setReviewPlan(null);
        }}>
          <section aria-labelledby="publication-review-title" aria-modal="true" className="dialog-card publication-review-dialog" role="dialog">
            <button
              aria-label="Close review"
              className="icon-button dialog-close"
              disabled={publishing}
              onClick={() => setReviewPlan(null)}
              type="button"
            >
              <Icon name="close" size={18} />
            </button>
            <p className="eyebrow">FINAL REVIEW <span className="eyebrow-divider">/</span> NOTHING LIVE YET</p>
            <h2 id="publication-review-title">Review the public changes</h2>
            <p className="dialog-intro">
              Publishing applies these files to the local working copy. You can inspect them in VS Code before committing or deploying anything.
            </p>
            <div className="review-summary">
              <strong>{reviewPlan.title}</strong>
              <span>thenaturalinquiry.com/{reviewPlan.url}</span>
            </div>
            <div className="review-associations">
              <p className="eyebrow">INDEX PLACEMENT</p>
              {reviewPlan.categories.map((category) => (
                <div className="review-association" key={category.categoryId}>
                  <strong>{category.categoryTitle}</strong>
                  <span>{category.subjects.length ? category.subjects.join(" · ") : "Discipline tab"}</span>
                </div>
              ))}
            </div>
            <div className="review-file-list">
              <p className="eyebrow">FILES TO CHANGE</p>
              {reviewPlan.paths.map((file) => (
                <div className="review-file" key={file.path}>
                  <span className={`review-file-action ${file.action.toLowerCase()}`}>{file.action}</span>
                  <span><strong>{file.path}</strong><small>{file.label}</small></span>
                </div>
              ))}
            </div>
            <div className="dialog-note">
              <Icon name="leaf" size={16} />
              This review applies only to the clean clone on this device. It will not change GitHub or AWS.
            </div>
            {error && <p className="editor-error review-error" role="alert">{error}</p>}
            <div className="review-actions">
              <button className="button button-secondary" disabled={publishing} onClick={() => setReviewPlan(null)} type="button">
                Keep as draft
              </button>
              <button className="button button-primary" disabled={publishing} onClick={handlePublish} type="button">
                <Icon name="check" size={15} />
                {publishing ? "Applying changes…" : "Publish to local site"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
