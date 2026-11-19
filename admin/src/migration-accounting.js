export const MIGRATION_STAGES = [
  { id: "stage1", label: "Stage 1: Profile content and Research projects", models: ["ProfileContent", "ResearchProject"] },
  { id: "stage2", label: "Stage 2: Publications", models: ["Publication"] }
];

function isBlocked(record) {
  return record.category === "oversized" || record.blockers.length > 0;
}

function summarizeModels(models, selectedModels) {
  const entries = models.filter((model) => selectedModels.includes(model.model));
  const records = entries.flatMap((model) => model.records);
  const excluded = entries.reduce((sum, model) => sum + model.skipped.length, 0);
  const blocked = records.filter(isBlocked).length;
  const eligible = records.filter((record) =>
    !isBlocked(record) && (record.category === "new" || record.category === "identical")
  ).length;
  const willCreate = records.filter((record) =>
    record.category === "new" && !isBlocked(record)
  ).length;
  const conflicts = records.filter((record) => record.category === "conflict").length;
  const sourceRecords = entries.reduce((sum, model) => sum + (model.sourceCount ?? model.records.length + model.skipped.length), 0);
  const unavailable = Math.max(0, sourceRecords - records.length - excluded);

  return {
    sourceRecords,
    migrationInputs: sourceRecords - excluded,
    eligible,
    excluded,
    blocked,
    conflicts,
    willCreate,
    unavailable
  };
}

export function summarizeMigrationAccounting(storeCounts, models) {
  const overall = summarizeModels(models, ["ProfileContent", "ResearchProject", "Publication"]);
  const stages = Object.fromEntries(MIGRATION_STAGES.map((stage) => [
    stage.id,
    { ...stage, ...summarizeModels(models, stage.models) }
  ]));

  return {
    stores: {
      publications: storeCounts.publications ?? 0,
      research: storeCounts.research ?? 0,
      profile: storeCounts.profile ?? 0,
      drafts: storeCounts.drafts ?? 0,
      metadata: storeCounts.metadata ?? 0
    },
    migrationStores: {
      publications: storeCounts.publications ?? 0,
      research: storeCounts.research ?? 0,
      profile: storeCounts.profile ?? 0
    },
    overall,
    stages
  };
}
