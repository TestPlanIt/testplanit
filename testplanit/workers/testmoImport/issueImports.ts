import { PrismaClient, Prisma, IntegrationProvider, IntegrationAuthType, IntegrationStatus } from "@prisma/client";
import type { TestmoMappingConfiguration } from "../../services/imports/testmo/types";
import { toNumberValue, toStringValue } from "./helpers";
import type { EntitySummaryResult, ImportContext, PersistProgressFn } from "./types";

const PROGRESS_UPDATE_INTERVAL = 500;

/**
 * Map Testmo issue target type to TestPlanIt IntegrationProvider
 */
const mapIssueTargetType = (testmoType: number): IntegrationProvider => {
  // Based on Testmo documentation:
  // 1 = Jira Cloud
  // 2 = GitHub Issues
  // 3 = Azure DevOps
  // 4 = Jira Server/Data Center
  // For now, we'll map both Jira types to JIRA
  switch (testmoType) {
    case 1:
    case 4:
      return IntegrationProvider.JIRA;
    case 2:
      return IntegrationProvider.GITHUB;
    case 3:
      return IntegrationProvider.AZURE_DEVOPS;
    default:
      // Default to SIMPLE_URL for unknown types
      return IntegrationProvider.SIMPLE_URL;
  }
};

/**
 * Import issue_targets as Integration records
 * Testmo issue_targets represent external issue tracking systems (Jira, GitHub, etc.)
 * This function uses the user's configuration to map or create integrations.
 */
export const importIssueTargets = async (
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<{ summary: EntitySummaryResult; integrationIdMap: Map<number, number> }> => {
  const summary: EntitySummaryResult = {
    entity: "issueTargets",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const integrationIdMap = new Map<number, number>();
  let processedSinceLastPersist = 0;

  for (const [key, config] of Object.entries(configuration.issueTargets ?? {})) {
    const sourceId = Number(key);
    if (!Number.isFinite(sourceId) || !config) {
      continue;
    }

    summary.total += 1;

    // Handle "map" action - map to existing integration
    if (config.action === "map") {
      if (config.mappedTo === null || config.mappedTo === undefined) {
        throw new Error(
          `Issue target ${sourceId} is configured to map but no target integration was provided.`
        );
      }

      const existing = await tx.integration.findUnique({
        where: { id: config.mappedTo },
      });
      if (!existing) {
        throw new Error(
          `Integration ${config.mappedTo} selected for mapping was not found.`
        );
      }

      integrationIdMap.set(sourceId, existing.id);
      config.mappedTo = existing.id;
      summary.mapped += 1;

      processedSinceLastPersist += 1;
      if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
        await persistProgress("issueTargets");
        processedSinceLastPersist = 0;
      }
      continue;
    }

    // Handle "create" action - create new integration or map to existing by name
    const name = (config.name ?? "").trim();
    if (!name) {
      throw new Error(
        `Issue target ${sourceId} requires a name before it can be created.`
      );
    }

    const provider = config.provider
      ? (config.provider as IntegrationProvider)
      : config.testmoType
        ? mapIssueTargetType(config.testmoType)
        : IntegrationProvider.SIMPLE_URL;

    // Check if an integration with this name already exists
    const existing = await tx.integration.findFirst({
      where: {
        name,
        isDeleted: false,
      },
    });

    if (existing) {
      integrationIdMap.set(sourceId, existing.id);
      config.action = "map";
      config.mappedTo = existing.id;
      config.name = existing.name;
      summary.mapped += 1;
    } else {
      // Create new integration
      const integration = await tx.integration.create({
        data: {
          name,
          provider,
          authType: IntegrationAuthType.NONE,
          status: IntegrationStatus.INACTIVE,
          credentials: {}, // Empty credentials for now
          settings: {
            testmoSourceId: sourceId,
            testmoType: config.testmoType,
            importedFrom: "testmo",
          },
        },
      });

      integrationIdMap.set(sourceId, integration.id);
      config.action = "map";
      config.mappedTo = integration.id;
      config.name = integration.name;
      summary.created += 1;
    }

    processedSinceLastPersist += 1;
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
      await persistProgress("issueTargets");
      processedSinceLastPersist = 0;
    }
  }

  if (processedSinceLastPersist > 0) {
    await persistProgress("issueTargets");
  }

  return { summary, integrationIdMap };
};

/**
 * Construct the external URL for an issue based on the integration provider and settings
 */
const constructExternalUrl = (
  provider: IntegrationProvider,
  baseUrl: string | undefined,
  externalKey: string
): string | null => {
  if (!baseUrl) {
    return null;
  }

  // Remove trailing slash from baseUrl
  const cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

  switch (provider) {
    case IntegrationProvider.JIRA:
      // JIRA: baseUrl/browse/KEY
      return `${cleanBaseUrl}/browse/${externalKey}`;
    case IntegrationProvider.GITHUB:
      // GitHub: baseUrl/issues/NUMBER (externalKey should be just the number)
      return `${cleanBaseUrl}/issues/${externalKey}`;
    case IntegrationProvider.AZURE_DEVOPS:
      // Azure DevOps: baseUrl/_workitems/edit/ID
      return `${cleanBaseUrl}/_workitems/edit/${externalKey}`;
    case IntegrationProvider.SIMPLE_URL:
      // For simple URL, use the baseUrl as a template if it contains {issueId}
      if (baseUrl.includes("{issueId}")) {
        return baseUrl.replace("{issueId}", externalKey);
      }
      return `${cleanBaseUrl}/${externalKey}`;
    default:
      return null;
  }
};

/**
 * Import issues dataset as Issue records
 */
export const importIssues = async (
  tx: Prisma.TransactionClient,
  datasetRows: Map<string, any[]>,
  integrationIdMap: Map<number, number>,
  projectIdMap: Map<number, number>,
  createdById: string,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<{ summary: EntitySummaryResult; issueIdMap: Map<number, number> }> => {
  const summary: EntitySummaryResult = {
    entity: "issues",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const issueIdMap = new Map<number, number>();
  const issueRows = datasetRows.get("issues") ?? [];

  if (issueRows.length === 0) {
    return { summary, issueIdMap };
  }

  summary.total = issueRows.length;
  let processedSinceLastPersist = 0;

  // Cache integrations to avoid repeated queries
  const integrationCache = new Map<number, { provider: IntegrationProvider; baseUrl?: string }>();

  for (const row of issueRows) {
    const record = row as Record<string, unknown>;
    const sourceId = toNumberValue(record.id);
    const targetSourceId = toNumberValue(record.target_id);
    const projectSourceId = toNumberValue(record.project_id);
    const displayId = toStringValue(record.display_id);

    if (sourceId === null || targetSourceId === null || !displayId) {
      continue;
    }

    const integrationId = integrationIdMap.get(targetSourceId);
    if (!integrationId) {
      // Skip if target integration doesn't exist
      continue;
    }

    const projectId = projectSourceId !== null ? projectIdMap.get(projectSourceId) : null;

    // Check if issue already exists with this external ID and integration
    const existing = await tx.issue.findFirst({
      where: {
        externalId: displayId,
        integrationId,
      },
    });

    if (existing) {
      issueIdMap.set(sourceId, existing.id);
      summary.mapped += 1;
    } else {
      // Fetch integration details if not in cache
      if (!integrationCache.has(integrationId)) {
        const integration = await tx.integration.findUnique({
          where: { id: integrationId },
          select: { provider: true, settings: true },
        });
        if (integration) {
          const settings = integration.settings as Record<string, any> | null;
          integrationCache.set(integrationId, {
            provider: integration.provider,
            baseUrl: settings?.baseUrl,
          });
        }
      }

      const integrationInfo = integrationCache.get(integrationId);
      const externalUrl = integrationInfo
        ? constructExternalUrl(integrationInfo.provider, integrationInfo.baseUrl, displayId)
        : null;

      // Create new issue
      const issue = await tx.issue.create({
        data: {
          name: displayId,
          title: displayId,
          externalId: displayId,
          externalKey: displayId,
          externalUrl,
          integrationId,
          projectId: projectId ?? undefined,
          createdById,
          data: {
            testmoSourceId: sourceId,
            importedFrom: "testmo",
          },
        },
      });

      issueIdMap.set(sourceId, issue.id);
      summary.created += 1;
    }

    processedSinceLastPersist += 1;
    if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
      await persistProgress("issues");
      processedSinceLastPersist = 0;
    }
  }

  if (processedSinceLastPersist > 0) {
    await persistProgress("issues");
  }

  return { summary, issueIdMap };
};

/**
 * Import milestone_issues relationships
 * NOTE: Currently not implemented - Milestones model does not have an issues relation in the schema.
 * This would need to be added to the schema before milestone-issue relationships can be imported.
 * Connects issues to milestones via the implicit many-to-many join table
 */
export const importMilestoneIssues = async (
  tx: Prisma.TransactionClient,
  datasetRows: Map<string, any[]>,
  milestoneIdMap: Map<number, number>,
  issueIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "milestoneIssues",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const milestoneIssueRows = datasetRows.get("milestone_issues") ?? [];
  summary.total = milestoneIssueRows.length;

  // Skip import - schema doesn't support milestone-issue relationship yet
  // TODO: Add issues relation to Milestones model in schema.zmodel to enable this import
  if (milestoneIssueRows.length > 0) {
    console.warn(
      `Skipping import of ${milestoneIssueRows.length} milestone-issue relationships - ` +
      `Milestones model does not have an issues relation. ` +
      `Add 'issues Issue[]' to the Milestones model in schema.zmodel to enable this feature.`
    );
  }

  return summary;
};

/**
 * Import repository_case_issues relationships
 * Connects issues to repository cases
 */
export const importRepositoryCaseIssues = async (
  prisma: PrismaClient,
  datasetRows: Map<string, any[]>,
  caseIdMap: Map<number, number>,
  issueIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn,
  options?: {
    chunkSize?: number;
    transactionTimeoutMs?: number;
  }
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "repositoryCaseIssues",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const repositoryCaseIssueRows = datasetRows.get("repository_case_issues") ?? [];

  if (repositoryCaseIssueRows.length === 0) {
    return summary;
  }

  summary.total = repositoryCaseIssueRows.length;
  const chunkSize = Math.max(1, options?.chunkSize ?? 1000);
  let processedCount = 0;

  for (let index = 0; index < repositoryCaseIssueRows.length; index += chunkSize) {
    const chunk = repositoryCaseIssueRows.slice(index, index + chunkSize);

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        for (const row of chunk) {
          const record = row as Record<string, unknown>;
          const caseSourceId = toNumberValue(record.case_id);
          const issueSourceId = toNumberValue(record.issue_id);

          processedCount += 1;
          context.processedCount += 1;

          if (caseSourceId === null || issueSourceId === null) {
            continue;
          }

          const caseId = caseIdMap.get(caseSourceId);
          const issueId = issueIdMap.get(issueSourceId);

          if (!caseId || !issueId) {
            continue;
          }

          // Connect issue to repository case
          await tx.repositoryCases.update({
            where: { id: caseId },
            data: {
              issues: {
                connect: { id: issueId },
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

    const statusMessage = `Processing repository case issues (${processedCount.toLocaleString()} / ${summary.total.toLocaleString()} processed)`;
    await persistProgress("repositoryCaseIssues", statusMessage);
  }

  return summary;
};

/**
 * Import run_issues relationships
 * Connects issues to test runs
 */
export const importRunIssues = async (
  prisma: PrismaClient,
  datasetRows: Map<string, any[]>,
  testRunIdMap: Map<number, number>,
  issueIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn,
  options?: {
    chunkSize?: number;
    transactionTimeoutMs?: number;
  }
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "runIssues",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const runIssueRows = datasetRows.get("run_issues") ?? [];

  if (runIssueRows.length === 0) {
    return summary;
  }

  summary.total = runIssueRows.length;
  const chunkSize = Math.max(1, options?.chunkSize ?? 1000);
  let processedCount = 0;

  for (let index = 0; index < runIssueRows.length; index += chunkSize) {
    const chunk = runIssueRows.slice(index, index + chunkSize);

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        for (const row of chunk) {
          const record = row as Record<string, unknown>;
          const runSourceId = toNumberValue(record.run_id);
          const issueSourceId = toNumberValue(record.issue_id);

          processedCount += 1;
          context.processedCount += 1;

          if (runSourceId === null || issueSourceId === null) {
            continue;
          }

          const runId = testRunIdMap.get(runSourceId);
          const issueId = issueIdMap.get(issueSourceId);

          if (!runId || !issueId) {
            continue;
          }

          // Connect issue to test run
          await tx.testRuns.update({
            where: { id: runId },
            data: {
              issues: {
                connect: { id: issueId },
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

    const statusMessage = `Processing test run issues (${processedCount.toLocaleString()} / ${summary.total.toLocaleString()} processed)`;
    await persistProgress("runIssues", statusMessage);
  }

  return summary;
};

/**
 * Import run_result_issues relationships
 * Connects issues to test run results
 */
export const importRunResultIssues = async (
  prisma: PrismaClient,
  datasetRows: Map<string, any[]>,
  testRunResultIdMap: Map<number, number>,
  issueIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn,
  options?: {
    chunkSize?: number;
    transactionTimeoutMs?: number;
  }
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "runResultIssues",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const runResultIssueRows = datasetRows.get("run_result_issues") ?? [];

  if (runResultIssueRows.length === 0) {
    return summary;
  }

  summary.total = runResultIssueRows.length;
  const chunkSize = Math.max(1, options?.chunkSize ?? 1000);
  let processedCount = 0;

  for (let index = 0; index < runResultIssueRows.length; index += chunkSize) {
    const chunk = runResultIssueRows.slice(index, index + chunkSize);

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        for (const row of chunk) {
          const record = row as Record<string, unknown>;
          const resultSourceId = toNumberValue(record.result_id);
          const issueSourceId = toNumberValue(record.issue_id);

          processedCount += 1;
          context.processedCount += 1;

          if (resultSourceId === null || issueSourceId === null) {
            continue;
          }

          const resultId = testRunResultIdMap.get(resultSourceId);
          const issueId = issueIdMap.get(issueSourceId);

          if (!resultId || !issueId) {
            continue;
          }

          // Connect issue to test run result
          await tx.testRunResults.update({
            where: { id: resultId },
            data: {
              issues: {
                connect: { id: issueId },
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

    const statusMessage = `Processing test run result issues (${processedCount.toLocaleString()} / ${summary.total.toLocaleString()} processed)`;
    await persistProgress("runResultIssues", statusMessage);
  }

  return summary;
};

/**
 * Import session_issues relationships
 * Connects issues to sessions
 */
export const importSessionIssues = async (
  prisma: PrismaClient,
  datasetRows: Map<string, any[]>,
  sessionIdMap: Map<number, number>,
  issueIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn,
  options?: {
    chunkSize?: number;
    transactionTimeoutMs?: number;
  }
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "sessionIssues",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const sessionIssueRows = datasetRows.get("session_issues") ?? [];

  if (sessionIssueRows.length === 0) {
    return summary;
  }

  summary.total = sessionIssueRows.length;
  const chunkSize = Math.max(1, options?.chunkSize ?? 1000);
  let processedCount = 0;

  for (let index = 0; index < sessionIssueRows.length; index += chunkSize) {
    const chunk = sessionIssueRows.slice(index, index + chunkSize);

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        for (const row of chunk) {
          const record = row as Record<string, unknown>;
          const sessionSourceId = toNumberValue(record.session_id);
          const issueSourceId = toNumberValue(record.issue_id);

          processedCount += 1;
          context.processedCount += 1;

          if (sessionSourceId === null || issueSourceId === null) {
            continue;
          }

          const sessionId = sessionIdMap.get(sessionSourceId);
          const issueId = issueIdMap.get(issueSourceId);

          if (!sessionId || !issueId) {
            continue;
          }

          // Connect issue to session
          await tx.sessions.update({
            where: { id: sessionId },
            data: {
              issues: {
                connect: { id: issueId },
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

    const statusMessage = `Processing session issues (${processedCount.toLocaleString()} / ${summary.total.toLocaleString()} processed)`;
    await persistProgress("sessionIssues", statusMessage);
  }

  return summary;
};

/**
 * Import session_result_issues relationships
 * Connects issues to session results
 */
export const importSessionResultIssues = async (
  prisma: PrismaClient,
  datasetRows: Map<string, any[]>,
  sessionResultIdMap: Map<number, number>,
  issueIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn,
  options?: {
    chunkSize?: number;
    transactionTimeoutMs?: number;
  }
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "sessionResultIssues",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const sessionResultIssueRows = datasetRows.get("session_result_issues") ?? [];

  if (sessionResultIssueRows.length === 0) {
    return summary;
  }

  summary.total = sessionResultIssueRows.length;
  const chunkSize = Math.max(1, options?.chunkSize ?? 1000);
  let processedCount = 0;

  for (let index = 0; index < sessionResultIssueRows.length; index += chunkSize) {
    const chunk = sessionResultIssueRows.slice(index, index + chunkSize);

    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        for (const row of chunk) {
          const record = row as Record<string, unknown>;
          const resultSourceId = toNumberValue(record.result_id);
          const issueSourceId = toNumberValue(record.issue_id);

          processedCount += 1;
          context.processedCount += 1;

          if (resultSourceId === null || issueSourceId === null) {
            continue;
          }

          const resultId = sessionResultIdMap.get(resultSourceId);
          const issueId = issueIdMap.get(issueSourceId);

          if (!resultId || !issueId) {
            continue;
          }

          // Connect issue to session result
          await tx.sessionResults.update({
            where: { id: resultId },
            data: {
              issues: {
                connect: { id: issueId },
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

    const statusMessage = `Processing session result issues (${processedCount.toLocaleString()} / ${summary.total.toLocaleString()} processed)`;
    await persistProgress("sessionResultIssues", statusMessage);
  }

  return summary;
};

/**
 * Create ProjectIntegration records to connect projects to their integrations
 * This is needed so that projects can access issues from the configured integrations
 */
export const createProjectIntegrations = async (
  tx: Prisma.TransactionClient,
  datasetRows: Map<string, any[]>,
  projectIdMap: Map<number, number>,
  integrationIdMap: Map<number, number>,
  context: ImportContext,
  persistProgress: PersistProgressFn
): Promise<EntitySummaryResult> => {
  const summary: EntitySummaryResult = {
    entity: "projectIntegrations",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const issueRows = datasetRows.get("issues") ?? [];
  if (issueRows.length === 0) {
    return summary;
  }

  // Build a map of project ID -> Set of integration IDs
  const projectIntegrationsMap = new Map<number, Set<number>>();

  for (const row of issueRows) {
    const record = row as Record<string, unknown>;
    const targetSourceId = toNumberValue(record.target_id);
    const projectSourceId = toNumberValue(record.project_id);

    if (targetSourceId === null || projectSourceId === null) {
      continue;
    }

    const integrationId = integrationIdMap.get(targetSourceId);
    const projectId = projectIdMap.get(projectSourceId);

    if (!integrationId || !projectId) {
      continue;
    }

    if (!projectIntegrationsMap.has(projectId)) {
      projectIntegrationsMap.set(projectId, new Set());
    }
    projectIntegrationsMap.get(projectId)!.add(integrationId);
  }

  summary.total = projectIntegrationsMap.size;
  let processedSinceLastPersist = 0;

  // Create ProjectIntegration records
  for (const [projectId, integrationIds] of projectIntegrationsMap) {
    for (const integrationId of integrationIds) {
      // Check if connection already exists
      const existing = await tx.projectIntegration.findFirst({
        where: {
          projectId,
          integrationId,
        },
      });

      if (!existing) {
        await tx.projectIntegration.create({
          data: {
            projectId,
            integrationId,
            isActive: true,
          },
        });
        summary.created += 1;
      } else {
        summary.mapped += 1;
      }

      processedSinceLastPersist += 1;
      if (processedSinceLastPersist >= PROGRESS_UPDATE_INTERVAL) {
        await persistProgress("projectIntegrations");
        processedSinceLastPersist = 0;
      }
    }
  }

  if (processedSinceLastPersist > 0) {
    await persistProgress("projectIntegrations");
  }

  return summary;
};
