import type dynamicIconImports from "lucide-react/dynamicIconImports";

export type TrashIconName = keyof typeof dynamicIconImports;

export interface TrashItemTypeDisplay {
  // Matches the public item type served by /api/admin/trash/[itemType].
  name: string;
  translationKey: string;
  iconName: TrashIconName;
}

// One entry per soft-deletable model. A unit test checks this list against the
// schema-derived registry in app/api/admin/trash/itemTypes.ts, so a model that
// gains isDeleted/deletedAt without a row here fails the suite.
export const softDeletedItemTypes: TrashItemTypeDisplay[] = [
  {
    name: "Projects",
    translationKey: "common.fields.projects",
    iconName: "boxes",
  },
  {
    name: "Templates",
    translationKey: "common.fields.templates",
    iconName: "layout-template",
  },
  {
    name: "CaseFields",
    translationKey: "common.fields.caseFields",
    iconName: "layout-list",
  },
  {
    name: "ResultFields",
    translationKey: "common.fields.resultFields",
    iconName: "square-check",
  },
  {
    name: "FieldOptions",
    translationKey: "admin.trash.itemTypes.fieldOptions",
    iconName: "settings-2",
  },
  {
    name: "Workflows",
    translationKey: "common.labels.workflows",
    iconName: "workflow",
  },
  {
    name: "Status",
    translationKey: "common.labels.statuses",
    iconName: "circle-check-big",
  },
  {
    name: "Milestones",
    translationKey: "common.fields.milestones",
    iconName: "flag",
  },
  {
    name: "MilestoneTypes",
    translationKey: "common.fields.milestoneTypes",
    iconName: "milestone",
  },
  {
    name: "Configurations",
    translationKey: "common.fields.configurations",
    iconName: "combine",
  },
  {
    name: "ConfigCategories",
    translationKey: "admin.trash.itemTypes.configCategories",
    iconName: "layers-2",
  },
  {
    name: "ConfigVariants",
    translationKey: "admin.trash.itemTypes.configVariants",
    iconName: "component",
  },
  { name: "User", translationKey: "common.fields.users", iconName: "user" },
  { name: "Groups", translationKey: "common.fields.groups", iconName: "users" },
  { name: "Roles", translationKey: "common.labels.roles", iconName: "drama" },
  { name: "Tags", translationKey: "common.fields.tags", iconName: "tags" },
  { name: "Issues", translationKey: "common.fields.issues", iconName: "bug" },
  {
    name: "TestRuns",
    translationKey: "common.fields.testRuns",
    iconName: "play-circle",
  },
  {
    name: "TestRunCases",
    translationKey: "admin.trash.itemTypes.testRunCases",
    iconName: "list-checks",
  },
  {
    name: "TestRunCaseIteration",
    translationKey: "admin.trash.itemTypes.testRunCaseIterations",
    iconName: "iteration-cw",
  },
  {
    name: "TestRunCaseDataSetSnapshot",
    translationKey: "admin.trash.itemTypes.testRunCaseDataSetSnapshots",
    iconName: "database-backup",
  },
  {
    name: "TestRunResults",
    translationKey: "enums.ApplicationArea.TestRunResults",
    iconName: "clipboard-list",
  },
  {
    name: "TestRunStepResults",
    translationKey: "admin.trash.itemTypes.testRunStepResults",
    iconName: "list-todo",
  },
  {
    name: "Sessions",
    translationKey: "common.fields.sessions",
    iconName: "compass",
  },
  {
    name: "SessionResults",
    translationKey: "enums.ApplicationArea.SessionResults",
    iconName: "clipboard-check",
  },
  {
    name: "RepositoryFolders",
    translationKey: "admin.trash.itemTypes.repositoryFolders",
    iconName: "folder-open",
  },
  {
    name: "RepositoryCases",
    translationKey: "search.entityTypes.repositoryCase",
    iconName: "list-checks",
  },
  {
    name: "RepositoryCaseLink",
    translationKey: "admin.trash.itemTypes.repositoryCaseLinks",
    iconName: "link-2",
  },
  {
    name: "RepositoryCaseCodePin",
    translationKey: "repository.codePins.title",
    iconName: "pin",
  },
  {
    name: "RepositoryCaseVersions",
    translationKey: "admin.trash.itemTypes.repositoryCaseVersions",
    iconName: "history",
  },
  {
    name: "Steps",
    translationKey: "common.fields.steps",
    iconName: "list-ordered",
  },
  {
    name: "Attachments",
    translationKey: "common.fields.attachments",
    iconName: "paperclip",
  },
  {
    name: "Comment",
    translationKey: "comments.title",
    iconName: "message-square",
  },
  {
    name: "ReviewRequest",
    translationKey: "admin.trash.itemTypes.reviewRequests",
    iconName: "badge-check",
  },
  {
    name: "Notification",
    translationKey: "admin.trash.itemTypes.notifications",
    iconName: "bell",
  },
  {
    name: "ShareLink",
    translationKey: "admin.trash.itemTypes.shareLinks",
    iconName: "link",
  },
  {
    name: "Repositories",
    translationKey: "admin.trash.itemTypes.repositories",
    iconName: "book-open",
  },
  {
    name: "SharedStepGroup",
    translationKey: "admin.trash.itemTypes.sharedStepGroups",
    iconName: "share-2",
  },
  {
    name: "TestCaseParameter",
    translationKey: "admin.menu.testCaseParameters",
    iconName: "variable",
  },
  {
    name: "DataSet",
    translationKey: "admin.trash.itemTypes.dataSets",
    iconName: "database",
  },
  {
    name: "DataSetRow",
    translationKey: "admin.trash.itemTypes.dataSetRows",
    iconName: "rows-3",
  },
  {
    name: "ExecutionTarget",
    translationKey: "admin.trash.itemTypes.executionTargets",
    iconName: "target",
  },
  {
    name: "ImportMapping",
    translationKey: "admin.trash.itemTypes.importMappings",
    iconName: "file-input",
  },
  {
    name: "Integration",
    translationKey: "admin.menu.integrations",
    iconName: "plug",
  },
  {
    name: "LlmIntegration",
    translationKey: "common.pageTitles.aiModels",
    iconName: "sparkles",
  },
  {
    name: "PromptConfig",
    translationKey: "admin.menu.prompts",
    iconName: "message-square-code",
  },
  {
    name: "LlmReportSnapshot",
    translationKey: "admin.trash.itemTypes.llmReportSnapshots",
    iconName: "file-clock",
  },
  {
    name: "RequirementTraceabilitySnapshot",
    translationKey: "admin.trash.itemTypes.requirementTraceabilitySnapshots",
    iconName: "camera",
  },
  {
    name: "CaseExportTemplate",
    translationKey: "admin.menu.exportTemplates",
    iconName: "file-code",
  },
  {
    name: "CodeRepository",
    translationKey: "admin.menu.codeRepositories",
    iconName: "git-branch",
  },
  {
    name: "ImpactAnalysis",
    translationKey: "admin.trash.itemTypes.impactAnalyses",
    iconName: "radio",
  },
  {
    name: "DuplicateScanResult",
    translationKey: "admin.trash.itemTypes.duplicateScanResults",
    iconName: "copy-check",
  },
  {
    name: "StepSequenceMatch",
    translationKey: "admin.trash.itemTypes.stepSequenceMatches",
    iconName: "git-compare",
  },
  {
    name: "StepSequenceMatchCase",
    translationKey: "admin.trash.itemTypes.stepSequenceMatchCases",
    iconName: "list-tree",
  },
];
