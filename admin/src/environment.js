// Capabilities that depend on the local Vite dev server (`/__admin-api/*`) or on temporary tools.
// Those endpoints do not exist in a hosted build, so everything that needs them is off in production.
// Cloud-backed editing (Publications, Research, Profile) is unaffected by these flags.

export function getCapabilities(isDevelopment) {
  const dev = Boolean(isDevelopment);
  return {
    taxonomyEditing: dev,
    cloudFilingReconciliation: dev,
    localPublishing: dev,
    diagnosticTools: dev
  };
}

export const TOOL_ROUTES = ["#cloud-check", "#storage-diagnostic", "#migration-preview"];

// Returns the tool route to render, or null. In production no route is ever returned.
export function resolveToolRoute(hash, capabilities) {
  return capabilities.diagnosticTools && TOOL_ROUTES.includes(hash) ? hash : null;
}

export const PRODUCTION_MESSAGES = {
  taxonomy: "Subject Index editing is temporarily available only in local development. Disciplines, topics and cloud publication filings are shown here read-only.",
  publishing: "Public-site publishing is not configured yet. Cloud publication status (Published, Draft, Archived) only changes your cloud workspace; it does not update the public website."
};

const capabilities = getCapabilities(typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.DEV : false);

export default capabilities;
