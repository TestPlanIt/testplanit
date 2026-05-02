import { prisma as defaultPrisma } from "@/lib/prismaBase";
import type { PrismaClient } from "@prisma/client";
import { Job, JobsOptions } from "bullmq";
import { syncIssueToElasticsearch } from "~/services/issueSearch";
import { enqueueWithAuditContext } from "../../auditContextEnqueue";
import { getCurrentTenantId } from "../../multiTenantPrisma";
import { getSyncQueue } from "../../queues";
import valkeyConnection from "../../valkey";
import type { IssueAdapter, IssueData } from "../adapters/IssueAdapter";
import { issueCache } from "../cache/IssueCache";
import { integrationManager } from "../IntegrationManager";

// Lazy-load zenstack enhance to reduce worker memory at startup
let _enhance: typeof import("@zenstackhq/runtime").enhance | null = null;
async function _getEnhance() {
  if (!_enhance) {
    const { enhance } = await import("@zenstackhq/runtime");
    _enhance = enhance;
  }
  return _enhance;
}

export interface SyncJobData {
  userId: string;
  integrationId: number;
  projectId?: string;
  issueId?: string;
  action: "sync" | "create" | "update" | "refresh";
  data?: any;
  tenantId?: string; // For multi-tenant support
}

export interface SyncServiceOptions {
  prismaClient?: PrismaClient; // Optional: use provided client for multi-tenant support
  /**
   * Skip the upstream API call if `Issue.lastSyncedAt` is fresher than this
   * many seconds. Caller's choice based on the trigger context:
   *   • manual sync button   → 0    (always fetch — user explicitly asked)
   *   • hover/passive prefetch → 300 (5 min — dedupes tabs/refreshes)
   *   • inbound webhook       → 15   (debounces Jira event bursts; tail-end
   *                                   change at most 15s lag)
   * When the gate triggers, the call resolves with `cached: true` and the
   * upstream API is not contacted.
   */
  minFreshnessSeconds?: number;
  /**
   * If set, the sync creates a fresh local Issue row when no matching one
   * exists (instead of throwing). Used by inbound webhook handlers so the
   * receiver can mirror upstream issues that admins haven't manually
   * imported yet — the report layer can then show every upstream issue
   * regardless of whether testing is associated with it.
   *
   * `projectId` is required because Issues join to Projects directly; the
   * webhook handler resolves it from the WebhookConfig.
   *
   * Manual sync paths leave this unset — clicking Sync on an already-known
   * issue must NOT silently mint a row in a different project, and the
   * legacy throw surfaces the misconfiguration loudly.
   */
  createIfMissing?: { projectId: number };
}

/**
 * Result envelope shared by both user-context and system-context issue
 * refresh paths. `cached` and `locked` are the two short-circuit reasons —
 * either the local row was within the caller's freshness window or another
 * sync was already in flight for this issue. Both indicate "no upstream
 * API call was made"; callers can use them to skip a refetch.
 */
export interface IssueRefreshResult {
  success: boolean;
  error?: string;
  cached?: boolean;
  locked?: boolean;
}

/**
 * Per-issue Redis lock for `performIssueRefresh` — prevents two concurrent
 * syncs from the same issue from each pulling Jira's API. The TTL is the
 * safety release: if the holder crashes mid-sync, the next caller can
 * acquire after 60s.
 */
const ISSUE_SYNC_LOCK_TTL_SECONDS = 60;

function issueSyncLockKey(integrationId: number, externalId: string): string {
  return `sync-lock:issue:${integrationId}:${externalId}`;
}

async function acquireIssueSyncLock(
  integrationId: number,
  externalId: string
): Promise<boolean> {
  // Fail-open if Valkey isn't connected — better availability than blocking
  // sync entirely on cache infra.
  if (!valkeyConnection) return true;
  const key = issueSyncLockKey(integrationId, externalId);
  const result = await valkeyConnection.set(
    key,
    "1",
    "EX",
    ISSUE_SYNC_LOCK_TTL_SECONDS,
    "NX"
  );
  return result === "OK";
}

async function releaseIssueSyncLock(
  integrationId: number,
  externalId: string
): Promise<void> {
  if (!valkeyConnection) return;
  await valkeyConnection.del(issueSyncLockKey(integrationId, externalId));
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
    const syncQueue = getSyncQueue();
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }

    const jobData: SyncJobData = {
      userId,
      integrationId,
      action: "sync",
      data: options,
      tenantId: getCurrentTenantId(),
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

    const job = await enqueueWithAuditContext(
      syncQueue,
      "sync-issues",
      jobData,
      jobOptions
    );
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
    const syncQueue = getSyncQueue();
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
      tenantId: getCurrentTenantId(),
    };

    const job = await enqueueWithAuditContext(
      syncQueue,
      "sync-project-issues",
      jobData
    );
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
    const syncQueue = getSyncQueue();
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }

    const jobData: SyncJobData = {
      userId,
      integrationId,
      action: "create",
      data: issueData,
      tenantId: getCurrentTenantId(),
    };

    const job = await enqueueWithAuditContext(
      syncQueue,
      "create-issue",
      jobData,
      {
        attempts: 2,
        backoff: {
          type: "fixed",
          delay: 1000,
        },
      }
    );
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
    const syncQueue = getSyncQueue();
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
      tenantId: getCurrentTenantId(),
    };

    const job = await enqueueWithAuditContext(
      syncQueue,
      "update-issue",
      jobData
    );
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
    const syncQueue = getSyncQueue();
    if (!syncQueue) {
      console.error("Sync queue not initialized");
      return null;
    }

    const jobData: SyncJobData = {
      userId,
      integrationId,
      issueId,
      action: "refresh",
      tenantId: getCurrentTenantId(),
    };

    const job = await enqueueWithAuditContext(
      syncQueue,
      "refresh-issue",
      jobData,
      {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
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
    job?: Job, // BullMQ Job for progress reporting
    serviceOptions: SyncServiceOptions = {}
  ): Promise<{ synced: number; errors: string[] }> {
    const prisma = serviceOptions.prismaClient || defaultPrisma;
    const errors: string[] = [];
    let syncedCount = 0;

    try {
      // Get user for auth validation
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

      // Use raw Prisma client (no ZenStack enhance) — workers don't need access control
      // and enhance() causes ~3GB memory overhead

      // Get the integration
      const integration = await prisma.integration.findUnique({
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
        String(integrationId),
        prisma
      );

      if (!adapter) {
        throw new Error("Invalid adapter for issue synchronization");
      }

      // Look up linked IntegrationProject records (raw Prisma — workers skip ZenStack enhance)
      const linkedProjects = await prisma.integrationProject.findMany({
        where: {
          projectIntegration: { integrationId },
          isActive: true,
        },
      });

      if (linkedProjects.length > 0) {
        // Multi-project path: iterate per IntegrationProject with independent error isolation (D-07)
        // and per-project sync status tracking (D-08)
        for (const integrationProject of linkedProjects) {
          try {
            // Mark this project as syncing (D-08)
            await prisma.integrationProject.update({
              where: { id: integrationProject.id },
              data: { syncStatus: "syncing" },
            });

            // Fetch all issues stored for this integration (filtered to this external project)
            const allProjectIssues = await prisma.issue.findMany({
              where: {
                integrationId,
                ...(projectId && { projectId: parseInt(projectId) }),
              },
              select: {
                id: true,
                externalId: true,
                externalKey: true,
                name: true,
                externalData: true,
              },
            });

            // Filter issues that belong to this external project.
            // Jira: externalKey is "PROJECTKEY-123" — match by prefix + dash.
            // GitHub/Azure: externalProjectKey IS the owner/repo; compare to externalProjectId.
            // If no match criterion is met, include the issue (backward compat for ambiguous cases).
            const issuesForProject = allProjectIssues.filter((issue) => {
              if (!issue.externalKey) return false;
              if (
                issue.externalKey.startsWith(
                  integrationProject.externalProjectKey + "-"
                )
              ) {
                return true;
              }
              if (issue.externalKey === integrationProject.externalProjectId) {
                return true;
              }
              return false;
            });

            let projectSynced = 0;
            const BATCH_SIZE = 50;

            for (let i = 0; i < issuesForProject.length; i += BATCH_SIZE) {
              const batch = issuesForProject.slice(i, i + BATCH_SIZE);

              for (const localIssue of batch) {
                try {
                  if (job) {
                    const progress = Math.round(
                      ((syncedCount + projectSynced + 1) /
                        (allProjectIssues.length || 1)) *
                        100
                    );
                    await job.updateProgress({
                      current: syncedCount + projectSynced + 1,
                      total: allProjectIssues.length,
                      percentage: Math.min(progress, 100),
                      message: `Syncing ${integrationProject.externalProjectKey}: issue ${projectSynced + 1}`,
                    });
                  }

                  const issueIdentifier =
                    localIssue.externalId ||
                    localIssue.externalKey ||
                    localIssue.name;

                  if (!issueIdentifier) {
                    errors.push(
                      `Issue ${localIssue.id} has no external identifier`
                    );
                    continue;
                  }

                  const issueData = await adapter.syncIssue(issueIdentifier);
                  await issueCache.set(integrationId, issueData.id, issueData);
                  await this.updateExistingIssue(
                    prisma,
                    integrationId,
                    issueData
                  );
                  projectSynced++;
                } catch (error: any) {
                  errors.push(
                    `Failed to sync issue ${localIssue.externalKey || localIssue.externalId || localIssue.id}: ${error.message}`
                  );
                }
              }

              // Allow GC between batches
              if (i + BATCH_SIZE < issuesForProject.length) {
                await new Promise((resolve) => setTimeout(resolve, 10));
              }
            }

            syncedCount += projectSynced;

            // Mark project as completed with timestamp (D-08), clear any previous error
            await prisma.integrationProject.update({
              where: { id: integrationProject.id },
              data: {
                syncStatus: "completed",
                lastSyncAt: new Date(),
                syncError: null,
              },
            });
          } catch (error: any) {
            // D-07: Error in one project must not block others — log, update status, continue
            errors.push(
              `Project ${integrationProject.externalProjectKey}: ${error.message}`
            );
            try {
              await prisma.integrationProject.update({
                where: { id: integrationProject.id },
                data: {
                  syncStatus: "error",
                  syncError: error.message,
                },
              });
            } catch {
              // If status update itself fails, just log and continue
              errors.push(
                `Failed to update error status for ${integrationProject.externalProjectKey}`
              );
            }
            // Continue to next project — D-07: no one project blocks the rest
          }
        }
      } else {
        // Legacy path: no IntegrationProject records — fall back to flat sync by integrationId
        // This handles integrations that predate the IntegrationProject model or have no projects configured.

        // Get total count of issues to sync
        const totalIssues = await prisma.issue.count({
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
          const localIssues = await prisma.issue.findMany({
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
                const progress = Math.round(
                  ((globalIndex + 1) / totalIssues) * 100
                );
                await job.updateProgress({
                  current: globalIndex + 1,
                  total: totalIssues,
                  percentage: progress,
                  message: `Syncing issue ${globalIndex + 1} of ${totalIssues}`,
                });
              }

              // Use externalId to fetch the latest data, fallback to externalKey or name
              const issueIdentifier =
                localIssue.externalId ||
                localIssue.externalKey ||
                localIssue.name;

              if (!issueIdentifier) {
                errors.push(
                  `Issue ${localIssue.id} has no external identifier`
                );
                continue;
              }

              // Fetch fresh issue data from external system
              const issueData = await adapter.syncIssue(issueIdentifier);

              // Update cache
              await issueCache.set(integrationId, issueData.id, issueData);

              // Update local database
              await this.updateExistingIssue(prisma, integrationId, issueData);
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
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
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
   * Refresh a single issue from the external system.
   *
   * Caller passes `minFreshnessSeconds` via `serviceOptions` to control
   * whether to actually hit the upstream API:
   *   • 0 / unset → always fetch (manual sync button)
   *   • 300       → skip if synced < 5 min ago (hover prefetch)
   *   • 15        → skip if synced < 15 s ago  (inbound webhook debounce)
   * A per-issue Valkey lock additionally serializes concurrent fetches —
   * the second caller resolves with `locked: true` without queueing.
   */
  async performIssueRefresh(
    userId: string,
    integrationId: number,
    externalIssueId: string,
    serviceOptions: SyncServiceOptions = {}
  ): Promise<IssueRefreshResult> {
    return this._withGateAndLock(
      integrationId,
      externalIssueId,
      serviceOptions,
      () =>
        this._performIssueRefreshInner(
          userId,
          integrationId,
          externalIssueId,
          serviceOptions
        )
    );
  }

  /**
   * System-context counterpart of `performIssueRefresh` — used by inbound
   * webhook handlers, schedulers, and any other server-triggered sync that
   * has no user session.
   *
   * Differences from the user-context path:
   *   • No `userId` / no user lookup. Audit attribution is the integration
   *     itself; downstream `WebhookDelivery` rows already record the source.
   *   • OAUTH2 integrations are rejected (their credentials are user-tied
   *     and require token refresh logic that doesn't exist server-side).
   *   • Auth check is purely "Integration.credentials present?".
   *
   * Same freshness gate + per-issue lock as the user path. Same
   * `IssueRefreshResult` shape so callers can branch on `cached`/`locked`.
   */
  async performIssueRefreshSystem(
    integrationId: number,
    externalIssueId: string,
    serviceOptions: SyncServiceOptions = {}
  ): Promise<IssueRefreshResult> {
    return this._withGateAndLock(
      integrationId,
      externalIssueId,
      serviceOptions,
      () =>
        this._performIssueRefreshInnerSystem(
          integrationId,
          externalIssueId,
          serviceOptions
        )
    );
  }

  /**
   * Shared gate + lock around any inner sync. Splits the freshness check
   * (cheap DB read) and lock acquisition from the actual sync work, and
   * makes both `performIssueRefresh` and `performIssueRefreshSystem`
   * thin wrappers.
   */
  private async _withGateAndLock(
    integrationId: number,
    externalIssueId: string,
    serviceOptions: SyncServiceOptions,
    inner: () => Promise<{ success: boolean; error?: string }>
  ): Promise<IssueRefreshResult> {
    const prisma = serviceOptions.prismaClient || defaultPrisma;
    const minFreshnessSeconds = serviceOptions.minFreshnessSeconds ?? 0;
    try {
      // Freshness gate — read the local `Issue.lastSyncedAt`; if it's
      // within the caller's tolerance, skip the upstream fetch.
      if (minFreshnessSeconds > 0) {
        const stored = await prisma.issue.findFirst({
          where: {
            integrationId,
            OR: [
              { externalId: externalIssueId },
              { externalKey: externalIssueId },
            ],
          },
          select: { lastSyncedAt: true },
        });
        if (stored?.lastSyncedAt) {
          const ageMs = Date.now() - stored.lastSyncedAt.getTime();
          if (ageMs < minFreshnessSeconds * 1000) {
            return { success: true, cached: true };
          }
        }
      }

      // Per-issue lock — prevents two concurrent syncs against the same
      // issue from both pulling the API. Skipping (not waiting) is the
      // right call: the in-flight sync will write the latest state to the
      // DB anyway.
      const acquired = await acquireIssueSyncLock(
        integrationId,
        externalIssueId
      );
      if (!acquired) {
        return { success: true, locked: true };
      }

      try {
        return await inner();
      } finally {
        await releaseIssueSyncLock(integrationId, externalIssueId);
      }
    } catch (error: any) {
      console.error(`Failed to refresh issue ${externalIssueId}:`, error);
      return { success: false, error: error.message };
    }
  }

  private async _performIssueRefreshInner(
    userId: string,
    integrationId: number,
    externalIssueId: string,
    serviceOptions: SyncServiceOptions = {}
  ): Promise<{ success: boolean; error?: string }> {
    const prisma = serviceOptions.prismaClient || defaultPrisma;
    try {
      // Get user for auth validation
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

      // Use raw Prisma client (no ZenStack enhance) — workers don't need access control
      // and enhance() causes ~3GB memory overhead

      // Get the integration
      const integration = await prisma.integration.findUnique({
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

      return await this._executeSyncWithAdapter(
        prisma,
        integration,
        externalIssueId
      );
    } catch (error: any) {
      console.error(`Failed to refresh issue ${externalIssueId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * System-context inner — used by `performIssueRefreshSystem`. Reuses
   * `Integration.credentials` directly without any user lookup. OAUTH2
   * integrations are rejected because their tokens require user-bound
   * refresh logic that doesn't apply to a webhook-driven sync.
   */
  private async _performIssueRefreshInnerSystem(
    integrationId: number,
    externalIssueId: string,
    serviceOptions: SyncServiceOptions = {}
  ): Promise<{ success: boolean; error?: string }> {
    const prisma = serviceOptions.prismaClient || defaultPrisma;
    try {
      const integration = await prisma.integration.findUnique({
        where: { id: integrationId },
      });

      if (!integration) {
        throw new Error("Integration not found");
      }

      if (integration.authType === "OAUTH2") {
        throw new Error(
          "System-context sync is not supported for OAUTH2 integrations — tokens are user-bound"
        );
      }

      // For every other auth type, the integration-level `credentials`
      // field is the credential surface. NONE skips this check.
      if (integration.authType !== "NONE" && !integration.credentials) {
        throw new Error("Integration is missing credentials");
      }

      return await this._executeSyncWithAdapter(
        prisma,
        integration,
        externalIssueId,
        serviceOptions.createIfMissing
      );
    } catch (error: any) {
      console.error(
        `Failed to refresh issue (system) ${externalIssueId}:`,
        error
      );
      return { success: false, error: error.message };
    }
  }

  /**
   * Post-auth tail of `_performIssueRefreshInner` — assumes the integration
   * is loaded and authentication has already been validated. Resolves the
   * adapter, normalizes the GitHub repo context, calls `adapter.syncIssue`,
   * updates the Redis cache, and writes the local Issue row.
   */
  private async _executeSyncWithAdapter(
    prisma: PrismaClient,
    integration: { id: number; provider: string },
    externalIssueId: string,
    createIfMissing?: { projectId: number }
  ): Promise<{ success: boolean; error?: string }> {
    const integrationId = integration.id;

    const adapter = await integrationManager.getAdapter(
      String(integrationId),
      prisma
    );

    if (!adapter) {
      throw new Error("Invalid adapter for issue synchronization");
    }

    const capabilities = adapter.getCapabilities();
    if (!capabilities.syncIssue) {
      throw new Error(
        "This integration does not support syncing individual issues"
      );
    }

    // GitHub issues need the owner/repo context resolved into a compound
    // `owner/repo#N` for `adapter.syncIssue`. If the caller already provides
    // the compound form (webhook adapters do — `extractLinkedIssueRef`
    // returns `${repo}#${number}`), use it as-is. Otherwise fall back to
    // looking up the stored Issue and extracting owner/repo from its
    // externalData / externalUrl.
    let issueIdForSync = externalIssueId;
    if (integration.provider === "GITHUB") {
      issueIdForSync = await this._resolveGitHubIssueIdForSync(
        prisma,
        integrationId,
        externalIssueId
      );
    }

    const issueData = await adapter.syncIssue(issueIdForSync);
    await issueCache.set(integrationId, issueData.id, issueData);

    // Find existing local issue. The lookup OR-set covers historical
    // mismatches between externalId / externalKey storage conventions —
    // matches `updateExistingIssue`'s behaviour exactly.
    const existingIssue = await prisma.issue.findFirst({
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

    if (existingIssue) {
      await this.updateExistingIssue(prisma, integrationId, issueData);
      return { success: true };
    }

    // No local issue — caller must have opted into create-if-missing
    // (inbound webhook handler does, manual sync button does not).
    if (createIfMissing) {
      await this._createIssueFromExternal(
        prisma,
        integrationId,
        createIfMissing.projectId,
        issueData
      );
      return { success: true };
    }

    throw new Error(
      `Issue ${issueData.key || issueData.id} not found in local database. Issues must be created through the UI before they can be synced.`
    );
  }

  /**
   * Compose the compound `owner/repo#N` form GitHub adapters expect.
   * Short-circuits when externalIssueId is already in that form (webhook
   * receivers always pass it that way via `extractLinkedIssueRef`).
   */
  private async _resolveGitHubIssueIdForSync(
    prisma: PrismaClient,
    integrationId: number,
    externalIssueId: string
  ): Promise<string> {
    // Already compound? Use as-is. Pattern: owner/repo#N where owner and
    // repo are GitHub-name-charset and N is digits.
    if (/^[\w.-]+\/[\w.-]+#\d+$/.test(externalIssueId)) {
      return externalIssueId;
    }

    // Fall back to the legacy lookup path: find a stored Issue and harvest
    // owner/repo from its externalData or externalUrl. Used by manual sync
    // when the caller has only the bare issue number/key.
    const storedIssue = await prisma.issue.findFirst({
      where: {
        integrationId,
        OR: [{ externalId: externalIssueId }, { externalKey: externalIssueId }],
      },
    });

    let owner: string | undefined;
    let repo: string | undefined;

    if (storedIssue?.externalData) {
      const externalData = storedIssue.externalData as Record<string, any>;
      if (externalData._github_owner && externalData._github_repo) {
        owner = externalData._github_owner;
        repo = externalData._github_repo;
      }
    }

    if ((!owner || !repo) && storedIssue?.externalUrl) {
      const urlMatch = storedIssue.externalUrl.match(
        /github\.com\/([^/]+)\/([^/]+)\/issues/
      );
      if (urlMatch) {
        owner = urlMatch[1];
        repo = urlMatch[2];
      }
    }

    if (!owner || !repo) {
      throw new Error(
        `Cannot determine GitHub repository for issue ${externalIssueId}. ` +
          `Issue data is missing repository context.`
      );
    }

    const issueNumber = externalIssueId.replace(/^#/, "");
    return `${owner}/${repo}#${issueNumber}`;
  }

  /**
   * Insert a fresh Issue row from upstream data — used by inbound webhook
   * handlers that opt into auto-create when the linked issue doesn't yet
   * exist locally. Mirrors `updateExistingIssue`'s field mapping so a
   * subsequent update sync produces the identical row state.
   *
   * Project membership is REQUIRED (the Issue model joins to Projects via
   * `projectId`); the webhook handler resolves the project from the
   * WebhookConfig and passes it through.
   *
   * `Issue.createdById` is REQUIRED by the schema. Webhooks have no user
   * session, so we attribute the row to the **project's creator** — a
   * stable, always-present user with implicit authority over the project
   * (the same user who could have manually imported this issue). This
   * matches the audit attribution model: WEBHOOK_RECEIVED audit rows
   * already use `__system__` for `userId`; here `createdById` needs to
   * point at a real User row, so the project creator is the right surrogate.
   */
  private async _createIssueFromExternal(
    db: any,
    integrationId: number,
    projectId: number,
    issueData: IssueData
  ): Promise<void> {
    // `Projects.createdBy` is the User.id string; the `creator` relation
    // joins to the User row. We just need the FK value here.
    const project = await db.projects.findUnique({
      where: { id: projectId },
      select: { createdBy: true },
    });
    if (!project?.createdBy) {
      throw new Error(
        `Cannot auto-create issue ${issueData.key || issueData.id}: project ${projectId} has no creator on record (required for Issue.createdById)`
      );
    }

    const created = await db.issue.create({
      data: {
        name: issueData.key || issueData.id,
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
        integrationId,
        projectId,
        createdById: project.createdBy,
      },
    });

    // Index newly-created issues just like manual import does. Best-effort
    // — search index drift is recoverable, the row commit isn't.
    await syncIssueToElasticsearch(created.id).catch((error: any) => {
      console.error(
        `Failed to sync newly created issue ${created.id} to Elasticsearch:`,
        error
      );
    });
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
      const _anyIssueWithKey = await db.issue.findFirst({
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

    // Manually emit issue.updated for the same reason — the enhanced
    // Prisma client bypasses the $extends middleware where the
    // emitIssueUpdated hook normally fires. Refetch via the un-enhanced
    // client to get the full post-update row, then emit through the
    // extended client's $transaction (so we have a Prisma.TransactionClient
    // for webhookEvents.emit). Best-effort: a failure here must not roll
    // back the sync — wrap in try/catch.
    try {
      const updatedIssue = await defaultPrisma.issue.findUnique({
        where: { id: existingIssue.id },
      });
      if (updatedIssue && updatedIssue.projectId != null) {
        const { prisma: extendedPrisma } = await import("@/lib/prisma");
        const { emitIssueUpdated } =
          await import("~/lib/webhooks/event-emitters/issueEvents");
        await extendedPrisma.$transaction(async (tx) => {
          await emitIssueUpdated(existingIssue as any, updatedIssue as any, tx);
        });
      }
    } catch (error) {
      console.error(
        `Failed to emit issue.updated webhook for issue ${existingIssue.id}:`,
        error
      );
    }
  }
}

export const syncService = new SyncService();
