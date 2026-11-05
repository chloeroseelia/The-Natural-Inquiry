import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { runInNewContext } from "node:vm";

const PUBLISHED_DATA_PATH = "natural-inquiry-published-entries.js";
const PUBLISHED_DATA_PREFIX = "window.NaturalInquiryPublishedEntries = ";
const MAX_REQUEST_BYTES = 22 * 1024 * 1024;
const MAX_PDF_BYTES = 15 * 1024 * 1024;

function isWithinRoot(root, target) {
  const path = relative(root, target);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error("The request is too large. PDFs must be 15 MB or smaller."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("The request did not contain valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeSlug(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "untitled";
}

async function loadFullCategoryData(projectRoot) {
  const source = await readFile(resolve(projectRoot, "natural-inquiry-index-data.js"), "utf8");
  const publishedEntries = await loadPublishedEntries(projectRoot);
  const scope = { window: { NaturalInquiryPublishedEntries: publishedEntries } };
  runInNewContext(`${source}\nwindow.__naturalInquiryCategories = naturalInquiryIndexCategories;`, scope, { timeout: 1000 });
  const categories = scope.window.__naturalInquiryCategories;
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error("The public Natural Inquiry Index taxonomy could not be loaded.");
  }
  return categories;
}

async function loadTaxonomy(projectRoot) {
  const categories = await loadFullCategoryData(projectRoot);
  return categories.map(({ id, title, subjects }) => ({ id, title, subjects: [...subjects] }));
}

async function loadPublishedEntries(projectRoot) {
  const path = resolve(projectRoot, PUBLISHED_DATA_PATH);
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  if (!source.startsWith(PUBLISHED_DATA_PREFIX)) {
    throw new Error(`${PUBLISHED_DATA_PATH} has an unexpected format; no public files were changed.`);
  }
  const json = source.slice(PUBLISHED_DATA_PREFIX.length).replace(/;\s*$/, "");
  const entries = JSON.parse(json);
  if (!Array.isArray(entries)) throw new Error("Published-entry data must be an array.");
  return entries;
}

function validateTaxonomy(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error("The Index must contain between 1 and 100 categories.");
  }

  const categoryIds = new Set();
  return value.map((category) => {
    if (!category || typeof category !== "object" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.id || "")) {
      throw new Error("Each Index category needs a valid, stable ID.");
    }
    if (categoryIds.has(category.id)) throw new Error(`The category ID "${category.id}" is used more than once.`);
    categoryIds.add(category.id);

    const title = typeof category.title === "string" ? category.title.trim() : "";
    if (!title || title.length > 120) throw new Error("Category titles must be between 1 and 120 characters.");
    if (!Array.isArray(category.subjects) || category.subjects.length > 300) {
      throw new Error(`The subjects for "${title}" must be a list of no more than 300 items.`);
    }

    const seenSubjects = new Set();
    const subjects = category.subjects.map((subject) => {
      if (typeof subject !== "string" || !subject.trim() || subject.trim().length > 120) {
        throw new Error(`Subjects in "${title}" must be between 1 and 120 characters.`);
      }
      const normalized = subject.trim().toLocaleLowerCase();
      if (seenSubjects.has(normalized)) throw new Error(`"${subject.trim()}" appears more than once in "${title}".`);
      seenSubjects.add(normalized);
      return subject.trim();
    });

    return { id: category.id, title, subjects };
  });
}

async function createTaxonomyPlan(projectRoot, requestedCategories) {
  const categories = validateTaxonomy(requestedCategories);
  const dataPath = resolve(projectRoot, "natural-inquiry-index-data.js");
  const originalSource = await readFile(dataPath, "utf8");
  const startMarker = "const naturalInquiryIndexCategories = ";
  const endMarker = "const naturalInquiryWritings = ";
  const start = originalSource.indexOf(startMarker);
  const writingStart = originalSource.indexOf(endMarker, start);
  const categoryEnd = originalSource.lastIndexOf("];", writingStart);
  if (start < 0 || writingStart < 0 || categoryEnd < start) {
    throw new Error("The public Index data has an unexpected format; no files were changed.");
  }

  const previousCategories = await loadTaxonomy(projectRoot);
  const fullCategories = await loadFullCategoryData(projectRoot);
  const taxonomyChanged = JSON.stringify(previousCategories) !== JSON.stringify(categories);
  const previousById = new Map(previousCategories.map((category) => [category.id, category]));
  const fullById = new Map(fullCategories.map((category) => [category.id, category]));
  const preservedCategories = categories.map((category) => {
    const previous = previousById.get(category.id);
    if (!previous) return category;
    const fullSource = fullById.get(category.id);
    const subjectWriting = Object.fromEntries(
      Object.entries(fullSource.subjectWriting || {}).filter(([subject]) => category.subjects.includes(subject))
    );
    return {
      ...fullSource,
      ...category,
      ...(Object.keys(subjectWriting).length ? { subjectWriting } : { subjectWriting: undefined })
    };
  });
  const nextSource = `${originalSource.slice(0, start)}${startMarker}${JSON.stringify(preservedCategories, null, 2)};${originalSource.slice(categoryEnd + 2)}`;

  const publishedEntries = await loadPublishedEntries(projectRoot);
  const currentById = new Map(categories.map((category) => [category.id, category]));
  let entriesChanged = false;
  const nextEntries = publishedEntries.map((entry) => {
    if (!Array.isArray(entry.filings)) return entry;
    const filings = entry.filings.flatMap((filing) => {
      const category = currentById.get(filing.categoryId);
      if (!category) {
        entriesChanged = true;
        return [];
      }
      const allowedSubjects = new Set(category.subjects);
      const subjects = (filing.subjects || []).filter((subject) => allowedSubjects.has(subject));
      if (subjects.length !== (filing.subjects || []).length || filing.categoryTitle !== category.title) {
        entriesChanged = true;
      }
      return [{ ...filing, categoryTitle: category.title, subjects }];
    });
    if (filings.length !== entry.filings.length) entriesChanged = true;
    return { ...entry, filings };
  });

  const files = taxonomyChanged ? [{ path: dataPath, content: nextSource }] : [];
  if (entriesChanged) {
    files.push({
      path: resolve(projectRoot, PUBLISHED_DATA_PATH),
      content: `${PUBLISHED_DATA_PREFIX}${JSON.stringify(nextEntries, null, 2)};\n`
    });
  }

  return {
    categories,
    previousCategories,
    files
  };
}

function validateDraft(draft, taxonomy) {
  if (!draft || typeof draft !== "object") throw new Error("Draft details are missing.");
  if (!/^[\da-f-]{20,40}$/i.test(draft.id || "")) throw new Error("Save this draft before preparing a public update.");
  if (typeof draft.title !== "string" || !draft.title.trim()) throw new Error("Add a title before publishing.");
  if (typeof draft.subtitle !== "string" || !draft.subtitle.trim()) {
    throw new Error("Add a short description for the public archive.");
  }

  if (!["Essay", "Research project", "Field note", "Other"].includes(draft.category)) {
    throw new Error("Choose a supported entry category.");
  }
  if (!Array.isArray(draft.indexCategories) || draft.indexCategories.length === 0) {
    throw new Error("Choose at least one public Index discipline.");
  }
  if (!["write", "upload"].includes(draft.mode)) throw new Error("Choose writing or PDF as the entry material.");
  if (draft.mode === "write" && (typeof draft.body !== "string" || !draft.body.trim())) {
    throw new Error("Add writing before publishing.");
  }
  if (draft.mode === "upload" && typeof draft.fileName !== "string") {
    throw new Error("Choose a PDF before publishing.");
  }

  const selectedCategories = draft.indexCategories.map((selected) => {
    const category = taxonomy.find((item) => item.id === selected.id);
    if (!category) throw new Error("One selected discipline is no longer in the public Index. Refresh and choose again.");
    if (!Array.isArray(selected.subjects)) throw new Error("Invalid subtopic selection.");
    const subjects = [...new Set(selected.subjects)];
    if (subjects.some((subject) => !category.subjects.includes(subject))) {
      throw new Error(`One selected subtopic does not belong to ${category.title}.`);
    }
    return { categoryId: category.id, categoryTitle: category.title, subjects };
  });

  return { selectedCategories };
}

function createArticlePage(draft, url, mediaFile) {
  const title = escapeHtml(draft.title.trim());
  const description = escapeHtml(draft.subtitle.trim());
  const category = escapeHtml(draft.categoryLabel || draft.category);
  const body = draft.mode === "write"
    ? draft.body.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("\n        ")
    : `<div class="document-actions"><a href="../${escapeHtml(mediaFile)}" download="${escapeHtml(draft.fileName)}">Download original PDF ↓</a></div>
        <iframe class="document-frame" src="../${escapeHtml(mediaFile)}" title="${title}"></iframe>
        <p class="document-caption">If the document does not appear here, use the download link above to read the original PDF.</p>`;
  const eyebrow = draft.category === "Research project" ? "Research project" : draft.category === "Field note" ? "Field note" : draft.category === "Other" ? category : "Essay";
  const pageTitle = url.startsWith("research/") ? "research" : "writing";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${description}">
    <meta name="theme-color" content="#f7f5ee">
    <title>${title} — The Natural Inquiry</title>
    <link rel="stylesheet" href="../styles.css">
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
        <p class="eyebrow">${escapeHtml(eyebrow)} · ${pageTitle === "research" ? "Research" : "The Natural Inquiry"}</p>
        <h1>${title}</h1>
        <p class="article-deck">${description}</p>
        <div class="article-meta"><span>Chloe Elia</span><span>${category}</span></div>
      </header>
      <article class="article-content">
        ${body}
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

async function createPublicationPlan(projectRoot, draft) {
  const taxonomy = await loadTaxonomy(projectRoot);
  const { selectedCategories } = validateDraft(draft, taxonomy);
  const directory = draft.category === "Research project" ? "research" : "writing";
  const slug = safeSlug(draft.title);
  const url = `${directory}/${slug}.html`;
  const pagePath = resolve(projectRoot, url);
  if (!isWithinRoot(projectRoot, pagePath)) throw new Error("The generated page path is outside the project.");

  const publishedEntries = await loadPublishedEntries(projectRoot);
  const previous = publishedEntries.find((entry) => entry.id === draft.id);
  if (previous && previous.url !== url) {
    throw new Error(`This draft is already associated with ${previous.url}. Changing a published page address requires a manual review.`);
  }
  const urlOwner = publishedEntries.find((entry) => entry.url === url && entry.id !== draft.id);
  if (urlOwner) throw new Error(`The public path ${url} is already used by another managed entry.`);

  let mediaFile = null;
  let attachmentBytes = null;
  if (draft.mode === "upload") {
    if (!draft.fileName.toLowerCase().endsWith(".pdf") || !Number.isInteger(draft.fileSize) || draft.fileSize < 5 || draft.fileSize > MAX_PDF_BYTES) {
      throw new Error("Choose a PDF of 15 MB or smaller.");
    }
    if (typeof draft.attachmentData === "string") {
      attachmentBytes = Buffer.from(draft.attachmentData, "base64");
      if (attachmentBytes.length !== draft.fileSize || attachmentBytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error("The uploaded document is not a valid PDF or did not arrive intact.");
      }
    }
    mediaFile = `media/${draft.id}-${slug}.pdf`;
  }

  const publicEntry = {
    id: draft.id,
    title: draft.title.trim(),
    type: draft.category === "Research project" ? "Research" : draft.category === "Essay" ? "Essay" : "Notes",
    description: draft.subtitle.trim(),
    url,
    year: new Date().getFullYear(),
    filings: selectedCategories.map(({ categoryId, subjects }) => ({ categoryId, subjects })),
    mediaFile
  };
  const nextEntries = [...publishedEntries.filter((entry) => entry.id !== draft.id), publicEntry];
  const dataSource = `${PUBLISHED_DATA_PREFIX}${JSON.stringify(nextEntries, null, 2)};\n`;
  const existingManagedEntry = publishedEntries.find((entry) => entry.id === draft.id);
  const paths = [
    {
      path: url,
      label: "Create the public reading page",
      absolutePath: pagePath,
      exists: await pathExists(pagePath),
      managedExistingPage: Boolean(existingManagedEntry)
    }
  ];

  if (mediaFile) {
    const mediaPath = resolve(projectRoot, mediaFile);
    if (!isWithinRoot(projectRoot, mediaPath)) throw new Error("The generated media path is outside the project.");
    const exists = await pathExists(mediaPath);
    const managedExistingMedia = existingManagedEntry?.mediaFile === mediaFile;
    paths.push({
      path: mediaFile,
      label: draft.mode === "upload" && attachmentBytes ? "Add the uploaded PDF to the public media folder" : "Keep the existing public PDF",
      absolutePath: mediaPath,
      exists,
      managedExistingMedia,
      attachmentBytes
    });
  }

  const dataPath = resolve(projectRoot, PUBLISHED_DATA_PATH);
  paths.push({
    path: PUBLISHED_DATA_PATH,
    label: "Update homepage archive and Index subject associations",
    absolutePath: dataPath,
    exists: await pathExists(dataPath),
    content: dataSource
  });

  if (!existingManagedEntry && paths.some((item) => item.path !== PUBLISHED_DATA_PATH && item.exists)) {
    throw new Error("A generated public path already exists. Choose a different title or resolve the existing file manually.");
  }
  if (paths.some((item) => item.path !== PUBLISHED_DATA_PATH && item.exists &&
      !item.managedExistingMedia && !item.managedExistingPage)) {
    throw new Error("A generated page or media path already exists and is not managed by this workspace.");
  }

  const article = createArticlePage(draft, url, mediaFile);
  const page = paths.find((item) => item.path === url);
  page.content = article;
  return {
    draftId: draft.id,
    title: draft.title.trim(),
    url,
    categories: selectedCategories,
    paths: paths.map(({ path, label, exists }) => ({ path, label, action: exists ? "Update" : "Create" })),
    files: paths.filter((item) => item.path !== mediaFile || attachmentBytes).map((item) => ({
      path: item.absolutePath,
      content: item.path === mediaFile ? attachmentBytes : Buffer.from(item.content, "utf8")
    })),
    publicEntry
  };
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function writeFilesAtomically(files, id) {
  const token = `${id}-${randomUUID()}`;
  const staged = [];
  const committed = [];
  try {
    for (const file of files) {
      await mkdir(dirname(file.path), { recursive: true });
      const tempPath = `${file.path}.tmp-${token}`;
      const backupPath = `${file.path}.bak-${token}`;
      await writeFile(tempPath, file.content, { flag: "wx" });
      staged.push({ path: file.path, tempPath, backupPath, hadOriginal: await pathExists(file.path) });
    }

    for (const item of staged) {
      if (item.hadOriginal) await rename(item.path, item.backupPath);
      try {
        await rename(item.tempPath, item.path);
        committed.push(item);
      } catch (error) {
        if (item.hadOriginal) await rename(item.backupPath, item.path);
        throw error;
      }
    }
  } catch (error) {
    for (const item of committed.reverse()) {
      await rm(item.path, { force: true });
      if (item.hadOriginal) await rename(item.backupPath, item.path);
    }
    throw error;
  } finally {
    await Promise.all(staged.flatMap((item) => [
      rm(item.tempPath, { force: true }),
      rm(item.backupPath, { force: true })
    ]));
  }
}

function verifyLocalOrigin(request, response) {
  const host = request.headers.host;
  let origin;
  try {
    origin = new URL(request.headers.origin).host;
  } catch {
    sendJson(response, 403, { error: "A same-origin browser request is required." });
    return false;
  }
  if (origin !== host || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host || "")) {
    sendJson(response, 403, { error: "Publishing is only available from this local workspace." });
    return false;
  }
  return true;
}

export function localPublishingPlugin(projectRoot) {
  return {
    name: "natural-inquiry-local-publishing",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || "/", "http://localhost").pathname;
        if (!pathname.startsWith("/__admin-api/")) return next();

        if (pathname === "/__admin-api/taxonomy" && request.method === "GET") {
          try {
            sendJson(response, 200, { categories: await loadTaxonomy(projectRoot) });
          } catch (error) {
            sendJson(response, 500, { error: error.message || "The public Index could not be read." });
          }
          return;
        }

        if (pathname === "/__admin-api/taxonomy" && request.method === "POST") {
          if (!verifyLocalOrigin(request, response)) return;
          try {
            const requestBody = await readJsonBody(request);
            const plan = await createTaxonomyPlan(projectRoot, requestBody.categories);
            if (plan.files.length) await writeFilesAtomically(plan.files, randomUUID());
            sendJson(response, 200, {
              categories: plan.categories,
              changed: plan.files.length > 0,
              unlinkedCategories: plan.previousCategories
                .filter((category) => !plan.categories.some((next) => next.id === category.id))
                .map(({ id, title }) => ({ id, title })),
              unlinkedSubjects: plan.previousCategories.flatMap((category) => {
                const next = plan.categories.find((entry) => entry.id === category.id);
                return next
                  ? category.subjects.filter((subject) => !next.subjects.includes(subject))
                    .map((subject) => ({ categoryId: category.id, subject }))
                  : [];
              })
            });
          } catch (error) {
            sendJson(response, 400, { error: error.message || "The public Index could not be updated." });
          }
          return;
        }

        if ((pathname === "/__admin-api/publication-preview" || pathname === "/__admin-api/publish") &&
            request.method === "POST") {
          if (!verifyLocalOrigin(request, response)) return;
          try {
            const draft = await readJsonBody(request);
            const plan = await createPublicationPlan(projectRoot, draft);
            if (pathname === "/__admin-api/publish") {
              await writeFilesAtomically(plan.files, plan.draftId);
            }
            sendJson(response, 200, {
              title: plan.title,
              url: plan.url,
              categories: plan.categories,
              paths: plan.paths
            });
          } catch (error) {
            sendJson(response, 400, { error: error.message || "The publication could not be prepared." });
          }
          return;
        }

        sendJson(response, 404, { error: "Unknown local publishing endpoint." });
      });
    }
  };
}
