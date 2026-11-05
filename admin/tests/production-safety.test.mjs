// Production-safety tests: capability flags, hash-route gating, and the rendered Subject Index and
// draft editor in production vs development mode. Components are loaded through Vite's SSR loader
// and rendered to static HTML. No IndexedDB, no AWS, no network.
// Run from admin/: node tests/production-safety.test.mjs
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PRODUCTION_MESSAGES,
  TOOL_ROUTES,
  getCapabilities,
  resolveToolRoute
} from "../src/environment.js";

let n = 0;
const pass = (name) => console.log(`${++n} ${name}: ok`);

const forbidden = [];
globalThis.fetch = (...args) => { forbidden.push(args[0]); throw new Error("unexpected network call"); };

// ---- 1. capability flags ---------------------------------------------------------------------------
{
  const prod = getCapabilities(false);
  const dev = getCapabilities(true);
  assert.deepEqual(prod, { taxonomyEditing: false, cloudFilingReconciliation: false, localPublishing: false, diagnosticTools: false });
  assert.deepEqual(dev, { taxonomyEditing: true, cloudFilingReconciliation: true, localPublishing: true, diagnosticTools: true });
  assert.deepEqual(getCapabilities(undefined), prod, "unknown environment fails closed");
  assert.deepEqual(getCapabilities(null), prod);
  pass("capabilities: everything local-only is off in production, on in development, closed when unknown");
}

// ---- 2. hash routes -----------------------------------------------------------------------------------
{
  const prod = getCapabilities(false);
  const dev = getCapabilities(true);
  assert.deepEqual(TOOL_ROUTES, ["#cloud-check", "#storage-diagnostic", "#migration-preview"]);
  for (const route of TOOL_ROUTES) {
    assert.equal(resolveToolRoute(route, prod), null, `${route} unavailable in production`);
    assert.equal(resolveToolRoute(route, dev), route, `${route} available in development`);
  }
  for (const odd of ["", "#", "#unknown", "#CLOUD-CHECK", "#cloud-check ", "#/cloud-check", "cloud-check"]) {
    assert.equal(resolveToolRoute(odd, prod), null);
    assert.equal(resolveToolRoute(odd, dev), null, `${JSON.stringify(odd)} is not a tool route`);
  }
  pass("hash routes: tools unreachable in production however the hash is typed; available in development");
}

// ---- 3. rendered components ------------------------------------------------------------------------------
const server = await createServer({
  configFile: false,
  root: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  appType: "custom",
  server: { middlewareMode: true },
  logLevel: "silent",
  plugins: [(await import("@vitejs/plugin-react")).default()]
});

try {
  const { default: SubjectIndexWorkspace } = await server.ssrLoadModule("/src/SubjectIndexWorkspace.jsx");
  const { default: EntryEditor } = await server.ssrLoadModule("/src/EntryEditor.jsx");

  const categories = [
    { id: "biology", title: "Biology", subjects: ["Marine biology", "Genetics"] },
    { id: "earth", title: "Earth science", subjects: ["Geology"] }
  ];
  const publications = [
    { id: "p1", title: "Seaweed Made Simple", archived: false, indexCategories: [{ id: "biology", subjects: ["Marine biology"] }] },
    { id: "p2", title: "Stale filing", archived: false, indexCategories: [{ id: "biology", subjects: ["Gone topic"] }] }
  ];
  const render = (props) => renderToStaticMarkup(createElement(SubjectIndexWorkspace, {
    initialCategories: categories,
    publications,
    research: [{ id: "r1" }],
    cloudState: { publications: "ready", research: "ready" },
    onSave: async () => { throw new Error("save must not be reached"); },
    onReconcileCloud: () => { throw new Error("reconcile must not be reached"); },
    ...props
  }));

  const prodHtml = render({ editable: false, readOnlyNotice: PRODUCTION_MESSAGES.taxonomy });
  // Everything is still displayed...
  const text = (html) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "");
  for (const expected of ["Biology", "Earth science", "Seaweed Made Simple", "2 disciplines", "2 cloud publications filed here", "0 cloud publications filed here"]) {
    assert.ok(text(prodHtml).includes(expected), `production still shows: ${expected}`);
  }
  for (const value of ["Biology", "Earth science", "Marine biology", "Genetics", "Geology"]) {
    assert.ok(prodHtml.includes(`value="${value}"`), `production still shows editable-field value: ${value}`);
  }
  assert.ok(prodHtml.includes("temporarily available only in local development"), "explains why it is read-only");
  // ...but nothing can be edited or saved.
  assert.ok(/<button[^>]*disabled=""[^>]*>[^<]*(<svg.*?<\/svg>)?\s*Save Index/s.test(prodHtml), "Save Index disabled");
  assert.ok(!prodHtml.includes("Re-check cloud filings"), "no reconciliation control in production");
  const inputs = [...prodHtml.matchAll(/<input[^>]*aria-label="(?:Discipline name|Topic)[^>]*>/g)].map((m) => m[0]);
  assert.ok(inputs.length >= 5, "all discipline and topic inputs rendered");
  assert.ok(inputs.every((tag) => tag.includes('readOnly=""') || tag.includes("readonly")), "every discipline/topic input is read-only");
  assert.ok(/<form[^>]*subject-index-add-category[^>]*hidden/.test(prodHtml) || /<form[^>]*hidden[^>]*subject-index-add-category/.test(prodHtml), "add-discipline form hidden");
  assert.equal([...prodHtml.matchAll(/subject-index-delete[^>]*hidden/g)].length, 2, "remove-discipline hidden");
  assert.ok([...prodHtml.matchAll(/subject-index-topic-delete[^>]*hidden/g)].length >= 3, "remove-topic hidden");
  assert.ok([...prodHtml.matchAll(/<form[^>]*subject-index-add-topic[^>]*hidden/g)].length === 2 || [...prodHtml.matchAll(/<form[^>]*hidden[^>]*subject-index-add-topic/g)].length === 2, "add-topic forms hidden");
  assert.ok(!prodHtml.includes("local project"), "no local-project saving claims in production");

  const devHtml = render({ editable: true });
  assert.ok(!devHtml.includes("temporarily available only in local development"));
  assert.ok(devHtml.includes("Re-check cloud filings"), "development keeps the reconcile control");
  assert.ok(!/readOnly=""/.test(devHtml), "development inputs are editable");
  assert.ok(!/subject-index-delete[^>]*hidden/.test(devHtml));
  assert.ok(!/<form[^>]*subject-index-add-category[^>]*hidden/.test(devHtml));
  pass("Subject Index: production is a read-only display with explanation; development editing preserved");

  // Draft editor: the public-publishing control.
  const draft = { id: "d1", mode: "write", category: "writing", categoryLabel: "Essay", title: "T", subtitle: "S", body: "B", indexCategories: [], updatedAt: "2026-01-01T00:00:00.000Z" };
  const editor = (extra) => renderToStaticMarkup(createElement(EntryEditor, {
    initialDraft: draft, taxonomy: categories, onClose() {}, onSave: async (d) => d, onDelete: async () => {},
    onReview: async () => { throw new Error("review must not be reached"); },
    onPublish: async () => { throw new Error("publish must not be reached"); },
    ...extra
  }));
  const prodEditor = editor({ publishingEnabled: false, publishingDisabledNotice: PRODUCTION_MESSAGES.publishing });
  assert.ok(/<button[^>]*button-publish-review[^>]*disabled=""|<button[^>]*disabled=""[^>]*button-publish-review/.test(prodEditor), "Review public changes disabled in production");
  assert.ok(prodEditor.includes("Public-site publishing is not configured yet"), "explains that publishing is not configured");
  assert.ok(!prodEditor.includes("Publishing writes only to this local project folder"));
  assert.ok(prodEditor.includes("Save draft"), "saving drafts still works in production");
  assert.ok(prodEditor.includes("Download metadata handoff"), "handoff download remains");

  const devEditor = editor({});
  assert.ok(!/<button[^>]*button-publish-review[^>]*disabled=""|<button[^>]*disabled=""[^>]*button-publish-review/.test(devEditor), "development keeps the review control enabled");
  assert.ok(devEditor.includes("Publishing writes only to this local project folder"));
  pass("draft editor: public-site publishing disabled and explained in production; development preserved");
} finally {
  await server.close();
}

// ---- 4. messages never conflate cloud status with public publishing ------------------------------------------
{
  assert.match(PRODUCTION_MESSAGES.publishing, /not configured yet/);
  assert.match(PRODUCTION_MESSAGES.publishing, /does not update the public website/);
  assert.match(PRODUCTION_MESSAGES.taxonomy, /local development/);
  pass("messages distinguish cloud status from public-site publishing");
}

assert.deepEqual(forbidden, [], "no network or local endpoint calls");
pass("no network or local endpoint calls");
console.log(`all ${n} test groups passed`);
