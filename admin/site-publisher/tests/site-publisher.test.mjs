// Synthetic tests for the static-site generator (Publishing Phase 1).
// Uses only in-memory fixtures and a temp directory: no AWS, no network, no real site files.
// Run from admin/site-publisher: node tests/site-publisher.test.mjs
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanText, safeUrl, sanitizeHtml } from "../sanitize.js";
import {
  FIELD_ALLOWLISTS, PRIVATE_FIELDS, buildManifest, isValidPublicPath, validateManifest
} from "../manifest.js";
import { GENERATED_MARKER, PUBLISHED_DATA_PATH, generateSite } from "../generate.js";
import { generateToDirectory } from "../generate-cli.mjs";

let n = 0;
const pass = (name) => console.log(`${++n} ${name}: ok`);

const GENERATED_AT = "2026-11-05T12:00:00.000Z";
const ID = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function publication(overrides = {}) {
  return {
    id: ID(1), title: "Tide Pools", subtitle: "Life between tides", category: "Essay", summary: null,
    content: "<p>Hello <strong>world</strong></p>", contentFormat: "RICH_TEXT", status: "PUBLISHED", archived: false,
    indexCategories: JSON.stringify([{ id: "ecology", subjects: ["Intertidal zones"] }]),
    references: JSON.stringify([{ id: "r1", title: "A source", url: "https://example.org/a" }]),
    mediaKeys: JSON.stringify(["admin-media/secret.png"]), sourceDocumentName: "private-draft.docx",
    publicPath: "writing/tide-pools.html", publishedAt: "2026-10-01T00:00:00.000Z",
    importedCreatedAt: "2026-01-01T00:00:00.000Z", importedUpdatedAt: "2026-02-01T00:00:00.000Z",
    revision: 7, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z", owner: "someone",
    ...overrides
  };
}
function research(overrides = {}) {
  return {
    id: ID(2), title: "Kelp Study", summary: "A kelp project", overview: "Overview text", overviewTitle: "About",
    content: "<p>Kelp body</p>", projectNote: "INTERNAL NOTE do not publish", projectStage: "IN_PROGRESS",
    status: "PUBLISHED", indexCategories: null, mediaKeys: JSON.stringify(["admin-media/kelp.png"]),
    publicPath: "research/kelp-study.html", publishedAt: "2026-10-02T00:00:00.000Z", revision: 3, ...overrides
  };
}
function profile(overrides = {}) {
  return {
    id: ID(3), sectionKey: "about", title: "About", content: "<p>Bio</p>", summary: "Short", status: "PUBLISHED",
    sortOrder: 1, publishedAt: "2026-10-03T00:00:00.000Z", revision: 2, ...overrides
  };
}
const build = (input) => buildManifest(input, { generatedAt: GENERATED_AT });
const serialized = (value) => JSON.stringify(value);

// 1. Sanitization of HTML
{
  const dirty = `<p onclick="x()">Hi <a href="javascript:alert(1)">bad</a> <a href="https://ok.example/x" target="_blank" onmouseover="y()">ok</a></p>
    <script>alert(1)</script><style>p{}</style><iframe src="https://evil"></iframe><img src=x onerror=alert(1)>
    <svg><script>alert(2)</script></svg><form><input></form><!-- comment --><h2 style="color:red">Heading</h2>
    <figure><img src="data:image/png;base64,AAAA"><figcaption>cap</figcaption></figure><div><span>kept text</span></div>`;
  const { html, stats } = sanitizeHtml(dirty);
  for (const bad of ["<script", "onclick", "onerror", "onmouseover", "javascript:", "<iframe", "<style", "<img", "<svg", "<form", "<!--", "style=", "target=", "<div", "<figure", "alert("]) {
    assert.ok(!html.includes(bad), `sanitized output still contains ${bad}: ${html}`);
  }
  assert.ok(html.includes("<h2>Heading</h2>"));
  assert.ok(html.includes("kept text"));
  assert.ok(html.includes('<a href="https://ok.example/x" rel="noopener noreferrer">ok</a>'));
  assert.ok(html.includes("bad")); // unsafe link keeps its text, loses the link
  assert.ok(stats.removedMedia >= 2 && stats.removedLinks === 1);
  assert.equal(sanitizeHtml("").html, "");
  assert.equal(sanitizeHtml(null).html, "");
  // Text is escaped, not interpreted, and sanitizing twice changes nothing.
  assert.equal(sanitizeHtml("<p>1 &lt; 2 &amp; &lt;b&gt;</p>").html, "<p>1 &lt; 2 &amp; &lt;b&gt;</p>");
  assert.equal(sanitizeHtml(html).html, html);
  // Mutation-XSS style nesting
  const tricky = sanitizeHtml('<p><a href="java\tscript:alert(1)">x</a><noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript></p>').html;
  assert.ok(!/onerror|javascript|<img/i.test(tricky), tricky);
  pass("HTML sanitization removes scripts, handlers, unsafe links, media and unknown tags");
}

// 2. URL and text sanitization
{
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "//evil.example", "/\\evil.example", "https://user:pw@example.org", "java\nscript:x", "", null, 5, "file:///etc/passwd"]) {
    assert.equal(safeUrl(bad), null, `should reject ${bad}`);
  }
  assert.equal(safeUrl("https://example.org/a?b=1"), "https://example.org/a?b=1");
  assert.equal(safeUrl("mailto:a@example.org"), "mailto:a@example.org");
  assert.equal(safeUrl("/writing/x.html"), "/writing/x.html");
  assert.equal(safeUrl("#top"), "#top");
  assert.equal(cleanText("a\u0000b\u202Ec\u200Bd "), "abc\u200Bd");
  assert.equal(cleanText(undefined), "");
  pass("URL allowlist and control/bidi character stripping");
}

// 3. Draft and unpublished exclusion
{
  const records = [
    publication({ id: ID(10), status: "DRAFT", publicPath: "writing/a.html" }),
    publication({ id: ID(11), status: "IN_REVIEW", publicPath: "writing/b.html" }),
    publication({ id: ID(12), status: "APPROVED", publicPath: "writing/c.html" }),
    publication({ id: ID(13), status: undefined, publicPath: "writing/d.html" }),
    publication({ id: ID(14), status: "published", publicPath: "writing/e.html" }),
    publication({ id: ID(15), status: "UNKNOWN", publicPath: "writing/f.html" }),
    null
  ];
  const { manifest, excluded } = build({
    publications: records,
    researchProjects: [research({ id: ID(20), status: "DRAFT" }), research({ id: ID(21), status: "IN_REVIEW" })],
    profileContent: [profile({ id: ID(30), status: "DRAFT" }), profile({ id: ID(31), status: "APPROVED" })]
  });
  assert.equal(manifest.publications.length, 0);
  assert.equal(manifest.research.length, 0);
  assert.equal(manifest.profile.length, 0);
  assert.equal(excluded.length, records.length + 4);
  assert.ok(excluded.every((item) => item.reason));
  pass("draft, review, approved, unknown and malformed records are excluded");
}

// 4. Archived exclusion
{
  const { manifest, excluded } = build({
    publications: [
      publication({ id: ID(40), archived: true, publicPath: "writing/arch.html" }),
      publication({ id: ID(41), archived: "true", publicPath: "writing/arch2.html" }),
      publication({ id: ID(42), status: "ARCHIVED", archived: true, publicPath: "writing/arch3.html" }),
      publication({ id: ID(43), archived: null, publicPath: "writing/null-archived.html" })
    ],
    researchProjects: [research({ id: ID(44), status: "ARCHIVED" })]
  });
  assert.deepEqual(manifest.publications.map((item) => item.id), [ID(43)]);
  assert.equal(manifest.research.length, 0);
  assert.equal(excluded.filter((item) => item.reason === "archived").length, 2);
  assert.ok(excluded.some((item) => item.id === ID(44) && item.reason === "not published"));
  pass("archived records are excluded (fail closed on any non-false archived flag)");
}

// 5. Private fields never reach the manifest
{
  const { manifest } = build({ publications: [publication()], researchProjects: [research()], profileContent: [profile()] });
  const text = serialized(manifest);
  for (const secret of ["admin-media", "private-draft.docx", "INTERNAL NOTE", "someone", "revision", "mediaKeys", "sourceDocumentName", "projectNote", "importedCreatedAt", "owner"]) {
    assert.ok(!text.includes(secret), `manifest leaked ${secret}`);
  }
  for (const [section, allowed] of Object.entries(FIELD_ALLOWLISTS)) {
    for (const item of manifest[section]) {
      assert.deepEqual(Object.keys(item).sort(), [...allowed].sort(), `${section} keys must equal the allowlist`);
    }
  }
  for (const field of PRIVATE_FIELDS) {
    for (const allowed of Object.values(FIELD_ALLOWLISTS)) assert.ok(!allowed.includes(field), `${field} must not be allowlisted`);
  }
  // A field added to the database later stays private until allowlisted.
  const future = build({ publications: [publication({ newSecretField: "TOP SECRET" })] }).manifest;
  assert.ok(!serialized(future).includes("TOP SECRET"));
  pass("private and unknown source fields never appear in the manifest");
}

// 6. Manifest validation rejects tampered manifests
{
  const { manifest } = build({ publications: [publication()], researchProjects: [research()], profileContent: [profile()] });
  assert.deepEqual(validateManifest(manifest), { ok: true, errors: [] });
  const tamper = (mutate) => { const copy = structuredClone(manifest); mutate(copy); return validateManifest(copy); };
  assert.ok(!tamper((m) => { m.publications[0].status = "DRAFT"; }).ok);
  assert.ok(!tamper((m) => { m.publications[0].mediaKeys = ["admin-media/x"]; }).ok);
  assert.ok(!tamper((m) => { m.research[0].projectNote = "x"; }).ok);
  assert.ok(!tamper((m) => { m.publications[0].publicPath = "../evil.html"; }).ok);
  assert.ok(!tamper((m) => { m.publications[0].publicPath = "writing/../x.html"; }).ok);
  assert.ok(!tamper((m) => { m.publications[0].publicPath = "index.html"; }).ok);
  assert.ok(!tamper((m) => { m.publications[0].publicPath = "writing/template.html"; }).ok);
  assert.ok(!tamper((m) => { m.extra = []; }).ok);
  assert.ok(!tamper((m) => { m.schemaVersion = 2; }).ok);
  assert.ok(!tamper((m) => { m.publications.push(structuredClone(m.publications[0])); }).ok);
  assert.ok(!tamper((m) => { m.profile[0].nested = { owner: "x" }; }).ok);
  assert.ok(!validateManifest(null).ok);
  assert.ok(!validateManifest({ ...manifest, generatedAt: "invalid" }).ok);
  assert.throws(() => generateSite({ ...manifest, schemaVersion: 9 }), /Manifest rejected/);
  assert.throws(() => generateSite({ ...manifest, publications: [{ ...manifest.publications[0], revision: 1 }] }), /non-allowlisted|private field/);
  pass("generator and validator reject tampered or non-conforming manifests");
}

// 7. Public path rules and collisions
{
  assert.ok(isValidPublicPath("writing/good-slug-1.html", "writing"));
  for (const bad of ["writing/Bad.html", "writing/a b.html", "writing//x.html", "writing/x.htm", "research/x.html", "writing/-x.html", "writing/x-.html", "writing/index.html"]) {
    assert.ok(!isValidPublicPath(bad, "writing"), bad);
  }
  const derived = build({ publications: [publication({ publicPath: null, title: "Café: Notes & More!" })] }).manifest;
  assert.equal(derived.publications[0].publicPath, "writing/cafe-notes-more.html");
  const bad = build({ publications: [publication({ publicPath: "../../etc/passwd" })] });
  assert.equal(bad.manifest.publications.length, 0);
  assert.equal(bad.excluded[0].reason, "invalid public path");
  const clash = build({ publications: [publication({ id: ID(50) }), publication({ id: ID(51) })] });
  assert.equal(clash.manifest.publications.length, 0);
  assert.equal(clash.excluded.filter((item) => item.reason === "public path collision").length, 2);
  const rp = build({ publications: [publication({ category: "Research project", publicPath: "research/rp.html" })] });
  assert.equal(rp.manifest.publications.length, 1);
  const cross = build({
    publications: [publication({ category: "Research project", publicPath: "research/shared.html" })],
    researchProjects: [research({ publicPath: "research/shared.html" })]
  });
  assert.equal(cross.manifest.publications.length, 0);
  assert.equal(cross.manifest.research.length, 0);
  assert.equal(cross.excluded.filter((item) => item.reason === "public path collision").length, 2);
  const tampered = build({
    publications: [publication({ category: "Research project", publicPath: "research/shared.html" })],
    researchProjects: [research({ publicPath: "research/other.html" })]
  }).manifest;
  tampered.research[0].publicPath = "research/shared.html";
  assert.ok(!validateManifest(tampered).ok, "validation rejects cross-model path collisions");
  assert.throws(() => generateSite(tampered), /duplicates publicPath/);
  assert.equal(build({ publications: [publication({ category: "Research project", publicPath: "writing/rp.html" })] }).manifest.publications.length, 0);
  pass("public paths are validated, derived safely, and collisions are held back");
}

// 8. Required fields, media and unsupported formats
{
  const cases = [
    [{ title: "" }, "missing or oversized title"],
    [{ title: "x".repeat(301) }, "missing or oversized title"],
    [{ category: "Poem" }, "unsupported category"],
    [{ subtitle: null, summary: null }, "missing description"],
    [{ content: "<p><br></p>" }, "missing or oversized content"],
    [{ content: "<script>x</script>" }, "missing or oversized content"],
    [{ publishedAt: null }, "missing or invalid publishedAt"],
    [{ publishedAt: "not a date" }, "missing or invalid publishedAt"],
    [{ contentFormat: "PDF" }, "PDF publications need public media support (not available yet)"]
  ];
  for (const [override, reason] of cases) {
    const result = build({ publications: [publication(override)] });
    assert.equal(result.manifest.publications.length, 0, reason);
    assert.equal(result.excluded[0].reason, reason);
  }
  const withImage = build({ publications: [publication({ content: '<p>Text</p><figure><img src="admin-media/x.png"></figure>' })] });
  assert.equal(withImage.manifest.publications.length, 1);
  assert.ok(!serialized(withImage.manifest).includes("admin-media"));
  assert.equal(withImage.notes[0].note, "1 media element(s) removed");
  pass("required fields enforced; media is stripped and PDF publications are held back");
}

// 9. JSON fields: strings, parsed values, malformed values
{
  const strings = build({ publications: [publication()] }).manifest.publications[0];
  const parsed = build({ publications: [publication({
    indexCategories: [{ categoryId: "ecology", subjects: ["Intertidal zones"] }],
    references: [{ title: "A source", url: "https://example.org/a" }]
  })] }).manifest.publications[0];
  assert.deepEqual(strings.indexCategories, [{ categoryId: "ecology", subjects: ["Intertidal zones"] }]);
  assert.deepEqual(strings.indexCategories, parsed.indexCategories);
  assert.deepEqual(strings.references, parsed.references);
  const malformed = build({ publications: [publication({ indexCategories: "{not json", references: "oops" })] }).manifest.publications[0];
  assert.deepEqual(malformed.indexCategories, []);
  assert.deepEqual(malformed.references, []);
  const messy = build({ publications: [publication({
    indexCategories: JSON.stringify([{ id: "a b" }, { id: "ok", subjects: ["x", 5, "x", "<b>y</b>"] }, null, { id: "ok" }]),
    references: JSON.stringify([{ title: "Bad link", url: "javascript:alert(1)" }, { title: "" }, null, { title: "Fine" }])
  })] }).manifest.publications[0];
  assert.deepEqual(messy.indexCategories, [{ categoryId: "ok", subjects: ["x", "<b>y</b>"] }]);
  assert.deepEqual(messy.references, [{ title: "Bad link" }, { title: "Fine" }]);
  pass("JSON strings and parsed values normalize identically; malformed JSON is dropped safely");
}

// 10. Generated pages
{
  const { manifest } = build({
    publications: [publication({ title: 'Tide <script>alert(1)</script> "Pools"', subtitle: 'A "quoted" <b>desc</b>', content: '<p>Body <a href="javascript:alert(1)">x</a></p><script>bad()</script>' })],
    researchProjects: [research()]
  });
  const { files, report } = generateSite(manifest);
  const page = files.find((file) => file.path === "writing/tide-pools.html").content;
  assert.ok(page.includes(GENERATED_MARKER));
  assert.ok(!/<script>alert|onerror|javascript:/i.test(page));
  assert.ok(!page.includes("<b>desc</b>"));
  assert.ok(page.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(page.includes('<link rel="stylesheet" href="../styles.css">'));
  assert.ok(page.includes('<a href="https://example.org/a" rel="noopener noreferrer">A source</a>'));
  assert.ok(page.includes("<title>Tide &lt;script&gt;"));
  const researchPage = files.find((file) => file.path === "research/kelp-study.html").content;
  assert.ok(researchPage.includes("In progress") && researchPage.includes("Kelp body"));
  assert.ok(!researchPage.includes("INTERNAL NOTE") && !researchPage.includes("admin-media"));
  assert.equal(report.counts.pagesGenerated, 2);
  assert.equal(report.profileSections, 0);
  pass("generated pages escape metadata, embed only sanitized content and exclude private data");
}

// 11. Entries data file is compatible with the existing public Index
{
  const { manifest } = build({ publications: [publication(), publication({ id: ID(60), title: "Older", publicPath: "writing/older.html", publishedAt: "2025-03-01T00:00:00.000Z", category: "Field note", indexCategories: null, references: null })] });
  const { files } = generateSite(manifest);
  const data = files.find((file) => file.path === PUBLISHED_DATA_PATH).content;
  const scope = { window: {} };
  new Function("window", data)(scope.window);
  const entries = scope.window.NaturalInquiryPublishedEntries;
  assert.equal(entries.length, 2);
  assert.deepEqual(Object.keys(entries[0]).sort(), ["description", "filings", "id", "mediaFile", "title", "type", "url", "year"]);
  assert.equal(entries[0].url, "writing/tide-pools.html");
  assert.equal(entries[0].year, 2026);
  assert.equal(entries[0].type, "Essay");
  assert.deepEqual(entries[0].filings, [{ categoryId: "ecology", subjects: ["Intertidal zones"] }]);
  assert.equal(entries[1].type, "Notes");
  assert.equal(entries[1].year, 2025);
  const hostile = generateSite(build({ publications: [publication({ title: "</script><script>alert(1)</script>" })] }).manifest).files.find((file) => file.path === PUBLISHED_DATA_PATH).content;
  assert.ok(!hostile.includes("</script>") && !hostile.includes("<"));
  const empty = generateSite(build({}).manifest).files.find((file) => file.path === PUBLISHED_DATA_PATH).content;
  assert.equal(empty, "window.NaturalInquiryPublishedEntries = [];\n");
  pass("published-entries file matches the existing public format and is script-safe");
}

// 12. Existing hand-written pages are never overwritten; generated pages may be refreshed
{
  const { manifest } = build({ publications: [publication({ publicPath: "writing/seaweed-made-simple.html" }), publication({ id: ID(70), title: "New", publicPath: "writing/new.html" })] });
  const existing = { "writing/seaweed-made-simple.html": "<html>hand written</html>", "writing/new.html": `<!doctype html>\n${GENERATED_MARKER}\nold` };
  const { files, report } = generateSite(manifest, { readExisting: (path) => existing[path] ?? null });
  assert.ok(!files.some((file) => file.path === "writing/seaweed-made-simple.html"));
  assert.ok(files.some((file) => file.path === "writing/new.html"));
  assert.equal(report.skipped[0].reason, "protected existing page (not generated)");
  const entries = files.find((file) => file.path === PUBLISHED_DATA_PATH).content;
  assert.ok(!entries.includes("seaweed-made-simple") && entries.includes("writing/new.html"));
  pass("hand-written public pages are protected; previously generated pages can be regenerated");
}

// 13. Unpublish / archive / delete simply stop appearing
{
  const base = [publication(), publication({ id: ID(80), title: "Two", publicPath: "writing/two.html" })];
  const first = generateSite(build({ publications: base }).manifest).files.map((file) => file.path);
  assert.ok(first.includes("writing/two.html"));
  for (const change of [{ status: "DRAFT" }, { archived: true }]) {
    const next = generateSite(build({ publications: [base[0], { ...base[1], ...change }] }).manifest).files.map((file) => file.path);
    assert.ok(!next.includes("writing/two.html"));
  }
  const deleted = generateSite(build({ publications: [base[0]] }).manifest).files.map((file) => file.path);
  assert.ok(!deleted.includes("writing/two.html"));
  pass("unpublished, archived and deleted records disappear from the next generated site");
}

// 14. Profile content (manifest only) and ordering / determinism
{
  const { manifest } = build({
    profileContent: [profile({ id: ID(91), sectionKey: "b", sortOrder: 2 }), profile({ id: ID(92), sectionKey: "a", sortOrder: 1, content: "<p>x</p><script>y</script>" }), profile({ id: ID(93), sectionKey: "bad key!" })],
    publications: [publication({ id: ID(94), title: "Older", publicPath: "writing/older.html", publishedAt: "2025-01-01T00:00:00Z" }), publication()]
  });
  assert.deepEqual(manifest.profile.map((item) => item.sectionKey), ["a", "b"]);
  assert.ok(!manifest.profile[0].contentHtml.includes("script"));
  assert.deepEqual(manifest.publications.map((item) => item.title), ["Tide Pools", "Older"]);
  const again = build({ publications: [publication(), publication({ id: ID(94), title: "Older", publicPath: "writing/older.html", publishedAt: "2025-01-01T00:00:00Z" })], profileContent: [profile({ id: ID(92), sectionKey: "a", sortOrder: 1, content: "<p>x</p><script>y</script>" }), profile({ id: ID(91), sectionKey: "b", sortOrder: 2 })] }).manifest;
  assert.deepEqual(again, manifest);
  assert.equal(generateSite(manifest).report.profileSections, 2);
  assert.throws(() => buildManifest({}, { generatedAt: "nope" }), /generatedAt/);
  pass("profile sections are sanitized and ordered; output is deterministic");
}

// 15. Directory output: separate directory, path safety, no site files touched
{
  const dir = await mkdtemp(join(tmpdir(), "ni-publisher-"));
  try {
    const site = join(dir, "site");
    const out = join(dir, "out");
    await mkdir(join(site, "writing"), { recursive: true });
    await writeFile(join(site, "writing", "seaweed-made-simple.html"), "<html>original</html>");
    const { manifest } = build({ publications: [publication({ publicPath: "writing/seaweed-made-simple.html" }), publication({ id: ID(100), title: "Fresh", publicPath: "writing/fresh.html" })] });
    const manifestPath = join(dir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    const result = await generateToDirectory({ manifestPath, siteRoot: site, outDir: out });
    assert.ok(existsSync(join(out, "writing", "fresh.html")));
    assert.ok(existsSync(join(out, PUBLISHED_DATA_PATH)));
    assert.ok(!existsSync(join(out, "writing", "seaweed-made-simple.html")));
    assert.equal(await readFile(join(site, "writing", "seaweed-made-simple.html"), "utf8"), "<html>original</html>");
    assert.deepEqual((await readdir(site)).sort(), ["writing"]);
    assert.equal(result.report.skipped.length, 1);

    await assert.rejects(generateToDirectory({ manifestPath, siteRoot: site, outDir: site }), /Refusing to write into the site root/);

    const evil = structuredClone(manifest);
    evil.publications[1].publicPath = "writing/../../escape.html";
    await writeFile(manifestPath, JSON.stringify(evil));
    await assert.rejects(generateToDirectory({ manifestPath, siteRoot: site, outDir: out }), /Manifest rejected/);
    assert.ok(!existsSync(join(dir, "escape.html")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  pass("CLI writes to a separate directory, protects site files and rejects path escapes");
}

console.log(`\nAll ${n} site-publisher test groups passed.`);
