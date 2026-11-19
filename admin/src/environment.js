// Capabilities that depend on the local Vite dev server (`/__admin-api/*`) or development-only tools.
// These capabilities remain off in production.
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

// The read-only cloud check is available in production; other diagnostics remain development-only.
export function resolveToolRoute(hash, capabilities) {
  if (hash === "#cloud-check") return hash;
  return capabilities.diagnosticTools && TOOL_ROUTES.includes(hash) ? hash : null;
}

export const PRODUCTION_MESSAGES = {
  taxonomy: "Subject Index editing is temporarily available only in local development. Disciplines, topics and cloud publication filings are shown here read-only.",
  publishing: "Public-site publishing is not configured yet. Cloud publication status (Published, Draft, Archived) only changes your cloud workspace; it does not update the public website."
};

const capabilities = getCapabilities(typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.DEV : false);

export default capabilities;
