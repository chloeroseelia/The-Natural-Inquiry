import { escapeHtml, sanitizeHtml, safeUrl } from "./sanitize.js";
import { isValidPublicPath, validateManifest } from "./manifest.js";

export const GENERATED_MARKER = "<!-- generated-by: natural-inquiry-site-publisher; do not edit by hand -->";
export const PUBLISHED_DATA_PATH = "natural-inquiry-published-entries.js";
const PUBLISHED_DATA_PREFIX = "window.NaturalInquiryPublishedEntries = ";

const STAGE_LABELS = { IN_PROGRESS: "In progress", PAST: "Past project", PLANNED: "Planned" };

function entryType(category) {
  return category === "Essay" ? "Essay" : category === "Research project" ? "Research" : "Notes";
}

function renderReferences(references) {
  if (!references?.length) return "";
  const items = references.map((reference) => {
    const url = safeUrl(reference.url);
    const label = escapeHtml(reference.title);
    const body = url ? `<a href="${escapeHtml(url)}"${/^(https?:|mailto:)/i.test(url) ? ' rel="noopener noreferrer"' : ""}>${label}</a>` : label;
    return `<li>${body}</li>`;
  });
  return `\n        <section class="article-references">\n          <h2>References</h2>\n          <ol>${items.join("")}</ol>\n        </section>`;
}

function renderPage({ url, title, description, eyebrow, section, categoryLabel, contentHtml, references }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  return `<!doctype html>
${GENERATED_MARKER}
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${safeDescription}">
    <meta name="theme-color" content="#f7f5ee">
    <title>${safeTitle} — The Natural Inquiry</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&amp;family=DM+Sans:wght@400;500;600;700&amp;family=Playfair+Display:ital,wght@0,500;0,600;1,500;1,600&amp;display=swap">
    <link rel="stylesheet" href="../styles.css">
    <link rel="icon" href="../favicon.svg" type="image/svg+xml">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="The Natural Inquiry">
    <meta property="og:title" content="${safeTitle} — The Natural Inquiry">
    <meta property="og:description" content="${safeDescription}">
    <meta property="og:image" content="https://chloeroseelia.github.io/The-Natural-Inquiry/images/og-image.jpg">
    <meta name="twitter:card" content="summary_large_image">
    <script src="../natural-inquiry-published-entries.js" defer></script>
    <script src="../natural-inquiry-index-data.js" defer></script>
    <script src="../natural-inquiry-subject-links.js" defer></script>
  </head>
  <body>
    <header class="site-header">
      <a class="wordmark" href="../index.html" aria-label="The Natural Inquiry home">
        <span class="wordmark-mark" aria-hidden="true">N</span>
        <span>The Natural Inquiry</span>
      </a>
      <nav aria-label="Main navigation">
        <a href="../index.html#archive">Archive</a>
        <a href="../writing-showcase.html">Showcase</a>
        <a href="../profile.html">Profile</a>
        <a href="../natural-inquiry-index.html">Index</a>
        <a href="../index.html#about">About</a>
      </nav>
    </header>
    <main class="article-main">
      <a class="article-back" href="../index.html#archive">← Back to selected writing</a>
      <div class="article-subjects" id="article-subjects" data-writing-url="${escapeHtml(url)}" aria-label="Related scientific disciplines"></div>
      <header class="article-header">
        <p class="eyebrow">${escapeHtml(eyebrow)} · ${section === "research" ? "Research" : "The Natural Inquiry"}</p>
        <h1>${safeTitle}</h1>
        <p class="article-deck">${safeDescription}</p>
        <div class="article-meta"><span>Chloe Elia</span><span>${escapeHtml(categoryLabel)}</span></div>
      </header>
      <article class="article-content">
        ${contentHtml}${references}
      </article>
    </main>
    <footer class="site-footer">
      <a class="wordmark footer-wordmark" href="../index.html">
        <span class="wordmark-mark" aria-hidden="true">N</span>
        <span>The Natural Inquiry</span>
      </a>
      <p>Made for curiosity. <span id="current-year"></span></p>
      <a class="back-to-top" href="../index.html#top">Back to top ↑</a>
    </footer>
    <script>document.querySelector("#current-year").textContent = new Date().getFullYear();</script>
  </body>
</html>
`;
}

function serializeEntries(entries) {
  // "<" and line separators are escaped so the data can never close a script context.
  const json = JSON.stringify(entries, null, 2)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return `${PUBLISHED_DATA_PREFIX}${json};\n`;
}

/*
 * Pure generation. `readExisting(relativePath)` returns the current content of a file in the
 * public site (or null if absent) and is used only to avoid overwriting hand-written pages.
 * Returns the files to write; the caller decides where they go.
 */
export function generateSite(manifest, { readExisting = () => null } = {}) {
  const validation = validateManifest(manifest);
  if (!validation.ok) {
    throw new Error(`Manifest rejected:\n- ${validation.errors.join("\n- ")}`);
  }

  const files = [];
  const entries = [];
  const report = { included: [], skipped: [], profileSections: manifest.profile.length };

  const pages = [
    ...manifest.publications.map((item) => ({ item, section: "publications" })),
    ...manifest.research.map((item) => ({ item, section: "research" }))
  ];

  for (const { item, section } of pages) {
    const directory = section === "research" || item.category === "Research project" ? "research" : "writing";
    if (!isValidPublicPath(item.publicPath, directory)) {
      report.skipped.push({ id: item.id, path: item.publicPath, reason: "invalid public path" });
      continue;
    }
    const existing = readExisting(item.publicPath);
    if (existing != null && !existing.includes(GENERATED_MARKER)) {
      report.skipped.push({ id: item.id, path: item.publicPath, reason: "protected existing page (not generated)" });
      continue;
    }

    // The manifest is untrusted: sanitize again before it becomes a public page.
    const content = sanitizeHtml(item.contentHtml);
    const description = item.subtitle || item.summary || item.overview || "";
    const category = section === "research" ? "Research project" : item.category;
    const stage = STAGE_LABELS[item.projectStage];
    const html = renderPage({
      url: item.publicPath,
      title: item.title,
      description: description.length > 1000 ? description.slice(0, 1000) : description,
      eyebrow: section === "research" ? "Research project" : category === "Field note" ? "Field note" : category === "Other" ? "Other" : "Essay",
      section: directory,
      categoryLabel: section === "research" ? stage || "Research project" : category,
      contentHtml: content.html || (item.overview ? sanitizeHtml(`<p>${escapeHtml(item.overview)}</p>`).html : ""),
      references: renderReferences(item.references)
    });

    files.push({ path: item.publicPath, content: html });
    entries.push({
      id: item.id,
      title: item.title,
      type: entryType(category),
      description,
      url: item.publicPath,
      year: new Date(item.publishedAt).getUTCFullYear(),
      filings: (item.indexCategories || []).map(({ categoryId, subjects }) => ({ categoryId, subjects: [...subjects] })),
      mediaFile: null
    });
    report.included.push({ id: item.id, path: item.publicPath, section });
  }

  files.push({ path: PUBLISHED_DATA_PATH, content: serializeEntries(entries) });
  report.counts = {
    pagesGenerated: report.included.length,
    skipped: report.skipped.length,
    entries: entries.length,
    profileSectionsInManifest: manifest.profile.length
  };
  return { files, report };
}
