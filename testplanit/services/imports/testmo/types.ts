import type { Readable } from "node:stream";
import type { Access } from "@prisma/client";

export type TestmoReadableSource = string | URL | Readable | (() => Readable);

export interface TestmoDatasetSummary {
  name: string;
  rowCount: number;
  schema?: Record<string, unknown> | null;
  sampleRows: unknown[];
  allRows?: unknown[];
  truncated: boolean;
}

export interface TestmoExportSummaryMeta {
  totalDatasets: number;
  totalRows: number;
  durationMs: number;
  startedAt: Date;
  completedAt: Date;
  fileSizeBytes?: number;
}

export interface TestmoExportSummary {
  datasets: Record<string, TestmoDatasetSummary>;
  meta: TestmoExportSummaryMeta;
}

export interface TestmoExportAnalyzerOptions {
  sampleRowLimit?: number;
  preserveDatasets?: Set<string>;
  maxRowsToPreserve?: number;
  signal?: AbortSignal;
  onDatasetComplete?: (dataset: TestmoDatasetSummary) => void | Promise<void>;
  shouldAbort?: () => boolean;
}

export interface TestmoDatasetSummaryPayload {
  id: number;
  name: string;
  rowCount: number;
  sampleRowCount: number;
  truncated: boolean;
}

export interface TestmoDatasetDetailPayload {
  id: number;
  name: string;
  rowCount: number;
  sampleRowCount: number;
  truncated: boolean;
  schema: Record<string, unknown> | null;
  sampleRows: unknown[];
  allRows?: unknown[];
}

export interface TestmoAnalysisSummaryPayload {
  meta: {
    totalDatasets: number;
    totalRows: number;
    durationMs: number;
    startedAt: string;
    completedAt: string;
    fileName: string;
    fileSizeBytes: number;
  };
  datasets: TestmoDatasetSummaryPayload[];
  storage?: {
    key: string;
    bucket?: string;
  };
}

export type TestmoImportStatus =
  | "QUEUED"
  | "RUNNING"
  | "READY"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED";

export type TestmoImportPhase =
  | "UPLOADING"
  | "ANALYZING"
  | "CONFIGURING"
  | "IMPORTING"
  | "FINALIZING";

export interface TestmoImportJobPayload {
  id: string;
  status: TestmoImportStatus;
  statusMessage?: string | null;
  phase?: TestmoImportPhase | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  canceledAt?: string | null;
  originalFileName: string;
  originalFileSize?: number | null;
  storageKey: string;
  storageBucket?: string | null;
  totalDatasets?: number | null;
  processedDatasets?: number | null;
  totalRows?: string | number | null;
  processedRows?: string | number | null;
  durationMs?: number | null;
  error?: string | null;
  cancelRequested?: boolean;
  summary?: TestmoAnalysisSummaryPayload | null;
  datasets?: TestmoDatasetSummaryPayload[];
  processedCount?: number | null;
  errorCount?: number | null;
  skippedCount?: number | null;
  totalCount?: number | null;
  currentEntity?: string | null;
  estimatedTimeRemaining?: string | null;
  processingRate?: string | null;
  activityLog?: unknown[] | null;
  entityProgress?: Record<string, unknown> | null;
  options?: Record<string, unknown> | null;
  configuration?: Record<string, unknown> | null;
  analysis?: Record<string, unknown> | null;
  analysisGeneratedAt?: string | null;
  lastImportStartedAt?: string | null;
}

export interface TestmoMappingAnalysisSummary {
  projects: number;
  users: number;
  testCases: number;
  testRuns: number;
  sessions: number;
  workflows: number;
  statuses: number;
  roles: number;
  configurations: number;
  groups: number;
  templates: number;
  templateFields: number;
  customFields: number;
  milestoneTypes: number;
  integrations: number;
  issues: number;
}

export interface TestmoMappingAnalysis {
  summary: TestmoMappingAnalysisSummary;
  requiresConfiguration: boolean;
  warnings?: string[];
  ambiguousEntities?: {
    workflows: TestmoWorkflowSuggestion[];
    statuses: TestmoStatusSuggestion[];
    roles: TestmoRoleSuggestion[];
    configurations: TestmoConfigurationSuggestion[];
    milestoneTypes: TestmoMilestoneTypeSuggestion[];
    groups: TestmoGroupSuggestion[];
    tags: TestmoTagSuggestion[];
    issueTargets: TestmoIssueTargetSuggestion[];
    users: TestmoUserSuggestion[];
    templates: TestmoTemplateSuggestion[];
    templateFields: TestmoTemplateFieldSuggestion[];
  };
  existingEntities?: {
    workflows: TestmoExistingWorkflow[];
    statuses: TestmoExistingStatus[];
    roles: TestmoExistingRole[];
    configurationCategories: TestmoExistingConfigCategory[];
    configurationVariants: TestmoExistingConfigVariant[];
    configurations: TestmoExistingConfiguration[];
    milestoneTypes: TestmoExistingMilestoneType[];
    groups: TestmoExistingGroup[];
    tags: TestmoExistingTag[];
    issueTargets: TestmoExistingIntegration[];
    users: TestmoExistingUser[];
    caseFields: TestmoExistingCaseField[];
    resultFields: TestmoExistingResultField[];
    caseFieldTypes: TestmoCaseFieldType[];
    templates: TestmoExistingTemplate[];
  };
  preservedDatasets?: Record<string, unknown>;
}

export interface TestmoWorkflowSuggestion {
  id: number;
  name: string;
  suggestedWorkflowType?: string | null;
}

export interface TestmoStatusSuggestion {
  id: number;
  name: string;
  systemName?: string | null;
  isSuccess?: boolean;
  isFailure?: boolean;
  isCompleted?: boolean;
  isUntested?: boolean;
  colorHex?: string | null;
}

export interface TestmoGroupSuggestion {
  id: number;
  name: string;
  note?: string | null;
}

export interface TestmoTagSuggestion {
  id: number;
  name: string;
}

export interface TestmoIssueTargetSuggestion {
  id: number;
  name: string;
  type: number;
  provider?: string | null;
}

export interface TestmoUserSuggestion {
  id: number;
  email?: string | null;
  name?: string | null;
  isActive?: boolean;
  isApi?: boolean;
  access?: Access | null;
  roleName?: string | null;
}

export type TestmoTemplateFieldTargetType = "case" | "result";

export interface TestmoTemplateFieldSuggestion {
  id: number;
  fieldId?: number | null;
  templateId?: number | null;
  templateIds?: number[];
  templateName: string;
  templateNames?: string[];
  displayName?: string | null;
  systemName?: string | null;
  fieldType?: string | null;
  targetType: TestmoTemplateFieldTargetType;
  isRequired?: boolean;
  isRestricted?: boolean;
  hint?: string | null;
  defaultValue?: string | null;
  isChecked?: boolean | null;
  minValue?: number | null;
  maxValue?: number | null;
  minIntegerValue?: number | null;
  maxIntegerValue?: number | null;
  initialHeight?: number | null;
  dropdownOptions?: TestmoFieldOptionConfig[];
  order?: number | null;
}

export interface TestmoFieldOptionConfig {
  name: string;
  iconId?: number | null;
  iconColorId?: number | null;
  isEnabled?: boolean;
  isDefault?: boolean;
  order?: number | null;
}

export interface TestmoTemplateSuggestion {
  id: number;
  name: string;
  templateFieldIds: number[];
  caseTemplateFieldIds: number[];
  resultTemplateFieldIds: number[];
}

export interface TestmoExistingTemplateField {
  fieldId: number;
  systemName: string;
  displayName: string;
  order: number | null;
}

export interface TestmoExistingTemplate {
  id: number;
  name: string;
  caseFields: TestmoExistingTemplateField[];
  resultFields: TestmoExistingTemplateField[];
}

export interface TestmoRoleSuggestion {
  id: number;
  name: string;
  isDefault?: boolean;
  permissions?: TestmoRolePermissions;
}

export interface TestmoConfigurationSuggestion {
  id: number;
  name: string;
  variantTokens: string[];
}

export interface TestmoExistingWorkflow {
  id: number;
  name: string;
  workflowType?: string | null;
  scope?: string | null;
  order?: number;
}

export interface TestmoExistingStatus {
  id: number;
  name: string;
  systemName: string;
  colorHex?: string | null;
  colorId?: number | null;
  aliases?: string | null;
  isSuccess: boolean;
  isFailure: boolean;
  isCompleted: boolean;
  isEnabled: boolean;
  scopeIds?: number[];
}

export interface TestmoExistingGroup {
  id: number;
  name: string;
  note?: string | null;
}

export interface TestmoExistingTag {
  id: number;
  name: string;
}

export interface TestmoExistingIntegration {
  id: number;
  name: string;
  provider: string;
  status: string;
}

export interface TestmoExistingRole {
  id: number;
  name: string;
  isDefault: boolean;
  permissions: TestmoRolePermissions;
}

export interface TestmoExistingConfigCategory {
  id: number;
  name: string;
}

export interface TestmoExistingConfigVariant {
  id: number;
  name: string;
  categoryId: number;
  categoryName: string;
}

export interface TestmoExistingConfiguration {
  id: number;
  name: string;
  variantIds: number[];
}

export interface TestmoExistingUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  isApi: boolean;
  access: Access;
  roleId: number;
  roleName?: string | null;
}

export interface TestmoExistingCaseField {
  id: number;
  displayName: string;
  systemName: string;
  typeId: number;
  typeName: string;
  isRestricted: boolean;
}

export interface TestmoExistingResultField {
  id: number;
  displayName: string;
  systemName: string;
  typeId: number;
  typeName: string;
  isRestricted: boolean;
}

export interface TestmoCaseFieldType {
  id: number;
  type: string;
}

export interface TestmoMilestoneTypeSuggestion {
  id: number;
  name: string;
  iconName?: string | null;
  isDefault?: boolean;
}

export interface TestmoExistingMilestoneType {
  id: number;
  name: string;
  iconId?: number | null;
  iconName?: string | null;
  isDefault: boolean;
}

export type TestmoWorkflowAction = "map" | "create";
export type TestmoStatusAction = "map" | "create";
export type TestmoGroupAction = "map" | "create";
export type TestmoTagAction = "map" | "create";
export type TestmoRoleAction = "map" | "create";
export type TestmoMilestoneTypeAction = "map" | "create";
export type TestmoConfigurationAction = "map" | "create";
export type TestmoUserAction = "map" | "create";
export type TestmoTemplateAction = "map" | "create";
export type TestmoIssueTargetAction = "map" | "create";

export type TestmoConfigVariantAction =
  | "map-variant"
  | "create-variant-existing-category"
  | "create-category-variant";

export interface TestmoWorkflowMappingConfig {
  action: TestmoWorkflowAction;
  mappedTo?: number | null;
  workflowType?: string | null;
  name?: string | null;
  scope?: string | null;
  iconId?: number | null;
  colorId?: number | null;
}

export interface TestmoStatusMappingConfig {
  action: TestmoStatusAction;
  mappedTo?: number | null;
  name?: string;
  systemName?: string;
  colorHex?: string | null;
  colorId?: number | null;
  aliases?: string | null;
  isSuccess?: boolean;
  isFailure?: boolean;
  isCompleted?: boolean;
  isEnabled?: boolean;
  scopeIds?: number[];
}

export interface TestmoGroupMappingConfig {
  action: TestmoGroupAction;
  mappedTo?: number | null;
  name?: string;
  note?: string | null;
}

export interface TestmoTagMappingConfig {
  action: TestmoTagAction;
  mappedTo?: number | null;
  name?: string;
}

export interface TestmoIssueTargetMappingConfig {
  action: TestmoIssueTargetAction;
  mappedTo?: number | null;
  name?: string;
  provider?: string | null;
  testmoType?: number | null;
}

export interface TestmoUserMappingConfig {
  action: TestmoUserAction;
  mappedTo?: string | null;
  name?: string;
  email?: string;
  password?: string | null;
  access?: Access;
  roleId?: number | null;
  isActive?: boolean;
  isApi?: boolean;
}

export interface TestmoTemplateMappingConfig {
  action: TestmoTemplateAction;
  mappedTo?: number | null;
  name?: string;
}

export type TestmoTemplateFieldAction = "map" | "create";

export interface TestmoTemplateFieldMappingConfig {
  action: TestmoTemplateFieldAction;
  targetType: TestmoTemplateFieldTargetType;
  mappedTo?: number | null;
  displayName?: string;
  systemName?: string;
  typeId?: number | null;
  typeName?: string | null;
  hint?: string | null;
  isRequired?: boolean;
  isRestricted?: boolean;
  defaultValue?: string | null;
  isChecked?: boolean | null;
  minValue?: number | null;
  maxValue?: number | null;
  minIntegerValue?: number | null;
  maxIntegerValue?: number | null;
  initialHeight?: number | null;
  dropdownOptions?: TestmoFieldOptionConfig[];
  templateName?: string | null;
  order?: number | null;
}

export interface TestmoRolePermissionConfig {
  canAddEdit: boolean;
  canDelete: boolean;
  canClose: boolean;
}

export type TestmoRolePermissions = Record<string, TestmoRolePermissionConfig>;

export interface TestmoRoleMappingConfig {
  action: TestmoRoleAction;
  mappedTo?: number | null;
  name?: string;
  isDefault?: boolean;
  permissions?: TestmoRolePermissions;
}

export interface TestmoMilestoneTypeMappingConfig {
  action: TestmoMilestoneTypeAction;
  mappedTo?: number | null;
  name?: string;
  iconId?: number | null;
  isDefault?: boolean;
}

export interface TestmoConfigVariantMappingConfig {
  token: string;
  action: TestmoConfigVariantAction;
  mappedVariantId?: number | null;
  categoryId?: number | null;
  categoryName?: string | null;
  variantName?: string | null;
}

export interface TestmoConfigurationMappingConfig {
  action: TestmoConfigurationAction;
  mappedTo?: number | null;
  name?: string;
  variants: Record<number, TestmoConfigVariantMappingConfig>;
}

export interface TestmoMappingConfiguration {
  workflows: Record<number, TestmoWorkflowMappingConfig>;
  statuses: Record<number, TestmoStatusMappingConfig>;
  roles: Record<number, TestmoRoleMappingConfig>;
  milestoneTypes: Record<number, TestmoMilestoneTypeMappingConfig>;
  groups: Record<number, TestmoGroupMappingConfig>;
  tags: Record<number, TestmoTagMappingConfig>;
  users: Record<number, TestmoUserMappingConfig>;
  configurations: Record<number, TestmoConfigurationMappingConfig>;
  templateFields: Record<number, TestmoTemplateFieldMappingConfig>;
  templates: Record<number, TestmoTemplateMappingConfig>;
  customFields: Record<number, unknown>;
  issueTargets: Record<number, TestmoIssueTargetMappingConfig>;
}
