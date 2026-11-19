const CLOUD_SECTIONS = ["publications", "research", "profile"];

export function workspaceStatusMessage(cloudStatus) {
  const sections = CLOUD_SECTIONS.map((key) => cloudStatus?.[key]);
  if (sections.some((section) => section?.state === "error")) return "Some cloud content unavailable";
  if (sections.some((section) => section?.state === "loading")) return "Loading cloud content...";
  if (sections.some((section) => section?.state !== "ready")) return "Cloud status unavailable";
  if (sections.some((section) => section.message)) return "Cloud content needs review";
  return "Cloud content; drafts local";
}

export default function WorkspaceStatus({ cloudStatus, icon }) {
  return (
    <div className="workspace-status" role="status">
      <span className="status-mark">{icon}</span>
      <span>
        <strong>Cloud workspace</strong>
        <small>{workspaceStatusMessage(cloudStatus)}</small>
      </span>
    </div>
  );
}
