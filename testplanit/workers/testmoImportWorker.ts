import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  Access,
  ApplicationArea,
  WorkflowScope,
  WorkflowType,
} from "~/zenstack/models";
import type { TestmoImportJob } from "~/zenstack/models";
import { JsonNull } from "@zenstackhq/orm";
import type { JsonObject, JsonValue } from "@zenstackhq/orm";
import type { DbClient, TxClient } from "~/lib/zenstack";
import type {
  StepsUncheckedCreateInput,
  TestRunCasesUncheckedCreateInput,
  TestmoImportJobUpdateArgs,
} from "~/zenstack/input";
import { getSchema } from "@tiptap/core";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import bcrypt from "bcrypt";
import { Job, Worker } from "bullmq";
import { Window as HappyDOMWindow } from "happy-dom";
import { Readable } from "node:stream";
import { emptyEditorContent } from "../app/constants/backend";
import {
  disconnectAllTenantClients,
  getDbClientForJob,
  isMultiTenantMode,
  validateMultiTenantJobData,
  type MultiTenantJobData,
} from "../lib/multiTenantDb";
import { runWithAuditContext } from "../lib/auditContext";
import {
  enqueueWithAuditContext,
  type ActorContextJobData,
} from "../lib/auditContextEnqueue";
import {
  getElasticsearchReindexQueue,
  TESTMO_IMPORT_QUEUE_NAME,
} from "../lib/queues";
import { captureAuditEvent } from "../lib/services/auditLog";
import { resolveCreateStateRemap } from "../lib/services/reviewGate";
import { createTestCaseVersionInTransaction } from "../lib/services/testCaseVersionService.js";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";
import {
  normalizeMappingConfiguration,
  serializeMappingConfiguration,
} from "../services/imports/testmo/configuration";
import { analyzeTestmoExport } from "../services/imports/testmo/TestmoExportAnalyzer";
import type {
  TestmoDatasetSummary,
  TestmoMappingConfiguration,
} from "../services/imports/testmo/types";
import { generateRandomPassword } from "../utils/randomPassword";
import type { ReindexJobData } from "./elasticsearchReindexWorker";
import {
  clearAutomationImportCaches,
  importAutomationCases,
  importAutomationRunFields,
  importAutomationRunLinks,
  importAutomationRuns,
  importAutomationRunTags,
  importAutomationRunTestFields,
  importAutomationRunTests,
} from "./testmoImport/automationImports";
import {
  assignImportedConfigurationsToProjects,
  importConfigurations,
  importGroups,
  importMilestoneTypes,
  importRoles,
  importTags,
  importUserGroups,
  importWorkflows,
} from "./testmoImport/configurationImports";
import {
  buildNumberIdMap,
  buildStringIdMap,
  buildTemplateFieldMaps,
  createWorkflowResolver,
  resolveUserId,
  toBooleanValue,
  toDateValue,
  toInputJsonValue,
  toNumberValue,
  toStringValue,
} from "./testmoImport/helpers";
import {
  createProjectIntegrations,
  importIssues,
  importIssueTargets,
  importMilestoneIssues,
  importRepositoryCaseIssues,
  importRunIssues,
  importRunResultIssues,
  importSessionIssues,
  importSessionResultIssues,
} from "./testmoImport/issueImports";
import {
  importMilestoneLinks,
  importProjectLinks,
  importRunLinks,
} from "./testmoImport/linkImports";
import {
  importRepositoryCaseTags,
  importRunTags,
  importSessionTags,
} from "./testmoImport/tagImports";
import {
  importTemplateFields,
  importTemplates,
} from "./testmoImport/templateImports";

// TODO(testmo-import): Remaining datasets to implement:
//
// IMPLEMENTED (32 datasets):
// - workflows, groups, roles, milestoneTypes, configurations, states, statuses
// - templates, template_fields
// - users, user_groups
// - projects, milestones
// - sessions, session_results, session_values
// - repositories, repository_folders, repository_cases, repository_case_values, repository_case_steps
// - runs, run_tests, run_results, run_result_steps
// - automation_cases, automation_runs, automation_run_tests, automation_run_fields,
// - automation_run_test_fields, automation_run_links, automation_run_tags
// - project_links, milestone_links, run_links
// - issue_targets, issues, repository_case_issues, run_issues, run_result_issues,
//   session_issues, session_result_issues
//
// SCHEMA LIMITATIONS:
// - milestone_issues: Milestones model doesn't have issues relation (skipped)
//
// AUTOMATION - Testmo automation run data:
// - automation_sources, automation_run_artifacts
// - automation_run_test_comments, automation_run_test_comment_issues
// - automation_run_test_artifacts, automation_run_threads, automation_run_thread_fields
// - automation_run_thread_artifacts
//
// COMMENTS (2 datasets) - Comments on test cases:
// - repository_case_comments
// - automation_run_test_comments (see automation above)
//
// TAGS
// - milestone_automation_tags

const projectNameCache = new Map<number, string>();
const templateNameCache = new Map<number, string>();
const workflowNameCache = new Map<number, string>();
const configurationNameCache = new Map<number, string>();
const milestoneNameCache = new Map<number, string>();
const userNameCache = new Map<string, string>();
const folderNameCache = new Map<number, string>();

const getProjectName = async (
  tx: TxClient,
  projectId: number
): Promise<string> => {
  if (projectNameCache.has(projectId)) {
    return projectNameCache.get(projectId)!;
  }

  const project = await tx.projects.findUnique({
    where: { id: projectId },
    select: { name: true },
  });

  const name = project?.name ?? `Project ${projectId}`;
  projectNameCache.set(projectId, name);
  return name;
};

const getTemplateName = async (
  tx: TxClient,
  templateId: number
): Promise<string> => {
  if (templateNameCache.has(templateId)) {
    return templateNameCache.get(templateId)!;
  }

  const template = await tx.templates.findUnique({
    where: { id: templateId },
    select: { templateName: true },
  });

  const name = template?.templateName ?? `Template ${templateId}`;
  templateNameCache.set(templateId, name);
  return name;
};

const getWorkflowName = async (
  tx: TxClient,
  workflowId: number
): Promise<string> => {
  if (workflowNameCache.has(workflowId)) {
    return workflowNameCache.get(workflowId)!;
  }

  const workflow = await tx.workflows.findUnique({
    where: { id: workflowId },
    select: { name: true },
  });

  const name = workflow?.name ?? `Workflow ${workflowId}`;
  workflowNameCache.set(workflowId, name);
  return name;
};

const getConfigurationName = async (
  tx: TxClient,
  configurationId: number
): Promise<string | null> => {
  if (configurationNameCache.has(configurationId)) {
    return configurationNameCache.get(configurationId)!;
  }

  const configuration = await tx.configurations.findUnique({
    where: { id: configurationId },
    select: { name: true },
  });

  const name = configuration?.name ?? null;
  if (name !== null) {
    configurationNameCache.set(configurationId, name);
  }
  return name;
};

const getMilestoneName = async (
  tx: TxClient,
  milestoneId: number
): Promise<string | null> => {
  if (milestoneNameCache.has(milestoneId)) {
    return milestoneNameCache.get(milestoneId)!;
  }

  const milestone = await tx.milestones.findUnique({
    where: { id: milestoneId },
    select: { name: true },
  });

  const name = milestone?.name ?? null;
  if (name !== null) {
    milestoneNameCache.set(milestoneId, name);
  }
  return name;
};

const getUserName = async (
  tx: TxClient,
  userId: string | null | undefined
): Promise<string> => {
  if (!userId) {
    return "Automation Import";
  }

  if (userNameCache.has(userId)) {
    return userNameCache.get(userId)!;
  }

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  const name = user?.name ?? userId;
  userNameCache.set(userId, name);
  return name;
};

const getFolderName = async (
  tx: TxClient,
  folderId: number
): Promise<string> => {
  if (folderNameCache.has(folderId)) {
    return folderNameCache.get(folderId)!;
  }

  const folder = await tx.repositoryFolders.findUnique({
    where: { id: folderId },
    select: { name: true },
  });

  const name = folder?.name ?? "";
  folderNameCache.set(folderId, name);
  return name;
};

const parseNumberEnv = (
  value: string | undefined,
  fallback: number
): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const IMPORT_TRANSACTION_TIMEOUT_MS = parseNumberEnv(
  process.env.TESTMO_IMPORT_TRANSACTION_TIMEOUT_MS,
  15 * 60 * 1000
);

const AUTOMATION_TRANSACTION_TIMEOUT_MS = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_TRANSACTION_TIMEOUT_MS,
  45 * 60 * 1000
);

const bucketName = process.env.AWS_BUCKET_NAME;

const s3Client = new S3Client({
  region: process.env.AWS_REGION || process.env.AWS_BUCKET_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  endpoint: process.env.AWS_PUBLIC_ENDPOINT_URL || process.env.AWS_ENDPOINT_URL,
  forcePathStyle: Boolean(process.env.AWS_ENDPOINT_URL),
  maxAttempts: 5, // Retry transient network errors
});

const FINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELED"]);

const _VALID_APPLICATION_AREAS = new Set<string>(
  Object.values(ApplicationArea)
);
const _VALID_WORKFLOW_TYPES = new Set<string>(Object.values(WorkflowType));
const _VALID_WORKFLOW_SCOPES = new Set<string>(Object.values(WorkflowScope));
const SYSTEM_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;
const DEFAULT_STATUS_COLOR_HEX = "#B1B2B3";
const MAX_INT_32 = 2_147_483_647;
const MIN_INT_32 = -2_147_483_648;

interface ActivitySummaryEntry {
  type: "summary";
  timestamp: string;
  entity: string;
  total: number;
  created: number;
  mapped: number;
  details?: Record<string, unknown>;
}

interface ActivityMessageEntry {
  type: "message";
  timestamp: string;
  message: string;
  details?: Record<string, unknown>;
}

type ActivityLogEntry = ActivitySummaryEntry | ActivityMessageEntry;

interface ImportContext {
  activityLog: ActivityLogEntry[];
  entityProgress: Record<
    string,
    { total: number; created: number; mapped: number }
  >;
  entityRates: Record<string, number>;
  processedCount: number;
  startTime: number;
  lastProgressUpdate: number;
  jobId: string;
  recentProgress: Array<{ timestamp: number; processedCount: number }>;
}

const currentTimestamp = () => new Date().toISOString();

type EntitySummaryResult = Omit<ActivitySummaryEntry, "type" | "timestamp">;

const createInitialContext = (jobId: string): ImportContext => ({
  activityLog: [],
  entityProgress: {},
  entityRates: {},
  processedCount: 0,
  startTime: Date.now(),
  lastProgressUpdate: Date.now(),
  jobId,
  recentProgress: [{ timestamp: Date.now(), processedCount: 0 }],
});

const logMessage = (
  context: ImportContext,
  message: string,
  details?: Record<string, unknown>
) => {
  context.activityLog.push({
    type: "message",
    timestamp: currentTimestamp(),
    message,
    ...(details ? { details } : {}),
  });
};

const recordEntitySummary = (
  context: ImportContext,
  summary: EntitySummaryResult
) => {
  const entry: ActivitySummaryEntry = {
    type: "summary",
    timestamp: currentTimestamp(),
    ...summary,
  };
  context.activityLog.push(entry);
  const existing = context.entityProgress[summary.entity];
  const processedTotal = summary.created + summary.mapped;
  if (existing) {
    const previousProcessed = existing.created + existing.mapped;
    existing.total = summary.total;
    existing.created = summary.created;
    existing.mapped = summary.mapped;
    const delta = processedTotal - previousProcessed;
    if (delta > 0) {
      context.processedCount += delta;
    }
  } else {
    context.entityProgress[summary.entity] = {
      total: summary.total,
      created: summary.created,
      mapped: summary.mapped,
    };
    context.processedCount += processedTotal;
  }
};

type PersistProgressFn = (
  entity: string | null,
  statusMessage?: string
) => Promise<void>;

const PROGRESS_UPDATE_INTERVAL = 500;

const REPOSITORY_CASE_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_REPOSITORY_CASE_CHUNK_SIZE,
  500
);

const TEST_RUN_CASE_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_TEST_RUN_CASE_CHUNK_SIZE,
  500
);

const AUTOMATION_CASE_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_CASE_CHUNK_SIZE,
  500
);

const AUTOMATION_RUN_TEST_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_RUN_TEST_CHUNK_SIZE,
  2000
);

const AUTOMATION_RUN_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_RUN_CHUNK_SIZE,
  500
);

const AUTOMATION_RUN_FIELD_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_RUN_FIELD_CHUNK_SIZE,
  500
);

const AUTOMATION_RUN_LINK_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_RUN_LINK_CHUNK_SIZE,
  500
);

const AUTOMATION_RUN_TEST_FIELD_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_RUN_TEST_FIELD_CHUNK_SIZE,
  500
);

const AUTOMATION_RUN_TAG_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_AUTOMATION_RUN_TAG_CHUNK_SIZE,
  500
);

const TEST_RUN_RESULT_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_TEST_RUN_RESULT_CHUNK_SIZE,
  2000
);

const ISSUE_RELATIONSHIP_CHUNK_SIZE = parseNumberEnv(
  process.env.TESTMO_ISSUE_RELATIONSHIP_CHUNK_SIZE,
  1000
);

const initializeEntityProgress = (
  context: ImportContext,
  entity: string,
  total: number
) => {
  if (total <= 0) {
    return;
  }
  const existing = context.entityProgress[entity];
  if (existing) {
    existing.total = total;
  } else {
    context.entityProgress[entity] = {
      total,
      created: 0,
      mapped: 0,
    };
  }
};

const incrementEntityProgress = (
  context: ImportContext,
  entity: string,
  createdIncrement = 0,
  mappedIncrement = 0
) => {
  const totalIncrement = createdIncrement + mappedIncrement;
  if (totalIncrement === 0) {
    return;
  }
  const entry =
    context.entityProgress[entity] ??
    (context.entityProgress[entity] = {
      total: totalIncrement,
      created: 0,
      mapped: 0,
    });
  entry.created += createdIncrement;
  entry.mapped += mappedIncrement;
  context.processedCount += totalIncrement;
};

const decrementEntityTotal = (context: ImportContext, entity: string) => {
  const entry = context.entityProgress[entity];
  if (entry && entry.total > 0) {
    entry.total -= 1;
  }
};

const formatInProgressStatus = (
  context: ImportContext,
  entity: string
): string | undefined => {
  const entry = context.entityProgress[entity];
  if (!entry) {
    return undefined;
  }
  const processed = entry.created + entry.mapped;
  return `${processed.toLocaleString()} / ${entry.total.toLocaleString()} processed`;
};

// Default rates (items/sec) based on observed import performance (v2, with batch size fix).
// Used for phases that haven't started yet to estimate remaining time.
const DEFAULT_ENTITY_RATES: Record<string, number> = {
  workflows: 1000,
  statuses: 1000,
  groups: 1300,
  tags: 2200,
  roles: 700,
  milestoneTypes: 1000,
  configurations: 170,
  templates: 350,
  templateFields: 135,
  users: 19,
  userGroups: 875,
  projects: 63,
  projectLinks: 59,
  milestones: 577,
  milestoneLinks: 10,
  sessions: 130,
  sessionResults: 660,
  sessionTags: 470,
  repositories: 180,
  repositoryFolders: 105,
  repositoryCases: 54,
  repositoryCaseTags: 3100,
  automationCases: 154,
  automationRuns: 459,
  automationRunTests: 498,
  automationRunFields: 1448,
  automationRunLinks: 1045,
  automationRunTestFields: 1073,
  automationRunTags: 271,
  sessionValues: 500,
  testRuns: 1019,
  runLinks: 500,
  testRunCases: 725,
  runTags: 381,
  testRunResults: 478,
  testRunStepResults: 42,
  issueTargets: 10,
  issues: 10,
  projectIntegrations: 100,
  milestoneIssues: 400,
  repositoryCaseIssues: 370,
  runIssues: 320,
  runResultIssues: 310,
  sessionIssues: 120,
  sessionResultIssues: 80,
};

const calculateProgressMetrics = (
  context: ImportContext,
  totalCount: number
): { estimatedTimeRemaining: string | null; processingRate: string | null } => {
  const now = Date.now();
  const elapsedMs = now - context.startTime;
  const elapsedSeconds = elapsedMs / 1000;

  // Don't calculate estimates until we have at least 2 seconds of data and some progress
  if (elapsedSeconds < 2 || context.processedCount === 0 || totalCount === 0) {
    return { estimatedTimeRemaining: null, processingRate: null };
  }

  const itemsPerSecond = getSmoothedProcessingRate(
    context,
    now,
    elapsedSeconds
  );

  // Calculate per-entity weighted ETA using observed and default rates
  let weightedRemainingSeconds = 0;
  let hasEntityData = false;

  for (const [entity, progress] of Object.entries(context.entityProgress)) {
    const remaining = Math.max(
      0,
      progress.total - progress.created - progress.mapped
    );
    if (remaining <= 0) continue;

    // Use the observed rate for the current entity if available,
    // otherwise fall back to default rates
    let entityRate: number;
    if (
      context.entityRates &&
      context.entityRates[entity] &&
      context.entityRates[entity] > 0
    ) {
      entityRate = context.entityRates[entity];
    } else {
      entityRate = DEFAULT_ENTITY_RATES[entity] ?? 100;
    }

    weightedRemainingSeconds += remaining / entityRate;
    hasEntityData = true;
  }

  // If we don't have entity-level data, fall back to overall rate
  if (!hasEntityData) {
    const remainingCount = totalCount - context.processedCount;
    weightedRemainingSeconds = remainingCount / itemsPerSecond;
  }

  // Format processing rate
  const processingRate =
    itemsPerSecond >= 1
      ? `${itemsPerSecond.toFixed(1)} items/sec`
      : `${(itemsPerSecond * 60).toFixed(1)} items/min`;

  // Format estimated time remaining (in seconds)
  const estimatedTimeRemaining = Math.ceil(weightedRemainingSeconds).toString();

  return { estimatedTimeRemaining, processingRate };
};

const MAX_RECENT_PROGRESS_ENTRIES = 60;
const RECENT_PROGRESS_WINDOW_MS = 60_000;
const EMA_ALPHA = 0.3;

const getSmoothedProcessingRate = (
  context: ImportContext,
  now: number,
  elapsedSeconds: number
): number => {
  const recent = context.recentProgress;
  const lastEntry = recent[recent.length - 1];
  if (
    lastEntry.timestamp !== now ||
    lastEntry.processedCount !== context.processedCount
  ) {
    recent.push({ timestamp: now, processedCount: context.processedCount });
  }

  while (
    recent.length > MAX_RECENT_PROGRESS_ENTRIES ||
    (recent.length > 1 && now - recent[1].timestamp > RECENT_PROGRESS_WINDOW_MS)
  ) {
    recent.shift();
  }

  if (recent.length < 2) {
    return context.processedCount / elapsedSeconds;
  }

  let smoothedRate = null;

  for (let i = 1; i < recent.length; i += 1) {
    const prev = recent[i - 1];
    const current = recent[i];
    if (current.timestamp <= prev.timestamp) {
      continue;
    }
    const deltaCount = current.processedCount - prev.processedCount;
    if (deltaCount <= 0) {
      continue;
    }
    const deltaSeconds = (current.timestamp - prev.timestamp) / 1000;
    if (deltaSeconds <= 0) {
      continue;
    }
    const instantaneousRate = deltaCount / deltaSeconds;
    if (Number.isFinite(instantaneousRate) && instantaneousRate > 0) {
      smoothedRate =
        smoothedRate === null
          ? instantaneousRate
          : EMA_ALPHA * instantaneousRate + (1 - EMA_ALPHA) * smoothedRate;
    }
  }

  if (smoothedRate === null || !Number.isFinite(smoothedRate)) {
    smoothedRate = context.processedCount / elapsedSeconds;
  }

  const totalRate = context.processedCount / elapsedSeconds;
  return Math.max(smoothedRate, totalRate * 0.2);
};

const computeEntityTotals = (
  configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  datasetRowCounts: Map<string, number>
): Map<string, number> => {
  const totals = new Map<string, number>();
  const countConfigEntries = (entries?: Record<number, unknown>) =>
    Object.values(entries ?? {}).filter(
      (entry) => entry !== undefined && entry !== null
    ).length;

  totals.set("workflows", countConfigEntries(configuration.workflows));
  totals.set("statuses", countConfigEntries(configuration.statuses));
  totals.set("groups", countConfigEntries(configuration.groups));
  totals.set("roles", countConfigEntries(configuration.roles));
  totals.set(
    "milestoneTypes",
    countConfigEntries(configuration.milestoneTypes)
  );
  totals.set(
    "configurations",
    countConfigEntries(configuration.configurations)
  );
  totals.set("templates", countConfigEntries(configuration.templates));
  totals.set(
    "templateFields",
    countConfigEntries(configuration.templateFields)
  );
  totals.set("tags", countConfigEntries(configuration.tags));
  totals.set("users", countConfigEntries(configuration.users));

  const datasetCount = (name: string) => datasetRowCounts.get(name) ?? 0;
  totals.set("userGroups", datasetCount("user_groups"));
  totals.set("projects", datasetCount("projects"));
  totals.set("milestones", datasetCount("milestones"));
  totals.set("sessions", datasetCount("sessions"));
  totals.set("sessionResults", datasetCount("session_results"));
  totals.set("repositories", datasetCount("repositories"));
  totals.set("repositoryFolders", datasetCount("repository_folders"));
  totals.set("repositoryCases", datasetCount("repository_cases"));
  totals.set("repositoryCaseTags", datasetCount("repository_case_tags"));
  totals.set("automationCases", datasetCount("automation_cases"));
  totals.set("automationRuns", datasetCount("automation_runs"));
  totals.set("automationRunTests", datasetCount("automation_run_tests"));
  totals.set("automationRunFields", datasetCount("automation_run_fields"));
  totals.set("automationRunLinks", datasetCount("automation_run_links"));
  totals.set(
    "automationRunTestFields",
    datasetCount("automation_run_test_fields")
  );
  totals.set("automationRunTags", datasetCount("automation_run_tags"));
  totals.set("testRuns", datasetCount("runs"));
  totals.set("testRunCases", datasetCount("run_tests"));
  totals.set("testRunResults", datasetCount("run_results"));
  totals.set("testRunStepResults", datasetCount("run_result_steps"));
  totals.set("runTags", datasetCount("run_tags"));
  totals.set("sessionTags", datasetCount("session_tags"));
  totals.set("issueTargets", datasetCount("issue_targets"));
  totals.set("issues", datasetCount("issues"));
  totals.set("milestoneIssues", datasetCount("milestone_issues"));
  totals.set("repositoryCaseIssues", datasetCount("repository_case_issues"));
  totals.set("runIssues", datasetCount("run_issues"));
  totals.set("runResultIssues", datasetCount("run_result_issues"));
  totals.set("sessionIssues", datasetCount("session_issues"));
  totals.set("sessionResultIssues", datasetCount("session_result_issues"));
  // ProjectIntegrations count is derived from issues dataset
  totals.set("projectIntegrations", 0); // Will be computed during import

  return totals;
};

const releaseDatasetRows = (
  datasetRows: Map<string, any[]>,
  ...names: string[]
) => {
  for (const name of names) {
    datasetRows.delete(name);
  }
};

const normalizeEstimate = (
  value: number | null
): {
  value: number | null;
  adjustment:
    "nanoseconds" | "microseconds" | "milliseconds" | "clamped" | null;
} => {
  if (value === null || !Number.isFinite(value)) {
    return { value: null, adjustment: null };
  }

  const rounded = Math.round(value);
  if (Math.abs(rounded) <= MAX_INT_32) {
    return { value: rounded, adjustment: null };
  }

  const scaleCandidates: Array<{
    factor: number;
    adjustment: "nanoseconds" | "microseconds" | "milliseconds";
  }> = [
    { factor: 1_000_000, adjustment: "microseconds" },
    { factor: 1_000_000_000, adjustment: "nanoseconds" },
    { factor: 1_000, adjustment: "milliseconds" },
  ];

  for (const candidate of scaleCandidates) {
    const scaled = Math.round(value / candidate.factor);
    if (Math.abs(scaled) <= MAX_INT_32) {
      return { value: scaled, adjustment: candidate.adjustment };
    }
  }

  return {
    value: value > 0 ? MAX_INT_32 : MIN_INT_32,
    adjustment: "clamped",
  };
};

const generateSystemName = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^[^a-z]+/, "");
  return normalized || "status";
};

const normalizeColorHex = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith("#")
    ? trimmed.toUpperCase()
    : `#${trimmed.toUpperCase()}`;
};

const isCanonicalRepository = (
  projectSourceId: number | null,
  repoSourceId: number | null,
  canonicalRepoIdByProject: Map<number, Set<number>>
): boolean => {
  if (repoSourceId === null) {
    return true;
  }

  if (projectSourceId === null) {
    return true;
  }

  const canonicalRepoIds = canonicalRepoIdByProject.get(projectSourceId);
  if (!canonicalRepoIds || canonicalRepoIds.size === 0) {
    return true;
  }

  return canonicalRepoIds.has(repoSourceId);
};

const getPreferredRepositoryId = (
  projectSourceId: number | null,
  repoSourceId: number | null,
  canonicalRepoIdByProject: Map<number, Set<number>>
): number | null => {
  if (projectSourceId === null) {
    return null;
  }

  const canonicalRepoIds = canonicalRepoIdByProject.get(projectSourceId);
  if (!canonicalRepoIds || canonicalRepoIds.size === 0) {
    return repoSourceId;
  }

  const iterator = canonicalRepoIds.values().next();
  const primaryRepoId = iterator.done ? null : (iterator.value ?? null);

  if (primaryRepoId === null) {
    return repoSourceId;
  }

  return primaryRepoId;
};

const TIPTAP_EXTENSIONS = [
  StarterKit.configure({
    dropcursor: false,
    gapcursor: false,
    undoRedo: false,
    trailingNode: false,
    heading: {
      levels: [1, 2, 3, 4],
    },
  }),
];

// Reusable Happy-DOM window to avoid creating new contexts for each conversion
// This dramatically reduces memory usage during large imports
let sharedHappyDOMWindow: HappyDOMWindow | null = null;
let sharedDOMParser: any = null; // Happy-DOM's DOMParser type differs from browser DOMParser
let conversionsSinceCleanup = 0;
const CLEANUP_INTERVAL = 1000; // Clean up and recreate window every N conversions

function getSharedHappyDOM() {
  if (
    !sharedHappyDOMWindow ||
    !sharedDOMParser ||
    conversionsSinceCleanup >= CLEANUP_INTERVAL
  ) {
    // Clean up old window if it exists
    if (sharedHappyDOMWindow) {
      try {
        sharedHappyDOMWindow.close();
      } catch {
        // Ignore cleanup errors
      }
    }

    sharedHappyDOMWindow = new HappyDOMWindow();
    sharedDOMParser = new sharedHappyDOMWindow.DOMParser();
    conversionsSinceCleanup = 0;
  }

  conversionsSinceCleanup++;
  return { window: sharedHappyDOMWindow!, parser: sharedDOMParser! };
}

// Custom generateJSON that reuses the same Happy-DOM window
function generateJSONOptimized(
  html: string,
  extensions: any[],
  options?: any
): Record<string, unknown> {
  const { parser } = getSharedHappyDOM();
  const schema = getSchema(extensions);

  const htmlString = `<!DOCTYPE html><html><body>${html}</body></html>`;
  const doc = parser.parseFromString(htmlString, "text/html");

  if (!doc) {
    throw new Error("Failed to parse HTML string");
  }

  return PMDOMParser.fromSchema(schema).parse(doc.body, options).toJSON();
}

interface CaseFieldMetadata {
  id: number;
  systemName: string;
  displayName: string;
  type: string;
  optionIds: Set<number>;
  optionsByName: Map<string, number>;
}

const isTipTapDocument = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const doc = value as { type?: unknown; content?: unknown };
  if (doc.type !== "doc") {
    return false;
  }
  if (!("content" in doc)) {
    return true;
  }
  return Array.isArray(doc.content);
};

const TIPTAP_CACHE_LIMIT = 100;
const tipTapConversionCache = new Map<string, Record<string, unknown>>();

const getCachedTipTapDocument = (
  key: string
): Record<string, unknown> | undefined => tipTapConversionCache.get(key);

const cacheTipTapDocument = (
  key: string,
  doc: Record<string, unknown>
): void => {
  if (tipTapConversionCache.has(key)) {
    tipTapConversionCache.set(key, doc);
    return;
  }
  if (tipTapConversionCache.size >= TIPTAP_CACHE_LIMIT) {
    tipTapConversionCache.clear();
  }
  tipTapConversionCache.set(key, doc);
};

const clearTipTapCache = () => tipTapConversionCache.clear();

const createParagraphDocument = (text: string): Record<string, unknown> => {
  const trimmed = text.trim();
  if (!trimmed) {
    return emptyEditorContent as Record<string, unknown>;
  }

  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text,
          },
        ],
      },
    ],
  } as Record<string, unknown>;

  return doc;
};

const convertToTipTapDocument = (
  value: unknown
): Record<string, unknown> | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (isTipTapDocument(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return emptyEditorContent as Record<string, unknown>;
    }

    const cachedDoc = getCachedTipTapDocument(trimmed);
    if (cachedDoc) {
      return cachedDoc;
    }

    let candidate: Record<string, unknown> | undefined;

    try {
      const parsed = JSON.parse(trimmed);
      if (isTipTapDocument(parsed)) {
        candidate = parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON
    }

    if (!candidate) {
      try {
        const generated = generateJSONOptimized(trimmed, TIPTAP_EXTENSIONS);
        if (isTipTapDocument(generated)) {
          candidate = generated as Record<string, unknown>;
        }
      } catch {
        // Continue with fallback
      }
    }

    if (!candidate) {
      candidate = createParagraphDocument(trimmed);
    }

    cacheTipTapDocument(trimmed, candidate);
    return candidate;
  }

  if (typeof value === "object") {
    try {
      const parsed = JSON.parse(JSON.stringify(value));
      if (isTipTapDocument(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore and fall back
    }
  }

  return createParagraphDocument(String(value));
};

const isTipTapDocumentEmpty = (doc: Record<string, unknown>): boolean => {
  const content = Array.isArray(doc.content) ? doc.content : [];
  if (content.length === 0) {
    return true;
  }

  if (content.length === 1) {
    const first = content[0] as { content?: unknown; text?: unknown };
    const children = Array.isArray(first?.content) ? first?.content : [];

    if (children.length === 0) {
      const text = typeof first?.text === "string" ? first.text.trim() : "";
      return text.length === 0;
    }

    if (children.length === 1) {
      const child = children[0] as { text?: unknown };
      if (typeof child?.text === "string" && child.text.trim().length === 0) {
        return true;
      }
    }
  }

  return false;
};

const convertToTipTapJsonValue = (value: unknown): JsonValue | null => {
  const doc = convertToTipTapDocument(value);
  if (!doc || isTipTapDocumentEmpty(doc)) {
    return null;
  }
  return doc as JsonValue;
};

const convertToTipTapJsonString = (value: unknown): string | null => {
  const doc = convertToTipTapDocument(value);
  if (!doc || isTipTapDocumentEmpty(doc)) {
    return null;
  }
  return JSON.stringify(doc);
};

const parseBooleanValue = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return ["1", "true", "yes", "y", "on"].includes(normalized);
  }
  return Boolean(value);
};

const parseIntegerValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
};

const parseFloatValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseDateValueToISOString = (value: unknown): string | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = [
    trimmed,
    trimmed.replace(/ /g, "T"),
    `${trimmed.replace(/ /g, "T")}Z`,
  ];

  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return null;
};

const normalizeDropdownValue = (
  value: unknown,
  metadata: CaseFieldMetadata,
  logWarning: (message: string, details: Record<string, unknown>) => void
): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && metadata.optionIds.has(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && metadata.optionIds.has(numeric)) {
      return numeric;
    }

    const optionIdByName = metadata.optionsByName.get(trimmed.toLowerCase());
    if (optionIdByName !== undefined) {
      return optionIdByName;
    }

    logWarning("Unrecognized dropdown option", {
      field: metadata.systemName,
      displayName: metadata.displayName,
      value,
      availableOptions: Array.from(metadata.optionsByName.keys()),
    });
    return null;
  }

  if (typeof value === "object") {
    const serialized = String(value);
    return normalizeDropdownValue(serialized, metadata, logWarning);
  }

  return null;
};

const convertToArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Not JSON, continue with splitting logic
    }

    return trimmed
      .split(/[;,|]/g)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [value];
};

const normalizeMultiSelectValue = (
  value: unknown,
  metadata: CaseFieldMetadata,
  logWarning: (message: string, details: Record<string, unknown>) => void
): number[] | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const entries = convertToArray(value);
  const optionIds: number[] = [];

  for (const entry of entries) {
    if (entry === null || entry === undefined || entry === "") {
      continue;
    }

    // Note: After resolving Testmo IDs to names in normalizeCaseFieldValue,
    // entries should be strings (option names), not numbers
    if (typeof entry === "number" && metadata.optionIds.has(entry)) {
      // This case handles if we already have TestPlanIt option IDs
      optionIds.push(entry);
      continue;
    }

    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }

      // Try to parse as number first (in case it's a TestPlanIt option ID as string)
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && metadata.optionIds.has(numeric)) {
        optionIds.push(numeric);
        continue;
      }

      // Look up by name (this is the main path after Testmo ID resolution)
      const optionIdByName = metadata.optionsByName.get(trimmed.toLowerCase());
      if (optionIdByName !== undefined) {
        optionIds.push(optionIdByName);
        continue;
      }

      logWarning("Unrecognized multi-select option", {
        field: metadata.systemName,
        displayName: metadata.displayName,
        value: trimmed,
        availableOptions: Array.from(metadata.optionsByName.keys()),
      });
      continue;
    }

    logWarning("Unsupported multi-select option value", {
      field: metadata.systemName,
      displayName: metadata.displayName,
      value: entry,
      entryType: typeof entry,
    });
  }

  return optionIds.length > 0 ? Array.from(new Set(optionIds)) : null;
};

const normalizeCaseFieldValue = (
  value: unknown,
  metadata: CaseFieldMetadata,
  logWarning: (message: string, details: Record<string, unknown>) => void,
  testmoFieldValueMap?: Map<number, { fieldId: number; name: string }>
): unknown => {
  if (value === null || value === undefined) {
    return null;
  }

  const fieldType = metadata.type.toLowerCase();

  if (fieldType.includes("text long") || fieldType.includes("text (long)")) {
    // Convert to TipTap JSON and then stringify it to match how AddCase.tsx stores it
    const jsonValue = convertToTipTapJsonValue(value);
    if (jsonValue === null) {
      return null;
    }
    // TODO: Refactor Long Text field storage throughout the application
    // Currently, the app stores TipTap JSON as stringified JSON in JSONB columns,
    // which is inefficient. We should store them as proper JSON objects instead.
    // This affects AddCase.tsx, RenderField.tsx, and many other components.
    // For now, we stringify to match existing behavior, but this should be fixed.
    return JSON.stringify(jsonValue);
  }

  if (fieldType.includes("text string") || fieldType === "string") {
    return String(value);
  }

  if (fieldType === "integer") {
    return parseIntegerValue(value);
  }

  if (fieldType === "number") {
    return parseFloatValue(value);
  }

  if (fieldType === "checkbox") {
    return parseBooleanValue(value);
  }

  if (fieldType === "dropdown") {
    // If value is a number and we have a Testmo field value map, try to resolve it
    // This includes Priority which uses field_value IDs just like other dropdowns
    if (typeof value === "number" && testmoFieldValueMap) {
      const testmoFieldValue = testmoFieldValueMap.get(value);
      if (testmoFieldValue) {
        // Use the name from the Testmo field value to lookup in TestPlanIt options
        const result = normalizeDropdownValue(
          testmoFieldValue.name,
          metadata,
          logWarning
        );
        return result;
      }
    }

    const result = normalizeDropdownValue(value, metadata, logWarning);
    return result;
  }

  const normalizedType = fieldType.replace(/\s+/g, "-");
  if (normalizedType === "multi-select") {
    // For multi-select, we need to handle arrays of Testmo field value IDs
    if (testmoFieldValueMap && testmoFieldValueMap.size > 0) {
      const processedValue = Array.isArray(value) ? value : [value];

      const resolvedValues = processedValue.map((v) => {
        if (typeof v === "number") {
          const testmoFieldValue = testmoFieldValueMap.get(v);
          if (testmoFieldValue) {
            return testmoFieldValue.name;
          } else {
            return v;
          }
        }
        return v;
      });

      const result = normalizeMultiSelectValue(
        resolvedValues,
        metadata,
        logWarning
      );
      return result;
    }

    const result = normalizeMultiSelectValue(value, metadata, logWarning);
    return result;
  }

  if (fieldType === "date") {
    return parseDateValueToISOString(value);
  }

  if (fieldType === "link") {
    return String(value);
  }

  if (fieldType === "steps") {
    // Steps are handled separately via repository_case_steps dataset
    return undefined;
  }

  return value;
};

async function importUsers(
  tx: TxClient,
  configuration: TestmoMappingConfiguration,
  importJob: TestmoImportJob
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "users",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const validAccessValues = new Set<string>(Object.values(Access));

  const resolveAccess = (value?: Access | null): Access => {
    if (value && validAccessValues.has(value)) {
      return value;
    }
    return Access.USER;
  };

  const ensureRoleExists = async (roleId: number): Promise<void> => {
    const role = await tx.roles.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new Error(`Role ${roleId} selected for a user does not exist.`);
    }
  };

  const resolveRoleId = async (
    configRoleId?: number | null
  ): Promise<number> => {
    if (configRoleId && Number.isFinite(configRoleId)) {
      await ensureRoleExists(configRoleId);
      return configRoleId;
    }

    const defaultRole = await tx.roles.findFirst({
      where: { isDefault: true },
    });
    if (!defaultRole) {
      throw new Error("No default role is configured. Unable to create users.");
    }
    return defaultRole.id;
  };

  for (const [key, config] of Object.entries(configuration.users ?? {})) {
    const userId = Number(key);
    if (!Number.isFinite(userId) || !config) {
      continue;
    }

    summary.total += 1;

    if (config.action === "map") {
      if (!config.mappedTo) {
        throw new Error(
          `User ${userId} is configured to map but no target user was provided.`
        );
      }

      const existing = await tx.user.findUnique({
        where: { id: config.mappedTo },
      });
      if (!existing) {
        throw new Error(
          `User ${config.mappedTo} selected for mapping was not found.`
        );
      }

      config.mappedTo = existing.id;
      summary.mapped += 1;
      continue;
    }

    const email = (config.email ?? "").trim().toLowerCase();
    if (!email) {
      throw new Error(
        `User ${userId} requires an email address before creation.`
      );
    }

    const existingByEmail = await tx.user.findUnique({ where: { email } });
    if (existingByEmail) {
      config.action = "map";
      config.mappedTo = existingByEmail.id;
      config.email = existingByEmail.email;
      config.name = existingByEmail.name;
      config.access = existingByEmail.access;
      config.roleId = existingByEmail.roleId;
      summary.mapped += 1;
      continue;
    }

    const name = (config.name ?? "").trim() || email;
    const access = resolveAccess(config.access ?? null);
    const roleId = await resolveRoleId(config.roleId ?? null);
    const isActive = config.isActive ?? true;
    const isApi = config.isApi ?? false;

    const password = config.password ?? generateRandomPassword();
    const hashedPassword = await bcrypt.hash(password, 10);

    const created = await tx.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        access,
        roleId,
        isActive,
        isApi,
        emailVerified: new Date(),
        createdById: importJob.createdById,
      },
    });

    config.action = "map";
    config.mappedTo = created.id;
    config.password = null;
    config.name = created.name;
    config.email = created.email;
    config.access = created.access;
    config.roleId = created.roleId;
    config.isActive = created.isActive;
    config.isApi = created.isApi;
    summary.created += 1;
  }

  return summary;
}

interface ProjectsImportResult {
  summary: EntitySummaryResult;
  projectIdMap: Map<number, number>;
  defaultTemplateIdByProject: Map<number, number | null>;
}

interface RepositoriesImportResult {
  summary: EntitySummaryResult;
  repositoryIdMap: Map<number, number>;
  canonicalRepoIdByProject: Map<number, Set<number>>;
  masterRepositoryIds: Set<number>;
}

interface RepositoryFoldersImportResult {
  summary: EntitySummaryResult;
  folderIdMap: Map<number, number>;
  repositoryRootFolderMap: Map<number, number>;
}

interface TestRunsImportResult {
  summary: EntitySummaryResult;
  testRunIdMap: Map<number, number>;
}

interface TestRunCasesImportResult {
  summary: EntitySummaryResult;
  testRunCaseIdMap: Map<number, number>;
}

interface RepositoryCasesImportResult {
  summary: EntitySummaryResult;
  caseIdMap: Map<number, number>;
  caseFieldMap: Map<string, number>;
  caseFieldMetadataById: Map<number, CaseFieldMetadata>;
  caseMetaMap: Map<number, { projectId: number; name: string }>;
  /** Maps "projectSourceId:key" → imported TestPlanIt case ID for key-based snapshot resolution */
  caseKeyMap: Map<string, number>;
}

interface MilestonesImportResult {
  summary: EntitySummaryResult;
  milestoneIdMap: Map<number, number>;
}

const importProjects = async (
  tx: TxClient,
  datasetRows: Map<string, any[]>,
  importJob: TestmoImportJob,
  userIdMap: Map<number, string>,
  statusIdMap: Map<number, number>,
  workflowIdMap: Map<number, number>,
  milestoneTypeIdMap: Map<number, number>,
  templateIdMap: Map<number, number>,
  templateMap: Map<string, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<ProjectsImportResult> => {
  const projectRows = datasetRows.get("projects") ?? [];
  const summary: EntitySummaryResult = {
    entity: "projects",
    total: 0,
    created: 0,
    mapped: 0,
  };
  const projectIdMap = new Map<number, number>();
  const defaultTemplateIdByProject = new Map<number, number | null>();

  if (projectRows.length === 0) {
    logMessage(context, "No projects dataset found; skipping project import.");
    return { summary, projectIdMap, defaultTemplateIdByProject };
  }

  initializeEntityProgress(context, "projects", projectRows.length);
  let processedSinceLastPersist = 0;

  const templateIdsToAssign = new Set<number>(templateIdMap.values());
  for (const templateId of templateMap.values()) {
    templateIdsToAssign.add(templateId);
  }

  const defaultTemplateRecord = await tx.templates.findFirst({
    where: {
      isDefault: true,
      isDeleted: false,
    },
    select: { id: true },
  });
  if (defaultTemplateRecord?.id) {
    templateIdsToAssign.add(defaultTemplateRecord.id);
  }

  const workflowIdsToAssign = new Set<number>(workflowIdMap.values());
  const defaultCaseWorkflow = await tx.workflows.findFirst({
    where: {
      isDefault: true,
      isDeleted: false,
      scope: WorkflowScope.CASES,
    },
    select: { id: true },
  });
  if (defaultCaseWorkflow?.id) {
    workflowIdsToAssign.add(defaultCaseWorkflow.id);
  }

  const milestoneTypeIdsToAssign = new Set<number>(milestoneTypeIdMap.values());
  const defaultMilestoneType = await tx.milestoneTypes.findFirst({
    where: {
      isDefault: true,
      isDeleted: false,
    },
    select: { id: true },
  });
  if (defaultMilestoneType?.id) {
    milestoneTypeIdsToAssign.add(defaultMilestoneType.id);
  }

  for (const row of projectRows) {
    const record = row as Record<string, unknown>;
    const sourceId = toNumberValue(record.id);
    if (sourceId === null) {
      continue;
    }

    const name = toStringValue(record.name) ?? `Imported Project ${sourceId}`;

    const existing = await tx.projects.findUnique({ where: { name } });

    let projectId: number;
    if (existing) {
      projectId = existing.id;
      projectIdMap.set(sourceId, projectId);
      summary.total += 1;
      summary.mapped += 1;
      incrementEntityProgress(context, "projects", 0, 1);
      processedSinceLastPersist += 1;
    } else {
      const createdBy = resolveUserId(
        userIdMap,
        importJob.createdById,
        record.created_by
      );
      const createdAt = toDateValue(record.created_at) ?? new Date();
      const completedAt = toDateValue(record.completed_at);
      const note = toStringValue(record.note);
      const docs = toStringValue(record.docs);
      const isCompleted = toBooleanValue(record.is_completed);

      const project = await tx.projects.create({
        data: {
          name,
          note: note ?? null,
          docs: docs ?? null,
          isCompleted,
          createdBy,
          createdAt,
          completedAt: completedAt ?? undefined,
        },
      });

      projectId = project.id;
      projectIdMap.set(sourceId, project.id);
      summary.total += 1;
      summary.created += 1;
      incrementEntityProgress(context, "projects", 1, 0);
      processedSinceLastPersist += 1;
    }

    if (statusIdMap.size > 0) {
      const statusAssignments = Array.from(statusIdMap.values()).map(
        (statusId) => ({
          projectId,
          statusId,
        })
      );
      await tx.projectStatusAssignment.createMany({
        data: statusAssignments,
        skipDuplicates: true,
      });
    }

    if (workflowIdsToAssign.size > 0) {
      const workflowAssignments = Array.from(workflowIdsToAssign).map(
        (workflowId) => ({
          projectId,
          workflowId,
        })
      );
      await tx.projectWorkflowAssignment.createMany({
        data: workflowAssignments,
        skipDuplicates: true,
      });
    }

    if (milestoneTypeIdsToAssign.size > 0) {
      const milestoneAssignments = Array.from(milestoneTypeIdsToAssign).map(
        (milestoneTypeId) => ({
          projectId,
          milestoneTypeId,
        })
      );
      await tx.milestoneTypesAssignment.createMany({
        data: milestoneAssignments,
        skipDuplicates: true,
      });
    }

    if (templateIdsToAssign.size > 0) {
      const templateAssignments = Array.from(templateIdsToAssign).map(
        (templateId) => ({
          templateId,
          projectId,
        })
      );
      await tx.templateProjectAssignment.createMany({
        data: templateAssignments,
        skipDuplicates: true,
      });
    }

    let resolvedDefaultTemplateId: number | null = null;
    if (defaultTemplateRecord?.id) {
      resolvedDefaultTemplateId = defaultTemplateRecord.id;
    } else {
      const fallbackAssignment = await tx.templateProjectAssignment.findFirst({
        where: { projectId },
        select: { templateId: true },
        orderBy: { templateId: "asc" },
      });
      resolvedDefaultTemplateId = fallbackAssignment?.templateId ?? null;
    }

    if (!resolvedDefaultTemplateId) {
      const fallbackTemplate = await tx.templates.findFirst({
        where: { isDeleted: false },
        select: { id: true },
        orderBy: { id: "asc" },
      });
      if (fallbackTemplate?.id) {
        await tx.templateProjectAssignment.upsert({
          where: {
            templateId_projectId: {
              templateId: fallbackTemplate.id,
              projectId,
            },
          },
          create: {
            projectId,
            templateId: fallbackTemplate.id,
          },
          update: {},
        });
        resolvedDefaultTemplateId = fallbackTemplate.id;
      }
    }

    defaultTemplateIdByProject.set(projectId, resolvedDefaultTemplateId);

    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
      const message = formatInProgressStatus(context, "projects");
      await persistProgress("projects", message);
      processedSinceLastPersist = 0;
    }
  }

  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "projects");
    await persistProgress("projects", message);
  }

  return { summary, projectIdMap, defaultTemplateIdByProject };
};

const importMilestones = async (
  tx: TxClient,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  milestoneTypeIdMap: Map<number, number>,
  userIdMap: Map<number, string>,
  importJob: TestmoImportJob,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<MilestonesImportResult> => {
  const milestoneRows = datasetRows.get("milestones") ?? [];
  const summary: EntitySummaryResult = {
    entity: "milestones",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const milestoneIdMap = new Map<number, number>();

  if (milestoneRows.length === 0) {
    logMessage(
      context,
      "No milestones dataset found; skipping milestone import."
    );
    return { summary, milestoneIdMap };
  }

  initializeEntityProgress(context, "milestones", milestoneRows.length);
  let processedSinceLastPersist = 0;

  const defaultMilestoneType = await tx.milestoneTypes.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  const fallbackMilestoneTypeId = defaultMilestoneType?.id ?? null;

  type PendingRelation = {
    milestoneId: number;
    parentSourceId: number | null;
    rootSourceId: number | null;
  };

  const pendingRelations: PendingRelation[] = [];

  for (const row of milestoneRows) {
    const record = row as Record<string, unknown>;
    const sourceId = toNumberValue(record.id);
    const projectSourceId = toNumberValue(record.project_id);
    const typeSourceId = toNumberValue(record.type_id);

    if (sourceId === null || projectSourceId === null) {
      continue;
    }

    const projectId = projectIdMap.get(projectSourceId);
    if (!projectId) {
      logMessage(context, "Skipping milestone due to missing project mapping", {
        sourceId,
        projectSourceId,
      });
      decrementEntityTotal(context, "milestones");
      continue;
    }

    const resolvedMilestoneTypeId =
      typeSourceId !== null
        ? (milestoneTypeIdMap.get(typeSourceId) ?? fallbackMilestoneTypeId)
        : fallbackMilestoneTypeId;

    if (!resolvedMilestoneTypeId) {
      logMessage(
        context,
        "Skipping milestone due to missing milestone type mapping",
        {
          sourceId,
          typeSourceId,
        }
      );
      decrementEntityTotal(context, "milestones");
      continue;
    }

    const name = toStringValue(record.name) ?? `Imported Milestone ${sourceId}`;
    const note = convertToTipTapJsonString(record.note);
    const docs = convertToTipTapJsonString(record.docs);
    const isStarted = toBooleanValue(record.is_started);
    const isCompleted = toBooleanValue(record.is_completed);
    const startedAt = toDateValue(record.started_at);
    const completedAt = toDateValue(record.completed_at);
    const createdAt = toDateValue(record.created_at) ?? new Date();
    const createdBy = resolveUserId(
      userIdMap,
      importJob.createdById,
      record.created_by
    );

    const existingMilestone = await tx.milestones.findFirst({
      where: {
        projectId,
        name,
        isDeleted: false,
      },
    });

    if (existingMilestone) {
      milestoneIdMap.set(sourceId, existingMilestone.id);
      summary.total += 1;
      summary.mapped += 1;
      incrementEntityProgress(context, "milestones", 0, 1);
      processedSinceLastPersist += 1;
      if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
        const message = formatInProgressStatus(context, "milestones");
        await persistProgress("milestones", message);
        processedSinceLastPersist = 0;
      }
      continue;
    }

    const milestone = await tx.milestones.create({
      data: {
        projectId,
        milestoneTypesId: resolvedMilestoneTypeId,
        name,
        note: note ?? undefined,
        docs: docs ?? undefined,
        isStarted,
        isCompleted,
        startedAt: startedAt ?? undefined,
        completedAt: completedAt ?? undefined,
        createdAt,
        createdBy,
      },
    });

    milestoneIdMap.set(sourceId, milestone.id);
    pendingRelations.push({
      milestoneId: milestone.id,
      parentSourceId: toNumberValue(record.parent_id),
      rootSourceId: toNumberValue(record.root_id),
    });

    summary.total += 1;
    summary.created += 1;

    incrementEntityProgress(context, "milestones", 1, 0);
    processedSinceLastPersist += 1;
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
      const message = formatInProgressStatus(context, "milestones");
      await persistProgress("milestones", message);
      processedSinceLastPersist = 0;
    }
  }

  for (const relation of pendingRelations) {
    const parentId =
      relation.parentSourceId !== null
        ? (milestoneIdMap.get(relation.parentSourceId) ?? null)
        : null;
    const rootId =
      relation.rootSourceId !== null
        ? (milestoneIdMap.get(relation.rootSourceId) ?? null)
        : null;

    if (parentId !== null || rootId !== null) {
      await tx.milestones.update({
        where: { id: relation.milestoneId },
        data: {
          parentId: parentId ?? undefined,
          rootId: rootId ?? undefined,
        },
      });
    }
  }

  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "milestones");
    await persistProgress("milestones", message);
  }

  return { summary, milestoneIdMap };
};

interface SessionsImportResult {
  summary: EntitySummaryResult;
  sessionIdMap: Map<number, number>;
}

const importSessions = async (
  tx: TxClient,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  milestoneIdMap: Map<number, number>,
  configurationIdMap: Map<number, number>,
  workflowIdMap: Map<number, number>,
  userIdMap: Map<number, string>,
  templateIdMap: Map<number, number>,
  importJob: TestmoImportJob,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<SessionsImportResult> => {
  const sessionRows = datasetRows.get("sessions") ?? [];
  const summary: EntitySummaryResult = {
    entity: "sessions",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const sessionIdMap = new Map<number, number>();

  if (sessionRows.length === 0) {
    logMessage(context, "No sessions dataset found; skipping session import.");
    return { summary, sessionIdMap };
  }

  initializeEntityProgress(context, "sessions", sessionRows.length);
  let processedSinceLastPersist = 0;

  // Get the default template for Sessions - try to find Exploratory or any enabled template
  const defaultTemplate = await tx.templates.findFirst({
    where: {
      OR: [
        { templateName: "Exploratory" },
        { isDefault: true },
        { isEnabled: true },
      ],
      isDeleted: false,
    },
    select: { id: true },
  });

  const workflowResolver = createWorkflowResolver(tx, workflowIdMap);

  for (const row of sessionRows) {
    const record = row as Record<string, unknown>;
    const sourceId = toNumberValue(record.id);
    const projectSourceId = toNumberValue(record.project_id);
    const templateSourceId = toNumberValue(record.template_id);
    const stateSourceId = toNumberValue(record.state_id);

    if (sourceId === null || projectSourceId === null) {
      continue;
    }

    const projectId = projectIdMap.get(projectSourceId);
    if (!projectId) {
      logMessage(context, "Skipping session due to missing project mapping", {
        sourceId,
        projectSourceId,
      });
      decrementEntityTotal(context, "sessions");
      continue;
    }

    // Resolve template ID - use mapped template or default exploratory template
    let resolvedTemplateId = defaultTemplate?.id;
    if (templateSourceId !== null && templateIdMap.has(templateSourceId)) {
      resolvedTemplateId = templateIdMap.get(templateSourceId);
    }

    if (!resolvedTemplateId) {
      logMessage(context, "Skipping session due to missing template", {
        sourceId,
        templateSourceId,
      });
      decrementEntityTotal(context, "sessions");
      continue;
    }

    // Resolve workflow state — must match SESSIONS scope; fall back to
    // project default for that scope when the user-mapped one doesn't.
    const candidateStateId =
      stateSourceId !== null
        ? (workflowIdMap.get(stateSourceId) ?? null)
        : null;
    const resolvedStateIdRaw = await workflowResolver.resolve(
      projectId,
      WorkflowScope.SESSIONS,
      candidateStateId
    );

    if (!resolvedStateIdRaw) {
      logMessage(context, "Skipping session due to missing workflow state", {
        sourceId,
        stateSourceId,
      });
      decrementEntityTotal(context, "sessions");
      continue;
    }

    const resolvedStateId =
      (await resolveCreateStateRemap(
        tx,
        projectId,
        WorkflowScope.SESSIONS,
        resolvedStateIdRaw
      )) ?? resolvedStateIdRaw;

    const name = toStringValue(record.name) ?? `Imported Session ${sourceId}`;
    const note = convertToTipTapJsonString(record.note);
    const mission = convertToTipTapJsonString(record.custom_mission);

    // Convert microseconds to seconds for estimate, forecast, and elapsed
    const estimateRaw = toNumberValue(record.estimate);
    const estimate =
      estimateRaw !== null ? Math.floor(estimateRaw / 1000000) : null;
    const forecastRaw = toNumberValue(record.forecast);
    const forecast =
      forecastRaw !== null ? Math.floor(forecastRaw / 1000000) : null;
    const elapsedRaw = toNumberValue(record.elapsed);
    const elapsed =
      elapsedRaw !== null ? Math.floor(elapsedRaw / 1000000) : null;

    const isCompleted = toBooleanValue(record.is_closed);
    const completedAt = isCompleted ? toDateValue(record.closed_at) : null;
    const createdAt = toDateValue(record.created_at) ?? new Date();
    const createdBy = resolveUserId(
      userIdMap,
      importJob.createdById,
      record.created_by
    );

    // Resolve milestone if present
    const milestoneSourceId = toNumberValue(record.milestone_id);
    let milestoneId = null;
    if (milestoneSourceId !== null) {
      milestoneId = milestoneIdMap.get(milestoneSourceId) ?? null;
    }

    // Resolve configuration if present
    const configSourceId = toNumberValue(record.config_id);
    let configId = null;
    if (configSourceId !== null) {
      configId = configurationIdMap.get(configSourceId) ?? null;
    }

    // Resolve assignee if present
    const assigneeSourceId = toNumberValue(record.assignee_id);
    let assignedToId = null;
    if (assigneeSourceId !== null) {
      assignedToId = userIdMap.get(assigneeSourceId) ?? null;
    }

    // Check if a similar session already exists
    const existingSession = await tx.sessions.findFirst({
      where: {
        projectId,
        name,
        isDeleted: false,
      },
      select: { id: true },
    });

    let sessionId: number;
    if (existingSession) {
      sessionId = existingSession.id;
      summary.mapped += 1;
      incrementEntityProgress(context, "sessions", 0, 1);
    } else {
      const session = await tx.sessions.create({
        data: {
          projectId,
          templateId: resolvedTemplateId,
          name,
          note: note ?? undefined,
          mission: mission ?? undefined,
          configId,
          milestoneId,
          stateId: resolvedStateId,
          assignedToId,
          estimate,
          forecastManual: forecast,
          elapsed,
          isCompleted,
          completedAt,
          createdAt,
          createdById: createdBy,
        },
      });
      sessionId = session.id;
      summary.created += 1;
      incrementEntityProgress(context, "sessions", 1, 0);

      const projectName = await getProjectName(tx, projectId);
      const templateName = await getTemplateName(tx, resolvedTemplateId);
      const workflowName = await getWorkflowName(tx, resolvedStateId);
      const configurationName = configId
        ? await getConfigurationName(tx, configId)
        : null;
      const milestoneNameResolved = milestoneId
        ? await getMilestoneName(tx, milestoneId)
        : null;
      const assignedToNameResolved = assignedToId
        ? await getUserName(tx, assignedToId)
        : null;
      const createdByName = await getUserName(tx, createdBy);

      await tx.sessionVersions.create({
        data: {
          session: { connect: { id: session.id } },
          name,
          staticProjectId: projectId,
          staticProjectName: projectName,
          project: { connect: { id: projectId } },
          templateId: resolvedTemplateId,
          templateName,
          configId: configId ?? null,
          configurationName,
          milestoneId: milestoneId ?? null,
          milestoneName: milestoneNameResolved,
          stateId: resolvedStateId,
          stateName: workflowName,
          assignedToId: assignedToId ?? null,
          assignedToName: assignedToNameResolved,
          createdById: createdBy,
          createdByName,
          estimate,
          forecastManual: forecast,
          forecastAutomated: null,
          elapsed,
          note: note ?? JSON.stringify(emptyEditorContent),
          mission: mission ?? JSON.stringify(emptyEditorContent),
          isCompleted,
          completedAt,
          version: session.currentVersion ?? 1,
          tags: JSON.stringify([]),
          attachments: JSON.stringify([]),
          issues: JSON.stringify([]),
        },
      });
    }

    sessionIdMap.set(sourceId, sessionId);
    processedSinceLastPersist += 1;

    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
      const message = formatInProgressStatus(context, "sessions");
      await persistProgress("sessions", message);
      processedSinceLastPersist = 0;
    }
  }

  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "sessions");
    await persistProgress("sessions", message);
  }

  return { summary, sessionIdMap };
};

interface SessionResultsImportResult {
  summary: EntitySummaryResult;
  sessionResultIdMap: Map<number, number>;
}

const importSessionResults = async (
  tx: TxClient,
  datasetRows: Map<string, any[]>,
  sessionIdMap: Map<number, number>,
  statusIdMap: Map<number, number>,
  userIdMap: Map<number, string>,
  importJob: TestmoImportJob,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<SessionResultsImportResult> => {
  const sessionResultRows = datasetRows.get("session_results") ?? [];
  const summary: EntitySummaryResult = {
    entity: "sessionResults",
    total: 0,
    created: 0,
    mapped: 0,
  };
  const sessionResultIdMap = new Map<number, number>();

  if (sessionResultRows.length === 0) {
    logMessage(context, "No session results found; skipping.");
    return { summary, sessionResultIdMap };
  }

  // Get the default "untested" status to use when source status is null
  const untestedStatus = await tx.status.findFirst({
    where: { systemName: "untested" },
    select: { id: true },
  });

  if (!untestedStatus) {
    throw new Error("Default 'untested' status not found in workspace");
  }

  const defaultStatusId = untestedStatus.id;

  initializeEntityProgress(context, "sessionResults", sessionResultRows.length);
  let processedSinceLastPersist = 0;

  for (const row of sessionResultRows) {
    const record = row as Record<string, unknown>;
    const sourceResultId = toNumberValue(record.id);
    const sourceSessionId = toNumberValue(record.session_id);
    const sourceStatusId = toNumberValue(record.status_id);

    if (sourceResultId === null || sourceSessionId === null) {
      decrementEntityTotal(context, "sessionResults");
      continue;
    }

    const sessionId = sessionIdMap.get(sourceSessionId);
    if (!sessionId) {
      logMessage(context, "Skipping session result - session not found", {
        sourceSessionId,
      });
      decrementEntityTotal(context, "sessionResults");
      continue;
    }

    // Resolve status - use default "untested" status if source status is null or not found
    let statusId: number;
    if (sourceStatusId !== null) {
      statusId = statusIdMap.get(sourceStatusId) ?? defaultStatusId;
    } else {
      statusId = defaultStatusId;
    }

    const comment = convertToTipTapJsonString(record.comment);
    const elapsedRaw = toNumberValue(record.elapsed);
    const elapsed =
      elapsedRaw !== null ? Math.floor(elapsedRaw / 1000000) : null;
    const createdAt = toDateValue(record.created_at) ?? new Date();
    const createdById = resolveUserId(
      userIdMap,
      importJob.createdById,
      record.created_by
    );

    const sessionResult = await tx.sessionResults.create({
      data: {
        sessionId,
        statusId,
        resultData: comment ?? undefined,
        elapsed,
        createdAt,
        createdById,
      },
    });

    sessionResultIdMap.set(sourceResultId, sessionResult.id);
    summary.created += 1;
    incrementEntityProgress(context, "sessionResults", 1, 0);
    processedSinceLastPersist += 1;

    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
      const message = formatInProgressStatus(context, "sessionResults");
      await persistProgress("sessionResults", message);
      processedSinceLastPersist = 0;
    }
  }

  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "sessionResults");
    await persistProgress("sessionResults", message);
  }

  return { summary, sessionResultIdMap };
};

interface SessionValuesImportResult {
  summary: EntitySummaryResult;
}

const importSessionValues = async (
  tx: TxClient,
  datasetRows: Map<string, any[]>,
  sessionIdMap: Map<number, number>,
  testmoFieldValueMap: Map<number, { fieldId: number; name: string }>,
  configuration: TestmoMappingConfiguration,
  caseFieldMap: Map<string, number>,
  caseFieldMetadataById: Map<number, CaseFieldMetadata>,
  importJob: TestmoImportJob,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<SessionValuesImportResult> => {
  const sessionValueRows = datasetRows.get("session_values") ?? [];
  const summary: EntitySummaryResult = {
    entity: "sessionValues",
    total: 0,
    created: 0,
    mapped: 0,
  };

  if (sessionValueRows.length === 0) {
    logMessage(context, "No session values found; skipping.");
    return { summary };
  }

  // Build a map of multi-select values by session_id and field_id
  const multiSelectValuesBySessionAndField = new Map<string, number[]>();

  for (const row of sessionValueRows) {
    const record = row as Record<string, unknown>;
    const sessionId = toNumberValue(record.session_id);
    const fieldId = toNumberValue(record.field_id);
    const valueId = toNumberValue(record.value_id);

    if (sessionId !== null && fieldId !== null && valueId !== null) {
      const key = `${sessionId}:${fieldId}`;
      const values = multiSelectValuesBySessionAndField.get(key) ?? [];
      values.push(valueId);
      multiSelectValuesBySessionAndField.set(key, values);
    }
  }

  // Build mapping from Testmo field IDs to system names from configuration
  const testmoFieldIdBySystemName = new Map<string, number>();
  for (const [key, fieldConfig] of Object.entries(
    configuration.templateFields ?? {}
  )) {
    const testmoFieldId = Number(key);
    if (fieldConfig && fieldConfig.systemName) {
      testmoFieldIdBySystemName.set(fieldConfig.systemName, testmoFieldId);
    }
  }

  // Process unique session+field combinations
  const processedCombinations = new Set<string>();

  initializeEntityProgress(
    context,
    "sessionValues",
    multiSelectValuesBySessionAndField.size
  );
  let processedSinceLastPersist = 0;

  for (const [key, valueIds] of multiSelectValuesBySessionAndField.entries()) {
    if (processedCombinations.has(key)) {
      continue;
    }
    processedCombinations.add(key);

    const [sessionSourceIdStr, fieldSourceIdStr] = key.split(":");
    const sessionSourceId = Number(sessionSourceIdStr);
    const fieldSourceId = Number(fieldSourceIdStr);

    const sessionId = sessionIdMap.get(sessionSourceId);
    if (!sessionId) {
      decrementEntityTotal(context, "sessionValues");
      continue;
    }

    // Find which case field this Testmo field maps to
    let testPlanItFieldId: number | undefined;
    let fieldSystemName: string | undefined;

    for (const [
      systemName,
      testmoFieldId,
    ] of testmoFieldIdBySystemName.entries()) {
      if (testmoFieldId === fieldSourceId) {
        fieldSystemName = systemName;
        testPlanItFieldId = caseFieldMap.get(systemName);
        break;
      }
    }

    if (!testPlanItFieldId || !fieldSystemName) {
      decrementEntityTotal(context, "sessionValues");
      continue;
    }

    // Resolve value names from value IDs
    const resolvedValueNames: string[] = [];
    for (const valueId of valueIds) {
      const valueMeta = testmoFieldValueMap.get(valueId);
      if (valueMeta) {
        resolvedValueNames.push(valueMeta.name);
      }
    }

    if (resolvedValueNames.length === 0) {
      decrementEntityTotal(context, "sessionValues");
      continue;
    }

    // Create the session field value record
    await tx.sessionFieldValues.create({
      data: {
        sessionId,
        fieldId: testPlanItFieldId,
        value: resolvedValueNames,
      },
    });

    summary.created += 1;
    incrementEntityProgress(context, "sessionValues", 1, 0);
    processedSinceLastPersist += 1;

    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
      const message = formatInProgressStatus(context, "sessionValues");
      await persistProgress("sessionValues", message);
      processedSinceLastPersist = 0;
    }
  }

  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "sessionValues");
    await persistProgress("sessionValues", message);
  }

  return { summary };
};

const importRepositories = async (
  tx: TxClient,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<RepositoriesImportResult> => {
  const summary: EntitySummaryResult = {
    entity: "repositories",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const repositoryIdMap = new Map<number, number>();
  const canonicalRepoIdByProject = new Map<number, Set<number>>();
  const primaryRepositoryIdByProject = new Map<number, number>();
  const masterRepositoryIds = new Set<number>();

  const repositoryRows = datasetRows.get("repositories") ?? [];
  let folderRows = datasetRows.get("repository_folders") ?? [];
  let caseRows = datasetRows.get("repository_cases") ?? [];

  const repositoriesByProject = new Map<
    number,
    Array<Record<string, unknown>>
  >();
  for (const row of repositoryRows) {
    const record = row as Record<string, unknown>;
    const repoId = toNumberValue(record.id);
    const projectSourceId = toNumberValue(record.project_id);
    if (repoId === null || projectSourceId === null) {
      continue;
    }
    const collection = repositoriesByProject.get(projectSourceId) ?? [];
    collection.push(record);
    repositoriesByProject.set(projectSourceId, collection);
  }

  const canonicalRepositoryRows: Array<Record<string, unknown>> = [];
  if (repositoriesByProject.size > 0) {
    for (const [projectSourceId, rows] of repositoriesByProject) {
      const explicitMasters = rows.filter((record) => {
        const value = toNumberValue(record.is_master);
        return value === 1;
      });

      const nonSnapshotRows = rows.filter((record) => {
        const snapshotFlag = toNumberValue(record.is_snapshot);
        return snapshotFlag !== 1;
      });

      const selectedRows =
        explicitMasters.length > 0
          ? explicitMasters
          : nonSnapshotRows.length > 0
            ? nonSnapshotRows
            : rows.slice(0, 1);

      const repoSet = new Set<number>();
      for (const record of selectedRows) {
        const repoId = toNumberValue(record.id);
        if (repoId === null || repoSet.has(repoId)) {
          continue;
        }
        repoSet.add(repoId);
        masterRepositoryIds.add(repoId);
        canonicalRepositoryRows.push(record);
      }

      if (repoSet.size === 0) {
        continue;
      }

      canonicalRepoIdByProject.set(projectSourceId, repoSet);
    }

    if (canonicalRepositoryRows.length > 0) {
      datasetRows.set("repositories", canonicalRepositoryRows);
    }
  }

  if (masterRepositoryIds.size > 0) {
    const filteredFolders = folderRows.filter((row) => {
      const record = row as Record<string, unknown>;
      const repoId = toNumberValue(record.repo_id);
      return repoId !== null ? masterRepositoryIds.has(repoId) : true;
    });
    datasetRows.set("repository_folders", filteredFolders);
    folderRows = filteredFolders;

    const filteredCases = caseRows.filter((row) => {
      const record = row as Record<string, unknown>;
      const repoId = toNumberValue(record.repo_id);
      return repoId !== null ? masterRepositoryIds.has(repoId) : true;
    });
    datasetRows.set("repository_cases", filteredCases);
    caseRows = filteredCases;

    const caseValueRows = datasetRows.get("repository_case_values");
    if (Array.isArray(caseValueRows) && caseValueRows.length > 0) {
      const filteredCaseValues = caseValueRows.filter((row) => {
        const record = row as Record<string, unknown>;
        const repoId = toNumberValue(record.repo_id);
        return repoId !== null ? masterRepositoryIds.has(repoId) : true;
      });
      datasetRows.set("repository_case_values", filteredCaseValues);
    }

    const caseStepRows = datasetRows.get("repository_case_steps");
    if (Array.isArray(caseStepRows) && caseStepRows.length > 0) {
      const filteredCaseSteps = caseStepRows.filter((row) => {
        const record = row as Record<string, unknown>;
        const repoId = toNumberValue(record.repo_id);
        return repoId !== null ? masterRepositoryIds.has(repoId) : true;
      });
      datasetRows.set("repository_case_steps", filteredCaseSteps);
    }
  }

  const baseRepositoryRows =
    canonicalRepositoryRows.length > 0
      ? canonicalRepositoryRows
      : repositoryRows;

  if (
    baseRepositoryRows.length === 0 &&
    folderRows.length === 0 &&
    caseRows.length === 0
  ) {
    logMessage(
      context,
      "No repository data available; skipping repository import."
    );
    return {
      summary,
      repositoryIdMap,
      canonicalRepoIdByProject,
      masterRepositoryIds,
    };
  }

  const repoProjectLookup = new Map<number, number>();

  const registerRepoCandidate = (
    repoId: number | null,
    projectId: number | null
  ) => {
    if (repoId === null || projectId === null) {
      return;
    }
    if (
      masterRepositoryIds.size > 0 &&
      !isCanonicalRepository(projectId, repoId, canonicalRepoIdByProject)
    ) {
      return;
    }
    repoProjectLookup.set(repoId, projectId);
  };

  for (const row of baseRepositoryRows) {
    const record = row as Record<string, unknown>;
    registerRepoCandidate(
      toNumberValue(record.id),
      toNumberValue(record.project_id)
    );
  }

  const hydrateRepoProject = (rows: any[], repoKey: string) => {
    for (const row of rows) {
      const record = row as Record<string, unknown>;
      registerRepoCandidate(
        toNumberValue(record[repoKey]),
        toNumberValue(record.project_id)
      );
    }
  };

  hydrateRepoProject(folderRows, "repo_id");
  hydrateRepoProject(caseRows, "repo_id");

  if (repoProjectLookup.size === 0) {
    logMessage(
      context,
      "No repository data available; skipping repository import."
    );
    return {
      summary,
      repositoryIdMap,
      canonicalRepoIdByProject,
      masterRepositoryIds,
    };
  }

  initializeEntityProgress(context, "repositories", repoProjectLookup.size);
  let processedSinceLastPersist = 0;

  for (const [repoId, projectSourceId] of repoProjectLookup) {
    const projectId = projectIdMap.get(projectSourceId);
    if (!projectId) {
      logMessage(
        context,
        "Skipping repository due to missing project mapping",
        {
          repoId,
          projectSourceId,
        }
      );
      decrementEntityTotal(context, "repositories");
      continue;
    }

    summary.total += 1;

    const repoSet =
      canonicalRepoIdByProject.get(projectSourceId) ?? new Set<number>();
    if (!canonicalRepoIdByProject.has(projectSourceId)) {
      canonicalRepoIdByProject.set(projectSourceId, repoSet);
    }

    const existingPrimaryRepositoryId =
      primaryRepositoryIdByProject.get(projectSourceId);
    if (existingPrimaryRepositoryId !== undefined) {
      repositoryIdMap.set(repoId, existingPrimaryRepositoryId);
      repoSet.add(repoId);
      summary.mapped += 1;
      incrementEntityProgress(context, "repositories", 0, 1);
      processedSinceLastPersist += 1;
      if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
        const message = formatInProgressStatus(context, "repositories");
        await persistProgress("repositories", message);
        processedSinceLastPersist = 0;
      }
      continue;
    }

    const existingRepository = await tx.repositories.findFirst({
      where: { projectId, isDeleted: false },
      orderBy: { id: "asc" },
    });

    let repositoryId: number;

    if (existingRepository && repositoryRows.length === 0) {
      repositoryId = existingRepository.id;
      summary.mapped += 1;
      incrementEntityProgress(context, "repositories", 0, 1);
    } else {
      const repository = await tx.repositories.create({
        data: {
          projectId,
        },
      });
      repositoryId = repository.id;
      summary.created += 1;
      incrementEntityProgress(context, "repositories", 1, 0);
    }

    repositoryIdMap.set(repoId, repositoryId);
    repoSet.add(repoId);
    primaryRepositoryIdByProject.set(projectSourceId, repositoryId);

    processedSinceLastPersist += 1;
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
      const message = formatInProgressStatus(context, "repositories");
      await persistProgress("repositories", message);
      processedSinceLastPersist = 0;
    }
  }

  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "repositories");
    await persistProgress("repositories", message);
  }

  repoProjectLookup.clear();

  return {
    summary,
    repositoryIdMap,
    canonicalRepoIdByProject,
    masterRepositoryIds,
  };
};

const importRepositoryFolders = async (
  db: DbClient,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  repositoryIdMap: Map<number, number>,
  canonicalRepoIdByProject: Map<number, Set<number>>,
  importJob: TestmoImportJob,
  userIdMap: Map<number, string>,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<RepositoryFoldersImportResult> => {
  const folderRows = datasetRows.get("repository_folders") ?? [];
  const summary: EntitySummaryResult = {
    entity: "repositoryFolders",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const folderIdMap = new Map<number, number>();
  const repositoryRootFolderMap = new Map<number, number>();

  if (folderRows.length === 0) {
    logMessage(
      context,
      "No repository folders dataset found; skipping folder import."
    );
    return { summary, folderIdMap, repositoryRootFolderMap };
  }

  const canonicalFolderRecords = new Map<number, Record<string, unknown>>();

  for (const row of folderRows) {
    const record = row as Record<string, unknown>;
    const folderId = toNumberValue(record.id);
    const projectSourceId = toNumberValue(record.project_id);
    const repoSourceId = toNumberValue(record.repo_id);

    if (
      !isCanonicalRepository(
        projectSourceId,
        repoSourceId,
        canonicalRepoIdByProject
      )
    ) {
      continue;
    }

    if (folderId !== null) {
      canonicalFolderRecords.set(folderId, record);
    }
  }

  if (canonicalFolderRecords.size === 0) {
    logMessage(
      context,
      "No canonical repository folders found; skipping folder import."
    );
    return { summary, folderIdMap, repositoryRootFolderMap };
  }

  initializeEntityProgress(
    context,
    "repositoryFolders",
    canonicalFolderRecords.size
  );
  let processedSinceLastPersist = 0;

  const processedFolders = new Set<number>();
  const processingFolders = new Set<number>();
  const fallbackCreator = importJob.createdById;
  const folderSignatureMap = new Map<string, number>();

  const ensureRepositoryFor = async (
    repoSourceId: number,
    projectId: number
  ): Promise<number> => {
    let repositoryId = repositoryIdMap.get(repoSourceId);
    if (!repositoryId) {
      const repository = await db.repositories.create({
        data: { projectId },
      });
      repositoryId = repository.id;
      repositoryIdMap.set(repoSourceId, repositoryId);
    }
    return repositoryId;
  };

  const importFolder = async (
    folderSourceId: number
  ): Promise<number | null> => {
    if (folderIdMap.has(folderSourceId)) {
      return folderIdMap.get(folderSourceId) ?? null;
    }

    const record = canonicalFolderRecords.get(folderSourceId);
    if (!record) {
      return null;
    }

    if (processingFolders.has(folderSourceId)) {
      logMessage(
        context,
        "Detected folder parent cycle; attaching to repository root",
        {
          folderSourceId,
        }
      );
      return null;
    }

    processingFolders.add(folderSourceId);

    try {
      if (!processedFolders.has(folderSourceId)) {
        summary.total += 1;
        processedFolders.add(folderSourceId);
      }

      const projectSourceId = toNumberValue(record.project_id);
      const repoSourceId = toNumberValue(record.repo_id);
      const parentSourceId = toNumberValue(record.parent_id);

      if (projectSourceId === null || repoSourceId === null) {
        decrementEntityTotal(context, "repositoryFolders");
        return null;
      }

      const projectId = projectIdMap.get(projectSourceId);
      if (!projectId) {
        logMessage(context, "Skipping folder due to missing project mapping", {
          folderSourceId,
          projectSourceId,
        });
        decrementEntityTotal(context, "repositoryFolders");
        return null;
      }

      const targetRepoId = getPreferredRepositoryId(
        projectSourceId,
        repoSourceId,
        canonicalRepoIdByProject
      );

      if (targetRepoId === null) {
        logMessage(
          context,
          "Skipping folder due to missing canonical repository",
          {
            folderSourceId,
            projectSourceId,
            repoSourceId,
          }
        );
        decrementEntityTotal(context, "repositoryFolders");
        return null;
      }

      const repositoryId = await ensureRepositoryFor(targetRepoId, projectId);

      if (!repositoryIdMap.has(targetRepoId)) {
        repositoryIdMap.set(targetRepoId, repositoryId);
      }
      repositoryIdMap.set(repoSourceId, repositoryId);

      let parentId: number | null = null;
      if (parentSourceId !== null) {
        const mappedParent = folderIdMap.get(parentSourceId);
        if (mappedParent !== undefined) {
          parentId = mappedParent ?? null;
        } else {
          const createdParent = await importFolder(parentSourceId);
          parentId = createdParent ?? null;
        }
      }

      if (parentSourceId !== null && parentId === null) {
        logMessage(
          context,
          "Folder parent missing; attaching to repository root",
          {
            folderSourceId,
            parentSourceId,
          }
        );
        parentId = repositoryRootFolderMap.get(repositoryId) ?? null;
      }

      const name = toStringValue(record.name) ?? `Folder ${folderSourceId}`;

      // Check if we've already created or mapped a folder with this signature during this import
      const signature = `${repositoryId}:${parentId}:${name}`;
      const existingFolderId = folderSignatureMap.get(signature);

      if (existingFolderId !== undefined) {
        folderIdMap.set(folderSourceId, existingFolderId);
        summary.mapped += 1;
        incrementEntityProgress(context, "repositoryFolders", 0, 1);
        return existingFolderId;
      }

      const docsValue = convertToTipTapJsonString(record.docs);
      const order = toNumberValue(record.display_order) ?? 0;
      const creatorId = resolveUserId(
        userIdMap,
        fallbackCreator,
        record.created_by
      );
      const createdAt = toDateValue(record.created_at) ?? new Date();

      const transactionResult = await db.$transaction<{
        folderId: number;
        created: boolean;
      }>(async (tx) => {
        const existing = await tx.repositoryFolders.findFirst({
          where: {
            projectId,
            repositoryId,
            parentId,
            name,
            isDeleted: false,
          },
        });

        if (existing) {
          return { folderId: existing.id, created: false };
        }

        const folder = await tx.repositoryFolders.create({
          data: {
            projectId,
            repositoryId,
            parentId,
            name,
            order,
            creatorId,
            createdAt,
            ...(docsValue !== null ? { docs: docsValue } : {}),
          },
        });

        return { folderId: folder.id, created: true };
      });

      const folderId = transactionResult.folderId;

      if (transactionResult.created) {
        summary.created += 1;
        incrementEntityProgress(context, "repositoryFolders", 1, 0);
      } else {
        summary.mapped += 1;
        incrementEntityProgress(context, "repositoryFolders", 0, 1);
      }

      processedSinceLastPersist += 1;
      if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
        const message = formatInProgressStatus(context, "repositoryFolders");
        await persistProgress("repositoryFolders", message);
        processedSinceLastPersist = 0;
      }

      folderIdMap.set(folderSourceId, folderId);
      folderSignatureMap.set(signature, folderId);

      if (parentId === null && !repositoryRootFolderMap.has(repositoryId)) {
        repositoryRootFolderMap.set(repositoryId, folderId);
      }

      return folderId;
    } finally {
      processingFolders.delete(folderSourceId);
    }
  };

  for (const folderSourceId of canonicalFolderRecords.keys()) {
    await importFolder(folderSourceId);
  }

  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "repositoryFolders");
    await persistProgress("repositoryFolders", message);
  }

  canonicalFolderRecords.clear();
  processedFolders.clear();
  processingFolders.clear();

  return { summary, folderIdMap, repositoryRootFolderMap };
};
const importRepositoryCases = async (
  db: DbClient,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  repositoryIdMap: Map<number, number>,
  canonicalRepoIdByProject: Map<number, Set<number>>,
  folderIdMap: Map<number, number>,
  repositoryRootFolderMap: Map<number, number>,
  templateIdMap: Map<number, number>,
  templateNameMap: Map<string, number>,
  workflowIdMap: Map<number, number>,
  userIdMap: Map<number, string>,
  caseFieldMap: Map<string, number>,
  testmoFieldValueMap: Map<number, { fieldId: number; name: string }>,
  configuration: TestmoMappingConfiguration,
  importJob: TestmoImportJob,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<RepositoryCasesImportResult> => {
  const caseRows = datasetRows.get("repository_cases") ?? [];
  const caseValuesRows = datasetRows.get("repository_case_values") ?? [];

  // Build a map of multi-select values by case_id and field_id
  const multiSelectValuesByCaseAndField = new Map<string, number[]>();

  for (const row of caseValuesRows) {
    const record = row as Record<string, unknown>;
    const caseId = toNumberValue(record.case_id);
    const fieldId = toNumberValue(record.field_id);
    const valueId = toNumberValue(record.value_id);
    const projectSourceId = toNumberValue(record.project_id);
    const repoSourceId = toNumberValue(record.repo_id);

    if (
      !isCanonicalRepository(
        projectSourceId,
        repoSourceId,
        canonicalRepoIdByProject
      )
    ) {
      continue;
    }

    if (caseId !== null && fieldId !== null && valueId !== null) {
      const key = `${caseId}:${fieldId}`;
      const values = multiSelectValuesByCaseAndField.get(key) ?? [];
      values.push(valueId);
      multiSelectValuesByCaseAndField.set(key, values);
    }
  }

  const summary: EntitySummaryResult = {
    entity: "repositoryCases",
    total: 0,
    created: 0,
    mapped: 0,
    details: {
      estimateAdjusted: 0,
      estimateClamped: 0,
    },
  };

  const caseIdMap = new Map<number, number>();
  const caseMetaMap = new Map<number, { projectId: number; name: string }>();
  const caseKeyMap = new Map<string, number>();
  const summaryDetails = summary.details as Record<string, number>;

  // Debug tracking for dropdown/multi-select fields
  const dropdownStats = new Map<
    string,
    {
      totalAttempts: number;
      nullResults: number;
      successResults: number;
      sampleValues: Set<any>;
      sampleNulls: Array<any>;
    }
  >();

  const templateRows = datasetRows.get("templates") ?? [];
  const templateNameBySourceId = new Map<number, string>();
  for (const row of templateRows) {
    const record = row as Record<string, unknown>;
    const sourceId = toNumberValue(record.id);
    const name = toStringValue(record.name);
    if (sourceId !== null && name) {
      templateNameBySourceId.set(sourceId, name);
    }
  }

  const canonicalCaseRows: Record<string, unknown>[] = [];
  const canonicalCaseIds = new Set<number>();

  for (let index = 0; index < caseRows.length; index += 1) {
    const record = caseRows[index] as Record<string, unknown>;
    const projectSourceId = toNumberValue(record.project_id);
    const repoSourceId = toNumberValue(record.repo_id);
    const caseSourceId = toNumberValue(record.id);

    if (
      !isCanonicalRepository(
        projectSourceId,
        repoSourceId,
        canonicalRepoIdByProject
      )
    ) {
      continue;
    }

    if (caseSourceId !== null) {
      canonicalCaseRows.push(record);
      canonicalCaseIds.add(caseSourceId);
    }
  }
  caseRows.length = 0;

  const repositoryCaseStepRows = datasetRows.get("repository_case_steps") ?? [];
  datasetRows.delete("repository_case_steps");
  const stepsByCaseId = new Map<number, Array<Record<string, unknown>>>();
  for (const row of repositoryCaseStepRows) {
    const record = row as Record<string, unknown>;
    const caseId = toNumberValue(record.case_id);
    if (caseId === null || !canonicalCaseIds.has(caseId)) {
      continue;
    }

    const projectSourceId = toNumberValue(record.project_id);
    const repoSourceId = toNumberValue(record.repo_id);
    if (
      !isCanonicalRepository(
        projectSourceId,
        repoSourceId,
        canonicalRepoIdByProject
      )
    ) {
      continue;
    }

    const collection = stepsByCaseId.get(caseId);
    if (collection) {
      collection.push(record);
    } else {
      stepsByCaseId.set(caseId, [record]);
    }
  }

  const resolvedTemplateIdsByName = new Map<string, number>(templateNameMap);
  const templateAssignmentsByProject = new Map<number, Set<number>>();

  const canonicalCaseCount = canonicalCaseRows.length;

  if (canonicalCaseCount === 0) {
    logMessage(
      context,
      "No repository cases dataset found; skipping case import."
    );
    return {
      summary,
      caseIdMap,
      caseFieldMap: new Map(),
      caseFieldMetadataById: new Map(),
      caseMetaMap,
      caseKeyMap,
    };
  }

  initializeEntityProgress(context, "repositoryCases", canonicalCaseCount);
  let processedSinceLastPersist = 0;

  const defaultTemplate = await db.templates.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });

  const workflowResolver = createWorkflowResolver(db, workflowIdMap);

  const fallbackCreator = importJob.createdById;

  const caseFieldMetadataById = new Map<number, CaseFieldMetadata>();
  if (caseFieldMap.size > 0) {
    const uniqueCaseFieldIds = Array.from(
      new Set(Array.from(caseFieldMap.values()))
    );

    const caseFieldRecords = await db.caseFields.findMany({
      where: {
        id: {
          in: uniqueCaseFieldIds,
        },
      },
      include: {
        type: {
          select: {
            type: true,
          },
        },
        fieldOptions: {
          include: {
            fieldOption: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    for (const field of caseFieldRecords) {
      const optionsByName = new Map<string, number>();
      const optionIds = new Set<number>();

      for (const assignment of field.fieldOptions ?? []) {
        const option = assignment.fieldOption;
        if (!option) {
          continue;
        }
        optionIds.add(option.id);
        optionsByName.set(option.name.trim().toLowerCase(), option.id);
      }

      caseFieldMetadataById.set(field.id, {
        id: field.id,
        systemName: field.systemName,
        displayName: field.displayName,
        type: field.type.type,
        optionIds,
        optionsByName,
      });
    }
  }

  const recordFieldWarning = (
    message: string,
    details: Record<string, unknown>
  ) => {
    logMessage(context, message, details);
  };
  const chunkSize = Math.max(1, REPOSITORY_CASE_CHUNK_SIZE);
  logMessage(context, `Processing repository cases in batches of ${chunkSize}`);

  const processChunk = async (
    records: Record<string, unknown>[]
  ): Promise<void> => {
    if (records.length === 0) {
      return;
    }
    await db.$transaction(async (tx: TxClient) => {
      // Phase 13 SAF-01 — opt this bulk import chunk out of row-level CDC
      // capture. The audit_row_change() trigger early-returns when
      // app.skip_audit is true, collapsing the ~9x per-row trigger overhead
      // back to ~1x (SPIKE-02) so the import transaction does not blow its
      // timeout. The job-level captureAuditEvent retains the semantic
      // coverage for the import as a whole. SET LOCAL only inside a
      // $transaction (Pitfall A).
      await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;

      // Phase 13 perf — batch-prefetch the existing-case dedup lookup for
      // this chunk instead of issuing one findFirst per record against the
      // (potentially multi-million row) repositoryCases table. Memory stays
      // bounded by the chunk size: we hold at most one chunk's worth of
      // {id, isDeleted} entries, freed when the chunk completes. The map is
      // updated as cases are created below so intra-chunk duplicate
      // (projectId, name, className) keys still dedupe exactly as the
      // original per-row, self-write-visible findFirst did.
      // NUL delimiter: Postgres text columns cannot contain \u0000, so this
      // composite key is collision-free across name/className boundaries.
      const existingCaseKey = (
        pid: number,
        name: string,
        cls: string | null
      ): string => `${pid}\u0000${name}\u0000${cls ?? ""}`;
      const existingCaseByKey = new Map<
        string,
        { id: number; isDeleted: boolean }
      >();
      {
        const prefetchProjectIds = new Set<number>();
        const prefetchNames = new Set<string>();
        for (const record of records) {
          const projectSourceId = toNumberValue(record.project_id);
          if (projectSourceId === null) {
            continue;
          }
          const projectId = projectIdMap.get(projectSourceId);
          if (!projectId) {
            continue;
          }
          const caseName =
            toStringValue(record.name) ??
            `Imported Case ${toNumberValue(record.id) ?? 0}`;
          prefetchProjectIds.add(projectId);
          prefetchNames.add(caseName);
        }
        if (prefetchProjectIds.size > 0 && prefetchNames.size > 0) {
          const existingRows = await tx.repositoryCases.findMany({
            where: {
              source: "MANUAL",
              projectId: { in: Array.from(prefetchProjectIds) },
              name: { in: Array.from(prefetchNames) },
            },
            select: {
              id: true,
              projectId: true,
              name: true,
              className: true,
              isDeleted: true,
            },
          });
          for (const row of existingRows) {
            existingCaseByKey.set(
              existingCaseKey(row.projectId, row.name, row.className),
              { id: row.id, isDeleted: row.isDeleted }
            );
          }
        }
      }

      for (const record of records) {
        const caseSourceId = toNumberValue(record.id);
        const projectSourceId = toNumberValue(record.project_id);
        const repoSourceId = toNumberValue(record.repo_id);
        const folderSourceId = toNumberValue(record.folder_id);
        const caseName =
          toStringValue(record.name) ?? `Imported Case ${caseSourceId ?? 0}`;

        if (
          caseSourceId === null ||
          projectSourceId === null ||
          repoSourceId === null
        ) {
          decrementEntityTotal(context, "repositoryCases");
          continue;
        }

        const projectId = projectIdMap.get(projectSourceId);
        if (!projectId) {
          logMessage(context, "Skipping case due to missing project mapping", {
            caseSourceId,
            projectSourceId,
          });
          decrementEntityTotal(context, "repositoryCases");
          canonicalCaseIds.delete(caseSourceId);
          stepsByCaseId.delete(caseSourceId);
          continue;
        }

        const targetRepoId = getPreferredRepositoryId(
          projectSourceId,
          repoSourceId,
          canonicalRepoIdByProject
        );
        caseMetaMap.set(caseSourceId, { projectId, name: caseName });

        if (targetRepoId === null) {
          const existingFallback = await tx.repositoryCases.findFirst({
            where: {
              projectId,
              name: caseName,
              isDeleted: false,
            },
            select: { id: true },
          });

          if (existingFallback) {
            caseIdMap.set(caseSourceId, existingFallback.id);
            summary.total += 1;
            summary.mapped += 1;
          }

          logMessage(
            context,
            "Skipping case due to missing canonical repository",
            {
              caseSourceId,
              projectSourceId,
              repoSourceId,
            }
          );
          decrementEntityTotal(context, "repositoryCases");
          canonicalCaseIds.delete(caseSourceId);
          stepsByCaseId.delete(caseSourceId);
          continue;
        }

        let repositoryId = repositoryIdMap.get(targetRepoId);
        if (repositoryId === undefined) {
          const repository = await tx.repositories.create({
            data: { projectId },
          });
          repositoryId = repository.id;
          repositoryIdMap.set(targetRepoId, repositoryId);
        }

        const resolvedRepositoryId = repositoryId;

        repositoryIdMap.set(repoSourceId, resolvedRepositoryId);

        let folderId =
          folderSourceId !== null
            ? (folderIdMap.get(folderSourceId) ?? null)
            : null;
        if (folderId == null) {
          const rootFolderId =
            repositoryRootFolderMap.get(resolvedRepositoryId);
          if (rootFolderId) {
            folderId = rootFolderId;
          } else {
            const fallbackFolder = await tx.repositoryFolders.create({
              data: {
                projectId,
                repositoryId: resolvedRepositoryId,
                name: "Imported",
                creatorId: fallbackCreator,
              },
            });
            folderId = fallbackFolder.id;
            repositoryRootFolderMap.set(
              resolvedRepositoryId,
              fallbackFolder.id
            );
          }
        }

        if (folderId == null) {
          logMessage(context, "Skipping case due to missing folder mapping", {
            caseSourceId,
            folderSourceId,
          });
          decrementEntityTotal(context, "repositoryCases");
          canonicalCaseIds.delete(caseSourceId);
          stepsByCaseId.delete(caseSourceId);
          continue;
        }

        const resolvedFolderId = folderId;
        const className = toStringValue(record.key);

        // Check for existing case matching the unique constraint
        // (projectId, name, className, source) — including soft-deleted
        // records since the constraint does not include isDeleted. Resolved
        // from the chunk prefetch map (updated as cases are created below)
        // rather than a per-row findFirst.
        const existing =
          existingCaseByKey.get(
            existingCaseKey(projectId, caseName, className ?? null)
          ) ?? null;

        if (existing) {
          // Restore soft-deleted cases so they can be reused
          if (existing.isDeleted) {
            await tx.repositoryCases.update({
              where: { id: existing.id },
              data: { isDeleted: false },
            });
          }
          caseIdMap.set(caseSourceId, existing.id);
          const existingKey = toStringValue(record.key);
          if (existingKey) {
            caseKeyMap.set(`${projectSourceId}:${existingKey}`, existing.id);
          }
          summary.total += 1;
          summary.mapped += 1;
          incrementEntityProgress(context, "repositoryCases", 0, 1);
          processedSinceLastPersist += 1;
          if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
            const message = formatInProgressStatus(context, "repositoryCases");
            await persistProgress("repositoryCases", message);
            processedSinceLastPersist = 0;
          }
          canonicalCaseIds.delete(caseSourceId);
          stepsByCaseId.delete(caseSourceId);
          continue;
        }

        const templateSourceId = toNumberValue(record.template_id);
        const stateSourceId = toNumberValue(record.state_id);

        let templateId: number | null = null;
        if (templateSourceId !== null) {
          const mappedTemplateId = templateIdMap.get(templateSourceId);
          if (mappedTemplateId !== undefined) {
            templateId = mappedTemplateId;
          } else {
            const templateName = templateNameBySourceId.get(templateSourceId);
            if (templateName) {
              templateId = resolvedTemplateIdsByName.get(templateName) ?? null;
              if (!templateId) {
                const existingTemplate = await tx.templates.findFirst({
                  where: { templateName },
                });

                if (existingTemplate) {
                  templateId = existingTemplate.id;
                } else {
                  const createdTemplate = await tx.templates.create({
                    data: {
                      templateName,
                      isEnabled: true,
                      isDefault: false,
                    },
                  });
                  templateId = createdTemplate.id;
                }

                resolvedTemplateIdsByName.set(templateName, templateId);
                templateNameMap.set(templateName, templateId);
              }

              if (templateId !== null) {
                templateIdMap.set(templateSourceId, templateId);
              }
            }
          }
        }

        templateId = templateId ?? defaultTemplate?.id ?? null;
        const candidateWorkflowId =
          stateSourceId !== null
            ? (workflowIdMap.get(stateSourceId) ?? null)
            : null;
        const workflowIdRaw = await workflowResolver.resolve(
          projectId,
          WorkflowScope.CASES,
          candidateWorkflowId
        );
        const workflowId =
          workflowIdRaw != null
            ? ((await resolveCreateStateRemap(
                tx,
                projectId,
                WorkflowScope.CASES,
                workflowIdRaw
              )) ?? workflowIdRaw)
            : workflowIdRaw;

        if (templateId == null || workflowId == null) {
          logMessage(
            context,
            "Skipping case due to missing template or workflow mapping",
            {
              caseSourceId,
              templateSourceId,
              stateSourceId,
            }
          );
          decrementEntityTotal(context, "repositoryCases");
          canonicalCaseIds.delete(caseSourceId);
          stepsByCaseId.delete(caseSourceId);
          continue;
        }

        const resolvedTemplateId = templateId;
        const resolvedWorkflowId = workflowId;

        const creatorId = resolveUserId(
          userIdMap,
          fallbackCreator,
          record.created_by
        );
        const createdAt = toDateValue(record.created_at) ?? new Date();
        const order = toNumberValue(record.display_order) ?? 0;
        const estimateValue = toNumberValue(record.estimate);
        const { value: normalizedEstimate, adjustment: estimateAdjustment } =
          normalizeEstimate(estimateValue);
        if (
          estimateAdjustment === "nanoseconds" ||
          estimateAdjustment === "microseconds" ||
          estimateAdjustment === "milliseconds"
        ) {
          summaryDetails.estimateAdjusted += 1;
        } else if (estimateAdjustment === "clamped") {
          summaryDetails.estimateClamped += 1;
        }

        const repositoryCase = await tx.repositoryCases.create({
          data: {
            projectId,
            repositoryId: resolvedRepositoryId,
            folderId: resolvedFolderId,
            templateId: resolvedTemplateId,
            name: caseName,
            className: className ?? undefined,
            stateId: resolvedWorkflowId,
            estimate: normalizedEstimate ?? undefined,
            order,
            createdAt,
            creatorId,
            automated: toBooleanValue(record.automated ?? false),
            currentVersion: 1,
          },
        });

        caseIdMap.set(caseSourceId, repositoryCase.id);
        if (className) {
          caseKeyMap.set(`${projectSourceId}:${className}`, repositoryCase.id);
        }
        // Keep the chunk dedup map current so a later record in this same
        // chunk with the same (projectId, name, className) maps to this row
        // instead of attempting a duplicate insert.
        existingCaseByKey.set(
          existingCaseKey(projectId, caseName, className ?? null),
          { id: repositoryCase.id, isDeleted: false }
        );
        // Track field values created for this case so the multi-select pass
        // below can resolve existing values in memory instead of issuing a
        // findFirst per (case, field). Scoped per record — freed each
        // iteration, so memory does not grow with the import.
        const createdCaseFieldValueIdByFieldId = new Map<number, number>();
        const projectTemplateAssignments =
          templateAssignmentsByProject.get(projectId) ?? new Set<number>();
        projectTemplateAssignments.add(resolvedTemplateId);
        templateAssignmentsByProject.set(projectId, projectTemplateAssignments);
        summary.total += 1;
        summary.created += 1;

        incrementEntityProgress(context, "repositoryCases", 1, 0);
        processedSinceLastPersist += 1;
        if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
          const message = formatInProgressStatus(context, "repositoryCases");
          await persistProgress("repositoryCases", message);
          processedSinceLastPersist = 0;
        }

        for (const [key, rawValue] of Object.entries(record)) {
          if (!key.startsWith("custom_")) {
            continue;
          }

          const fieldName = key.replace(/^custom_/, "");
          const fieldId = caseFieldMap.get(fieldName);
          if (!fieldId) {
            continue;
          }

          const fieldMetadata = caseFieldMetadataById.get(fieldId);
          if (!fieldMetadata) {
            recordFieldWarning("Missing case field metadata", {
              field: fieldName,
              fieldId,
              caseSourceId,
            });
            continue;
          }

          if (
            rawValue === null ||
            rawValue === undefined ||
            (typeof rawValue === "string" && rawValue.trim().length === 0)
          ) {
            continue;
          }

          const processedValue = normalizeCaseFieldValue(
            rawValue,
            fieldMetadata,
            (message, details) =>
              recordFieldWarning(message, {
                caseSourceId,
                field: fieldMetadata.systemName,
                displayName: fieldMetadata.displayName,
                ...details,
              }),
            testmoFieldValueMap
          );

          // Collect stats for multi-select fields only
          if (fieldMetadata.type.toLowerCase().includes("multi-select")) {
            console.log(`  Processed value:`, processedValue);
            console.log(`  Processed value type: ${typeof processedValue}`);
            console.log(`  Is Array: ${Array.isArray(processedValue)}`);
            console.log(
              `  Will save to DB:`,
              processedValue !== null && processedValue !== undefined
            );

            const stats = dropdownStats.get(fieldMetadata.systemName) || {
              totalAttempts: 0,
              nullResults: 0,
              successResults: 0,
              sampleValues: new Set(),
              sampleNulls: [],
            };

            stats.totalAttempts++;

            if (processedValue === null || processedValue === undefined) {
              stats.nullResults++;
              if (stats.sampleNulls.length < 3) {
                stats.sampleNulls.push(rawValue);
              }
            } else {
              stats.successResults++;
              if (stats.sampleValues.size < 3) {
                stats.sampleValues.add(JSON.stringify(processedValue));
              }
            }

            dropdownStats.set(fieldMetadata.systemName, stats);
          }

          if (processedValue === undefined || processedValue === null) {
            continue;
          }

          if (
            isTipTapDocument(processedValue) &&
            isTipTapDocumentEmpty(processedValue as Record<string, unknown>)
          ) {
            continue;
          }

          if (typeof processedValue === "string" && !processedValue.trim()) {
            continue;
          }

          if (Array.isArray(processedValue) && processedValue.length === 0) {
            continue;
          }

          const createdFieldValue = await tx.caseFieldValues.create({
            data: {
              testCaseId: repositoryCase.id,
              fieldId,
              value: toInputJsonValue(processedValue),
            },
          });
          createdCaseFieldValueIdByFieldId.set(fieldId, createdFieldValue.id);
        }

        // Process multi-select values from repository_case_values dataset
        // These are stored separately from the custom_ fields in repository_cases

        // Build mapping from system names to Testmo field IDs from configuration
        const testmoFieldIdBySystemName = new Map<string, number>();
        for (const [key, fieldConfig] of Object.entries(
          configuration.templateFields ?? {}
        )) {
          const testmoFieldId = Number(key);
          if (fieldConfig && fieldConfig.systemName) {
            testmoFieldIdBySystemName.set(
              fieldConfig.systemName,
              testmoFieldId
            );
          }
        }

        for (const [systemName, fieldId] of caseFieldMap.entries()) {
          const fieldMetadata = caseFieldMetadataById.get(fieldId);
          if (
            !fieldMetadata ||
            !fieldMetadata.type.toLowerCase().includes("multi-select")
          ) {
            continue;
          }

          // Get the Testmo field ID for this system name
          const testmoFieldId = testmoFieldIdBySystemName.get(systemName);
          if (!testmoFieldId) {
            // No Testmo field mapping for this multi-select field
            continue;
          }

          // Look up values for this case and field using Testmo IDs
          const lookupKey = `${caseSourceId}:${testmoFieldId}`;
          const valueIds = multiSelectValuesByCaseAndField.get(lookupKey);

          if (!valueIds || valueIds.length === 0) {
            continue;
          }

          // Process the multi-select values
          const processedValue = normalizeCaseFieldValue(
            valueIds,
            fieldMetadata,
            (message, details) =>
              recordFieldWarning(message, {
                caseSourceId,
                field: fieldMetadata.systemName,
                displayName: fieldMetadata.displayName,
                source: "repository_case_values",
                ...details,
              }),
            testmoFieldValueMap
          );

          if (processedValue === undefined || processedValue === null) {
            continue;
          }

          if (Array.isArray(processedValue) && processedValue.length === 0) {
            continue;
          }

          // Resolve any value already created for this field from the
          // custom_ pass above via the per-record map. The case was created
          // in this transaction, so no other source of pre-existing values
          // is possible — this replaces a per-(case, field) findFirst.
          const existingValueId =
            createdCaseFieldValueIdByFieldId.get(fieldId);

          if (existingValueId !== undefined) {
            await tx.caseFieldValues.update({
              where: {
                id: existingValueId,
              },
              data: {
                value: toInputJsonValue(processedValue),
              },
            });
          } else {
            const createdFieldValue = await tx.caseFieldValues.create({
              data: {
                testCaseId: repositoryCase.id,
                fieldId,
                value: toInputJsonValue(processedValue),
              },
            });
            createdCaseFieldValueIdByFieldId.set(
              fieldId,
              createdFieldValue.id
            );
          }
        }

        const caseSteps = stepsByCaseId.get(caseSourceId) ?? [];
        const stepsForVersion: Array<{
          step: unknown;
          expectedResult: unknown;
        }> = [];
        if (caseSteps.length > 0) {
          let generatedOrder = 0;
          const stepEntries: Array<StepsUncheckedCreateInput> = [];

          for (const stepRecord of caseSteps) {
            const stepAction = toStringValue(stepRecord.text1);
            const stepData = toStringValue(stepRecord.text2);
            const expectedResult = toStringValue(stepRecord.text3);
            const expectedResultData = toStringValue(stepRecord.text4);

            if (
              !stepAction &&
              !stepData &&
              !expectedResult &&
              !expectedResultData
            ) {
              continue;
            }

            let orderValue = toNumberValue(stepRecord.display_order);
            if (orderValue === null) {
              generatedOrder += 1;
              orderValue = generatedOrder;
            } else {
              generatedOrder = orderValue;
            }

            const stepEntry: StepsUncheckedCreateInput = {
              testCaseId: repositoryCase.id,
              order: orderValue,
            };

            // Combine step action (text1) with step data (text2)
            if (stepAction || stepData) {
              let combinedStepText = stepAction || "";
              if (stepData) {
                // Append data wrapped in <data> tag
                combinedStepText +=
                  (combinedStepText ? "\n" : "") + `<data>${stepData}</data>`;
              }

              const stepPayload = convertToTipTapJsonValue(combinedStepText);
              if (stepPayload !== null) {
                stepEntry.step = JSON.stringify(stepPayload);
              }
            }

            // Combine expected result (text3) with expected result data (text4)
            if (expectedResult || expectedResultData) {
              let combinedExpectedText = expectedResult || "";
              if (expectedResultData) {
                // Append data wrapped in <data> tag
                combinedExpectedText +=
                  (combinedExpectedText ? "\n" : "") +
                  `<data>${expectedResultData}</data>`;
              }

              const expectedPayload =
                convertToTipTapJsonValue(combinedExpectedText);
              if (expectedPayload !== null) {
                stepEntry.expectedResult = JSON.stringify(expectedPayload);
              }
            }

            const parseJson = (value?: string) => {
              if (!value) {
                return emptyEditorContent;
              }
              try {
                return JSON.parse(value);
              } catch (error) {
                console.warn("Failed to parse repository case step", {
                  caseSourceId,
                  error,
                });
                return emptyEditorContent;
              }
            };

            stepsForVersion.push({
              step: parseJson(stepEntry.step as string | undefined),
              expectedResult: parseJson(
                stepEntry.expectedResult as string | undefined
              ),
            });

            stepEntries.push(stepEntry);
          }

          if (stepEntries.length > 0) {
            await tx.steps.createMany({ data: stepEntries });
          }
        }

        const _projectName = await getProjectName(tx, projectId);
        const _templateName = await getTemplateName(tx, resolvedTemplateId);
        const workflowName = await getWorkflowName(tx, resolvedWorkflowId);
        const _folderName = await getFolderName(tx, resolvedFolderId);
        const creatorName = await getUserName(tx, creatorId);
        const versionCaseName =
          toStringValue(record.name) ?? repositoryCase.name;

        // Create version snapshot using centralized helper
        const caseVersion = await createTestCaseVersionInTransaction(
          tx,
          repositoryCase.id,
          {
            // Use repositoryCase.currentVersion (already set on the case)
            creatorId,
            creatorName,
            createdAt: repositoryCase.createdAt ?? new Date(),
            overrides: {
              name: versionCaseName,
              stateId: resolvedWorkflowId,
              stateName: workflowName,
              estimate: repositoryCase.estimate ?? null,
              forecastManual: repositoryCase.forecastManual ?? null,
              forecastAutomated: repositoryCase.forecastAutomated ?? null,
              automated: repositoryCase.automated,
              isArchived: repositoryCase.isArchived,
              order,
              steps:
                stepsForVersion.length > 0
                  ? (stepsForVersion as JsonValue)
                  : null,
              tags: [],
              issues: [],
              links: [],
              attachments: [],
            },
          }
        );

        const caseFieldValuesForVersion = await tx.caseFieldValues.findMany({
          where: { testCaseId: repositoryCase.id },
          include: {
            field: {
              select: {
                displayName: true,
                systemName: true,
              },
            },
          },
        });

        if (caseFieldValuesForVersion.length > 0) {
          await tx.caseFieldVersionValues.createMany({
            data: caseFieldValuesForVersion.map((fieldValue) => ({
              versionId: caseVersion.id,
              field:
                fieldValue.field.displayName || fieldValue.field.systemName,
              value: fieldValue.value ?? JsonNull,
            })),
          });
        }

        canonicalCaseIds.delete(caseSourceId);
        stepsByCaseId.delete(caseSourceId);
      }
    });

    clearTipTapCache();
  };

  const totalChunks = Math.ceil(canonicalCaseRows.length / chunkSize);
  let currentChunk = 0;

  while (canonicalCaseRows.length > 0) {
    const chunkRecords = canonicalCaseRows.splice(
      Math.max(canonicalCaseRows.length - chunkSize, 0)
    );
    currentChunk++;
    logMessage(
      context,
      `Processing repository cases chunk ${currentChunk}/${totalChunks}`,
      {
        chunkSize: chunkRecords.length,
        remainingCases: canonicalCaseRows.length,
        processedCount: context.processedCount,
      }
    );
    await processChunk(chunkRecords);
  }

  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "repositoryCases");
    await persistProgress("repositoryCases", message);
  }

  logMessage(context, `Repository cases import completed`, {
    totalProcessed: summary.total,
    created: summary.created,
    mapped: summary.mapped,
    finalProcessedCount: context.processedCount,
    dropdownFieldSummary: Array.from(dropdownStats.entries()).map(
      ([field, stats]) => ({
        field,
        attempts: stats.totalAttempts,
        success: stats.successResults,
        failed: stats.nullResults,
      })
    ),
  });

  if (templateAssignmentsByProject.size > 0) {
    const assignmentRows: Array<{ projectId: number; templateId: number }> = [];
    for (const [projectId, templateIds] of templateAssignmentsByProject) {
      for (const templateId of templateIds) {
        assignmentRows.push({ projectId, templateId });
      }
    }

    if (assignmentRows.length > 0) {
      await db.templateProjectAssignment.createMany({
        data: assignmentRows,
        skipDuplicates: true,
      });
    }
  }

  if ((summaryDetails.estimateAdjusted ?? 0) > 0) {
    logMessage(
      context,
      "Converted repository case estimates from smaller units",
      {
        adjustments: summaryDetails.estimateAdjusted,
      }
    );
  }

  if ((summaryDetails.estimateClamped ?? 0) > 0) {
    logMessage(
      context,
      "Clamped oversized repository case estimates to int32 range",
      {
        clamped: summaryDetails.estimateClamped,
      }
    );
  }

  caseRows.length = 0;
  repositoryCaseStepRows.length = 0;
  canonicalCaseRows.length = 0;
  canonicalCaseIds.clear();
  stepsByCaseId.clear();
  clearTipTapCache();

  return {
    summary,
    caseIdMap,
    caseFieldMap,
    caseFieldMetadataById,
    caseMetaMap,
    caseKeyMap,
  };
};

const importTestRuns = async (
  tx: TxClient,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  _canonicalRepoIdByProject: Map<number, Set<number>>,
  configurationIdMap: Map<number, number>,
  milestoneIdMap: Map<number, number>,
  workflowIdMap: Map<number, number>,
  userIdMap: Map<number, string>,
  importJob: TestmoImportJob,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<TestRunsImportResult> => {
  const runRows = datasetRows.get("runs") ?? [];
  const summary: EntitySummaryResult = {
    entity: "testRuns",
    total: 0,
    created: 0,
    mapped: 0,
    details: {
      forecastAdjusted: 0,
      forecastClamped: 0,
      elapsedAdjusted: 0,
      elapsedClamped: 0,
    },
  };

  const summaryDetails = summary.details as Record<string, number>;
  const testRunIdMap = new Map<number, number>();

  if (runRows.length === 0) {
    logMessage(context, "No runs dataset found; skipping test run import.");
    return { summary, testRunIdMap };
  }

  initializeEntityProgress(context, "testRuns", runRows.length);
  let processedSinceLastPersist = 0;

  const workflowResolver = createWorkflowResolver(tx, workflowIdMap);

  for (const row of runRows) {
    const record = row as Record<string, unknown>;
    const sourceId = toNumberValue(record.id);
    const projectSourceId = toNumberValue(record.project_id);

    if (sourceId === null || projectSourceId === null) {
      decrementEntityTotal(context, "testRuns");
      continue;
    }

    const projectId = projectIdMap.get(projectSourceId);
    if (!projectId) {
      logMessage(context, "Skipping test run due to missing project mapping", {
        sourceId,
        projectSourceId,
      });
      decrementEntityTotal(context, "testRuns");
      continue;
    }

    const workflowSourceId = toNumberValue(record.state_id);
    const candidateStateId =
      workflowSourceId !== null
        ? (workflowIdMap.get(workflowSourceId) ?? null)
        : null;
    const stateIdRaw = await workflowResolver.resolve(
      projectId,
      WorkflowScope.RUNS,
      candidateStateId
    );

    if (!stateIdRaw) {
      logMessage(context, "Skipping test run due to missing workflow mapping", {
        sourceId,
        workflowSourceId,
      });
      decrementEntityTotal(context, "testRuns");
      continue;
    }

    const stateId =
      (await resolveCreateStateRemap(
        tx,
        projectId,
        WorkflowScope.RUNS,
        stateIdRaw
      )) ?? stateIdRaw;

    const configurationSourceId = toNumberValue(record.config_id);
    const configurationId =
      configurationSourceId !== null
        ? (configurationIdMap.get(configurationSourceId) ?? null)
        : null;

    const milestoneSourceId = toNumberValue(record.milestone_id);
    const milestoneId =
      milestoneSourceId !== null
        ? (milestoneIdMap.get(milestoneSourceId) ?? null)
        : null;

    const name = toStringValue(record.name) ?? `Imported Run ${sourceId}`;
    const note = convertToTipTapJsonString(record.note);
    const docs = convertToTipTapJsonString(record.docs);
    const createdAt = toDateValue(record.created_at) ?? new Date();
    const completedAt = toDateValue(record.closed_at);
    const isCompleted = toBooleanValue(record.is_closed);

    const createdById = resolveUserId(
      userIdMap,
      importJob.createdById,
      record.created_by
    );

    const forecastValue = toNumberValue(record.forecast);
    const elapsedValue = toNumberValue(record.elapsed);

    const { value: normalizedForecast, adjustment: forecastAdjustment } =
      normalizeEstimate(forecastValue);
    const { value: normalizedElapsed, adjustment: elapsedAdjustment } =
      normalizeEstimate(elapsedValue);

    if (
      forecastAdjustment === "microseconds" ||
      forecastAdjustment === "nanoseconds"
    ) {
      summaryDetails.forecastAdjusted += 1;
    } else if (forecastAdjustment === "milliseconds") {
      summaryDetails.forecastAdjusted += 1;
    } else if (forecastAdjustment === "clamped") {
      summaryDetails.forecastClamped += 1;
    }

    if (
      elapsedAdjustment === "microseconds" ||
      elapsedAdjustment === "nanoseconds"
    ) {
      summaryDetails.elapsedAdjusted += 1;
    } else if (elapsedAdjustment === "milliseconds") {
      summaryDetails.elapsedAdjusted += 1;
    } else if (elapsedAdjustment === "clamped") {
      summaryDetails.elapsedClamped += 1;
    }

    const createdRun = await tx.testRuns.create({
      data: {
        projectId,
        name,
        note: note ?? undefined,
        docs: docs ?? undefined,
        configId: configurationId ?? undefined,
        milestoneId: milestoneId ?? undefined,
        stateId,
        forecastManual: normalizedForecast ?? undefined,
        elapsed: normalizedElapsed ?? undefined,
        isCompleted,
        createdAt,
        createdById,
        completedAt: completedAt ?? undefined,
      },
    });

    testRunIdMap.set(sourceId, createdRun.id);
    summary.total += 1;
    summary.created += 1;

    incrementEntityProgress(context, "testRuns", 1, 0);
    processedSinceLastPersist += 1;

    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
      const message = formatInProgressStatus(context, "testRuns");
      await persistProgress("testRuns", message);
      processedSinceLastPersist = 0;
    }
  }

  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "testRuns");
    await persistProgress("testRuns", message);
  }

  if ((summaryDetails.forecastAdjusted ?? 0) > 0) {
    logMessage(context, "Adjusted test run forecasts to int32 range", {
      adjustments: summaryDetails.forecastAdjusted,
    });
  }

  if ((summaryDetails.forecastClamped ?? 0) > 0) {
    logMessage(context, "Clamped oversized test run forecasts to int32 range", {
      clamped: summaryDetails.forecastClamped,
    });
  }

  if ((summaryDetails.elapsedAdjusted ?? 0) > 0) {
    logMessage(context, "Adjusted test run elapsed durations to int32 range", {
      adjustments: summaryDetails.elapsedAdjusted,
    });
  }

  if ((summaryDetails.elapsedClamped ?? 0) > 0) {
    logMessage(context, "Clamped oversized test run elapsed durations", {
      clamped: summaryDetails.elapsedClamped,
    });
  }

  return { summary, testRunIdMap };
};

const importTestRunCases = async (
  db: DbClient,
  datasetRows: Map<string, any[]>,
  testRunIdMap: Map<number, number>,
  caseIdMap: Map<number, number>,
  caseMetaMap: Map<number, { projectId: number; name: string }>,
  userIdMap: Map<number, string>,
  statusIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<TestRunCasesImportResult> => {
  const runTestRows = datasetRows.get("run_tests") ?? [];
  const entityName = "testRunCases";
  const summary: EntitySummaryResult = {
    entity: "testRunCases",
    total: 0,
    created: 0,
    mapped: 0,
    details: {
      skippedUnselected: 0,
      importedUnselectedWithResults: 0,
    },
  };

  const summaryDetails = summary.details as Record<string, number>;
  const testRunCaseIdMap = new Map<number, number>();

  if (runTestRows.length === 0) {
    logMessage(
      context,
      "No run_tests dataset found; skipping test run case import."
    );
    return { summary, testRunCaseIdMap };
  }

  initializeEntityProgress(context, entityName, runTestRows.length);
  const progressEntry = context.entityProgress[entityName]!;
  progressEntry.total = runTestRows.length;

  let processedRows = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(
    1,
    Math.floor(Math.max(runTestRows.length, 1) / 50)
  );
  const minProgressIntervalMs = 2000;

  const reportProgress = async (force = false) => {
    if (runTestRows.length === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedRows - lastReportedCount;
    if (
      !force &&
      deltaCount < minProgressDelta &&
      now - lastReportAt < minProgressIntervalMs
    ) {
      return;
    }

    progressEntry.mapped = Math.min(processedRows, progressEntry.total);
    const processed = progressEntry.mapped;
    const totalForStatus = progressEntry.total;

    lastReportedCount = processedRows;
    lastReportAt = now;

    const statusMessage = `Processing test run case imports (${processed.toLocaleString()} / ${totalForStatus.toLocaleString()} cases processed)`;
    await persistProgress(entityName, statusMessage);
  };

  const completedStatusRecords = await db.status.findMany({
    select: { id: true, isCompleted: true },
  });
  const completedStatusIds = new Set<number>();
  for (const record of completedStatusRecords) {
    if (record.isCompleted) {
      completedStatusIds.add(record.id);
    }
  }

  const orderCounters = new Map<number, number>();
  const processedPairs = new Map<string, number>();
  const runTestIdsWithResults = new Set<number>();

  const runResultRows = datasetRows.get("run_results") ?? [];
  if (runResultRows.length > 0) {
    for (const row of runResultRows) {
      const resultRecord = row as Record<string, unknown>;
      const runTestSourceId = toNumberValue(resultRecord.test_id);
      if (runTestSourceId !== null) {
        runTestIdsWithResults.add(runTestSourceId);
      }
    }
  }

  await reportProgress(true);

  const batchSize = Math.max(1, Math.floor(TEST_RUN_CASE_CHUNK_SIZE / 2));

  for (let start = 0; start < runTestRows.length; start += batchSize) {
    const batch = runTestRows.slice(start, start + batchSize);

    const mappedRecords: Array<{
      record: Record<string, unknown>;
      data: TestRunCasesUncheckedCreateInput;
      runTestSourceId: number;
    }> = [];
    let duplicateMappingsInBatch = 0;

    for (const row of batch) {
      const record = row as Record<string, unknown>;
      processedRows += 1;
      const runTestSourceId = toNumberValue(record.id);
      const runSourceId = toNumberValue(record.run_id);
      const caseSourceId = toNumberValue(record.case_id);
      const _caseName =
        toStringValue(record.name) ?? `Imported Case ${caseSourceId ?? 0}`;

      if (
        runTestSourceId === null ||
        runSourceId === null ||
        caseSourceId === null
      ) {
        decrementEntityTotal(context, "testRunCases");
        continue;
      }

      const isSelected = toBooleanValue(record.is_selected);
      const hasLinkedResults = runTestIdsWithResults.has(runTestSourceId);
      if (!isSelected && !hasLinkedResults) {
        summaryDetails.skippedUnselected += 1;
        decrementEntityTotal(context, "testRunCases");
        continue;
      }

      if (!isSelected && hasLinkedResults) {
        summaryDetails.importedUnselectedWithResults += 1;
      }

      const testRunId = testRunIdMap.get(runSourceId);
      if (!testRunId) {
        logMessage(
          context,
          "Skipping test run case due to missing run mapping",
          {
            runTestSourceId,
            runSourceId,
          }
        );
        decrementEntityTotal(context, "testRunCases");
        continue;
      }

      let repositoryCaseId = caseIdMap.get(caseSourceId);

      if (!repositoryCaseId) {
        const meta = caseMetaMap.get(caseSourceId);
        if (meta) {
          const fallbackCase = await db.repositoryCases.findFirst({
            where: {
              projectId: meta.projectId,
              name: meta.name,
              isDeleted: false,
            },
            select: { id: true },
          });

          if (fallbackCase) {
            repositoryCaseId = fallbackCase.id;
            caseIdMap.set(caseSourceId, fallbackCase.id);
          }
        }
      }

      if (!repositoryCaseId) {
        logMessage(
          context,
          "Skipping test run case due to missing repository case",
          {
            runTestSourceId,
            caseSourceId,
          }
        );
        decrementEntityTotal(context, "testRunCases");
        continue;
      }

      const pairKey = `${testRunId}:${repositoryCaseId}`;
      const existingTestRunCaseId = processedPairs.get(pairKey);
      if (existingTestRunCaseId !== undefined) {
        testRunCaseIdMap.set(runTestSourceId, existingTestRunCaseId);
        summary.total += 1;
        summary.mapped += 1;
        duplicateMappingsInBatch += 1;
        continue;
      }

      const statusSourceId = toNumberValue(record.status_id);
      const statusId =
        statusSourceId !== null
          ? (statusIdMap.get(statusSourceId) ?? null)
          : null;
      const assignedSourceId = toNumberValue(record.assignee_id);
      const assignedToId =
        assignedSourceId !== null
          ? (userIdMap.get(assignedSourceId) ?? null)
          : null;

      const elapsedValue = toNumberValue(record.elapsed);
      const { value: normalizedElapsed } = normalizeEstimate(elapsedValue);

      const currentOrder = orderCounters.get(testRunId) ?? 0;
      orderCounters.set(testRunId, currentOrder + 1);

      const isCompleted =
        Boolean(statusId) && completedStatusIds.has(statusId as number);

      mappedRecords.push({
        record,
        runTestSourceId,
        data: {
          testRunId,
          repositoryCaseId,
          order: currentOrder,
          statusId: statusId ?? undefined,
          assignedToId: assignedToId ?? undefined,
          elapsed: normalizedElapsed ?? undefined,
          isCompleted,
        },
      });
    }

    if (mappedRecords.length > 0) {
      // Execute database operations in a transaction per batch
      const { createResult, persistedPairs } = await db.$transaction(
        async (tx) => {
          // Phase 13 SAF-01 — bulk-import skip_audit hatch (see the repository
          // case chunk above). Opts these testRunCases.createMany rows out of
          // row-level CDC capture; the job-level captureAuditEvent retains the
          // semantic event. SET LOCAL only inside a $transaction (Pitfall A).
          await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
          const createResult = await tx.testRunCases.createMany({
            data: mappedRecords.map((item) => item.data),
            skipDuplicates: true,
          });

          const persistedPairs = await tx.testRunCases.findMany({
            where: {
              isDeleted: false,
              OR: mappedRecords.map((item) => ({
                testRunId: item.data.testRunId,
                repositoryCaseId: item.data.repositoryCaseId,
              })),
            },
            select: {
              testRunId: true,
              repositoryCaseId: true,
              id: true,
            },
          });

          return { createResult, persistedPairs };
        }
      );

      summary.total += mappedRecords.length;
      summary.created += createResult.count;
      progressEntry.created += createResult.count;

      const sourceIdsByKey = new Map<string, number[]>();
      for (const item of mappedRecords) {
        const key = `${item.data.testRunId}:${item.data.repositoryCaseId}`;
        const sourceIds = sourceIdsByKey.get(key);
        if (sourceIds) {
          sourceIds.push(item.runTestSourceId);
        } else {
          sourceIdsByKey.set(key, [item.runTestSourceId]);
        }
      }

      for (const persisted of persistedPairs) {
        const key = `${persisted.testRunId}:${persisted.repositoryCaseId}`;
        processedPairs.set(key, persisted.id);
        const sourceIds = sourceIdsByKey.get(key) ?? [];
        if (sourceIds.length === 0) {
          continue;
        }
        for (const sourceId of sourceIds) {
          testRunCaseIdMap.set(sourceId, persisted.id);
        }
      }

      const createdCount = createResult.count;
      const mappedCount =
        mappedRecords.length > createdCount
          ? mappedRecords.length - createdCount
          : 0;
      incrementEntityProgress(
        context,
        "testRunCases",
        createdCount,
        mappedCount
      );
    }

    if (duplicateMappingsInBatch > 0) {
      incrementEntityProgress(
        context,
        "testRunCases",
        0,
        duplicateMappingsInBatch
      );
    }

    await reportProgress();
  }

  await reportProgress(true);

  return { summary, testRunCaseIdMap };
};

const importTestRunResults = async (
  db: DbClient,
  datasetRows: Map<string, any[]>,
  testRunIdMap: Map<number, number>,
  testRunCaseIdMap: Map<number, number>,
  statusIdMap: Map<number, number>,
  userIdMap: Map<number, string>,
  resultFieldMap: Map<string, number>,
  importJob: TestmoImportJob,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<{
  summary: EntitySummaryResult;
  testRunResultIdMap: Map<number, number>;
}> => {
  const resultRows = datasetRows.get("run_results") ?? [];
  datasetRows.delete("run_results");
  const summary: EntitySummaryResult = {
    entity: "testRunResults",
    total: 0,
    created: 0,
    mapped: 0,
    details: {
      elapsedAdjusted: 0,
      elapsedClamped: 0,
      missingStatus: 0,
    },
  };

  const summaryDetails = summary.details as Record<string, number>;
  const testRunResultIdMap = new Map<number, number>();
  const testRunCaseVersionCache = new Map<number, number>();

  if (resultRows.length === 0) {
    logMessage(
      context,
      "No run_results dataset found; skipping test run result import."
    );
    return { summary, testRunResultIdMap };
  }

  // Get the default "untested" status to use when source status is null
  const untestedStatus = await db.status.findFirst({
    where: { systemName: "untested" },
    select: { id: true },
  });

  if (!untestedStatus) {
    throw new Error("Default 'untested' status not found in workspace");
  }

  const defaultStatusId = untestedStatus.id;

  initializeEntityProgress(context, "testRunResults", resultRows.length);
  let processedSinceLastPersist = 0;
  const chunkSize = Math.max(1, TEST_RUN_RESULT_CHUNK_SIZE);
  logMessage(context, `Processing test run results in batches of ${chunkSize}`);

  const processChunk = async (
    records: Array<Record<string, unknown>>
  ): Promise<void> => {
    if (records.length === 0) {
      return;
    }
    await db.$transaction(async (tx: TxClient) => {
      // Phase 13 SAF-01 — bulk-import skip_audit hatch (see the repository
      // case chunk above). Opts these testRunResults rows out of row-level
      // CDC capture; the job-level captureAuditEvent retains the semantic
      // event. SET LOCAL only inside a $transaction (Pitfall A).
      await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
      for (const record of records) {
        const resultSourceId = toNumberValue(record.id);
        const runSourceId = toNumberValue(record.run_id);
        const runTestSourceId = toNumberValue(record.test_id);

        if (
          resultSourceId === null ||
          runSourceId === null ||
          runTestSourceId === null
        ) {
          decrementEntityTotal(context, "testRunResults");
          continue;
        }

        if (toBooleanValue(record.is_deleted)) {
          decrementEntityTotal(context, "testRunResults");
          continue;
        }

        const testRunId = testRunIdMap.get(runSourceId);
        if (!testRunId) {
          logMessage(
            context,
            "Skipping test run result due to missing run mapping",
            {
              resultSourceId,
              runSourceId,
            }
          );
          decrementEntityTotal(context, "testRunResults");
          continue;
        }

        const testRunCaseId = testRunCaseIdMap.get(runTestSourceId);
        if (!testRunCaseId) {
          logMessage(
            context,
            "Skipping test run result due to missing run case mapping",
            {
              resultSourceId,
              runTestSourceId,
            }
          );
          decrementEntityTotal(context, "testRunResults");
          continue;
        }

        const statusSourceId = toNumberValue(record.status_id);
        const statusId =
          statusSourceId !== null
            ? (statusIdMap.get(statusSourceId) ?? defaultStatusId)
            : defaultStatusId;

        const executedById = resolveUserId(
          userIdMap,
          importJob.createdById,
          record.created_by
        );
        const executedAt = toDateValue(record.created_at) ?? new Date();

        const elapsedValue = toNumberValue(record.elapsed);
        const { value: normalizedElapsed, adjustment: elapsedAdjustment } =
          normalizeEstimate(elapsedValue);

        if (
          elapsedAdjustment === "microseconds" ||
          elapsedAdjustment === "nanoseconds"
        ) {
          summaryDetails.elapsedAdjusted += 1;
        } else if (elapsedAdjustment === "milliseconds") {
          summaryDetails.elapsedAdjusted += 1;
        } else if (elapsedAdjustment === "clamped") {
          summaryDetails.elapsedClamped += 1;
        }

        const comment = toStringValue(record.comment);

        let testRunCaseVersion = testRunCaseVersionCache.get(testRunCaseId);
        if (testRunCaseVersion === undefined) {
          const runCase = await tx.testRunCases.findUnique({
            where: { id: testRunCaseId },
            select: {
              repositoryCase: {
                select: { currentVersion: true },
              },
            },
          });
          testRunCaseVersion = runCase?.repositoryCase?.currentVersion ?? 1;
          testRunCaseVersionCache.set(testRunCaseId, testRunCaseVersion);
        }

        const createdResult = await tx.testRunResults.create({
          data: {
            testRunId,
            testRunCaseId,
            testRunCaseVersion,
            statusId,
            executedById,
            executedAt,
            elapsed: normalizedElapsed ?? undefined,
            notes: comment ? toInputJsonValue(comment) : undefined,
          },
        });

        // Store the mapping from Testmo result ID to our result ID
        testRunResultIdMap.set(resultSourceId, createdResult.id);

        for (const [key, rawValue] of Object.entries(record)) {
          if (!key.startsWith("custom_")) {
            continue;
          }
          const fieldName = key.replace(/^custom_/, "");
          const fieldId = resultFieldMap.get(fieldName);
          if (!fieldId) {
            continue;
          }
          if (
            rawValue === null ||
            rawValue === undefined ||
            (typeof rawValue === "string" && rawValue.trim().length === 0)
          ) {
            continue;
          }

          await tx.resultFieldValues.create({
            data: {
              testRunResultsId: createdResult.id,
              fieldId,
              value: toInputJsonValue(rawValue),
            },
          });
        }

        summary.total += 1;
        summary.created += 1;

        incrementEntityProgress(context, "testRunResults", 1, 0);
        processedSinceLastPersist += 1;

        if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
          const message = formatInProgressStatus(context, "testRunResults");
          await persistProgress("testRunResults", message);
          processedSinceLastPersist = 0;
        }
      }
    });

    clearTipTapCache();
  };

  while (resultRows.length > 0) {
    const chunkRecords = resultRows.splice(
      Math.max(resultRows.length - chunkSize, 0)
    ) as Array<Record<string, unknown>>;
    await processChunk(chunkRecords);
  }

  if (processedSinceLastPersist > 0) {
    const message = formatInProgressStatus(context, "testRunResults");
    await persistProgress("testRunResults", message);
  }

  if ((summaryDetails.elapsedAdjusted ?? 0) > 0) {
    logMessage(context, "Adjusted test run result elapsed durations", {
      adjustments: summaryDetails.elapsedAdjusted,
    });
  }

  if ((summaryDetails.elapsedClamped ?? 0) > 0) {
    logMessage(context, "Clamped oversized test run result elapsed durations", {
      clamped: summaryDetails.elapsedClamped,
    });
  }

  if ((summaryDetails.missingStatus ?? 0) > 0) {
    logMessage(
      context,
      "Skipped test run results due to missing status mapping",
      {
        skipped: summaryDetails.missingStatus,
      }
    );
  }

  resultRows.length = 0;
  clearTipTapCache();
  return { summary, testRunResultIdMap };
};

const importTestRunStepResults = async (
  db: DbClient,
  datasetRows: Map<string, any[]>,
  testRunResultIdMap: Map<number, number>,
  testRunCaseIdMap: Map<number, number>,
  statusIdMap: Map<number, number>,
  _caseIdMap: Map<number, number>,
  importJob: TestmoImportJob,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<EntitySummaryResult> => {
  const entityName = "testRunStepResults";
  const stepResultRows = datasetRows.get("run_result_steps") ?? [];
  const summary: EntitySummaryResult = {
    entity: entityName,
    total: 0,
    created: 0,
    mapped: 0,
  };

  const plannedTotal =
    context.entityProgress[entityName]?.total ?? stepResultRows.length;
  const shouldStream =
    stepResultRows.length === 0 && plannedTotal > 0 && !!context.jobId;

  if (!shouldStream && stepResultRows.length === 0) {
    logMessage(
      context,
      "No run_result_steps dataset found; skipping step result import."
    );
    return summary;
  }

  const fetchBatchSize = 500;

  const rehydrateRow = (
    data: unknown,
    text1?: string | null,
    text2?: string | null,
    text3?: string | null,
    text4?: string | null
  ): Record<string, unknown> => {
    const cloned =
      typeof data === "object" && data !== null
        ? (JSON.parse(JSON.stringify(data)) as Record<string, unknown>)
        : {};
    const record =
      cloned && typeof cloned === "object"
        ? (cloned as Record<string, unknown>)
        : ({} as Record<string, unknown>);

    const textEntries: Array<[string, string | null | undefined]> = [
      ["text1", text1],
      ["text2", text2],
      ["text3", text3],
      ["text4", text4],
    ];

    for (const [key, value] of textEntries) {
      if (value !== null && value !== undefined && record[key] === undefined) {
        record[key] = value;
      }
    }

    return record;
  };

  const createChunkIterator = () => {
    if (!shouldStream) {
      return (async function* () {
        for (
          let offset = 0;
          offset < stepResultRows.length;
          offset += fetchBatchSize
        ) {
          const chunk = stepResultRows
            .slice(offset, offset + fetchBatchSize)
            .map((row) =>
              typeof row === "object" && row !== null
                ? (JSON.parse(JSON.stringify(row)) as Record<string, unknown>)
                : ({} as Record<string, unknown>)
            );
          yield chunk;
        }
      })();
    }

    if (!context.jobId) {
      throw new Error(
        "importTestRunStepResults requires context.jobId for streaming"
      );
    }

    return (async function* () {
      let nextRowIndex = 0;
      while (true) {
        const stagedRows = await db.testmoImportStaging.findMany({
          where: {
            jobId: context.jobId!,
            datasetName: "run_result_steps",
            rowIndex: {
              gte: nextRowIndex,
              lt: nextRowIndex + fetchBatchSize,
            },
          },
          orderBy: {
            rowIndex: "asc",
          },
          select: {
            rowIndex: true,
            rowData: true,
            text1: true,
            text2: true,
            text3: true,
            text4: true,
          },
        });

        if (stagedRows.length === 0) {
          break;
        }

        nextRowIndex = stagedRows[stagedRows.length - 1].rowIndex + 1;

        yield stagedRows.map((row) =>
          rehydrateRow(row.rowData, row.text1, row.text2, row.text3, row.text4)
        );
      }
    })();
  };

  const repositoryCaseIdByTestRunCaseId = new Map<number, number>();
  const missingRepositoryCaseIds = new Set<number>();

  const ensureRepositoryCasesLoaded = async (
    ids: Iterable<number>
  ): Promise<void> => {
    const uniqueIds = Array.from(
      new Set(
        Array.from(ids).filter(
          (id) =>
            !repositoryCaseIdByTestRunCaseId.has(id) &&
            !missingRepositoryCaseIds.has(id)
        )
      )
    );

    if (uniqueIds.length === 0) {
      return;
    }

    const cases = await db.testRunCases.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, repositoryCaseId: true },
    });

    const foundIds = new Set<number>();
    for (const testRunCase of cases) {
      repositoryCaseIdByTestRunCaseId.set(
        testRunCase.id,
        testRunCase.repositoryCaseId
      );
      foundIds.add(testRunCase.id);
    }

    for (const id of uniqueIds) {
      if (!foundIds.has(id)) {
        missingRepositoryCaseIds.add(id);
      }
    }
  };

  const untestedStatus = await db.status.findFirst({
    where: { systemName: "untested" },
    select: { id: true },
  });

  if (!untestedStatus) {
    throw new Error("Default 'untested' status not found");
  }

  const defaultStatusId = untestedStatus.id;

  initializeEntityProgress(context, entityName, plannedTotal);

  const chunkIterator = createChunkIterator();
  let processedCount = 0;

  for await (const chunk of chunkIterator) {
    const stepEntries: Array<{
      resultId: number;
      testRunCaseId: number;
      displayOrder: number;
      record: Record<string, unknown>;
    }> = [];
    const caseIdsForChunk = new Set<number>();

    for (const row of chunk) {
      const record = row as Record<string, unknown>;
      const resultSourceId = toNumberValue(record.result_id);
      const testRunCaseSourceId = toNumberValue(record.test_id);
      const displayOrder = toNumberValue(record.display_order);

      if (
        resultSourceId === null ||
        testRunCaseSourceId === null ||
        displayOrder === null
      ) {
        decrementEntityTotal(context, entityName);
        continue;
      }

      const resultId = testRunResultIdMap.get(resultSourceId);
      const testRunCaseId = testRunCaseIdMap.get(testRunCaseSourceId);

      if (!resultId || !testRunCaseId) {
        decrementEntityTotal(context, entityName);
        continue;
      }

      caseIdsForChunk.add(testRunCaseId);
      stepEntries.push({
        resultId,
        testRunCaseId,
        displayOrder,
        record,
      });
    }

    if (stepEntries.length === 0) {
      continue;
    }

    await ensureRepositoryCasesLoaded(caseIdsForChunk);

    for (const stepEntry of stepEntries) {
      const { resultId, testRunCaseId, displayOrder, record } = stepEntry;

      const repositoryCaseId =
        repositoryCaseIdByTestRunCaseId.get(testRunCaseId);

      if (!repositoryCaseId) {
        decrementEntityTotal(context, entityName);
        continue;
      }

      const stepAction = toStringValue(record.text1);
      const stepData = toStringValue(record.text2);
      const expectedResult = toStringValue(record.text3);
      const expectedResultData = toStringValue(record.text4);

      let stepContent: string | null = null;
      if (stepAction || stepData) {
        stepContent = stepAction || "";
        if (stepData) {
          stepContent += (stepContent ? "\n" : "") + `<data>${stepData}</data>`;
        }
      }

      let expectedResultContent: string | null = null;
      if (expectedResult || expectedResultData) {
        expectedResultContent = expectedResult || "";
        if (expectedResultData) {
          expectedResultContent +=
            (expectedResultContent ? "\n" : "") +
            `<data>${expectedResultData}</data>`;
        }
      }

      const stepPayload = stepContent
        ? convertToTipTapJsonValue(stepContent)
        : null;
      const expectedPayload = expectedResultContent
        ? convertToTipTapJsonValue(expectedResultContent)
        : null;

      const createdStep = await db.steps.create({
        data: {
          testCaseId: repositoryCaseId,
          order: displayOrder,
          step: stepPayload ? JSON.stringify(stepPayload) : undefined,
          expectedResult: expectedPayload
            ? JSON.stringify(expectedPayload)
            : undefined,
        },
      });

      const statusSourceId = toNumberValue(record.status_id);
      const statusId =
        statusSourceId !== null
          ? (statusIdMap.get(statusSourceId) ?? defaultStatusId)
          : defaultStatusId;

      const comment = toStringValue(record.comment);
      const elapsed = toNumberValue(record.elapsed);

      try {
        await db.testRunStepResults.create({
          data: {
            testRunResultId: resultId,
            stepId: createdStep.id,
            statusId,
            notes: comment ? toInputJsonValue(comment) : undefined,
            elapsed: elapsed ?? undefined,
          },
        });

        summary.total += 1;
        summary.created += 1;
      } catch (error) {
        logMessage(context, "Skipping duplicate step result", {
          resultId,
          stepId: createdStep.id,
          error: String(error),
        });
        decrementEntityTotal(context, entityName);
      }

      processedCount += 1;
      incrementEntityProgress(context, entityName, 1, 0);

      if (processedCount % PROGRESS_UPDATE_INTERVAL === 0) {
        const message = formatInProgressStatus(context, entityName);
        await persistProgress(entityName, message);
      }
    }
  }

  return summary;
};

async function importStatuses(
  tx: TxClient,
  configuration: TestmoMappingConfiguration
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "statuses",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const scopeRecords = await tx.statusScope.findMany({ select: { id: true } });
  const availableScopeIds = scopeRecords.map((record) => record.id);

  if (availableScopeIds.length === 0) {
    throw new Error(
      "No status scopes are configured in the workspace. Unable to import statuses."
    );
  }

  const colorCacheById = new Map<number, boolean>();
  const colorCacheByHex = new Map<string, number>();

  const resolveColorId = async (
    desiredId?: number | null,
    desiredHex?: string | null
  ): Promise<number> => {
    if (desiredId !== null && desiredId !== undefined) {
      if (!colorCacheById.has(desiredId)) {
        const exists = await tx.color.findUnique({ where: { id: desiredId } });
        if (!exists) {
          throw new Error(
            `Color ${desiredId} configured for a status does not exist.`
          );
        }
        colorCacheById.set(desiredId, true);
      }
      return desiredId;
    }

    const normalizedHex =
      normalizeColorHex(desiredHex) ?? DEFAULT_STATUS_COLOR_HEX;

    if (colorCacheByHex.has(normalizedHex)) {
      return colorCacheByHex.get(normalizedHex)!;
    }

    const color = await tx.color.findFirst({ where: { value: normalizedHex } });

    if (color) {
      colorCacheByHex.set(normalizedHex, color.id);
      return color.id;
    }

    if (normalizedHex !== DEFAULT_STATUS_COLOR_HEX) {
      return resolveColorId(undefined, DEFAULT_STATUS_COLOR_HEX);
    }

    throw new Error(
      "Unable to resolve a color to apply to an imported status."
    );
  };

  for (const [key, config] of Object.entries(configuration.statuses ?? {})) {
    const statusId = Number(key);
    if (!Number.isFinite(statusId) || !config) {
      continue;
    }

    summary.total += 1;

    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === undefined) {
        throw new Error(
          `Status ${statusId} is configured to map but no target status was provided.`
        );
      }

      const existing = await tx.status.findUnique({
        where: { id: config.mappedTo },
      });

      if (!existing) {
        throw new Error(
          `Status ${config.mappedTo} selected for mapping was not found.`
        );
      }

      config.mappedTo = existing.id;
      summary.mapped += 1;
      continue;
    }

    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Status ${statusId} requires a display name before it can be created.`
      );
    }

    let systemName = (config.systemName ?? "").trim();
    if (!SYSTEM_NAME_REGEX.test(systemName)) {
      systemName = generateSystemName(name);
    }

    if (!SYSTEM_NAME_REGEX.test(systemName)) {
      throw new Error(
        `Status "${name}" requires a valid system name (letters, numbers, underscore, starting with a letter).`
      );
    }

    const existingByName = await tx.status.findFirst({
      where: { name },
    });

    if (existingByName) {
      if (existingByName.isDeleted) {
        await tx.status.update({
          where: { id: existingByName.id },
          data: { isDeleted: false },
        });
      }
      config.action = "map";
      config.mappedTo = existingByName.id;
      config.name = existingByName.name;
      config.systemName = existingByName.systemName;
      summary.mapped += 1;
      continue;
    }

    const existingStatus = await tx.status.findFirst({
      where: { systemName },
    });

    if (existingStatus) {
      if (existingStatus.isDeleted) {
        await tx.status.update({
          where: { id: existingStatus.id },
          data: { isDeleted: false },
        });
      }
      config.action = "map";
      config.mappedTo = existingStatus.id;
      config.systemName = existingStatus.systemName;
      summary.mapped += 1;
      continue;
    }

    const colorId = await resolveColorId(
      config.colorId ?? null,
      config.colorHex ?? null
    );

    let scopeIds = Array.isArray(config.scopeIds)
      ? config.scopeIds.filter((value): value is number =>
          Number.isFinite(value as number)
        )
      : [];

    scopeIds = Array.from(new Set(scopeIds));

    if (scopeIds.length === 0) {
      scopeIds = availableScopeIds;
    }

    const aliases = (config.aliases ?? "").trim();

    const created = await tx.status.create({
      data: {
        name,
        systemName,
        aliases: aliases || null,
        colorId,
        isEnabled: config.isEnabled ?? true,
        isSuccess: config.isSuccess ?? false,
        isFailure: config.isFailure ?? false,
        isCompleted: config.isCompleted ?? false,
      },
    });

    if (scopeIds.length > 0) {
      await tx.statusScopeAssignment.createMany({
        data: scopeIds.map((scopeId) => ({
          statusId: created.id,
          scopeId,
        })),
        skipDuplicates: true,
      });
    }

    config.action = "map";
    config.mappedTo = created.id;
    config.systemName = systemName;
    config.colorId = colorId;
    config.scopeIds = scopeIds;
    config.aliases = aliases || null;
    summary.created += 1;
  }

  return summary;
}

async function processImportMode(
  importJob: TestmoImportJob,
  jobId: string,
  db: DbClient,
  tenantId?: string
) {
  if (FINAL_STATUSES.has(importJob.status)) {
    return { status: importJob.status };
  }

  if (!importJob.configuration) {
    throw new Error(
      `Testmo import job ${jobId} cannot start background import without configuration`
    );
  }

  const normalizedConfiguration = normalizeMappingConfiguration(
    importJob.configuration
  );

  const datasetRecords = await db.testmoImportDataset.findMany({
    where: { jobId },
    select: {
      name: true,
      rowCount: true,
    },
  });

  // Helper to load a dataset from staging on-demand
  const loadDatasetFromStaging = async (
    datasetName: string
  ): Promise<any[]> => {
    const mapStagedRow = (row: {
      rowData: unknown;
      fieldName?: string | null;
      fieldValue?: string | null;
      text1?: string | null;
      text2?: string | null;
      text3?: string | null;
      text4?: string | null;
    }) => {
      const data =
        typeof row.rowData === "object" && row.rowData !== null
          ? JSON.parse(JSON.stringify(row.rowData))
          : row.rowData;

      if (data && typeof data === "object") {
        const record = data as Record<string, unknown>;
        if (
          row.fieldValue !== null &&
          row.fieldValue !== undefined &&
          record.value === undefined
        ) {
          record.value = row.fieldValue;
        }
        if (
          row.fieldName &&
          (record.name === undefined || record.name === null)
        ) {
          record.name = row.fieldName;
        }
        const textKeys: Array<
          ["text1" | "text2" | "text3" | "text4", string | null | undefined]
        > = [
          ["text1", row.text1],
          ["text2", row.text2],
          ["text3", row.text3],
          ["text4", row.text4],
        ];
        for (const [key, value] of textKeys) {
          if (
            value !== null &&
            value !== undefined &&
            record[key] === undefined
          ) {
            record[key] = value;
          }
        }
      }

      return data;
    };

    try {
      const stagedRows = await db.testmoImportStaging.findMany({
        where: {
          jobId,
          datasetName,
        },
        orderBy: {
          rowIndex: "asc",
        },
        select: {
          rowData: true,
          fieldName: true,
          fieldValue: true,
          text1: true,
          text2: true,
          text3: true,
          text4: true,
        },
      });

      return stagedRows.map(mapStagedRow);
    } catch (error) {
      // If we get a serialization error, try loading in smaller batches
      logMessage(
        context,
        `Error loading ${datasetName} in single batch, trying batched approach: ${error}`
      );

      // Get total count
      const totalCount = await db.testmoImportStaging.count({
        where: {
          jobId,
          datasetName,
        },
      });

      // Use moderate batch size for large text datasets, larger for normal datasets
      const batchSize =
        datasetName === "automation_run_test_fields" ? 1000 : 5000;
      const allRows: any[] = [];

      for (let offset = 0; offset < totalCount; offset += batchSize) {
        try {
          const stagedRows = await db.testmoImportStaging.findMany({
            where: {
              jobId,
              datasetName,
            },
            orderBy: {
              rowIndex: "asc",
            },
            skip: offset,
            take: batchSize,
            select: {
              rowData: true,
              fieldName: true,
              fieldValue: true,
              text1: true,
              text2: true,
              text3: true,
              text4: true,
            },
          });

          const rows = stagedRows.map(mapStagedRow);

          allRows.push(...rows);
          logMessage(
            context,
            `Loaded batch ${offset}-${offset + batchSize} of ${datasetName} (${allRows.length}/${totalCount})`
          );
        } catch (batchError) {
          logMessage(
            context,
            `Error loading batch ${offset}-${offset + batchSize} of ${datasetName}, skipping: ${batchError}`
          );
          // Continue with next batch instead of failing entire import
        }
      }

      return allRows;
    }
  };

  // Small datasets that can be loaded into memory upfront (configuration data)
  const SMALL_DATASETS = new Set([
    "users",
    "roles",
    "groups",
    "user_groups",
    "states",
    "statuses",
    "templates",
    "template_fields",
    "fields",
    "field_values",
    "configs",
    "tags",
    "milestone_types",
  ]);

  // Load datasets into memory
  const datasetRowsByName = new Map<string, any[]>();
  const datasetRowCountByName = new Map<string, number>();

  for (const record of datasetRecords) {
    datasetRowCountByName.set(record.name, record.rowCount);

    // Only load small datasets into memory upfront
    if (SMALL_DATASETS.has(record.name)) {
      const rows = await loadDatasetFromStaging(record.name);
      datasetRowsByName.set(record.name, rows);
    } else {
      // For large datasets, set empty array as placeholder (will load on-demand)
      datasetRowsByName.set(record.name, []);
    }
  }

  const context = createInitialContext(jobId);
  logMessage(context, "Background import started.", { jobId });

  let currentEntity: string | null = null;

  const entityTotals = computeEntityTotals(
    normalizedConfiguration,
    datasetRowsByName,
    datasetRowCountByName
  );
  let plannedTotalCount = 0;
  for (const [entity, total] of entityTotals) {
    if (total > 0) {
      initializeEntityProgress(context, entity, total);
      plannedTotalCount += total;
    }
  }

  const formatEntityLabel = (entity: string): string =>
    entity
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^./, (char) => char.toUpperCase());

  const formatSummaryStatus = (summary: EntitySummaryResult): string => {
    const label = formatEntityLabel(summary.entity);
    return `${label}: ${summary.total} processed — ${summary.created} created · ${summary.mapped} mapped`;
  };

  const persistProgress = async (
    entity: string | null,
    statusMessage?: string
  ): Promise<void> => {
    currentEntity = entity;
    try {
      const now = Date.now();
      const _timeSinceLastUpdate = now - context.lastProgressUpdate;

      // Calculate progress metrics
      const metrics = calculateProgressMetrics(context, plannedTotalCount);

      const data: TestmoImportJobUpdateArgs["data"] = {
        currentEntity: entity,
        processedCount: context.processedCount,
        totalCount: plannedTotalCount,
        activityLog: toInputJsonValue(context.activityLog),
        entityProgress: toInputJsonValue(context.entityProgress),
        estimatedTimeRemaining: metrics.estimatedTimeRemaining,
        processingRate: metrics.processingRate,
      };
      if (statusMessage) {
        data.statusMessage = statusMessage;
      }
      await db.testmoImportJob.update({
        where: { id: jobId },
        data,
      } as TestmoImportJobUpdateArgs);

      context.lastProgressUpdate = now;
    } catch (progressError) {
      console.error(
        `Failed to update Testmo import progress for job ${jobId}`,
        progressError
      );
    }
  };

  const phaseDurations: { phase: string; durationMs: number; items: number }[] =
    [];

  const timedPhase = async <T>(
    phaseName: string,
    fn: () => Promise<T>,
    itemCount?: (result: T) => number
  ): Promise<T> => {
    const phaseStart = Date.now();
    console.log(`[IMPORT TIMING] ▶ ${phaseName} started`);
    const result = await fn();
    const durationMs = Date.now() - phaseStart;
    const items = itemCount ? itemCount(result) : 0;
    const durationSec = (durationMs / 1000).toFixed(1);
    const rateNum =
      items > 0 && durationMs > 0 ? items / (durationMs / 1000) : 0;
    const rate = rateNum > 0 ? rateNum.toFixed(1) : "n/a";
    console.log(
      `[IMPORT TIMING] ✓ ${phaseName} completed in ${durationSec}s (${items} items, ${rate} items/sec)`
    );
    phaseDurations.push({ phase: phaseName, durationMs, items });
    // Record observed rate for ETA calculations
    if (rateNum > 0) {
      context.entityRates[phaseName] = rateNum;
    }
    return result;
  };

  const importStart = new Date();

  await db.testmoImportJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      phase: "IMPORTING",
      statusMessage: "Background import started",
      lastImportStartedAt: importStart,
      processedCount: 0,
      errorCount: 0,
      skippedCount: 0,
      totalCount: plannedTotalCount,
      currentEntity: null,
      estimatedTimeRemaining: null,
      processingRate: null,
      activityLog: toInputJsonValue(context.activityLog),
      entityProgress: toInputJsonValue(context.entityProgress),
    },
  });

  try {
    const withTransaction = async <T>(
      operation: (tx: TxClient) => Promise<T>,
      options?: { timeoutMs?: number }
    ): Promise<T> => {
      void options;
      return db.$transaction(operation);
    };

    logMessage(context, "Processing workflow mappings");
    await persistProgress("workflows", "Processing workflow mappings");
    const workflowSummary = await timedPhase(
      "workflows",
      () =>
        withTransaction((tx) => importWorkflows(tx, normalizedConfiguration)),
      (s) => s.total
    );
    recordEntitySummary(context, workflowSummary);
    await persistProgress("workflows", formatSummaryStatus(workflowSummary));

    logMessage(context, "Processing status mappings");
    await persistProgress("statuses", "Processing status mappings");
    const statusSummary = await timedPhase(
      "statuses",
      () =>
        withTransaction((tx) => importStatuses(tx, normalizedConfiguration)),
      (s) => s.total
    );
    recordEntitySummary(context, statusSummary);
    await persistProgress("statuses", formatSummaryStatus(statusSummary));

    logMessage(context, "Processing group mappings");
    await persistProgress("groups", "Processing group mappings");
    const groupSummary = await timedPhase(
      "groups",
      () => withTransaction((tx) => importGroups(tx, normalizedConfiguration)),
      (s) => s.total
    );
    recordEntitySummary(context, groupSummary);
    await persistProgress("groups", formatSummaryStatus(groupSummary));

    logMessage(context, "Processing tag mappings");
    await persistProgress("tags", "Processing tag mappings");
    const tagSummary = await timedPhase(
      "tags",
      () => withTransaction((tx) => importTags(tx, normalizedConfiguration)),
      (s) => s.total
    );
    recordEntitySummary(context, tagSummary);
    await persistProgress("tags", formatSummaryStatus(tagSummary));

    logMessage(context, "Processing role mappings");
    await persistProgress("roles", "Processing role mappings");
    const roleSummary = await timedPhase(
      "roles",
      () => withTransaction((tx) => importRoles(tx, normalizedConfiguration)),
      (s) => s.total
    );
    recordEntitySummary(context, roleSummary);
    await persistProgress("roles", formatSummaryStatus(roleSummary));

    logMessage(context, "Processing milestone type mappings");
    await persistProgress(
      "milestoneTypes",
      "Processing milestone type mappings"
    );
    const milestoneSummary = await timedPhase(
      "milestoneTypes",
      () =>
        withTransaction((tx) =>
          importMilestoneTypes(tx, normalizedConfiguration)
        ),
      (s) => s.total
    );
    recordEntitySummary(context, milestoneSummary);
    await persistProgress(
      "milestoneTypes",
      formatSummaryStatus(milestoneSummary)
    );

    logMessage(context, "Processing configuration mappings");
    await persistProgress(
      "configurations",
      "Processing configuration mappings"
    );
    const configurationSummary = await timedPhase(
      "configurations",
      () =>
        withTransaction((tx) =>
          importConfigurations(tx, normalizedConfiguration)
        ),
      (s) => s.total
    );
    recordEntitySummary(context, configurationSummary);
    await persistProgress(
      "configurations",
      formatSummaryStatus(configurationSummary)
    );

    logMessage(context, "Processing template mappings");
    await persistProgress("templates", "Processing template mappings");
    const { summary: templateSummary, templateMap } = await timedPhase(
      "templates",
      () =>
        withTransaction((tx) => importTemplates(tx, normalizedConfiguration)),
      (r) => r.summary.total
    );
    recordEntitySummary(context, templateSummary);
    await persistProgress("templates", formatSummaryStatus(templateSummary));

    logMessage(context, "Processing template field mappings");
    await persistProgress(
      "templateFields",
      "Processing template field mappings"
    );
    const templateFieldSummary = await timedPhase(
      "templateFields",
      () =>
        withTransaction((tx) =>
          importTemplateFields(
            tx,
            normalizedConfiguration,
            templateMap,
            datasetRowsByName
          )
        ),
      (s) => s.total
    );
    recordEntitySummary(context, templateFieldSummary);
    await persistProgress(
      "templateFields",
      formatSummaryStatus(templateFieldSummary)
    );
    releaseDatasetRows(datasetRowsByName, "template_fields");

    // Build caseFieldMap and resultFieldMap from template fields configuration
    // This ensures newly created fields (action='create') are included
    const updatedFieldMaps = buildTemplateFieldMaps(
      normalizedConfiguration.templateFields ?? {}
    );
    const caseFieldMap = updatedFieldMaps.caseFields;
    const resultFieldMap = updatedFieldMaps.resultFields;

    logMessage(context, "Processing user mappings");
    await persistProgress("users", "Processing user mappings");
    const userSummary = await timedPhase(
      "users",
      () =>
        withTransaction((tx) =>
          importUsers(tx, normalizedConfiguration, importJob)
        ),
      (s) => s.total
    );
    recordEntitySummary(context, userSummary);
    await persistProgress("users", formatSummaryStatus(userSummary));

    logMessage(context, "Processing user group assignments");
    await persistProgress("userGroups", "Processing user group assignments");
    const userGroupsSummary = await timedPhase(
      "userGroups",
      () =>
        withTransaction((tx) =>
          importUserGroups(tx, normalizedConfiguration, datasetRowsByName)
        ),
      (s) => s.total
    );
    recordEntitySummary(context, userGroupsSummary);
    await persistProgress("userGroups", formatSummaryStatus(userGroupsSummary));

    const workflowIdMap = buildNumberIdMap(
      normalizedConfiguration.workflows ?? {}
    );
    const statusIdMap = buildNumberIdMap(
      normalizedConfiguration.statuses ?? {}
    );
    const configurationIdMap = buildNumberIdMap(
      normalizedConfiguration.configurations ?? {}
    );
    const milestoneTypeIdMap = buildNumberIdMap(
      normalizedConfiguration.milestoneTypes ?? {}
    );
    const templateIdMap = buildNumberIdMap(
      normalizedConfiguration.templates ?? {}
    );
    const userIdMap = buildStringIdMap(normalizedConfiguration.users ?? {});

    logMessage(context, "Processing project imports");
    await persistProgress("projects", "Processing project imports");

    const projectImport = await timedPhase(
      "projects",
      async () => {
        // Load projects dataset on-demand
        if (datasetRowsByName.get("projects")?.length === 0) {
          datasetRowsByName.set(
            "projects",
            await loadDatasetFromStaging("projects")
          );
        }

        return withTransaction((tx) =>
          importProjects(
            tx,
            datasetRowsByName,
            importJob,
            userIdMap,
            statusIdMap,
            workflowIdMap,
            milestoneTypeIdMap,
            templateIdMap,
            templateMap,
            context,
            persistProgress
          )
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, projectImport.summary);
    await persistProgress(
      "projects",
      formatSummaryStatus(projectImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "projects");

    // Import project_links
    logMessage(context, "Processing project links");
    await persistProgress("projectLinks", "Processing project links");

    const projectLinksImport = await timedPhase(
      "projectLinks",
      async () => {
        if (datasetRowsByName.get("project_links")?.length === 0) {
          datasetRowsByName.set(
            "project_links",
            await loadDatasetFromStaging("project_links")
          );
        }

        return withTransaction((tx) =>
          importProjectLinks(
            tx,
            normalizedConfiguration,
            datasetRowsByName,
            projectImport.projectIdMap,
            context
          )
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, projectLinksImport);
    await persistProgress(
      "projectLinks",
      formatSummaryStatus(projectLinksImport)
    );
    releaseDatasetRows(datasetRowsByName, "project_links");

    logMessage(context, "Processing milestone imports");
    await persistProgress("milestones", "Processing milestone imports");

    const milestoneImport = await timedPhase(
      "milestones",
      async () => {
        // Load milestones dataset on-demand
        if (datasetRowsByName.get("milestones")?.length === 0) {
          datasetRowsByName.set(
            "milestones",
            await loadDatasetFromStaging("milestones")
          );
        }

        return withTransaction((tx) =>
          importMilestones(
            tx,
            datasetRowsByName,
            projectImport.projectIdMap,
            milestoneTypeIdMap,
            userIdMap,
            importJob,
            context,
            persistProgress
          )
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, milestoneImport.summary);
    await persistProgress(
      "milestones",
      formatSummaryStatus(milestoneImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "milestones");

    // Import milestone_links
    logMessage(context, "Processing milestone links");
    await persistProgress("milestoneLinks", "Processing milestone links");

    const milestoneLinksImport = await timedPhase(
      "milestoneLinks",
      async () => {
        if (datasetRowsByName.get("milestone_links")?.length === 0) {
          datasetRowsByName.set(
            "milestone_links",
            await loadDatasetFromStaging("milestone_links")
          );
        }

        return withTransaction((tx) =>
          importMilestoneLinks(
            tx,
            normalizedConfiguration,
            datasetRowsByName,
            milestoneImport.milestoneIdMap,
            context
          )
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, milestoneLinksImport);
    await persistProgress(
      "milestoneLinks",
      formatSummaryStatus(milestoneLinksImport)
    );
    releaseDatasetRows(datasetRowsByName, "milestone_links");

    // NOTE: milestone_automation_tags cannot be imported because Milestones model
    // does not have a tags relation in the schema. This would need to be added first.

    logMessage(context, "Processing session imports");
    await persistProgress("sessions", "Processing session imports");

    const sessionImport = await timedPhase(
      "sessions",
      async () => {
        // Load sessions dataset on-demand
        if (datasetRowsByName.get("sessions")?.length === 0) {
          datasetRowsByName.set(
            "sessions",
            await loadDatasetFromStaging("sessions")
          );
        }

        return withTransaction((tx) =>
          importSessions(
            tx,
            datasetRowsByName,
            projectImport.projectIdMap,
            milestoneImport.milestoneIdMap,
            configurationIdMap,
            workflowIdMap,
            userIdMap,
            templateIdMap,
            importJob,
            context,
            persistProgress
          )
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, sessionImport.summary);
    await persistProgress(
      "sessions",
      formatSummaryStatus(sessionImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "sessions");

    logMessage(context, "Processing session results imports");
    await persistProgress(
      "sessionResults",
      "Processing session results imports"
    );

    const sessionResultsImport = await timedPhase(
      "sessionResults",
      async () => {
        // Load session_results dataset on-demand
        if (datasetRowsByName.get("session_results")?.length === 0) {
          datasetRowsByName.set(
            "session_results",
            await loadDatasetFromStaging("session_results")
          );
        }

        return withTransaction((tx) =>
          importSessionResults(
            tx,
            datasetRowsByName,
            sessionImport.sessionIdMap,
            statusIdMap,
            userIdMap,
            importJob,
            context,
            persistProgress
          )
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, sessionResultsImport.summary);
    await persistProgress(
      "sessionResults",
      formatSummaryStatus(sessionResultsImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "session_results");

    logMessage(context, "Processing session tag assignments");
    await persistProgress("sessionTags", "Processing session tag assignments");

    const sessionTagsSummary = await timedPhase(
      "sessionTags",
      async () => {
        // Load session_tags dataset on-demand
        if (datasetRowsByName.get("session_tags")?.length === 0) {
          datasetRowsByName.set(
            "session_tags",
            await loadDatasetFromStaging("session_tags")
          );
        }

        return withTransaction((tx) =>
          importSessionTags(
            tx,
            normalizedConfiguration,
            datasetRowsByName,
            sessionImport.sessionIdMap
          )
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, sessionTagsSummary);
    await persistProgress(
      "sessionTags",
      formatSummaryStatus(sessionTagsSummary)
    );
    releaseDatasetRows(datasetRowsByName, "session_tags");

    // Load field_values dataset if not already loaded (needed for session values and case values)
    if (datasetRowsByName.get("field_values")?.length === 0) {
      datasetRowsByName.set(
        "field_values",
        await loadDatasetFromStaging("field_values")
      );
    }

    // Build mapping from Testmo field_value IDs to field and name
    const testmoFieldValueMap = new Map<
      number,
      { fieldId: number; name: string }
    >();
    const fieldValueRows = datasetRowsByName.get("field_values") ?? [];
    for (const row of fieldValueRows) {
      const record = row as Record<string, unknown>;
      const id = toNumberValue(record.id);
      const fieldId = toNumberValue(record.field_id);
      const name = toStringValue(record.name);
      if (id !== null && fieldId !== null && name) {
        testmoFieldValueMap.set(id, { fieldId, name });
      }
    }

    logMessage(context, "Processing repository imports");
    await persistProgress("repositories", "Processing repository imports");

    const repositoryImport = await timedPhase(
      "repositories",
      async () => {
        // Load repositories dataset on-demand
        if (datasetRowsByName.get("repositories")?.length === 0) {
          datasetRowsByName.set(
            "repositories",
            await loadDatasetFromStaging("repositories")
          );
        }

        return withTransaction((tx) =>
          importRepositories(
            tx,
            datasetRowsByName,
            projectImport.projectIdMap,
            context,
            persistProgress
          )
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, repositoryImport.summary);
    await persistProgress(
      "repositories",
      formatSummaryStatus(repositoryImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "repositories");

    logMessage(context, "Processing repository folders");
    await persistProgress("repositoryFolders", "Processing repository folders");

    const folderImport = await timedPhase(
      "repositoryFolders",
      async () => {
        // Load repository_folders dataset on-demand
        if (datasetRowsByName.get("repository_folders")?.length === 0) {
          datasetRowsByName.set(
            "repository_folders",
            await loadDatasetFromStaging("repository_folders")
          );
        }
        if (repositoryImport.masterRepositoryIds.size > 0) {
          const filtered = (
            datasetRowsByName.get("repository_folders") ?? []
          ).filter((row: any) => {
            const repoId = toNumberValue(row.repo_id);
            return repoId === null
              ? true
              : repositoryImport.masterRepositoryIds.has(repoId);
          });
          datasetRowsByName.set("repository_folders", filtered);
        }

        return importRepositoryFolders(
          db,
          datasetRowsByName,
          projectImport.projectIdMap,
          repositoryImport.repositoryIdMap,
          repositoryImport.canonicalRepoIdByProject,
          importJob,
          userIdMap,
          context,
          persistProgress
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, folderImport.summary);
    await persistProgress(
      "repositoryFolders",
      formatSummaryStatus(folderImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "repository_folders");

    logMessage(context, "Processing repository cases");
    await persistProgress("repositoryCases", "Processing repository cases");

    const caseImport = await timedPhase(
      "repositoryCases",
      async () => {
        // Load repository_cases and related datasets on-demand
        if (datasetRowsByName.get("repository_cases")?.length === 0) {
          datasetRowsByName.set(
            "repository_cases",
            await loadDatasetFromStaging("repository_cases")
          );
        }
        if (repositoryImport.masterRepositoryIds.size > 0) {
          const filteredCases =
            datasetRowsByName.get("repository_cases")?.filter((row: any) => {
              const repoId = toNumberValue(row.repo_id);
              return repoId === null
                ? true
                : repositoryImport.masterRepositoryIds.has(repoId);
            }) ?? [];
          datasetRowsByName.set("repository_cases", filteredCases);
        }
        if (datasetRowsByName.get("repository_case_steps")?.length === 0) {
          datasetRowsByName.set(
            "repository_case_steps",
            await loadDatasetFromStaging("repository_case_steps")
          );
        }
        if (repositoryImport.masterRepositoryIds.size > 0) {
          const filteredSteps =
            datasetRowsByName
              .get("repository_case_steps")
              ?.filter((row: any) => {
                const repoId = toNumberValue(row.repo_id);
                return repoId === null
                  ? true
                  : repositoryImport.masterRepositoryIds.has(repoId);
              }) ?? [];
          datasetRowsByName.set("repository_case_steps", filteredSteps);
        }

        // Load repository_case_values dataset if not already loaded
        // This dataset contains multi-select field values (one row per selected value)
        if (
          !datasetRowsByName.has("repository_case_values") ||
          datasetRowsByName.get("repository_case_values")?.length === 0
        ) {
          const caseValuesData = await loadDatasetFromStaging(
            "repository_case_values"
          );
          datasetRowsByName.set("repository_case_values", caseValuesData);
        }
        if (repositoryImport.masterRepositoryIds.size > 0) {
          const filteredCaseValues =
            datasetRowsByName
              .get("repository_case_values")
              ?.filter((row: any) => {
                const repoId = toNumberValue(row.repo_id);
                return repoId === null
                  ? true
                  : repositoryImport.masterRepositoryIds.has(repoId);
              }) ?? [];
          datasetRowsByName.set("repository_case_values", filteredCaseValues);
        }

        return importRepositoryCases(
          db,
          datasetRowsByName,
          projectImport.projectIdMap,
          repositoryImport.repositoryIdMap,
          repositoryImport.canonicalRepoIdByProject,
          folderImport.folderIdMap,
          folderImport.repositoryRootFolderMap,
          templateIdMap,
          templateMap,
          workflowIdMap,
          userIdMap,
          caseFieldMap,
          testmoFieldValueMap,
          normalizedConfiguration,
          importJob,
          context,
          persistProgress
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, caseImport.summary);
    await persistProgress(
      "repositoryCases",
      formatSummaryStatus(caseImport.summary)
    );
    releaseDatasetRows(
      datasetRowsByName,
      "repository_cases",
      "repository_case_steps",
      "templates"
    );

    logMessage(context, "Processing repository case tag assignments");
    await persistProgress(
      "repositoryCaseTags",
      "Processing repository case tag assignments"
    );

    const repositoryCaseTagsSummary = await timedPhase(
      "repositoryCaseTags",
      async () => {
        // Load repository_case_tags dataset on-demand
        if (datasetRowsByName.get("repository_case_tags")?.length === 0) {
          datasetRowsByName.set(
            "repository_case_tags",
            await loadDatasetFromStaging("repository_case_tags")
          );
        }

        return withTransaction((tx) =>
          importRepositoryCaseTags(
            tx,
            normalizedConfiguration,
            datasetRowsByName,
            caseImport.caseIdMap
          )
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, repositoryCaseTagsSummary);
    await persistProgress(
      "repositoryCaseTags",
      formatSummaryStatus(repositoryCaseTagsSummary)
    );
    releaseDatasetRows(datasetRowsByName, "repository_case_tags");

    // Resolve snapshot case IDs to master cases via the Testmo `key` field.
    // Closed runs in Testmo reference snapshot repositories, so run_tests.case_id
    // may point to a snapshot case ID. The `key` field is stable across master and
    // snapshot copies of the same case, allowing us to map back to the imported case.
    const snapshotCaseKeys = await loadDatasetFromStaging(
      "_snapshot_case_keys"
    );
    if (snapshotCaseKeys.length > 0) {
      let resolvedCount = 0;
      let alreadyMappedCount = 0;
      let unresolvedCount = 0;

      for (const row of snapshotCaseKeys) {
        const record = row as Record<string, unknown>;
        const snapshotCaseId = toNumberValue(record.id);
        const key = toStringValue(record.key);
        const projectSourceId = toNumberValue(record.project_id);

        if (snapshotCaseId === null || !key || projectSourceId === null) {
          continue;
        }

        // Skip if this ID is already in caseIdMap (e.g., it matched a master case)
        if (caseImport.caseIdMap.has(snapshotCaseId)) {
          alreadyMappedCount++;
          continue;
        }

        // Look up the master case by project + key
        const lookupKey = `${projectSourceId}:${key}`;
        const importedCaseId = caseImport.caseKeyMap.get(lookupKey);
        if (importedCaseId) {
          caseImport.caseIdMap.set(snapshotCaseId, importedCaseId);
          resolvedCount++;
        } else {
          unresolvedCount++;
        }
      }

      logMessage(
        context,
        `Snapshot case key resolution: ${resolvedCount} resolved, ${alreadyMappedCount} already mapped, ${unresolvedCount} unresolved out of ${snapshotCaseKeys.length} snapshot cases`
      );
    }

    // ===== AUTOMATION IMPORTS =====
    logMessage(context, "Processing automation case imports");
    await persistProgress(
      "automationCases",
      "Processing automation case imports"
    );

    const automationCaseImport = await timedPhase(
      "automationCases",
      async () => {
        // Load automation_cases dataset on-demand
        if (datasetRowsByName.get("automation_cases")?.length === 0) {
          datasetRowsByName.set(
            "automation_cases",
            await loadDatasetFromStaging("automation_cases")
          );
        }

        return importAutomationCases(
          db,
          normalizedConfiguration,
          datasetRowsByName,
          projectImport.projectIdMap,
          repositoryImport.repositoryIdMap,
          folderImport.folderIdMap,
          templateIdMap,
          projectImport.defaultTemplateIdByProject,
          workflowIdMap,
          context,
          persistProgress,
          {
            chunkSize: AUTOMATION_CASE_CHUNK_SIZE,
            transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS,
          }
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, automationCaseImport.summary);
    await persistProgress(
      "automationCases",
      formatSummaryStatus(automationCaseImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "automation_cases");

    const automationCaseProjectMap =
      automationCaseImport.automationCaseProjectMap;

    logMessage(context, "Processing automation run imports");
    await persistProgress(
      "automationRuns",
      "Processing automation run imports"
    );

    const automationRunImport = await timedPhase(
      "automationRuns",
      async () => {
        // Load automation_runs dataset on-demand
        if (datasetRowsByName.get("automation_runs")?.length === 0) {
          datasetRowsByName.set(
            "automation_runs",
            await loadDatasetFromStaging("automation_runs")
          );
        }

        return importAutomationRuns(
          db,
          normalizedConfiguration,
          datasetRowsByName,
          projectImport.projectIdMap,
          configurationIdMap,
          milestoneImport.milestoneIdMap,
          workflowIdMap,
          userIdMap,
          importJob.createdById,
          context,
          persistProgress,
          {
            chunkSize: AUTOMATION_RUN_CHUNK_SIZE,
            transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS,
          }
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, automationRunImport.summary);
    await persistProgress(
      "automationRuns",
      formatSummaryStatus(automationRunImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "automation_runs");

    logMessage(context, "Processing automation run test imports");
    await persistProgress(
      "automationRunTests",
      "Processing automation run test imports"
    );

    const automationRunTestImport = await timedPhase(
      "automationRunTests",
      async () => {
        // Load automation_run_tests dataset on-demand
        if (datasetRowsByName.get("automation_run_tests")?.length === 0) {
          datasetRowsByName.set(
            "automation_run_tests",
            await loadDatasetFromStaging("automation_run_tests")
          );
        }

        return importAutomationRunTests(
          db,
          normalizedConfiguration,
          datasetRowsByName,
          projectImport.projectIdMap,
          automationRunImport.testRunIdMap,
          automationRunImport.testSuiteIdMap,
          automationRunImport.testRunTimestampMap,
          automationRunImport.testRunProjectIdMap,
          automationRunImport.testRunTestmoProjectIdMap,
          automationCaseProjectMap,
          statusIdMap,
          userIdMap,
          importJob.createdById,
          context,
          persistProgress,
          {
            chunkSize: AUTOMATION_RUN_TEST_CHUNK_SIZE,
            transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS,
          }
        );
      },
      (r) => r.summary.total
    );
    const automationRunTestSummary = automationRunTestImport.summary;
    const automationRunTestCaseMap = automationRunTestImport.testRunCaseIdMap;
    const automationRunJunitResultMap =
      automationRunTestImport.junitResultIdMap;
    recordEntitySummary(context, automationRunTestSummary);
    await persistProgress(
      "automationRunTests",
      formatSummaryStatus(automationRunTestSummary)
    );
    releaseDatasetRows(datasetRowsByName, "automation_run_tests");

    // Import automation_run_fields
    logMessage(context, "Processing automation run fields");
    await persistProgress(
      "automationRunFields",
      "Processing automation run fields"
    );

    const automationRunFieldsImport = await timedPhase(
      "automationRunFields",
      async () => {
        if (datasetRowsByName.get("automation_run_fields")?.length === 0) {
          datasetRowsByName.set(
            "automation_run_fields",
            await loadDatasetFromStaging("automation_run_fields")
          );
        }

        return importAutomationRunFields(
          db,
          normalizedConfiguration,
          datasetRowsByName,
          projectImport.projectIdMap,
          automationRunImport.testRunIdMap,
          context,
          persistProgress,
          {
            chunkSize: AUTOMATION_RUN_FIELD_CHUNK_SIZE,
            transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS,
          }
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, automationRunFieldsImport);
    await persistProgress(
      "automationRunFields",
      formatSummaryStatus(automationRunFieldsImport)
    );
    releaseDatasetRows(datasetRowsByName, "automation_run_fields");

    // Import automation_run_links
    logMessage(context, "Processing automation run links");
    await persistProgress(
      "automationRunLinks",
      "Processing automation run links"
    );

    const automationRunLinksImport = await timedPhase(
      "automationRunLinks",
      async () => {
        if (datasetRowsByName.get("automation_run_links")?.length === 0) {
          datasetRowsByName.set(
            "automation_run_links",
            await loadDatasetFromStaging("automation_run_links")
          );
        }

        return importAutomationRunLinks(
          db,
          normalizedConfiguration,
          datasetRowsByName,
          projectImport.projectIdMap,
          automationRunImport.testRunIdMap,
          userIdMap,
          importJob.createdById,
          context,
          persistProgress,
          {
            chunkSize: AUTOMATION_RUN_LINK_CHUNK_SIZE,
            transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS,
          }
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, automationRunLinksImport);
    await persistProgress(
      "automationRunLinks",
      formatSummaryStatus(automationRunLinksImport)
    );
    releaseDatasetRows(datasetRowsByName, "automation_run_links");

    // Import automation_run_test_fields
    logMessage(context, "Processing automation run test fields");
    await persistProgress(
      "automationRunTestFields",
      "Processing automation run test fields"
    );

    const automationRunTestFieldsImport = await timedPhase(
      "automationRunTestFields",
      () =>
        importAutomationRunTestFields(
          db,
          normalizedConfiguration,
          datasetRowsByName,
          projectImport.projectIdMap,
          automationRunImport.testRunIdMap,
          automationRunTestCaseMap,
          automationRunJunitResultMap,
          context,
          persistProgress,
          {
            chunkSize: AUTOMATION_RUN_TEST_FIELD_CHUNK_SIZE,
            transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS,
          }
        ),
      (s) => s.total
    );
    recordEntitySummary(context, automationRunTestFieldsImport);
    await persistProgress(
      "automationRunTestFields",
      formatSummaryStatus(automationRunTestFieldsImport)
    );
    releaseDatasetRows(datasetRowsByName, "automation_run_test_fields");

    // Import automation_run_tags
    logMessage(context, "Processing automation run tags");
    await persistProgress(
      "automationRunTags",
      "Processing automation run tags"
    );

    const automationRunTagsImport = await timedPhase(
      "automationRunTags",
      async () => {
        if (datasetRowsByName.get("automation_run_tags")?.length === 0) {
          datasetRowsByName.set(
            "automation_run_tags",
            await loadDatasetFromStaging("automation_run_tags")
          );
        }

        return importAutomationRunTags(
          db,
          normalizedConfiguration,
          datasetRowsByName,
          automationRunImport.testRunIdMap,
          context,
          persistProgress,
          {
            chunkSize: AUTOMATION_RUN_TAG_CHUNK_SIZE,
            transactionTimeoutMs: AUTOMATION_TRANSACTION_TIMEOUT_MS,
          }
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, automationRunTagsImport);
    await persistProgress(
      "automationRunTags",
      formatSummaryStatus(automationRunTagsImport)
    );
    releaseDatasetRows(datasetRowsByName, "automation_run_tags");

    // ===== END AUTOMATION IMPORTS =====

    logMessage(context, "Processing session values imports");
    await persistProgress("sessionValues", "Processing session values imports");

    const sessionValuesImport = await timedPhase(
      "sessionValues",
      async () => {
        // Load session_values dataset on-demand
        if (datasetRowsByName.get("session_values")?.length === 0) {
          datasetRowsByName.set(
            "session_values",
            await loadDatasetFromStaging("session_values")
          );
        }

        return withTransaction((tx) =>
          importSessionValues(
            tx,
            datasetRowsByName,
            sessionImport.sessionIdMap,
            testmoFieldValueMap,
            normalizedConfiguration,
            caseImport.caseFieldMap,
            caseImport.caseFieldMetadataById,
            importJob,
            context,
            persistProgress
          )
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, sessionValuesImport.summary);
    await persistProgress(
      "sessionValues",
      formatSummaryStatus(sessionValuesImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "session_values");

    logMessage(context, "Processing test run imports");
    await persistProgress("testRuns", "Processing test run imports");

    const testRunImport = await timedPhase(
      "testRuns",
      async () => {
        // Load runs dataset on-demand
        if (datasetRowsByName.get("runs")?.length === 0) {
          datasetRowsByName.set("runs", await loadDatasetFromStaging("runs"));
        }

        return withTransaction((tx) =>
          importTestRuns(
            tx,
            datasetRowsByName,
            projectImport.projectIdMap,
            repositoryImport.canonicalRepoIdByProject,
            configurationIdMap,
            milestoneImport.milestoneIdMap,
            workflowIdMap,
            userIdMap,
            importJob,
            context,
            persistProgress
          )
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, testRunImport.summary);
    await persistProgress(
      "testRuns",
      formatSummaryStatus(testRunImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "runs");

    // Configurations are global in Testmo but project-scoped here. Assign each
    // imported configuration to the projects whose runs use it so it appears in
    // their run/session pickers.
    logMessage(context, "Assigning configurations to projects");
    await withTransaction((tx) =>
      assignImportedConfigurationsToProjects(
        tx,
        Array.from(projectImport.projectIdMap.values())
      )
    );

    // Import run_links
    logMessage(context, "Processing run links");
    await persistProgress("runLinks", "Processing run links");

    const runLinksImport = await timedPhase(
      "runLinks",
      async () => {
        if (datasetRowsByName.get("run_links")?.length === 0) {
          datasetRowsByName.set(
            "run_links",
            await loadDatasetFromStaging("run_links")
          );
        }

        return withTransaction((tx) =>
          importRunLinks(
            tx,
            normalizedConfiguration,
            datasetRowsByName,
            testRunImport.testRunIdMap,
            context
          )
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, runLinksImport);
    await persistProgress("runLinks", formatSummaryStatus(runLinksImport));
    releaseDatasetRows(datasetRowsByName, "run_links");

    logMessage(context, "Processing test run case imports");
    await persistProgress("testRunCases", "Processing test run case imports");

    const testRunCaseImport = await timedPhase(
      "testRunCases",
      async () => {
        // Load run_tests dataset on-demand
        if (datasetRowsByName.get("run_tests")?.length === 0) {
          datasetRowsByName.set(
            "run_tests",
            await loadDatasetFromStaging("run_tests")
          );
        }

        return importTestRunCases(
          db,
          datasetRowsByName,
          testRunImport.testRunIdMap,
          caseImport.caseIdMap,
          caseImport.caseMetaMap,
          userIdMap,
          statusIdMap,
          context,
          persistProgress
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, testRunCaseImport.summary);
    await persistProgress(
      "testRunCases",
      formatSummaryStatus(testRunCaseImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "run_tests");

    logMessage(context, "Processing run tag assignments");
    await persistProgress("runTags", "Processing run tag assignments");

    const runTagsSummary = await timedPhase(
      "runTags",
      async () => {
        // Load run_tags dataset on-demand
        if (datasetRowsByName.get("run_tags")?.length === 0) {
          datasetRowsByName.set(
            "run_tags",
            await loadDatasetFromStaging("run_tags")
          );
        }

        return withTransaction((tx) =>
          importRunTags(
            tx,
            normalizedConfiguration,
            datasetRowsByName,
            testRunImport.testRunIdMap
          )
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, runTagsSummary);
    await persistProgress("runTags", formatSummaryStatus(runTagsSummary));
    releaseDatasetRows(datasetRowsByName, "run_tags");

    logMessage(context, "Processing test run result imports");
    await persistProgress(
      "testRunResults",
      "Processing test run result imports"
    );

    // Merge manual and automation test run case maps
    const mergedTestRunCaseIdMap = new Map(testRunCaseImport.testRunCaseIdMap);
    for (const [testmoId, testRunCaseId] of automationRunTestCaseMap) {
      mergedTestRunCaseIdMap.set(testmoId, testRunCaseId);
    }

    const testRunResultImport = await timedPhase(
      "testRunResults",
      async () => {
        // Load run_results dataset on-demand
        if (datasetRowsByName.get("run_results")?.length === 0) {
          datasetRowsByName.set(
            "run_results",
            await loadDatasetFromStaging("run_results")
          );
        }

        return importTestRunResults(
          db,
          datasetRowsByName,
          testRunImport.testRunIdMap,
          mergedTestRunCaseIdMap,
          statusIdMap,
          userIdMap,
          resultFieldMap,
          importJob,
          context,
          persistProgress
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, testRunResultImport.summary);
    await persistProgress(
      "testRunResults",
      formatSummaryStatus(testRunResultImport.summary)
    );
    releaseDatasetRows(datasetRowsByName, "run_results");

    logMessage(context, "Processing test run step results");
    await persistProgress(
      "testRunStepResults",
      "Processing test run step results"
    );

    const stepResultsSummary = await timedPhase(
      "testRunStepResults",
      () =>
        importTestRunStepResults(
          db,
          datasetRowsByName,
          testRunResultImport.testRunResultIdMap,
          mergedTestRunCaseIdMap,
          statusIdMap,
          caseImport.caseIdMap,
          importJob,
          context,
          persistProgress
        ),
      (s) => s.total
    );
    recordEntitySummary(context, stepResultsSummary);
    await persistProgress(
      "testRunStepResults",
      formatSummaryStatus(stepResultsSummary)
    );

    // Import issue targets (Integration records)
    logMessage(context, "Processing issue targets");
    await persistProgress("issueTargets", "Processing issue targets");

    const issueTargetsImport = await timedPhase(
      "issueTargets",
      () =>
        withTransaction((tx) =>
          importIssueTargets(
            tx,
            normalizedConfiguration,
            context,
            persistProgress
          )
        ),
      (r) => r.summary.total
    );
    recordEntitySummary(context, issueTargetsImport.summary);
    await persistProgress(
      "issueTargets",
      formatSummaryStatus(issueTargetsImport.summary)
    );
    // Note: We don't need to load/release issue_targets dataset since we use configuration

    // Import issues
    logMessage(context, "Processing issues");
    await persistProgress("issues", "Processing issues");

    const issuesImport = await timedPhase(
      "issues",
      async () => {
        if (datasetRowsByName.get("issues")?.length === 0) {
          datasetRowsByName.set(
            "issues",
            await loadDatasetFromStaging("issues")
          );
        }

        return withTransaction((tx) =>
          importIssues(
            tx,
            datasetRowsByName,
            issueTargetsImport.integrationIdMap,
            projectImport.projectIdMap,
            importJob.createdById,
            context,
            persistProgress
          )
        );
      },
      (r) => r.summary.total
    );
    recordEntitySummary(context, issuesImport.summary);
    await persistProgress("issues", formatSummaryStatus(issuesImport.summary));

    // Create ProjectIntegration records
    logMessage(context, "Creating project-integration connections");
    await persistProgress(
      "projectIntegrations",
      "Creating project-integration connections"
    );

    const projectIntegrationsSummary = await timedPhase(
      "projectIntegrations",
      () =>
        withTransaction((tx) =>
          createProjectIntegrations(
            tx,
            datasetRowsByName,
            projectImport.projectIdMap,
            issueTargetsImport.integrationIdMap,
            context,
            persistProgress
          )
        ),
      (s) => s.total
    );
    recordEntitySummary(context, projectIntegrationsSummary);
    await persistProgress(
      "projectIntegrations",
      formatSummaryStatus(projectIntegrationsSummary)
    );
    releaseDatasetRows(datasetRowsByName, "issues");

    // Import milestone_issues relationships
    // NOTE: Skipped - Milestones model does not have an issues relation
    // To enable: Add 'issues Issue[]' to Milestones model in schema.zmodel
    logMessage(
      context,
      "Skipping milestone issue relationships (schema limitation)"
    );
    await persistProgress(
      "milestoneIssues",
      "Skipped (schema does not support milestone-issue relationships)"
    );

    const milestoneIssuesSummary = await timedPhase(
      "milestoneIssues",
      async () => {
        if (datasetRowsByName.get("milestone_issues")?.length === 0) {
          datasetRowsByName.set(
            "milestone_issues",
            await loadDatasetFromStaging("milestone_issues")
          );
        }

        return withTransaction((tx) =>
          importMilestoneIssues(
            tx,
            datasetRowsByName,
            milestoneImport.milestoneIdMap,
            issuesImport.issueIdMap,
            context,
            persistProgress
          )
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, milestoneIssuesSummary);
    await persistProgress(
      "milestoneIssues",
      formatSummaryStatus(milestoneIssuesSummary)
    );
    releaseDatasetRows(datasetRowsByName, "milestone_issues");

    // Import repository_case_issues relationships
    logMessage(context, "Processing repository case issue relationships");
    await persistProgress(
      "repositoryCaseIssues",
      "Processing repository case issue relationships"
    );

    const repositoryCaseIssuesSummary = await timedPhase(
      "repositoryCaseIssues",
      async () => {
        if (datasetRowsByName.get("repository_case_issues")?.length === 0) {
          datasetRowsByName.set(
            "repository_case_issues",
            await loadDatasetFromStaging("repository_case_issues")
          );
        }

        return importRepositoryCaseIssues(
          db,
          datasetRowsByName,
          caseImport.caseIdMap,
          issuesImport.issueIdMap,
          context,
          persistProgress,
          {
            chunkSize: ISSUE_RELATIONSHIP_CHUNK_SIZE,
            transactionTimeoutMs: IMPORT_TRANSACTION_TIMEOUT_MS,
          }
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, repositoryCaseIssuesSummary);
    await persistProgress(
      "repositoryCaseIssues",
      formatSummaryStatus(repositoryCaseIssuesSummary)
    );
    releaseDatasetRows(datasetRowsByName, "repository_case_issues");

    // Import run_issues relationships
    logMessage(context, "Processing test run issue relationships");
    await persistProgress(
      "runIssues",
      "Processing test run issue relationships"
    );

    const runIssuesSummary = await timedPhase(
      "runIssues",
      async () => {
        if (datasetRowsByName.get("run_issues")?.length === 0) {
          datasetRowsByName.set(
            "run_issues",
            await loadDatasetFromStaging("run_issues")
          );
        }

        return importRunIssues(
          db,
          datasetRowsByName,
          testRunImport.testRunIdMap,
          issuesImport.issueIdMap,
          context,
          persistProgress,
          {
            chunkSize: ISSUE_RELATIONSHIP_CHUNK_SIZE,
            transactionTimeoutMs: IMPORT_TRANSACTION_TIMEOUT_MS,
          }
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, runIssuesSummary);
    await persistProgress("runIssues", formatSummaryStatus(runIssuesSummary));
    releaseDatasetRows(datasetRowsByName, "run_issues");

    // Import run_result_issues relationships
    logMessage(context, "Processing test run result issue relationships");
    await persistProgress(
      "runResultIssues",
      "Processing test run result issue relationships"
    );

    const runResultIssuesSummary = await timedPhase(
      "runResultIssues",
      async () => {
        if (datasetRowsByName.get("run_result_issues")?.length === 0) {
          datasetRowsByName.set(
            "run_result_issues",
            await loadDatasetFromStaging("run_result_issues")
          );
        }

        return importRunResultIssues(
          db,
          datasetRowsByName,
          testRunResultImport.testRunResultIdMap,
          issuesImport.issueIdMap,
          context,
          persistProgress,
          {
            chunkSize: ISSUE_RELATIONSHIP_CHUNK_SIZE,
            transactionTimeoutMs: IMPORT_TRANSACTION_TIMEOUT_MS,
          }
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, runResultIssuesSummary);
    await persistProgress(
      "runResultIssues",
      formatSummaryStatus(runResultIssuesSummary)
    );
    releaseDatasetRows(datasetRowsByName, "run_result_issues");

    // Import session_issues relationships
    logMessage(context, "Processing session issue relationships");
    await persistProgress(
      "sessionIssues",
      "Processing session issue relationships"
    );

    const sessionIssuesSummary = await timedPhase(
      "sessionIssues",
      async () => {
        if (datasetRowsByName.get("session_issues")?.length === 0) {
          datasetRowsByName.set(
            "session_issues",
            await loadDatasetFromStaging("session_issues")
          );
        }

        return importSessionIssues(
          db,
          datasetRowsByName,
          sessionImport.sessionIdMap,
          issuesImport.issueIdMap,
          context,
          persistProgress,
          {
            chunkSize: ISSUE_RELATIONSHIP_CHUNK_SIZE,
            transactionTimeoutMs: IMPORT_TRANSACTION_TIMEOUT_MS,
          }
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, sessionIssuesSummary);
    await persistProgress(
      "sessionIssues",
      formatSummaryStatus(sessionIssuesSummary)
    );
    releaseDatasetRows(datasetRowsByName, "session_issues");

    // Import session_result_issues relationships
    logMessage(context, "Processing session result issue relationships");
    await persistProgress(
      "sessionResultIssues",
      "Processing session result issue relationships"
    );

    const sessionResultIssuesSummary = await timedPhase(
      "sessionResultIssues",
      async () => {
        if (datasetRowsByName.get("session_result_issues")?.length === 0) {
          datasetRowsByName.set(
            "session_result_issues",
            await loadDatasetFromStaging("session_result_issues")
          );
        }

        return importSessionResultIssues(
          db,
          datasetRowsByName,
          sessionResultsImport.sessionResultIdMap,
          issuesImport.issueIdMap,
          context,
          persistProgress,
          {
            chunkSize: ISSUE_RELATIONSHIP_CHUNK_SIZE,
            transactionTimeoutMs: IMPORT_TRANSACTION_TIMEOUT_MS,
          }
        );
      },
      (s) => s.total
    );
    recordEntitySummary(context, sessionResultIssuesSummary);
    await persistProgress(
      "sessionResultIssues",
      formatSummaryStatus(sessionResultIssuesSummary)
    );
    releaseDatasetRows(datasetRowsByName, "session_result_issues");

    console.log("\n[IMPORT TIMING] ═══════════════════════════════════");
    console.log("[IMPORT TIMING] Phase Duration Summary:");
    for (const { phase, durationMs, items } of phaseDurations) {
      const sec = (durationMs / 1000).toFixed(1);
      const rate =
        items > 0
          ? ` (${(items / (durationMs / 1000)).toFixed(1)} items/sec)`
          : "";
      console.log(
        `[IMPORT TIMING]   ${phase.padEnd(25)} ${sec.padStart(8)}s  ${String(items).padStart(8)} items${rate}`
      );
    }
    const totalMs = phaseDurations.reduce((sum, p) => sum + p.durationMs, 0);
    console.log(
      `[IMPORT TIMING] ${"TOTAL".padEnd(25)} ${(totalMs / 1000).toFixed(1).padStart(8)}s`
    );
    console.log("[IMPORT TIMING] ═══════════════════════════════════\n");

    logMessage(context, "Finalizing import configuration");
    await persistProgress(null, "Finalizing import configuration");
    const serializedConfiguration = serializeMappingConfiguration(
      normalizedConfiguration
    );

    const totalTimeMs = Date.now() - context.startTime;
    const totalTimeSeconds = Math.floor(totalTimeMs / 1000);
    const minutes = Math.floor(totalTimeSeconds / 60);
    const seconds = totalTimeSeconds % 60;
    const totalTimeFormatted =
      minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    logMessage(context, "Import completed successfully.", {
      processedEntities: context.processedCount,
      totalTime: totalTimeFormatted,
      totalTimeMs,
    });
    await persistProgress(null, "Import completed successfully.");

    const updatedJob = await db.testmoImportJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        phase: null,
        statusMessage: "Import completed successfully.",
        completedAt: new Date(),
        processedCount: context.processedCount,
        totalCount: context.processedCount,
        errorCount: 0,
        skippedCount: 0,
        currentEntity: null,
        estimatedTimeRemaining: null,
        processingRate: null,
        durationMs: totalTimeMs,
        activityLog: toInputJsonValue(context.activityLog),
        entityProgress: toInputJsonValue(context.entityProgress),
        configuration: toInputJsonValue(serializedConfiguration),
      },
    });

    // Audit logging — record the completed import
    captureAuditEvent({
      action: "BULK_CREATE",
      entityType: "TestmoImportJob",
      entityId: jobId,
      entityName: `Testmo Import`,
      userId: importJob.createdById,
      tenantId,
      metadata: {
        source: "testmo-import",
        jobId: jobId,
        processedCount: context.processedCount,
        durationMs: totalTimeMs,
        entityProgress: context.entityProgress,
      },
    }).catch(() => {}); // best-effort

    // Trigger full Elasticsearch reindex after successful import
    // This ensures all imported data is searchable
    const elasticsearchReindexQueue = getElasticsearchReindexQueue();
    if (elasticsearchReindexQueue) {
      try {
        logMessage(
          context,
          "Queueing Elasticsearch reindex after successful import"
        );
        const reindexJobData: ReindexJobData = {
          entityType: "all",
          userId: importJob.createdById,
          tenantId,
        };
        // worker-to-worker fan-out.
        // Wrap this processor in runWithAuditContext(
        // job.data.actorContext, ...), so ALS is populated at enqueue-time
        // here and the upstream user's (or upstream systemReason) rides
        // along automatically. No systemReason passed — inherit from upstream.
        await enqueueWithAuditContext(
          elasticsearchReindexQueue,
          `reindex-after-import-${jobId}`,
          reindexJobData
        );
        console.log(
          `Queued Elasticsearch reindex job after import ${jobId} completion`
        );
      } catch (reindexError) {
        // Don't fail the import if reindex queueing fails
        console.error(
          `Failed to queue Elasticsearch reindex after import ${jobId}:`,
          reindexError
        );
        logMessage(
          context,
          "Warning: Failed to queue Elasticsearch reindex. Search results may not include imported data until manual reindex is performed.",
          {
            error:
              reindexError instanceof Error
                ? reindexError.message
                : String(reindexError),
          }
        );
      }
    } else {
      console.warn(
        `Elasticsearch reindex queue not available after import ${jobId}. Search indexes will need to be updated manually.`
      );
    }

    return { status: updatedJob.status };
  } catch (error) {
    console.error(`Testmo import job ${jobId} failed during import`, error);

    const errorDetails: Record<string, unknown> = {
      message: error instanceof Error ? error.message : String(error),
    };
    logMessage(context, "Import failed", errorDetails);

    const serializedConfiguration = serializeMappingConfiguration(
      normalizedConfiguration
    );

    await db.testmoImportJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        phase: null,
        statusMessage: "Import failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
        currentEntity,
        processedCount: context.processedCount,
        totalCount: context.processedCount,
        activityLog: toInputJsonValue(context.activityLog),
        entityProgress: toInputJsonValue(context.entityProgress),
        configuration: toInputJsonValue(serializedConfiguration),
      },
    });

    throw error;
  }
}

type TestmoQueueMode = "analyze" | "import";

type TestmoImportJobData = ActorContextJobData<
  { jobId: string; mode?: TestmoQueueMode } & MultiTenantJobData
>;

// public processor re-establishes the ALS frame from
// job.data.actorContext so downstream captureAuditEvent calls (L7079
// IMPORT_COMPLETED / BULK_CREATE) and the elasticsearch fan-out at L7109
// pick up the originating user's context. systemReason rides along via
// W5 Option A — no per-worker handling.
async function processor(job: Job<TestmoImportJobData>) {
  return runWithAuditContext(job.data.actorContext ?? {}, () =>
    processorInner(job)
  );
}

async function processorInner(job: Job<TestmoImportJobData>) {
  const { jobId, mode = "analyze" } = job.data;

  if (!jobId) {
    throw new Error("Job id is required");
  }

  validateMultiTenantJobData(job.data);
  const db = getDbClientForJob(job.data);

  // Clear caches to prevent cross-tenant cache pollution
  projectNameCache.clear();
  templateNameCache.clear();
  workflowNameCache.clear();
  configurationNameCache.clear();
  milestoneNameCache.clear();
  userNameCache.clear();
  folderNameCache.clear();
  clearAutomationImportCaches();

  const importJob = await db.testmoImportJob.findUnique({
    where: { id: jobId },
  });

  if (!importJob) {
    throw new Error(`Testmo import job ${jobId} not found`);
  }

  if (FINAL_STATUSES.has(importJob.status)) {
    return { status: importJob.status };
  }

  if (mode === "import") {
    return processImportMode(importJob, jobId, db, job.data.tenantId);
  }

  if (mode !== "analyze") {
    throw new Error(`Unsupported Testmo import job mode: ${mode}`);
  }

  if (!bucketName && !importJob.storageBucket) {
    throw new Error("AWS bucket is not configured");
  }

  const resolvedBucket = importJob.storageBucket || bucketName!;

  if (!importJob.storageKey) {
    throw new Error("Storage key missing on import job");
  }

  if (importJob.cancelRequested) {
    await db.testmoImportJob.update({
      where: { id: jobId },
      data: {
        status: "CANCELED",
        statusMessage: "Import was canceled before it started",
        canceledAt: new Date(),
        phase: null,
      },
    });
    return { status: "CANCELED" };
  }

  await db.testmoImportDataset.deleteMany({ where: { jobId } });

  await db.testmoImportJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      phase: "ANALYZING",
      statusMessage: "Opening and scanning export file...",
      startedAt: new Date(),
      processedDatasets: 0,
      processedRows: BigInt(0),
    },
  });

  // Download the entire file to a temporary location first, then process it
  // This avoids streaming issues with large files
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const { createWriteStream, createReadStream, unlink } = await import("fs");
  const { pipeline } = await import("stream/promises");
  const { promisify } = await import("util");
  const unlinkAsync = promisify(unlink);

  const tempFilePath = join(tmpdir(), `testmo-import-${jobId}.json`);
  console.log(
    `[Worker] Downloading file to temporary location: ${tempFilePath}`
  );

  await db.testmoImportJob.update({
    where: { id: jobId },
    data: {
      statusMessage: "Preparing data...",
    },
  });

  // Download file from S3
  const getObjectResponse = await s3Client.send(
    new GetObjectCommand({
      Bucket: resolvedBucket,
      Key: importJob.storageKey,
    })
  );

  const s3Stream = getObjectResponse.Body as Readable | null;
  if (!s3Stream) {
    throw new Error("Failed to open uploaded file for download");
  }

  const fileSizeBigInt =
    getObjectResponse.ContentLength ?? importJob.originalFileSize;
  const fileSize = fileSizeBigInt ? Number(fileSizeBigInt) : undefined;

  console.log(
    `[Worker] File size: ${fileSize ? `${fileSize} bytes (${(fileSize / 1024 / 1024 / 1024).toFixed(2)} GB)` : "unknown"}`
  );

  const tempFileStream = createWriteStream(tempFilePath);
  let bodyStream: Readable;

  try {
    // Download the file completely to disk
    console.log(`[Worker] Streaming file from S3 to disk...`);
    await pipeline(s3Stream, tempFileStream);

    console.log(`[Worker] Download complete. File saved to ${tempFilePath}`);

    await db.testmoImportJob.update({
      where: { id: jobId },
      data: {
        statusMessage: "Download complete. Starting analysis...",
      },
    });

    // Now open the local file for processing
    bodyStream = createReadStream(tempFilePath);
    if (fileSize) {
      (bodyStream as any).__fileSize = fileSize;
    }

    // Clean up temp file after processing
    bodyStream.on("close", async () => {
      try {
        await unlinkAsync(tempFilePath);
        console.log(`[Worker] Cleaned up temporary file: ${tempFilePath}`);
      } catch (error) {
        console.error(`[Worker] Failed to clean up temporary file:`, error);
      }
    });
  } catch (error) {
    // Clean up temp file on error
    try {
      await unlinkAsync(tempFilePath);
      console.log(
        `[Worker] Cleaned up temporary file after error: ${tempFilePath}`
      );
    } catch (cleanupError) {
      console.error(
        `[Worker] Failed to clean up temporary file after error:`,
        cleanupError
      );
    }
    throw error;
  }

  let processedDatasets = 0;
  let processedRows = BigInt(0);
  let cancelRequested = false;

  const handleProgress = async (
    bytesRead: number,
    totalBytes: number,
    percentage: number,
    estimatedTimeRemaining?: number | null
  ) => {
    if (cancelRequested) {
      return;
    }

    // Format ETA for logging
    let etaDisplay = "";
    if (estimatedTimeRemaining) {
      if (estimatedTimeRemaining < 60) {
        etaDisplay = ` - ETA: ${estimatedTimeRemaining}s`;
      } else if (estimatedTimeRemaining < 3600) {
        const minutes = Math.ceil(estimatedTimeRemaining / 60);
        etaDisplay = ` - ETA: ${minutes}m`;
      } else {
        const hours = Math.floor(estimatedTimeRemaining / 3600);
        const minutes = Math.ceil((estimatedTimeRemaining % 3600) / 60);
        etaDisplay = ` - ETA: ${hours}h ${minutes}m`;
      }
    }

    console.log(
      `[Worker] Progress update: ${percentage}% (${bytesRead}/${totalBytes} bytes)${etaDisplay}`
    );

    await db.testmoImportJob.update({
      where: { id: jobId },
      data: {
        statusMessage: `Scanning file... ${percentage}% complete`,
        estimatedTimeRemaining: estimatedTimeRemaining?.toString() ?? null,
      },
    });
  };

  const handleDatasetComplete = async (dataset: TestmoDatasetSummary) => {
    if (cancelRequested) {
      return;
    }

    processedDatasets += 1;
    processedRows += BigInt(dataset.rowCount);

    const schemaValue =
      dataset.schema !== undefined && dataset.schema !== null
        ? (JSON.parse(JSON.stringify(dataset.schema)) as JsonValue)
        : JsonNull;

    const sampleRowsValue =
      dataset.sampleRows.length > 0
        ? (JSON.parse(JSON.stringify(dataset.sampleRows)) as JsonValue)
        : JsonNull;

    const allRowsValue =
      dataset.allRows && dataset.allRows.length > 0
        ? (JSON.parse(JSON.stringify(dataset.allRows)) as JsonValue)
        : JsonNull;

    await db.testmoImportDataset.create({
      data: {
        jobId,
        name: dataset.name,
        rowCount: dataset.rowCount,
        sampleRowCount: dataset.sampleRows.length,
        truncated: dataset.truncated,
        schema: schemaValue,
        sampleRows: sampleRowsValue,
        allRows: allRowsValue,
      },
    });

    const updatedJob = await db.testmoImportJob.update({
      where: { id: jobId },
      data: {
        processedDatasets,
        processedRows,
        statusMessage: `Found ${dataset.name} (${dataset.rowCount.toLocaleString()} rows)`,
      },
      select: {
        cancelRequested: true,
      },
    });

    cancelRequested = updatedJob.cancelRequested;
  };

  try {
    const summary = await analyzeTestmoExport(bodyStream, jobId, db, {
      onDatasetComplete: handleDatasetComplete,
      onProgress: handleProgress,
      shouldAbort: () => cancelRequested,
    });

    if (cancelRequested) {
      await db.testmoImportJob.update({
        where: { id: jobId },
        data: {
          status: "CANCELED",
          statusMessage: "Import was canceled",
          canceledAt: new Date(),
          phase: null,
        },
      });

      return { status: "CANCELED" };
    }

    const analysisPayload = {
      meta: {
        totalDatasets: summary.meta.totalDatasets,
        totalRows: summary.meta.totalRows,
        durationMs: summary.meta.durationMs,
        startedAt: summary.meta.startedAt.toISOString(),
        completedAt: summary.meta.completedAt.toISOString(),
        fileSizeBytes:
          Number(
            importJob.originalFileSize ?? summary.meta.fileSizeBytes ?? 0
          ) || 0,
      },
    } satisfies Record<string, unknown>;

    await db.testmoImportJob.update({
      where: { id: jobId },
      data: {
        status: "READY",
        phase: "CONFIGURING",
        statusMessage: "Analysis complete. Configure mapping to continue.",
        totalDatasets: summary.meta.totalDatasets,
        totalRows: BigInt(summary.meta.totalRows),
        processedDatasets,
        processedRows,
        durationMs: summary.meta.durationMs,
        analysisGeneratedAt: new Date(),
        configuration: JsonNull,
        options: JsonNull,
        analysis: analysisPayload as JsonObject,
        processedCount: 0,
        errorCount: 0,
        skippedCount: 0,
        totalCount: 0,
        currentEntity: null,
        estimatedTimeRemaining: null,
        processingRate: null,
        activityLog: JsonNull,
        entityProgress: JsonNull,
      },
    });

    if (processedDatasets === 0 && summary.meta.totalDatasets === 0) {
      await db.testmoImportJob.update({
        where: { id: jobId },
        data: {
          statusMessage: "Analysis complete (no datasets found)",
        },
      });
    }

    return { status: "READY" };
  } catch (error) {
    if (
      cancelRequested ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      await db.testmoImportJob.update({
        where: { id: jobId },
        data: {
          status: "CANCELED",
          statusMessage: "Import was canceled",
          canceledAt: new Date(),
          phase: null,
        },
      });

      return { status: "CANCELED" };
    }

    console.error(`Testmo import job ${jobId} failed`, error);

    await db.testmoImportJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        statusMessage: "Import failed",
        error: error instanceof Error ? error.message : String(error),
        phase: null,
      },
    });

    throw error;
  }
}

async function startWorker() {
  // Log multi-tenant mode status
  if (isMultiTenantMode()) {
    console.log("Testmo import worker starting in MULTI-TENANT mode");
  } else {
    console.log("Testmo import worker starting in SINGLE-TENANT mode");
  }

  if (!valkeyConnection) {
    console.warn(
      "Valkey connection not available. Testmo import worker cannot start."
    );
    process.exit(1);
  }

  const worker = new Worker(
    TESTMO_IMPORT_QUEUE_NAME,
    withTenantContext(processor),
    {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
      concurrency: parseInt(process.env.TESTMO_IMPORT_CONCURRENCY || "1", 10),
    }
  );

  worker.on("completed", (job) => {
    console.log(
      `Testmo import job ${job.id} completed successfully (${job.name}).`
    );
  });

  worker.on("failed", (job, err) => {
    console.error(`Testmo import job ${job?.id} failed with error:`, err);
  });

  worker.on("error", (err) => {
    console.error("Testmo import worker encountered an error:", err);
  });

  console.log("Testmo import worker started and listening for jobs...");

  const shutdown = async () => {
    console.log("Shutting down Testmo import worker...");
    await worker.close();
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    console.log("Testmo import worker shut down gracefully.");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Start worker when file is run directly (works with both ESM and CommonJS)
if (require.main === module) {
  startWorker().catch((err) => {
    console.error("Failed to start Testmo import worker:", err);
    process.exit(1);
  });
}
