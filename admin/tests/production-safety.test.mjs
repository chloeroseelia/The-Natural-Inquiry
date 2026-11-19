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
  assert.equal(resolveToolRoute("#cloud-check", prod), "#cloud-check", "read-only cloud check available in production");
  for (const route of TOOL_ROUTES) {
    if (route !== "#cloud-check") assert.equal(resolveToolRoute(route, prod), null, `${route} unavailable in production`);
    assert.equal(resolveToolRoute(route, dev), route, `${route} available in development`);
  }
  for (const odd of ["", "#", "#unknown", "#CLOUD-CHECK", "#cloud-check ", "#/cloud-check", "cloud-check"]) {
    assert.equal(resolveToolRoute(odd, prod), null);
    assert.equal(resolveToolRoute(odd, dev), null, `${JSON.stringify(odd)} is not a tool route`);
  }
  pass("hash routes: only cloud check available in production; all tools available in development");
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
  const { default: WorkspaceStatus } = await server.ssrLoadModule("/src/WorkspaceStatus.jsx");
  const { default: CloudConnectivityCheck } = await server.ssrLoadModule("/src/CloudConnectivityCheck.jsx");
  const { default: PublishReview, requestPublishReview } = await server.ssrLoadModule("/src/PublishReview.jsx");

  const reviewResult = {
    dryRun: true, wrote: false, reviewDigest: "a".repeat(64),
    manifest: { publications: [{ id: "p1", title: "Test", contentHtml: "<p>Public text</p>" }], research: [], profile: [] },
    changes: { added: [], removed: [], changed: [] }, excluded: [], notes: [], warnings: []
  };
  const calls = [];
  const fakeClient = { mutations: { publishSite: async (input) => { calls.push(input); return { data: JSON.stringify(reviewResult) }; } } };
  assert.deepEqual(await requestPublishReview(fakeClient), reviewResult);
  assert.deepEqual(calls, [{ dryRun: true }], "review only invokes dry-run");
  const doubleEncoded = { mutations: { publishSite: async () => ({ data: JSON.stringify(JSON.stringify(reviewResult)) }) } };
  assert.deepEqual(await requestPublishReview(doubleEncoded), reviewResult, "a twice-encoded AWSJSON review is unwrapped");
  const tripleEncoded = { mutations: { publishSite: async () => ({ data: JSON.stringify(JSON.stringify(JSON.stringify(reviewResult))) }) } };
  await assert.rejects(requestPublishReview(tripleEncoded), /invalid review/, "no more than two layers are unwrapped");
  await assert.rejects(requestPublishReview({ mutations: { publishSite: async () => ({ data: { ...reviewResult, warnings: undefined } }) } }), /incomplete review \(warnings\)/, "names the malformed field");
  await assert.rejects(requestPublishReview({ mutations: {} }), /not configured/);
  await assert.rejects(requestPublishReview({ mutations: { publishSite: async () => ({ errors: [{ message: "denied" }] }) } }), /denied/);
  await assert.rejects(requestPublishReview({ mutations: { publishSite: async () => ({ data: "not json" }) } }), /invalid review/);
  await assert.rejects(requestPublishReview({ mutations: { publishSite: async () => ({ data: { ...reviewResult, wrote: true } }) } }), /incomplete review/);
  const reviewHtml = renderToStaticMarkup(createElement(PublishReview));
  assert.match(reviewHtml, /Review changes/);
  assert.match(reviewHtml, /PDF uploads, images and the Profile page/);
  assert.doesNotMatch(reviewHtml, /Publish to website/, "no publish button before a review exists");
  pass("publishing review requests only dry-run and rejects failed or incomplete results");

  const { requestPublish, describePublishResult } = await server.ssrLoadModule("/src/PublishReview.jsx");
  const publishResult = { dryRun: false, wrote: true, siteUpdate: { status: "dispatched" } };
  const publishCalls = [];
  const publishClient = { mutations: { publishSite: async (input) => { publishCalls.push(input); return { data: JSON.stringify(publishResult) }; } } };
  assert.deepEqual(await requestPublish("b".repeat(64), publishClient), publishResult);
  assert.deepEqual(publishCalls, [{ dryRun: false, reviewDigest: "b".repeat(64) }], "publish sends exactly the reviewed digest");
  await assert.rejects(requestPublish(undefined, publishClient), /Run a review/);
  await assert.rejects(requestPublish("not-a-digest", publishClient), /Run a review/);
  assert.equal(publishCalls.length, 1, "no request is sent without a valid review digest");
  await assert.rejects(requestPublish("b".repeat(64), { mutations: { publishSite: async () => ({ errors: [{ message: "Content or the public manifest changed since review. Review again; nothing was changed." }] }) } }), /Review again/);
  await assert.rejects(requestPublish("b".repeat(64), { mutations: { publishSite: async () => ({ data: { dryRun: true, wrote: false, siteUpdate: { status: "dispatched" } } }) } }), /incomplete response/);
  assert.equal(describePublishResult(publishResult).tone, "success");
  assert.match(describePublishResult({ ...publishResult, siteUpdate: { status: "not-configured", reason: "The GitHub dispatch token has not been set up yet." } }).title, /not updated/);
  assert.match(describePublishResult({ ...publishResult, siteUpdate: { status: "failed", reason: "GitHub rejected the workflow request (HTTP 403)." } }).detail, /HTTP 403/);
  pass("publishing sends only a reviewed digest and reports dispatched, unconfigured and failed site updates");

  const checkHtml = renderToStaticMarkup(createElement(CloudConnectivityCheck, { onClose() {} }));
  for (const expected of ["Cloud connectivity check", "read-only", "Publication", "ResearchProject", "ProfileContent", "Run read-only check", "Back to dashboard"]) {
    assert.ok(checkHtml.includes(expected), `cloud check shows ${expected}`);
  }
  pass("cloud check renders all three models and requires an explicit read-only check");

  const ready = { state: "ready", message: "" };
  const statusHtml = (cloudStatus) => renderToStaticMarkup(createElement(WorkspaceStatus, { cloudStatus }));
  const statuses = { publications: ready, research: ready, profile: ready };
  assert.match(statusHtml(statuses), /Cloud workspace/);
  assert.match(statusHtml(statuses), /Cloud content; drafts local/);
  assert.match(statusHtml({ ...statuses, profile: { state: "loading" } }), /Loading cloud content/);
  assert.match(statusHtml({ ...statuses, research: { state: "error" }, profile: { state: "loading" } }), /Some cloud content unavailable/);
  assert.match(statusHtml({ ...statuses, publications: { state: "ready", message: "mapping issues" } }), /Cloud content needs review/);
  assert.match(statusHtml({ publications: ready }), /Cloud status unavailable/);
  assert.doesNotMatch(statusHtml(statuses), /Local workspace|Stored in this browser/);
  pass("workspace status: cloud loading, failures, mapping issues, and local drafts are distinguished");

  const previousWindow = globalThis.window;
  try {
    globalThis.window = { navigator: { onLine: true }, addEventListener() {}, removeEventListener() {} };
    const { default: App } = await server.ssrLoadModule("/src/App.jsx");
    const appHtml = renderToStaticMarkup(createElement(App, { user: {}, onSignOut() {} }));
    assert.match(appHtml, /Cloud workspace/);
    assert.match(appHtml, /Loading cloud content/);
    assert.doesNotMatch(appHtml, /Local workspace|Stored in this browser/);
    assert.match(appHtml, /Drafts saved in this browser/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  pass("dashboard renders the cloud status and identifies local drafts");

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
  assert.ok(prodEditor.includes("not backed up to the cloud"), "local drafts are not presented as cloud-backed");
  assert.ok(!prodEditor.includes("no sign-in"), "draft notice does not deny dashboard authentication");
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
