import { syncQueue } from "../../queues";
import { issueCache } from "../cache/IssueCache";
import { integrationManager } from "../IntegrationManager";
import { enhance } from "@zenstackhq/runtime";
import type { IssueData } from "../adapters/IssueAdapter";
import type { IssueAdapter } from "../adapters/IssueAdapter";
import { JobsOptions } from "bullmq";
import { prisma } from "@/lib/prisma";
import { syncIssueToElasticsearch } from "~/services/issueSearch";

export interface SyncJobData {
  userId: string;
  integrationId: number;
  projectId?: string;
  issueId?: string;
  action: "sync" | "create" | "update" | "refresh";
  data?: any;
}

export interface SyncOptions {
  forceRefresh?: boolean;
  includeMetadata?: boolean;
  limit?: number;
}

export class SyncService {
  /**
   * Queue a sync job for an integration
   */
  async queueSync(
    userId: string,
    integrationId: number,
    options: SyncOptions = {}
  ): Promise<string | null> {
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }

    const jobData: SyncJobData = {
      userId,
      integrationId,
      action: "sync",
      data: options,
    };

    const jobOptions: JobsOptions = {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    };

    const job = await syncQueue.add("sync-issues", jobData, jobOptions);
    return job.id || null;
  }

  /**
   * Queue a project-specific sync
   */
  async queueProjectSync(
    userId: string,
    integrationId: number,
    projectId: string,
    options: SyncOptions = {}
  ): Promise<string | null> {
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }

    const jobData: SyncJobData = {
      userId,
      integrationId,
      projectId,
      action: "sync",
      data: options,
    };

    const job = await syncQueue.add("sync-project-issues", jobData);
    return job.id || null;
  }

  /**
   * Queue issue creation
   */
  async queueIssueCreate(
    userId: string,
    integrationId: number,
    issueData: any
  ): Promise<string | null> {
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }

    const jobData: SyncJobData = {
      userId,
      integrationId,
      action: "create",
      data: issueData,
    };

    const job = await syncQueue.add("create-issue", jobData, {
      attempts: 2,
      backoff: {
        type: "fixed",
        delay: 1000,
      },
    });
    return job.id || null;
  }

  /**
   * Queue issue update
   */
  async queueIssueUpdate(
    userId: string,
    integrationId: number,
    issueId: string,
    updateData: any
  ): Promise<string | null> {
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }

    const jobData: SyncJobData = {
      userId,
      integrationId,
      issueId,
      action: "update",
      data: updateData,
    };

    const job = await syncQueue.add("update-issue", jobData);
    return job.id || null;
  }

  /**
   * Queue issue refresh (sync single issue from external system)
   */
  async queueIssueRefresh(
    userId: string,
    integrationId: number,
    issueId: string
  ): Promise<string | null> {
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }

    const jobData: SyncJobData = {
      userId,
      integrationId,
      issueId,
      action: "refresh",
    };

    const job = await syncQueue.add("refresh-issue", jobData, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });
    return job.id || null;
  }

  /**
   * Perform immediate sync (used by worker)
   */
  async performSync(
    userId: string,
    integrationId: number,
    projectId?: string,
    options: SyncOptions = {},
    job?: any // BullMQ Job for progress reporting
  ): Promise<{ synced: number; errors: string[] }> {
    const errors: string[] = [];
    let syncedCount = 0;

    try {
      // Get full user object for enhance
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          role: {
            include: {
              rolePermissions: true,
            },
          },
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      // Get user context for database operations
      const userDb = enhance(prisma, { user }, { kinds: ["delegate"] });

      // Get the integration
      const integration = await userDb.integration.findUnique({
        where: { id: integrationId },
        include: {
          userIntegrationAuths: {
            where: { userId: userId, isActive: true },
          },
        },
      });

      if (!integration) {
        throw new Error("Integration not found");
      }

      // Check authentication based on auth type
      if (integration.authType === "OAUTH2") {
        // For OAuth, check if user has valid authentication
        const userAuth = integration.userIntegrationAuths[0];
        if (!userAuth) {
          throw new Error("User not authenticated for this integration");
        }

        // Check if token is expired
        if (userAuth.tokenExpiresAt && userAuth.tokenExpiresAt < new Date()) {
          throw new Error("Authentication token has expired");
        }
      } else if (
        integration.authType === "API_KEY" ||
        integration.authType === "PERSONAL_ACCESS_TOKEN"
      ) {
        // For API key or PAT, check if integration has credentials
        if (!integration.credentials) {
          throw new Error("Integration is missing credentials");
        }
      } else if (integration.authType !== "NONE") {
        // For other auth types, ensure there's some form of authentication
        const userAuth = integration.userIntegrationAuths[0];
        if (!userAuth && !integration.credentials) {
          throw new Error(
            "No authentication credentials found for this integration"
          );
        }
      }

      // Get the adapter
      const adapter = await integrationManager.getAdapter(
        String(integrationId)
      );

      if (!adapter) {
        throw new Error("Invalid adapter for issue synchronization");
      }

      // Get total count of issues to sync
      const totalIssues = await userDb.issue.count({
        where: {
          integrationId,
          ...(projectId && { projectId: parseInt(projectId) }),
        },
      });

      // Process issues in batches to manage memory usage
      const BATCH_SIZE = 50;
      let processedCount = 0;

      while (processedCount < totalIssues) {
        // Fetch a batch of issues
        const localIssues = await userDb.issue.findMany({
          where: {
            integrationId,
            ...(projectId && { projectId: parseInt(projectId) }),
          },
          select: {
            id: true,
            externalId: true,
            externalKey: true,
            name: true,
          },
          skip: processedCount,
          take: BATCH_SIZE,
        });

        // Sync each issue in the current batch
        for (let i = 0; i < localIssues.length; i++) {
          const localIssue = localIssues[i];
          const globalIndex = processedCount + i;

          try {
            // Update progress to keep job alive and inform UI
            if (job) {
              const progress = Math.round(((globalIndex + 1) / totalIssues) * 100);
              await job.updateProgress({
                current: globalIndex + 1,
                total: totalIssues,
                percentage: progress,
                message: `Syncing issue ${globalIndex + 1} of ${totalIssues}`,
              });
            }

            // Use externalId to fetch the latest data, fallback to externalKey or name
            const issueIdentifier =
              localIssue.externalId || localIssue.externalKey || localIssue.name;

            if (!issueIdentifier) {
              errors.push(`Issue ${localIssue.id} has no external identifier`);
              continue;
            }

            // Fetch fresh issue data from external system
            const issueData = await adapter.syncIssue(issueIdentifier);

            // Update cache
            await issueCache.set(integrationId, issueData.id, issueData);

            // Update local database
            await this.updateExistingIssue(userDb, integrationId, issueData);
            syncedCount++;

          } catch (error: any) {
            errors.push(
              `Failed to sync issue ${localIssue.externalKey || localIssue.externalId || localIssue.id}: ${error.message}`
            );
          }
        }

        processedCount += localIssues.length;

        // Allow garbage collection between batches
        if (processedCount < totalIssues) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Fetch metadata if requested
      if (options.includeMetadata) {
        try {
          // Get metadata based on adapter capabilities
          const metadata: any = {};

          // Cast to IssueAdapter to access optional methods
          const issueAdapter = adapter as IssueAdapter;

          if (issueAdapter.getProjects) {
            metadata.projects = await issueAdapter.getProjects();
          }
          if (issueAdapter.getStatuses) {
            metadata.statuses = await issueAdapter.getStatuses();
          }
          if (issueAdapter.getPriorities) {
            metadata.priorities = await issueAdapter.getPriorities();
          }

          await issueCache.setMetadata(integrationId, metadata);
        } catch (error: any) {
          errors.push(`Failed to fetch metadata: ${error.message}`);
        }
      }

      return { synced: syncedCount, errors };
    } catch (error: any) {
      errors.push(`Sync failed: ${error.message}`);
      return { synced: syncedCount, errors };
    }
  }

  /**
   * Refresh a single issue from the external system
   */
  async performIssueRefresh(
    userId: string,
    integrationId: number,
    externalIssueId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get full user object for enhance
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          role: {
            include: {
              rolePermissions: true,
            },
          },
        },
      });

      if (!user) {
        throw new Error("User not found");
      }

      // Get user context for database operations
      const userDb = enhance(prisma, { user }, { kinds: ["delegate"] });

      // Get the integration
      const integration = await userDb.integration.findUnique({
        where: { id: integrationId },
        include: {
          userIntegrationAuths: {
            where: { userId: userId, isActive: true },
          },
        },
      });

      if (!integration) {
        throw new Error("Integration not found");
      }

      // Check authentication based on auth type
      if (integration.authType === "OAUTH2") {
        // For OAuth, check if user has valid authentication
        const userAuth = integration.userIntegrationAuths[0];
        if (!userAuth) {
          throw new Error("User not authenticated for this integration");
        }

        // Check if token is expired
        if (userAuth.tokenExpiresAt && userAuth.tokenExpiresAt < new Date()) {
          throw new Error("Authentication token has expired");
        }
      } else if (
        integration.authType === "API_KEY" ||
        integration.authType === "PERSONAL_ACCESS_TOKEN"
      ) {
        // For API key or PAT, check if integration has credentials
        if (!integration.credentials) {
          throw new Error("Integration is missing credentials");
        }
      } else if (integration.authType !== "NONE") {
        // For other auth types, ensure there's some form of authentication
        const userAuth = integration.userIntegrationAuths[0];
        if (!userAuth && !integration.credentials) {
          throw new Error(
            "No authentication credentials found for this integration"
          );
        }
      }

      // Get the adapter
      const adapter = await integrationManager.getAdapter(
        String(integrationId)
      );

      if (!adapter) {
        throw new Error("Invalid adapter for issue synchronization");
      }

      // Check if adapter supports sync
      const capabilities = adapter.getCapabilities();
      if (!capabilities.syncIssue) {
        throw new Error(
          "This integration does not support syncing individual issues"
        );
      }

      // For GitHub issues, we need to get the repo context from the stored issue data
      let issueIdForSync = externalIssueId;
      if (integration.provider === "GITHUB") {
        // Fetch the stored issue to get the repo context
        const storedIssue = await userDb.issue.findFirst({
          where: {
            integrationId,
            OR: [
              { externalId: externalIssueId },
              { externalKey: externalIssueId },
            ],
          },
        });

        if (storedIssue?.data) {
          const data = storedIssue.data as Record<string, any>;
          const customFields = data.customFields as Record<string, any> | undefined;
          if (customFields?._github_owner && customFields?._github_repo) {
            // Construct compound ID for GitHub: owner/repo#number
            const issueNumber = externalIssueId.replace(/^#/, "");
            issueIdForSync = `${customFields._github_owner}/${customFields._github_repo}#${issueNumber}`;
          }
        }
      }

      // Fetch fresh issue data from external system
      const issueData = await adapter.syncIssue(issueIdForSync);

      // Update cache
      await issueCache.set(integrationId, issueData.id, issueData);

      // Update local database
      await this.updateExistingIssue(userDb, integrationId, issueData);

      return { success: true };
    } catch (error: any) {
      console.error(`Failed to refresh issue ${externalIssueId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update an existing issue in the local database with fresh data from external system
   */
  private async updateExistingIssue(
    db: any,
    integrationId: number,
    issueData: IssueData
  ): Promise<void> {
    // Try to find the issue by externalId or externalKey
    // This handles cases where the database might store either the ID or key
    const existingIssue = await db.issue.findFirst({
      where: {
        integrationId,
        OR: [
          { externalId: issueData.id },
          { externalId: issueData.key },
          { externalKey: issueData.key },
          { externalKey: issueData.id },
        ],
      },
    });

    if (!existingIssue) {
      // Debug: Let's see if there are any issues with this key at all
      const anyIssueWithKey = await db.issue.findFirst({
        where: {
          OR: [
            { externalId: issueData.id },
            { externalId: issueData.key },
            { externalKey: issueData.key },
            { externalKey: issueData.id },
            { name: issueData.key },
          ],
        },
        select: {
          id: true,
          integrationId: true,
          externalId: true,
          externalKey: true,
          name: true,
        },
      });

      throw new Error(
        `Issue ${issueData.key || issueData.id} not found in local database. Issues must be created through the UI before they can be synced.`
      );
    }

    const issuePayload = {
      name: issueData.key || issueData.id, // Use key if available, otherwise use id
      title: issueData.title,
      description: issueData.description || "",
      status: issueData.status,
      priority: issueData.priority || "medium",
      externalId: issueData.id,
      externalKey: issueData.key,
      externalUrl: issueData.url,
      externalStatus: issueData.status,
      externalData: issueData.customFields || {},
      issueTypeId: issueData.issueType?.id,
      issueTypeName: issueData.issueType?.name,
      issueTypeIconUrl: issueData.issueType?.iconUrl,
      lastSyncedAt: new Date(),
    };

    await db.issue.update({
      where: { id: existingIssue.id },
      data: issuePayload,
    });

    // Manually sync to Elasticsearch since enhanced Prisma client bypasses extensions
    await syncIssueToElasticsearch(existingIssue.id).catch((error: any) => {
      console.error(
        `Failed to sync issue ${existingIssue.id} to Elasticsearch:`,
        error
      );
    });
  }
}

export const syncService = new SyncService();
