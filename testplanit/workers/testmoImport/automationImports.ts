import { Prisma, PrismaClient, JUnitResultType } from "@prisma/client";
import type { TestmoMappingConfiguration } from "../../services/imports/testmo/types";
import {
  toNumberValue,
  toStringValue,
  toDateValue,
  toBooleanValue,
  resolveUserId,
  buildNumberIdMap,
} from "./helpers";
import type {
  EntitySummaryResult,
  ImportContext,
  PersistProgressFn,
} from "./types";
import { createTestCaseVersionInTransaction } from "../../lib/services/testCaseVersionService.js";

type AutomationCaseGroup = {
  name: string;
  className: string | null;
  projectId: number;
  testmoCaseIds: number[];
  folder: string | null;
  createdAt: Date | null;
};

const projectNameCache = new Map<number, string>();
const templateNameCache = new Map<number, string>();
const workflowNameCache = new Map<number, string>();
const folderNameCache = new Map<number, string>();
const userNameCache = new Map<string, string>();

type StatusResolution = Prisma.StatusGetPayload<{
  select: {
    id: true;
    name: true;
    systemName: true;
    aliases: true;
    isSuccess: true;
    isFailure: true;
    isCompleted: true;
  };
}>;

const chunkArray = <T>(items: T[], chunkSize: number): T[][] => {
  if (chunkSize <= 0) {
    throw new Error("chunkSize must be greater than 0");
  }

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
};

async function getProjectName(
  tx: Prisma.TransactionClient,
  projectId: number
): Promise<string> {
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
}

async function getTemplateName(
  tx: Prisma.TransactionClient,
  templateId: number
): Promise<string> {
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
}

async function getWorkflowName(
  tx: Prisma.TransactionClient,
  workflowId: number
): Promise<string> {
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
}

async function getFolderName(
  tx: Prisma.TransactionClient,
  folderId: number
): Promise<string> {
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
}

async function getUserName(
  tx: Prisma.TransactionClient,
  userId: string | null | undefined
): Promise<string> {
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
}

const looksLikeGeneratedIdentifier = (segment: string): boolean => {
  const lower = segment.toLowerCase();
  if (/^[0-9a-f-]{8,}$/i.test(segment)) {
    return true;
  }
  if (/^\d{6,}$/.test(segment)) {
    return true;
  }
  if (segment.includes(":")) {
    return true;
  }
  if (segment.startsWith("@")) {
    return true;
  }
  if (
    segment === lower &&
    /[0-9]/.test(segment) &&
    /^[a-z0-9_-]{6,}$/.test(segment)
  ) {
    return true;
  }
  return false;
};

const normalizeAutomationClassName = (folder: string | null): string | null => {
  if (!folder) {
    return null;
  }

  const segments = folder
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return null;
  }

  const filteredSegments = segments.filter((segment, index) => {
    if (index === 0) {
      // Keep the platform root segment (e.g., ios/android)
      return true;
    }
    return !looksLikeGeneratedIdentifier(segment);
  });

  if (filteredSegments.length === 0) {
    return segments[segments.length - 1] ?? null;
  }

  return filteredSegments.join(".");
};

/**
 * Import automation cases as repository cases with automated=true.
 * Processes data in smaller transactions to provide better progress feedback.
 */
export const importAutomationCases = async (
  prisma: PrismaClient,
  configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  repositoryIdMap: Map<number, number>,
  _folderIdMap: Map<number, number>,
  templateIdMap: Map<number, number>,
  projectDefaultTemplateMap: Map<number, number | null>,
  workflowIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn,
  options?: {
    chunkSize?: number;
    transactionTimeoutMs?: number;
  }
): Promise<{
  summary: EntitySummaryResult;
  automationCaseIdMap: Map<number, number>;
  automationCaseProjectMap: Map<number, Map<number, number>>;
}> => {
  const summary: EntitySummaryResult = {
    entity: "automationCases",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const automationCaseIdMap = new Map<number, number>();
  const automationCaseProjectMap = new Map<number, Map<number, number>>();
  const automationCaseRows = datasetRows.get("automation_cases") ?? [];
  const globalFallbackTemplateId =
    Array.from(templateIdMap.values())[0] ?? null;

  summary.total = automationCaseRows.length;

  const entityName = "automationCases";
  const progressEntry =
    context.entityProgress[entityName] ??
    (context.entityProgress[entityName] = {
      total: summary.total,
      created: 0,
      mapped: 0,
    });
  progressEntry.total = summary.total;

  let processedAutomationCases = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(1, Math.floor(summary.total / 50));
  const minProgressIntervalMs = 2000;

  const chunkSize = Math.max(1, options?.chunkSize ?? 250);

  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedAutomationCases - lastReportedCount;
    if (
      !force &&
      deltaCount < minProgressDelta &&
      now - lastReportAt < minProgressIntervalMs
    ) {
      return;
    }

    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(
      processedAutomationCases,
      progressEntry.total
    );

    lastReportedCount = processedAutomationCases;
    lastReportAt = now;

    const statusMessage = `Processing automation case imports (${processedAutomationCases.toLocaleString()} / ${summary.total.toLocaleString()} cases processed)`;
    await persistProgress(entityName, statusMessage);
  };

  const repositoryCaseGroupMap = new Map<string, AutomationCaseGroup>();

  for (const row of automationCaseRows) {
    const testmoCaseId = toNumberValue(row.id);
    const testmoProjectId = toNumberValue(row.project_id);

    if (!testmoCaseId || !testmoProjectId) {
      continue;
    }

    const projectId = projectIdMap.get(testmoProjectId);
    if (!projectId) {
      continue;
    }

    const name = toStringValue(row.name) || `Automation Case ${testmoCaseId}`;
    const folder = toStringValue(row.folder);
    const createdAt = toDateValue(row.created_at);

    const className = normalizeAutomationClassName(folder);

    const repoKey = `${projectId}|${name}|${className ?? "null"}`;

    if (!repositoryCaseGroupMap.has(repoKey)) {
      repositoryCaseGroupMap.set(repoKey, {
        name,
        className,
        projectId,
        testmoCaseIds: [],
        folder,
        createdAt,
      });
    }

    const group = repositoryCaseGroupMap.get(repoKey)!;
    group.testmoCaseIds.push(testmoCaseId);

    // DEBUG: Log when multiple cases are grouped together
    if (group.testmoCaseIds.length === 2) {
      console.log(
        `[CASE_GROUPING] Multiple Testmo cases mapping to same repo case:`
      );
      console.log(`  Key: ${repoKey}`);
      console.log(`  TestPlanIt projectId: ${projectId}`);
      console.log(`  Name: ${name}`);
      console.log(`  ClassName: ${className}`);
      console.log(`  Testmo case IDs: ${group.testmoCaseIds.join(", ")}`);
    } else if (group.testmoCaseIds.length > 2) {
      console.log(
        `[CASE_GROUPING] Adding case ${testmoCaseId} to group (now ${group.testmoCaseIds.length} cases): ${group.testmoCaseIds.join(", ")}`
      );
    }
  }

  const repositoryCaseGroups = Array.from(repositoryCaseGroupMap.values());

  if (repositoryCaseGroups.length === 0) {
    await reportProgress(true);
    return { summary, automationCaseIdMap, automationCaseProjectMap };
  }

  await prisma.$executeRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence('"RepositoryCases"', 'id'),
      COALESCE((SELECT MAX(id) FROM "RepositoryCases"), 1),
      true
    );
  `);

  for (let index = 0; index < repositoryCaseGroups.length; index += chunkSize) {
    const chunk = repositoryCaseGroups.slice(index, index + chunkSize);

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        for (const group of chunk) {
          const {
            name,
            className,
            projectId,
            testmoCaseIds,
            folder,
            createdAt,
          } = group;
          const processedForGroup = testmoCaseIds.length;

          let repositoryId: number | undefined;
          for (const [, mappedRepoId] of repositoryIdMap.entries()) {
            const repoCheck = await tx.repositories.findFirst({
              where: { id: mappedRepoId, projectId },
            });
            if (repoCheck) {
              repositoryId = mappedRepoId;
              break;
            }
          }

          if (!repositoryId) {
            let repository = await tx.repositories.findFirst({
              where: {
                projectId,
                isActive: true,
                isDeleted: false,
                isArchived: false,
              },
              orderBy: { id: "asc" },
            });

            if (!repository) {
              repository = await tx.repositories.create({
                data: {
                  projectId,
                  isActive: true,
                  isDeleted: false,
                  isArchived: false,
                },
              });
            }
            repositoryId = repository.id;
          }

          let folderId: number | undefined;
          let folderNameForVersion: string | null = null;

          // First, ensure the top-level "Automation" folder exists
          let automationRootFolder = await tx.repositoryFolders.findFirst({
            where: {
              projectId,
              repositoryId,
              parentId: null,
              name: "Automation",
              isDeleted: false,
            },
          });

          if (!automationRootFolder) {
            automationRootFolder = await tx.repositoryFolders.create({
              data: {
                projectId,
                repositoryId,
                parentId: null,
                name: "Automation",
                creatorId: configuration.users?.[1]?.mappedTo || "unknown",
              },
            });
          }

          // Start folder hierarchy under the "Automation" root folder
          let currentParentId: number | null = automationRootFolder.id;

          if (folder) {
            const folderParts = folder.split(".");

            for (const folderName of folderParts) {
              if (!folderName) continue;

              const existing: any = await tx.repositoryFolders.findFirst({
                where: {
                  projectId,
                  repositoryId,
                  parentId: currentParentId,
                  name: folderName,
                  isDeleted: false,
                },
              });

              const current: any =
                existing ||
                (await tx.repositoryFolders.create({
                  data: {
                    projectId,
                    repositoryId,
                    parentId: currentParentId,
                    name: folderName,
                    creatorId: configuration.users?.[1]?.mappedTo || "unknown",
                  },
                }));

              currentParentId = current.id;
              folderId = current.id;
            }

            if (folderParts.length > 0) {
              folderNameForVersion =
                folderParts[folderParts.length - 1] || null;
            }
          }

          // If no folder was specified or the hierarchy is empty, use the root "Automation" folder
          if (!folderId) {
            folderId = automationRootFolder.id;
            folderNameForVersion = "Automation";
          }

          let defaultTemplateId =
            projectDefaultTemplateMap.get(projectId) ?? null;
          if (!defaultTemplateId) {
            const fallbackAssignment =
              await tx.templateProjectAssignment.findFirst({
                where: { projectId },
                select: { templateId: true },
                orderBy: { templateId: "asc" },
              });
            defaultTemplateId = fallbackAssignment?.templateId ?? null;
          }
          if (!defaultTemplateId) {
            defaultTemplateId = globalFallbackTemplateId;
          }
          if (!defaultTemplateId) {
            // Unable to resolve a template for this project; skip importing these cases
            processedAutomationCases += processedForGroup;
            context.processedCount += processedForGroup;
            continue;
          }

          const resolvedTemplateId = defaultTemplateId;

          const defaultWorkflowId =
            Array.from(workflowIdMap.values()).find((id) => id !== undefined) ||
            1;
          const normalizedClassName = className || null;

          let repositoryCase = await tx.repositoryCases.findFirst({
            where: {
              projectId,
              name,
              className: normalizedClassName,
              source: "JUNIT",
              isDeleted: false,
            },
          });

          if (!repositoryCase && normalizedClassName) {
            repositoryCase = await tx.repositoryCases.findFirst({
              where: {
                projectId,
                name,
                source: "JUNIT",
                isDeleted: false,
              },
            });
          }

          if (repositoryCase) {
            if (
              normalizedClassName &&
              repositoryCase.className !== normalizedClassName
            ) {
              repositoryCase = await tx.repositoryCases.update({
                where: { id: repositoryCase.id },
                data: {
                  className: normalizedClassName,
                },
              });
            }

            repositoryCase = await tx.repositoryCases.update({
              where: { id: repositoryCase.id },
              data: {
                automated: true,
                isDeleted: false,
                isArchived: false,
                stateId: defaultWorkflowId,
                templateId: resolvedTemplateId,
                folderId,
                repositoryId,
              },
            });
            for (const testmoCaseId of testmoCaseIds) {
              automationCaseIdMap.set(testmoCaseId, repositoryCase.id);
              let projectMap = automationCaseProjectMap.get(projectId);
              if (!projectMap) {
                projectMap = new Map<number, number>();
                automationCaseProjectMap.set(projectId, projectMap);
              }
              projectMap.set(testmoCaseId, repositoryCase.id);
            }
            summary.mapped += testmoCaseIds.length;
          } else {
            repositoryCase = await tx.repositoryCases.create({
              data: {
                projectId,
                repositoryId,
                folderId,
                name,
                className: normalizedClassName,
                source: "JUNIT",
                automated: true,
                stateId: defaultWorkflowId,
                templateId: resolvedTemplateId,
                creatorId: configuration.users?.[1]?.mappedTo || "unknown",
                createdAt: createdAt || new Date(),
              },
            });
            for (const testmoCaseId of testmoCaseIds) {
              automationCaseIdMap.set(testmoCaseId, repositoryCase.id);
              let projectMap = automationCaseProjectMap.get(projectId);
              if (!projectMap) {
                projectMap = new Map<number, number>();
                automationCaseProjectMap.set(projectId, projectMap);
              }
              projectMap.set(testmoCaseId, repositoryCase.id);
            }
            summary.created += 1;

            const projectName = await getProjectName(tx, projectId);
            const templateName = await getTemplateName(tx, resolvedTemplateId);
            const workflowName = await getWorkflowName(tx, defaultWorkflowId);
            const resolvedFolderName =
              folderNameForVersion ?? (await getFolderName(tx, folderId));
            const creatorName = await getUserName(tx, repositoryCase.creatorId);

            // Create version snapshot using centralized helper
            const caseVersion = await createTestCaseVersionInTransaction(
              tx,
              repositoryCase.id,
              {
                // Use repositoryCase.currentVersion (already set on the case)
                creatorId: repositoryCase.creatorId,
                creatorName,
                createdAt: repositoryCase.createdAt ?? new Date(),
                overrides: {
                  name,
                  stateId: defaultWorkflowId,
                  stateName: workflowName,
                  estimate: repositoryCase.estimate ?? null,
                  forecastManual: null,
                  forecastAutomated: null,
                  automated: true,
                  isArchived: repositoryCase.isArchived,
                  order: repositoryCase.order ?? 0,
                  steps: null,
                  tags: [],
                  issues: [],
                  links: [],
                  attachments: [],
                },
              }
            );

            const caseFieldValues = await tx.caseFieldValues.findMany({
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

            if (caseFieldValues.length > 0) {
              await tx.caseFieldVersionValues.createMany({
                data: caseFieldValues.map((fieldValue) => ({
                  versionId: caseVersion.id,
                  field:
                    fieldValue.field.displayName || fieldValue.field.systemName,
                  value: fieldValue.value ?? Prisma.JsonNull,
                })),
              });
            }
          }

          processedAutomationCases += processedForGroup;
          context.processedCount += processedForGroup;

          progressEntry.created = summary.created;
          progressEntry.mapped = Math.min(
            processedAutomationCases,
            progressEntry.total
          );
        }
      },
      {
        timeout: options?.transactionTimeoutMs,
      }
    );

    await reportProgress(true);
  }

  progressEntry.created = summary.created;
  progressEntry.mapped = summary.mapped;

  return { summary, automationCaseIdMap, automationCaseProjectMap };
};

/**
 * Import automation runs as test runs with testRunType='JUNIT'
 * Similar to JUnit XML import which creates test runs
 *
 * Maps Testmo automation_runs to TestPlanIt TestRuns:
 * - Sets testRunType="JUNIT"
 * - Maps configuration and milestone
 */
export const importAutomationRuns = async (
  prisma: PrismaClient,
  _configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  configurationIdMap: Map<number, number>,
  milestoneIdMap: Map<number, number>,
  workflowIdMap: Map<number, number>,
  userIdMap: Map<number, string>,
  defaultUserId: string,
  context: ImportContext,
  persistProgress: PersistProgressFn,
  options?: {
    chunkSize?: number;
    transactionTimeoutMs?: number;
  }
): Promise<{
  summary: EntitySummaryResult;
  testRunIdMap: Map<number, number>;
  testSuiteIdMap: Map<number, number>;
  testRunTimestampMap: Map<number, Date>;
  testRunProjectIdMap: Map<number, number>;
  testRunTestmoProjectIdMap: Map<number, number>;
}> => {
  const summary: EntitySummaryResult = {
    entity: "automationRuns",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const testRunIdMap = new Map<number, number>();
  const testSuiteIdMap = new Map<number, number>();
  const testRunTimestampMap = new Map<number, Date>(); // Map testmoRunId to executedAt timestamp
  const testRunProjectIdMap = new Map<number, number>(); // Map testmoRunId to TestPlanIt projectId
  const testRunTestmoProjectIdMap = new Map<number, number>(); // Map testmoRunId to Testmo projectId
  const automationRunRows = datasetRows.get("automation_runs") ?? [];

  summary.total = automationRunRows.length;

  const entityName = "automationRuns";
  const progressEntry =
    context.entityProgress[entityName] ??
    (context.entityProgress[entityName] = {
      total: summary.total,
      created: 0,
      mapped: 0,
    });
  progressEntry.total = summary.total;

  let processedRuns = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(1, Math.floor(summary.total / 50));
  const minProgressIntervalMs = 2000;
  const chunkSize = Math.max(1, options?.chunkSize ?? 250);

  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedRuns - lastReportedCount;
    if (
      !force &&
      deltaCount < minProgressDelta &&
      now - lastReportAt < minProgressIntervalMs
    ) {
      return;
    }

    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedRuns, progressEntry.total);

    lastReportedCount = processedRuns;
    lastReportAt = now;

    const statusMessage = `Processing automation run imports (${processedRuns.toLocaleString()} / ${summary.total.toLocaleString()} runs processed)`;
    await persistProgress(entityName, statusMessage);
  };

  if (automationRunRows.length === 0) {
    await reportProgress(true);
    return {
      summary,
      testRunIdMap,
      testSuiteIdMap,
      testRunTimestampMap,
      testRunProjectIdMap,
      testRunTestmoProjectIdMap,
    };
  }

  const defaultWorkflowId =
    Array.from(workflowIdMap.values()).find((id) => id !== undefined) || 1;

  for (let index = 0; index < automationRunRows.length; index += chunkSize) {
    const chunk = automationRunRows.slice(index, index + chunkSize);
    let processedInChunk = 0;

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        for (const row of chunk) {
          const testmoRunId = toNumberValue(row.id);
          const testmoProjectId = toNumberValue(row.project_id);
          const testmoConfigId = toNumberValue(row.config_id);
          const testmoMilestoneId = toNumberValue(row.milestone_id);
          const testmoCreatedBy = toNumberValue(row.created_by);

          processedInChunk += 1;

          if (!testmoRunId || !testmoProjectId) {
            continue;
          }

          const projectId = projectIdMap.get(testmoProjectId);
          if (!projectId) {
            continue;
          }

          const name =
            toStringValue(row.name) || `Automation Run ${testmoRunId}`;
          const configId = testmoConfigId
            ? configurationIdMap.get(testmoConfigId)
            : undefined;
          const milestoneId = testmoMilestoneId
            ? milestoneIdMap.get(testmoMilestoneId)
            : undefined;
          const createdById = resolveUserId(
            userIdMap,
            defaultUserId,
            testmoCreatedBy
          );
          const createdAt = toDateValue(row.created_at);
          const completedAt = toDateValue(row.completed_at);
          const elapsedMicroseconds = toNumberValue(row.elapsed);
          const totalCount = toNumberValue(row.total_count) || 0;
          const testmoIsCompleted =
            row.is_completed !== undefined
              ? toBooleanValue(row.is_completed)
              : true;

          const elapsed = elapsedMicroseconds
            ? Math.round(elapsedMicroseconds / 1_000_000)
            : null;
          const resolvedCompletedAt =
            completedAt || (testmoIsCompleted ? createdAt || new Date() : null);

          const testRun = await tx.testRuns.create({
            data: {
              name,
              projectId,
              stateId: defaultWorkflowId,
              configId: configId || null,
              milestoneId: milestoneId || null,
              testRunType: "JUNIT",
              createdById,
              createdAt: createdAt || new Date(),
              completedAt: resolvedCompletedAt || null,
              isCompleted: testmoIsCompleted,
              elapsed: elapsed,
            },
          });

          const testSuite = await tx.jUnitTestSuite.create({
            data: {
              name,
              time: elapsed || 0,
              tests: totalCount,
              testRunId: testRun.id,
              createdById,
              timestamp: createdAt || new Date(),
            },
          });

          testRunIdMap.set(testmoRunId, testRun.id);
          testSuiteIdMap.set(testmoRunId, testSuite.id);
          testRunTimestampMap.set(
            testmoRunId,
            resolvedCompletedAt || createdAt || new Date()
          );
          testRunProjectIdMap.set(testmoRunId, projectId);
          testRunTestmoProjectIdMap.set(testmoRunId, testmoProjectId);
          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs,
      }
    );

    processedRuns += processedInChunk;
    context.processedCount += processedInChunk;

    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedRuns, progressEntry.total);

    await reportProgress(true);
  }

  await reportProgress(true);

  progressEntry.created = summary.created;
  progressEntry.mapped = Math.min(processedRuns, progressEntry.total);

  return {
    summary,
    testRunIdMap,
    testSuiteIdMap,
    testRunTimestampMap,
    testRunProjectIdMap,
    testRunTestmoProjectIdMap,
  };
};

/**
 * Import automation_run_tests as TestRunCases and JUnitTestResults
 * Similar to JUnit XML import which creates test run cases and results
 *
 * Maps Testmo automation_run_tests to TestPlanIt:
 * - Creates TestRunCases (links test run to repository case)
 * - Creates JUnitTestResult records with status mapping
 * - Handles status mapping via Automation scope statuses
 */
export const importAutomationRunTests = async (
  prisma: PrismaClient,
  _configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  testRunIdMap: Map<number, number>,
  testSuiteIdMap: Map<number, number>,
  testRunTimestampMap: Map<number, Date>,
  testRunProjectIdMap: Map<number, number>,
  testRunTestmoProjectIdMap: Map<number, number>,
  automationCaseProjectMap: Map<number, Map<number, number>>,
  statusIdMap: Map<number, number>,
  _userIdMap: Map<number, string>,
  defaultUserId: string,
  context: ImportContext,
  persistProgress: PersistProgressFn,
  options?: {
    chunkSize?: number;
    transactionTimeoutMs?: number;
  }
): Promise<{
  summary: EntitySummaryResult;
  testRunCaseIdMap: Map<number, number>;
  junitResultIdMap: Map<number, number>;
}> => {
  const summary: EntitySummaryResult = {
    entity: "automationRunTests",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const testRunCaseIdMap = new Map<number, number>();
  const junitResultIdMap = new Map<number, number>();
  const automationRunTestRows = datasetRows.get("automation_run_tests") ?? [];

  summary.total = automationRunTestRows.length;

  const statusCache = new Map<number, StatusResolution>();

  const fetchStatusById = async (
    tx: Prisma.TransactionClient,
    statusId: number
  ): Promise<StatusResolution | null> => {
    if (statusCache.has(statusId)) {
      return statusCache.get(statusId)!;
    }

    const status = await tx.status.findUnique({
      where: { id: statusId },
      select: {
        id: true,
        name: true,
        systemName: true,
        aliases: true,
        isSuccess: true,
        isFailure: true,
        isCompleted: true,
      },
    });

    if (status) {
      statusCache.set(statusId, status);
    }

    return status ?? null;
  };

  const determineJUnitResultType = (
    resolvedStatus: StatusResolution | null,
    rawStatusName: string | null
  ): JUnitResultType => {
    const candidates = new Set<string>();
    const pushCandidate = (value: string | null | undefined) => {
      if (!value) {
        return;
      }
      const normalized = value.trim().toLowerCase();
      if (normalized.length > 0) {
        candidates.add(normalized);
      }
    };

    pushCandidate(rawStatusName);
    pushCandidate(resolvedStatus?.systemName);
    pushCandidate(resolvedStatus?.name);

    if (resolvedStatus?.aliases) {
      resolvedStatus.aliases
        .split(",")
        .map((alias) => alias.trim())
        .forEach((alias) => pushCandidate(alias));
    }

    const hasCandidateIncluding = (...needles: string[]): boolean => {
      for (const candidate of candidates) {
        for (const needle of needles) {
          if (candidate.includes(needle)) {
            return true;
          }
        }
      }
      return false;
    };

    if (hasCandidateIncluding("skip", "skipped", "block", "blocked", "omit")) {
      return JUnitResultType.SKIPPED;
    }

    if (hasCandidateIncluding("error", "exception")) {
      return JUnitResultType.ERROR;
    }

    if (resolvedStatus?.isFailure || hasCandidateIncluding("fail", "failed")) {
      return JUnitResultType.FAILURE;
    }

    if (resolvedStatus?.isSuccess) {
      return JUnitResultType.PASSED;
    }

    return JUnitResultType.PASSED;
  };

  const entityName = "automationRunTests";
  const progressEntry =
    context.entityProgress[entityName] ??
    (context.entityProgress[entityName] = {
      total: summary.total,
      created: 0,
      mapped: 0,
    });
  progressEntry.total = summary.total;

  let processedTests = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(1, Math.floor(summary.total / 50));
  const minProgressIntervalMs = 2000;
  const chunkSize = Math.max(1, options?.chunkSize ?? 250);

  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedTests - lastReportedCount;
    if (
      !force &&
      deltaCount < minProgressDelta &&
      now - lastReportAt < minProgressIntervalMs
    ) {
      return;
    }

    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedTests, progressEntry.total);

    lastReportedCount = processedTests;
    lastReportAt = now;

    const statusMessage = `Processing automation run test imports (${processedTests.toLocaleString()} / ${summary.total.toLocaleString()} tests processed)`;
    await persistProgress(entityName, statusMessage);
  };

  if (automationRunTestRows.length === 0) {
    await reportProgress(true);
    return { summary, testRunCaseIdMap, junitResultIdMap };
  }

  const findAutomationStatus = async (
    tx: Prisma.TransactionClient,
    testmoStatusId: number | null,
    projectId: number,
    statusName: string | null
  ): Promise<StatusResolution | null> => {
    if (testmoStatusId && statusIdMap.has(testmoStatusId)) {
      const mappedStatusId = statusIdMap.get(testmoStatusId);
      if (mappedStatusId) {
        const mappedStatus = await fetchStatusById(tx, mappedStatusId);
        if (mappedStatus) {
          return mappedStatus;
        }
      }
    }

    const select = {
      id: true,
      name: true,
      systemName: true,
      aliases: true,
      isSuccess: true,
      isFailure: true,
      isCompleted: true,
    } as const;

    if (statusName) {
      const normalizedStatus = statusName.toLowerCase();
      const status = await tx.status.findFirst({
        select,
        where: {
          isEnabled: true,
          isDeleted: false,
          projects: { some: { projectId } },
          scope: { some: { scope: { name: "Automation" } } },
          OR: [
            {
              systemName: {
                equals: normalizedStatus,
                mode: "insensitive",
              },
            },
            { aliases: { contains: normalizedStatus } },
          ],
        },
      });
      if (status) {
        statusCache.set(status.id, status);
        return status;
      }
    }

    const untestedStatus = await tx.status.findFirst({
      select,
      where: {
        isEnabled: true,
        isDeleted: false,
        systemName: { equals: "untested", mode: "insensitive" },
        projects: { some: { projectId } },
        scope: { some: { scope: { name: "Automation" } } },
      },
    });

    if (untestedStatus) {
      statusCache.set(untestedStatus.id, untestedStatus);
    }

    return untestedStatus ?? null;
  };

  for (
    let index = 0;
    index < automationRunTestRows.length;
    index += chunkSize
  ) {
    const chunk = automationRunTestRows.slice(index, index + chunkSize);
    let processedInChunk = 0;

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        for (const row of chunk) {
          const testmoRunTestId = toNumberValue(row.id);
          const testmoRunId = toNumberValue(row.run_id);
          const testmoProjectId = toNumberValue(row.project_id);
          const testmoCaseId = toNumberValue(row.case_id);
          const testmoStatusId = toNumberValue(row.status_id);

          processedInChunk += 1;

          if (!testmoRunTestId || !testmoRunId || !testmoProjectId) {
            continue;
          }

          // Skip duplicate tests (same testmoRunTestId already processed)
          if (junitResultIdMap.has(testmoRunTestId)) {
            continue;
          }

          const testRunId = testRunIdMap.get(testmoRunId);
          const testSuiteId = testSuiteIdMap.get(testmoRunId);
          const testRunProjectId = testRunProjectIdMap.get(testmoRunId);
          const testRunTestmoProjectId =
            testRunTestmoProjectIdMap.get(testmoRunId);

          // For incremental imports, testRunProjectId might not be in the map (run already existed).
          // In that case, look it up from the database.
          let actualTestRunProjectId = testRunProjectId;
          if (!actualTestRunProjectId && testRunId) {
            const existingRun = await tx.testRuns.findUnique({
              where: { id: testRunId },
              select: { projectId: true },
            });
            actualTestRunProjectId = existingRun?.projectId;
          }

          // Look up the case across ALL projects in the map
          // We need to find which project this Testmo case was imported into
          let repositoryCaseId: number | undefined;
          let actualCaseProjectId: number | undefined;

          if (testmoCaseId) {
            // Search through all projects in the map to find this case
            for (const [
              projectId,
              caseMap,
            ] of automationCaseProjectMap.entries()) {
              if (typeof (caseMap as any).get === "function") {
                const caseId = (caseMap as Map<number, number>).get(
                  testmoCaseId
                );
                if (caseId) {
                  repositoryCaseId = caseId;
                  actualCaseProjectId = projectId;
                  if (summary.created < 5) {
                    console.log(
                      `[FOUND_IN_MAP] testmoCaseId=${testmoCaseId} → caseId=${caseId}, project=${projectId}, runProject=${actualTestRunProjectId}`
                    );
                  }
                  break;
                }
              }
            }
          }

          // For incremental imports, if case not in map, look it up from database
          // IMPORTANT: Must search within the SAME project as the test run to avoid cross-project linking
          if (!repositoryCaseId && testmoCaseId && actualTestRunProjectId) {
            const testName = toStringValue(row.name);
            if (testName) {
              // Search for cases with matching name in the SAME project as the test run
              const existingCase = await tx.repositoryCases.findFirst({
                where: {
                  projectId: actualTestRunProjectId, // CRITICAL: Only search in run's project
                  name: testName,
                  source: "JUNIT",
                },
                select: { id: true, projectId: true },
              });
              if (existingCase) {
                repositoryCaseId = existingCase.id;
                actualCaseProjectId = existingCase.projectId;
                if (summary.created < 5) {
                  console.log(
                    `[FALLBACK] testmoCaseId=${testmoCaseId}, name=${testName.substring(0, 50)} → caseId=${repositoryCaseId}, project=${actualCaseProjectId}, runProject=${actualTestRunProjectId}`
                  );
                }
              }
            }
          }

          // Comprehensive logging for debugging
          if (summary.created < 20) {
            console.log(
              `[DEBUG #${summary.created}] testmoRunId=${testmoRunId}, testmoCaseId=${testmoCaseId}`
            );
            console.log(
              `  testRunId=${testRunId}, testSuiteId=${testSuiteId}, repositoryCaseId=${repositoryCaseId}`
            );
            console.log(
              `  actualTestRunProjectId=${actualTestRunProjectId}, actualCaseProjectId=${actualCaseProjectId}`
            );
            console.log(
              `  testRunProjectId from map=${testRunProjectIdMap.get(testmoRunId)}`
            );
          }

          if (
            !testRunId ||
            !testSuiteId ||
            !repositoryCaseId ||
            !actualTestRunProjectId ||
            !actualCaseProjectId
          ) {
            // Skip if we don't have all required IDs including the case's project
            if (summary.created < 10) {
              console.log(
                `[SKIP-MISSING] Missing IDs: testRunId=${testRunId}, testSuiteId=${testSuiteId}, repositoryCaseId=${repositoryCaseId}, actualTestRunProjectId=${actualTestRunProjectId}, actualCaseProjectId=${actualCaseProjectId}`
              );
            }
            continue;
          }

          // CRITICAL: Validate that the case's project matches the test run's project
          // This prevents cross-project contamination
          // Use strict equality with explicit type checking
          const caseProjectNum = Number(actualCaseProjectId);
          const runProjectNum = Number(actualTestRunProjectId);

          if (caseProjectNum !== runProjectNum) {
            // Skip this result - case belongs to a different project than the test run
            console.log(
              `[SKIP] Cross-project test #${summary.created}: testmoCaseId=${testmoCaseId}, testmoRunId=${testmoRunId}, caseProject=${caseProjectNum} (type: ${typeof actualCaseProjectId}), runProject=${runProjectNum} (type: ${typeof actualTestRunProjectId})`
            );
            continue;
          }

          // At this point, we've validated that actualCaseProjectId === actualTestRunProjectId
          // so we can safely create the result

          const statusName = toStringValue(row.status);
          const elapsedMicroseconds = toNumberValue(row.elapsed);
          const file = toStringValue(row.file);
          const line = toStringValue(row.line);
          const assertions = toNumberValue(row.assertions);

          const elapsed = elapsedMicroseconds
            ? Math.round(elapsedMicroseconds / 1_000_000)
            : null;

          const resolvedStatus = await findAutomationStatus(
            tx,
            testmoStatusId,
            actualTestRunProjectId,
            statusName
          );
          const statusId = resolvedStatus?.id ?? null;

          const testRunCase = await tx.testRunCases.upsert({
            where: {
              testRunId_repositoryCaseId: {
                testRunId,
                repositoryCaseId,
              },
            },
            update: {
              statusId: statusId ?? undefined,
              elapsed: elapsed,
              isCompleted: !!statusId,
              completedAt: statusId ? new Date() : null,
            },
            create: {
              testRunId,
              repositoryCaseId,
              statusId: statusId ?? undefined,
              elapsed: elapsed,
              order: summary.created + 1,
              isCompleted: !!statusId,
              completedAt: statusId ? new Date() : null,
            },
          });

          testRunCaseIdMap.set(testmoRunTestId, testRunCase.id);

          const resultType = determineJUnitResultType(resolvedStatus, statusName);

          const executedAt = testRunTimestampMap.get(testmoRunId) || new Date();

          // Log first few result creations for debugging
          if (summary.created < 10) {
            console.log(
              `[CREATE] Result #${summary.created + 1}: testmoCaseId=${testmoCaseId}, testmoRunId=${testmoRunId}, caseId=${repositoryCaseId}, caseProject=${actualCaseProjectId}, runId=${testRunId}, runProject=${actualTestRunProjectId}, suiteId=${testSuiteId}`
            );
          }

          // Special logging for case 69305 to debug cross-project issue
          if (repositoryCaseId === 69305) {
            console.log(
              `[CASE_69305] Creating result: testmoCaseId=${testmoCaseId}, testmoRunId=${testmoRunId}, testmoProjectId=${testmoProjectId}, testRunTestmoProjectId=${testRunTestmoProjectId}, caseId=${repositoryCaseId}, caseProject=${actualCaseProjectId}, runId=${testRunId}, runProject=${actualTestRunProjectId}, suiteId=${testSuiteId}`
            );
          }

          const junitResult = await tx.jUnitTestResult.create({
            data: {
              repositoryCaseId,
              testSuiteId,
              type: resultType,
              statusId: statusId ?? undefined,
              time: elapsed || undefined,
              assertions: assertions || undefined,
              file: file || undefined,
              line: line ? parseInt(line) : undefined,
              createdById: defaultUserId,
              executedAt,
            },
          });

          junitResultIdMap.set(testmoRunTestId, junitResult.id);
          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs,
      }
    );

    processedTests += processedInChunk;
    context.processedCount += processedInChunk;

    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedTests, progressEntry.total);

    await reportProgress(true);
  }

  await reportProgress(true);

  const suiteIdsToUpdate = Array.from(testSuiteIdMap.values());
  if (suiteIdsToUpdate.length > 0) {
    await prisma.$transaction(
      async (tx) => {
        await reconcileLegacyJUnitSuiteLinks(tx, suiteIdsToUpdate);
        await recomputeJUnitSuiteStats(tx, suiteIdsToUpdate);
      },
      {
        timeout: options?.transactionTimeoutMs,
      }
    );
  }

  progressEntry.created = summary.created;
  progressEntry.mapped = Math.min(processedTests, progressEntry.total);

  return { summary, testRunCaseIdMap, junitResultIdMap };
};

/**
 * Import automation_run_fields as custom fields stored in TestRuns.note (JSON)
 * Stores key-value metadata like Version, Build info, etc.
 */
export const importAutomationRunFields = async (
  prisma: PrismaClient,
  _configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  testRunIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn,
  options?: {
    chunkSize?: number;
    transactionTimeoutMs?: number;
  }
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "automationRunFields",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const automationRunFieldRows = datasetRows.get("automation_run_fields") ?? [];
  summary.total = automationRunFieldRows.length;

  const entityName = "automationRunFields";
  const progressEntry =
    context.entityProgress[entityName] ??
    (context.entityProgress[entityName] = {
      total: summary.total,
      created: 0,
      mapped: 0,
    });
  progressEntry.total = summary.total;

  const chunkSize = Math.max(1, options?.chunkSize ?? 250);
  const updateChunkSize = Math.max(1, Math.floor(chunkSize / 2) || 1);
  let processedRows = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(1, Math.floor(summary.total / 50));
  const minProgressIntervalMs = 2000;

  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
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

    lastReportedCount = processedRows;
    lastReportAt = now;

    const statusMessage = `Processing automation run fields (${processedRows.toLocaleString()} / ${summary.total.toLocaleString()} records processed)`;
    await persistProgress(entityName, statusMessage);
  };

  const fieldsByRunId = new Map<number, Record<string, any>>();
  for (const row of automationRunFieldRows) {
    const testmoRunId = toNumberValue(row.run_id);
    const testmoProjectId = toNumberValue(row.project_id);
    const name = toStringValue(row.name);
    const fieldType = toNumberValue(row.type);
    const value = toStringValue(row.value);

    processedRows += 1;

    if (!testmoRunId || !testmoProjectId || !name) {
      context.processedCount += 1;
      await reportProgress();
      continue;
    }

    const projectId = projectIdMap.get(testmoProjectId);
    const testRunId = testRunIdMap.get(testmoRunId);

    if (!projectId || !testRunId) {
      context.processedCount += 1;
      await reportProgress();
      continue;
    }

    if (!fieldsByRunId.has(testRunId)) {
      fieldsByRunId.set(testRunId, {});
    }
    const fields = fieldsByRunId.get(testRunId)!;
    fields[name] = { type: fieldType, value };

    context.processedCount += 1;
    if (processedRows % chunkSize === 0) {
      await reportProgress();
    }
  }

  await reportProgress(true);

  const runEntries = Array.from(fieldsByRunId.entries());
  const totalRuns = runEntries.length;
  let runsProcessed = 0;

  const updateChunks = chunkArray(runEntries, updateChunkSize);

  for (const chunk of updateChunks) {
    const results = await Promise.allSettled(
      chunk.map(([testRunId, fields]) =>
        prisma.testRuns.update({
          where: { id: testRunId },
          data: { note: fields },
        })
      )
    );

    results.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        summary.created += 1;
      } else {
        const runId = chunk[idx]?.[0];
        console.error("Failed to update automation run fields", {
          runId,
          error: result.reason,
        });
      }
    });

    runsProcessed += chunk.length;
    const statusMessage = `Applying automation run field updates (${runsProcessed.toLocaleString()} / ${totalRuns.toLocaleString()} runs updated)`;
    await persistProgress(entityName, statusMessage);
  }

  progressEntry.created = summary.created;
  progressEntry.mapped = Math.min(processedRows, progressEntry.total);

  return summary;
};

const reconcileLegacyJUnitSuiteLinks = async (
  tx: Prisma.TransactionClient,
  suiteIds: number[]
) => {
  if (suiteIds.length === 0) {
    return;
  }

  const chunkSize = 2000;
  for (const chunk of chunkArray(suiteIds, chunkSize)) {
    // Only update results where testSuiteId points to a TestRun (legacy data)
    // Don't update results that already correctly point to a JUnitTestSuite
    // CRITICAL: Also check that testSuiteId is NOT already a valid JUnitTestSuite
    await tx.$executeRaw`
      UPDATE "JUnitTestResult" AS r
      SET "testSuiteId" = s."id"
      FROM "JUnitTestSuite" AS s
      WHERE s."id" IN (${Prisma.join(chunk)})
        AND r."testSuiteId" = s."testRunId"
        AND r."testSuiteId" IN (SELECT id FROM "TestRuns")
        AND r."testSuiteId" NOT IN (SELECT id FROM "JUnitTestSuite");
    `;
  }
};

const recomputeJUnitSuiteStats = async (
  tx: Prisma.TransactionClient,
  suiteIds: number[]
) => {
  if (suiteIds.length === 0) {
    return;
  }

  const groupedAll: Array<{
    testSuiteId: number;
    type: JUnitResultType | null;
    _count: { _all: number };
    _sum: { time: number | null };
  }> = [];

  const chunkSize = 2000;
  for (const chunk of chunkArray(suiteIds, chunkSize)) {
    const grouped = await tx.jUnitTestResult.groupBy({
      by: ["testSuiteId", "type"],
      where: {
        testSuiteId: {
          in: chunk,
        },
      },
      _count: {
        _all: true,
      },
      _sum: {
        time: true,
      },
    });

    groupedAll.push(...grouped);
  }

  const statsBySuite = new Map<
    number,
    {
      total: number;
      failures: number;
      errors: number;
      skipped: number;
      time: number;
    }
  >();

  suiteIds.forEach((id) => {
    statsBySuite.set(id, {
      total: 0,
      failures: 0,
      errors: 0,
      skipped: 0,
      time: 0,
    });
  });

  groupedAll.forEach((entry) => {
    const suiteStats = statsBySuite.get(entry.testSuiteId);
    if (!suiteStats) {
      return;
    }

    const count = entry._count?._all ?? 0;
    const timeSum = entry._sum?.time ?? 0;

    suiteStats.total += count;
    suiteStats.time += timeSum;

    switch (entry.type) {
      case JUnitResultType.FAILURE:
        suiteStats.failures += count;
        break;
      case JUnitResultType.ERROR:
        suiteStats.errors += count;
        break;
      case JUnitResultType.SKIPPED:
        suiteStats.skipped += count;
        break;
      default:
        break;
    }
  });

  await Promise.all(
    Array.from(statsBySuite.entries()).map(([suiteId, data]) =>
      tx.jUnitTestSuite.update({
        where: { id: suiteId },
        data: {
          tests: data.total,
          failures: data.failures,
          errors: data.errors,
          skipped: data.skipped,
          time: data.time,
        },
      })
    )
  );
};

/**
 * Import automation_run_links as Attachments linked to TestRuns
 * Stores CI/CD job URLs, build links, etc.
 */
export const importAutomationRunLinks = async (
  prisma: PrismaClient,
  _configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  testRunIdMap: Map<number, number>,
  userIdMap: Map<number, string>,
  defaultUserId: string,
  context: ImportContext,
  persistProgress: PersistProgressFn,
  options?: {
    chunkSize?: number;
    transactionTimeoutMs?: number;
  }
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "automationRunLinks",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const automationRunLinkRows = datasetRows.get("automation_run_links") ?? [];
  summary.total = automationRunLinkRows.length;

  const entityName = "automationRunLinks";
  const progressEntry =
    context.entityProgress[entityName] ??
    (context.entityProgress[entityName] = {
      total: summary.total,
      created: 0,
      mapped: 0,
    });
  progressEntry.total = summary.total;

  let processedLinks = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(1, Math.floor(summary.total / 50));
  const minProgressIntervalMs = 2000;
  const chunkSize = Math.max(1, options?.chunkSize ?? 250);

  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
      return;
    }
    const now = Date.now();
    const deltaCount = processedLinks - lastReportedCount;
    if (
      !force &&
      deltaCount < minProgressDelta &&
      now - lastReportAt < minProgressIntervalMs
    ) {
      return;
    }

    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedLinks, progressEntry.total);

    lastReportedCount = processedLinks;
    lastReportAt = now;

    const statusMessage = `Processing automation run links (${processedLinks.toLocaleString()} / ${summary.total.toLocaleString()} links processed)`;
    await persistProgress(entityName, statusMessage);
  };

  if (automationRunLinkRows.length === 0) {
    await reportProgress(true);
    return summary;
  }

  for (
    let index = 0;
    index < automationRunLinkRows.length;
    index += chunkSize
  ) {
    const chunk = automationRunLinkRows.slice(index, index + chunkSize);

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        for (const row of chunk) {
          const testmoRunId = toNumberValue(row.run_id);
          const testmoProjectId = toNumberValue(row.project_id);
          const name = toStringValue(row.name);
          const note = toStringValue(row.note);
          const url = toStringValue(row.url);

          processedLinks += 1;
          context.processedCount += 1;

          if (!testmoRunId || !testmoProjectId || !url || !name) {
            continue;
          }

          const projectId = projectIdMap.get(testmoProjectId);
          const testRunId = testRunIdMap.get(testmoRunId);

          if (!projectId || !testRunId) {
            continue;
          }

          await tx.attachments.create({
            data: {
              testRunsId: testRunId,
              url,
              name,
              note: note || undefined,
              mimeType: "text/uri-list",
              size: BigInt(url.length),
              createdById: defaultUserId,
            },
          });

          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs,
      }
    );

    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedLinks, progressEntry.total);
    await reportProgress(true);
  }

  await reportProgress(true);

  progressEntry.created = summary.created;
  progressEntry.mapped = Math.min(processedLinks, progressEntry.total);

  return summary;
};

/**
 * Import automation_run_test_fields as JUnitTestResult system output/error
 * Stores test execution logs, error traces, output, etc.
 */
export const importAutomationRunTestFields = async (
  prisma: PrismaClient,
  _configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  testRunIdMap: Map<number, number>,
  _testRunCaseIdMap: Map<number, number>,
  junitResultIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn,
  options?: {
    chunkSize?: number;
    transactionTimeoutMs?: number;
  }
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "automationRunTestFields",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const entityName = "automationRunTestFields";

  const automationRunTestFieldRows =
    datasetRows.get("automation_run_test_fields") ?? [];
  const existingProgress = context.entityProgress[entityName];
  summary.total =
    automationRunTestFieldRows.length > 0
      ? automationRunTestFieldRows.length
      : (existingProgress?.total ?? 0);

  const progressEntry =
    context.entityProgress[entityName] ??
    (context.entityProgress[entityName] = {
      total: summary.total,
      created: 0,
      mapped: 0,
    });
  progressEntry.total = summary.total;
  if (summary.total === 0 && context.jobId) {
    summary.total = await prisma.testmoImportStaging.count({
      where: {
        jobId: context.jobId,
        datasetName: "automation_run_test_fields",
      },
    });
    progressEntry.total = summary.total;
  }

  let processedRows = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(
    1,
    Math.min(Math.floor(summary.total / 50), 5000)
  );
  const minProgressIntervalMs = 2000;
  const chunkSize = Math.max(1, options?.chunkSize ?? 250);

  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
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

    lastReportedCount = processedRows;
    lastReportAt = now;

    const statusMessage = `Processing automation run test fields (${processedRows.toLocaleString()} / ${summary.total.toLocaleString()} records processed)`;
    await persistProgress(entityName, statusMessage);
  };

  type PendingFieldUpdate = {
    junitResultId: number | undefined;
    systemOut: string[];
    systemErr: string[];
  };

  const pendingByTestId = new Map<number, PendingFieldUpdate>();
  let rowsSinceFlush = 0;
  const shouldStream =
    automationRunTestFieldRows.length === 0 && summary.total > 0;
  const fetchBatchSize = Math.min(Math.max(chunkSize * 4, chunkSize), 5000);

  const cloneRowData = (
    data: unknown,
    fieldName?: string | null,
    fieldValue?: string | null,
    text1?: string | null,
    text2?: string | null,
    text3?: string | null,
    text4?: string | null
  ) => {
    const cloned =
      typeof data === "object" && data !== null
        ? JSON.parse(JSON.stringify(data))
        : data;

    if (cloned && typeof cloned === "object") {
      const record = cloned as Record<string, unknown>;
      if (
        fieldValue !== null &&
        fieldValue !== undefined &&
        record.value === undefined
      ) {
        record.value = fieldValue;
      }
      if (fieldName && (record.name === undefined || record.name === null)) {
        record.name = fieldName;
      }
      const textEntries: Array<[string, string | null | undefined]> = [
        ["text1", text1],
        ["text2", text2],
        ["text3", text3],
        ["text4", text4],
      ];
      for (const [key, value] of textEntries) {
        if (
          value !== null &&
          value !== undefined &&
          record[key] === undefined
        ) {
          record[key] = value;
        }
      }
    }

    return cloned;
  };

  const streamStagingRows = async function* (): AsyncGenerator<any> {
    if (!context.jobId) {
      throw new Error(
        "importAutomationRunTestFields requires context.jobId for streaming"
      );
    }

    let nextRowIndex = 0;
    while (true) {
      const stagedRows = await prisma.testmoImportStaging.findMany({
        where: {
          jobId: context.jobId,
          datasetName: "automation_run_test_fields",
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
          fieldName: true,
          fieldValue: true,
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

      for (const staged of stagedRows) {
        yield cloneRowData(
          staged.rowData,
          staged.fieldName,
          staged.fieldValue,
          staged.text1,
          staged.text2,
          staged.text3,
          staged.text4
        );
      }
    }
  };

  const mergeValues = (
    current: string | null | undefined,
    additions: string[]
  ): string | null => {
    const filtered = additions
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (filtered.length === 0) {
      return current ?? null;
    }

    const addition = filtered.join("\n\n");
    if (!addition) {
      return current ?? null;
    }

    if (!current || current.trim().length === 0) {
      return addition;
    }

    return `${current}\n\n${addition}`;
  };

  const flushPendingUpdates = async (force = false) => {
    const shouldFlushByRows = rowsSinceFlush >= chunkSize;
    if (!force && pendingByTestId.size < chunkSize && !shouldFlushByRows) {
      return;
    }
    if (pendingByTestId.size === 0) {
      return;
    }

    const entries = Array.from(pendingByTestId.entries());
    pendingByTestId.clear();

    const resultIds = entries
      .map(([, update]) => update.junitResultId)
      .filter((id): id is number => typeof id === "number");

    const existingResults =
      resultIds.length > 0
        ? await prisma.jUnitTestResult.findMany({
            where: { id: { in: resultIds } },
            select: { id: true, systemOut: true, systemErr: true },
          })
        : [];
    const existingById = new Map(
      existingResults.map((result) => [result.id, result])
    );

    let updatesApplied = 0;

    if (entries.length > 0) {
      await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          for (const [, update] of entries) {
            const junitResultId = update.junitResultId;
            if (!junitResultId) {
              continue;
            }

            const existing = existingById.get(junitResultId);
            const nextSystemOut = mergeValues(
              existing?.systemOut,
              update.systemOut
            );
            const nextSystemErr = mergeValues(
              existing?.systemErr,
              update.systemErr
            );

            if (
              nextSystemOut === (existing?.systemOut ?? null) &&
              nextSystemErr === (existing?.systemErr ?? null)
            ) {
              continue;
            }

            await tx.jUnitTestResult.update({
              where: { id: junitResultId },
              data: {
                systemOut: nextSystemOut,
                systemErr: nextSystemErr,
              },
            });

            summary.created += 1;
            updatesApplied += 1;
          }
        },
        {
          timeout: options?.transactionTimeoutMs,
        }
      );
    }

    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedRows, summary.total);

    if (
      updatesApplied > 0 &&
      (processedRows % 50000 === 0 || processedRows === summary.total)
    ) {
      console.log(
        `[importAutomationRunTestFields] Applied ${updatesApplied} updates (processed ${processedRows}/${summary.total} rows)`
      );
    }

    const statusMessage = `Applying automation run test field updates (${processedRows.toLocaleString()} / ${summary.total.toLocaleString()} rows processed)`;
    await persistProgress(entityName, statusMessage);

    rowsSinceFlush = 0;
  };

  const rowIterator = shouldStream
    ? streamStagingRows()
    : (async function* () {
        for (const row of automationRunTestFieldRows) {
          yield row;
        }
      })();

  for await (const row of rowIterator) {
    const testmoTestId = toNumberValue(row.test_id);
    const testmoRunId = toNumberValue(row.run_id);
    const testmoProjectId = toNumberValue(row.project_id);
    const name = toStringValue(row.name);
    let value = toStringValue(row.value);

    processedRows += 1;
    context.processedCount += 1;

    if (!testmoTestId || !testmoRunId || !testmoProjectId || !name || !value) {
      await reportProgress();
      continue;
    }

    const projectId = projectIdMap.get(testmoProjectId);
    const testRunId = testRunIdMap.get(testmoRunId);
    const junitResultId = junitResultIdMap.get(testmoTestId);

    if (!projectId || !testRunId || !junitResultId) {
      await reportProgress();
      continue;
    }

    const MAX_VALUE_LENGTH = 500000; // 500KB limit
    if (value.length > MAX_VALUE_LENGTH) {
      value =
        value.substring(0, MAX_VALUE_LENGTH) +
        "\n\n... (truncated, original length: " +
        value.length +
        " characters)";
    }

    const lowerName = name.toLowerCase();
    const pending =
      pendingByTestId.get(testmoTestId) ??
      ({ junitResultId, systemOut: [], systemErr: [] } as PendingFieldUpdate);

    if (lowerName.includes("error") || lowerName.includes("errors")) {
      pending.systemErr.push(value);
    } else if (lowerName.includes("output")) {
      pending.systemOut.push(value);
    } else {
      pending.systemOut.push(`${name}: ${value}`);
    }

    pending.junitResultId = junitResultId;
    pendingByTestId.set(testmoTestId, pending);

    await reportProgress();

    rowsSinceFlush += 1;
    if (pendingByTestId.size >= chunkSize) {
      await flushPendingUpdates();
      continue;
    }

    if (rowsSinceFlush >= chunkSize) {
      await flushPendingUpdates();
    }
  }

  await reportProgress(true);
  await flushPendingUpdates(true);

  progressEntry.created = summary.created;
  progressEntry.mapped = Math.min(processedRows, summary.total);

  return summary;
};
export const importAutomationRunTags = async (
  prisma: PrismaClient,
  configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  testRunIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn,
  options?: {
    chunkSize?: number;
    transactionTimeoutMs?: number;
  }
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "automationRunTags",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const automationRunTagRows = datasetRows.get("automation_run_tags") ?? [];
  summary.total = automationRunTagRows.length;

  const entityName = "automationRunTags";
  const progressEntry =
    context.entityProgress[entityName] ??
    (context.entityProgress[entityName] = {
      total: summary.total,
      created: 0,
      mapped: 0,
    });
  progressEntry.total = summary.total;

  let processedRows = 0;
  let lastReportedCount = 0;
  let lastReportAt = context.lastProgressUpdate;
  const minProgressDelta = Math.max(1, Math.floor(summary.total / 50));
  const minProgressIntervalMs = 2000;
  const chunkSize = Math.max(1, options?.chunkSize ?? 250);

  const reportProgress = async (force = false) => {
    if (summary.total === 0) {
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

    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedRows, progressEntry.total);

    lastReportedCount = processedRows;
    lastReportAt = now;

    const statusMessage = `Processing automation run tags (${processedRows.toLocaleString()} / ${summary.total.toLocaleString()} assignments processed)`;
    await persistProgress(entityName, statusMessage);
  };

  if (automationRunTagRows.length === 0) {
    await reportProgress(true);
    return summary;
  }

  for (let index = 0; index < automationRunTagRows.length; index += chunkSize) {
    const chunk = automationRunTagRows.slice(index, index + chunkSize);

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        for (const row of chunk) {
          processedRows += 1;
          context.processedCount += 1;

          const testmoRunId = toNumberValue(row.run_id);
          const testmoTagId = toNumberValue(row.tag_id);

          if (!testmoRunId || !testmoTagId) {
            continue;
          }

          const runId = testRunIdMap.get(testmoRunId);
          if (!runId) {
            continue;
          }

          const tagConfig = configuration.tags?.[testmoTagId];
          if (!tagConfig || tagConfig.action !== "map" || !tagConfig.mappedTo) {
            continue;
          }

          const tagId = tagConfig.mappedTo;

          const existing = await tx.testRuns.findFirst({
            where: {
              id: runId,
              tags: {
                some: {
                  id: tagId,
                },
              },
            },
            select: { id: true },
          });

          if (existing) {
            summary.mapped += 1;
            continue;
          }

          await tx.testRuns.update({
            where: { id: runId },
            data: {
              tags: {
                connect: { id: tagId },
              },
            },
          });

          summary.created += 1;
        }
      },
      {
        timeout: options?.transactionTimeoutMs,
      }
    );

    progressEntry.created = summary.created;
    progressEntry.mapped = Math.min(processedRows, progressEntry.total);
    await reportProgress(true);
  }

  await reportProgress(true);

  progressEntry.created = summary.created;
  progressEntry.mapped = Math.min(processedRows, progressEntry.total);

  return summary;
};
