import { prisma as defaultPrisma } from "@/lib/prismaBase";
import type { PrismaClient } from "@prisma/client";
import { Job, JobsOptions } from "bullmq";
import { syncIssueToElasticsearch } from "~/services/issueSearch";
import { enqueueWithAuditContext } from "../../auditContextEnqueue";
import { getCurrentTenantId } from "../../multiTenantPrisma";
import { getSyncQueue } from "../../queues";
import valkeyConnection from "../../valkey";
import { projectIssueUpdateChannel } from "../../webhooks/issueUpdateChannels";
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
 * The shape Issue.data takes for synced rows. Distinct from externalData
 * (Jira customfield space) because labels/components are first-class
 * tracker concepts present across adapters, and downstream consumers
 * (auto-tag prompt extraction) need a stable key regardless of provider.
 *
 * Existing rows in the wild get this backfilled lazily on their next
 * sync — no migration needed because Issue.data has always been Json?.
 * Other writers of Issue.data (JiraLinkService manual-link path) layer
 * their own keys (jiraKey/jiraId/linkedAt) and don't collide.
 */
export interface SyncedIssueData {
  labels: string[];
  components: string[];
}

export function buildSyncedIssueData(issueData: IssueData): SyncedIssueData {
  return {
    labels: Array.isArray(issueData.labels) ? issueData.labels : [],
    components: Array.isArray(issueData.components) ? issueData.components : [],
  };
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

/**
 * Best-effort SSE wake-up for the project-scoped issue-update channel.
 *
 * Mirrors the notifications worker pattern (workers/notificationWorker.ts):
 * the payload is just a "something changed; refetch" signal — the consumer
 * is responsible for the authorized re-read. SSE pub/sub is untrusted
 * plumbing (Architectural Directive 2); access control fires at the
 * React Query / ZenStack hook layer when the client refetches.
 *
 * Failures are logged and swallowed — the DB row commit is the source of
 * truth, the SSE event is opportunistic. A missed event means at-most a
 * stale UI until the next manual refresh / next event.
 */
async function publishIssueUpdate(args: {
  projectId: number;
  issueId: number;
  event: "issue-updated" | "issue-created";
  tenantId: string;
}): Promise<void> {
  if (!valkeyConnection) return;
  try {
    const channel = projectIssueUpdateChannel(args.tenantId, args.projectId);
    const payload = JSON.stringify({
      event: args.event,
      issueId: args.issueId,
      projectId: args.projectId,
    });
    await valkeyConnection.publish(channel, payload);
  } catch (err) {
    console.warn(
      `[SyncService] SSE publish failed for issue ${args.issueId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

export interface SyncOptions {
  forceRefresh?: boolean;
  includeMetadata?: boolean;
  limit?: number;
}

/**
 * Bulk-import caps. The import pulls issues from a linked external project that
 * were updated within a recency window, up to a cap. IMPORT_MAX_CAP is the
 * absolute ceiling enforced server-side regardless of the requested cap, so a
 * filter mistake can't mirror an entire tracker.
 */
export const IMPORT_MAX_CAP = 1000;
export const IMPORT_DEFAULT_CAP = 200;
const IMPORT_PAGE_SIZE = 50;
/**
 * Upper bound on pages fetched for one import. Protects tracker rate limits on
 * the degraded path where a provider can't push the recency window into its
 * query and we filter returned pages client-side
 * (IMPORT_MAX_PAGES * IMPORT_PAGE_SIZE issues scanned at most).
 */
const IMPORT_MAX_PAGES = 40;

export interface ProjectImportOptions {
  updatedWithinDays?: number;
  cap?: number;
}

export interface ProjectImportResult {
  imported: number;
  matched: number;
  skipped: number;
  cappedAt: number;
  reachedCap: boolean;
  errors: string[];
}

/**
 * Which external-project identifier to hand `searchIssues`, by provider.
 * Mirrors how performSync reasons about these fields: Jira matches on the
 * project key (`project = KEY`), Azure DevOps WIQL compares
 * `[System.TeamProject]` by name, and the remaining providers key off
 * externalProjectId (GitHub `owner/repo`, Redmine/MantisBT numeric id).
 */
function resolveImportProjectRef(
  provider: string,
  mapping: {
    externalProjectId: string;
    externalProjectKey: string;
    externalProjectName: string;
  }
): string {
  switch (provider) {
    case "JIRA":
      return mapping.externalProjectKey || mapping.externalProjectId;
    case "AZURE_DEVOPS":
      return mapping.externalProjectName || mapping.externalProjectId;
    default:
      return mapping.externalProjectId || mapping.externalProjectKey;
  }
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
   * Queue a bulk import of issues from a single linked external project into
   * its TestPlanIt project, scoped by a recency window + cap. Rides the same
   * `issue-sync` queue as re-sync (distinct job name `import-project-issues`);
   * the worker calls `performProjectImport`.
   */
  async queueProjectImport(
    userId: string,
    integrationId: number,
    integrationProjectId: string,
    options: ProjectImportOptions = {}
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
      data: { integrationProjectId, ...options },
      tenantId: getCurrentTenantId(),
    };

    const job = await enqueueWithAuditContext(
      syncQueue,
      "import-project-issues",
      jobData,
      {
        // Imports create rows as they page through the tracker — a mid-run
        // auto-retry would re-scan from the top and re-hit rate limits, so
        // fail loud instead of retrying.
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      }
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
   * Approximate how many issues a bulk import would pull, before writing
   * anything. Asks the tracker for the recency-scoped result set (page of 1)
   * and returns its reported `total`. For providers that push the recency
   * window into their query (Jira/GitHub/Azure) this is the filtered count;
   * for providers that can't, it's the project total (an over-estimate that
   * the actual import then trims via the client-side cutoff) — surfaced as
   * "approximate" in the UI.
   */
  async previewProjectImport(
    integrationId: number,
    integrationProjectId: string,
    options: ProjectImportOptions = {},
    serviceOptions: SyncServiceOptions = {}
  ): Promise<{ matched: number; hasMore: boolean; cap: number }> {
    const db = serviceOptions.prismaClient || defaultPrisma;
    const cap = Math.min(options.cap ?? IMPORT_DEFAULT_CAP, IMPORT_MAX_CAP);

    const mapping = await db.integrationProject.findUnique({
      where: { id: integrationProjectId },
      include: {
        projectIntegration: { select: { integrationId: true } },
      },
    });
    if (!mapping?.projectIntegration) {
      throw new Error(
        `Integration project mapping ${integrationProjectId} not found`
      );
    }
    if (mapping.projectIntegration.integrationId !== integrationId) {
      throw new Error(
        `Mapping ${integrationProjectId} does not belong to integration ${integrationId}`
      );
    }

    const integration = await db.integration.findUnique({
      where: { id: integrationId },
      select: { provider: true },
    });
    if (!integration) {
      throw new Error("Integration not found");
    }

    const adapter = await integrationManager.getAdapter(
      String(integrationId),
      db
    );
    if (!adapter) {
      throw new Error("Invalid adapter for issue import");
    }

    const projectRef = resolveImportProjectRef(integration.provider, mapping);
    // Fetch a real page rather than trusting a reported `total`: Jira Cloud's
    // /search/jql endpoint no longer returns `total`, so `matched` falls back
    // to the count of issues actually returned (an honest "at least N"), and
    // `hasMore` is true when the tracker says so or the page came back full.
    // Sample a full page (not capped) so the count still reflects matches that
    // exceed a small cap — which is exactly when the over-cap notice matters.
    const sampleLimit = IMPORT_PAGE_SIZE;
    const { issues, total, hasMore } = await adapter.searchIssues({
      projectId: projectRef,
      updatedWithinDays: options.updatedWithinDays,
      fullSync: true,
      limit: sampleLimit,
      offset: 0,
    });

    const hasTotal = typeof total === "number" && Number.isFinite(total);
    const matched = hasTotal && total >= issues.length ? total : issues.length;
    const more =
      hasMore || (hasTotal && total > matched) || issues.length >= sampleLimit;

    return { matched, hasMore: more, cap };
  }

  /**
   * Bulk-import issues from a linked external project into its TestPlanIt
   * project. Pages `adapter.searchIssues` scoped to the recency window, upserts
   * each result via `_createIssueFromExternal` (dedup on
   * `(externalId, integrationId)`, resurrect-on-collision, ES index + SSE), and
   * stops at the requested cap / IMPORT_MAX_CAP / IMPORT_MAX_PAGES. Reuses the
   * per-project `syncStatus` badge (syncing → completed/error), so the settings
   * UI reflects progress with no new model. Imported rows are thereafter kept
   * fresh by the existing re-sync + inbound webhooks.
   */
  async performProjectImport(
    integrationId: number,
    integrationProjectId: string,
    options: ProjectImportOptions = {},
    job?: Job,
    serviceOptions: SyncServiceOptions = {}
  ): Promise<ProjectImportResult> {
    const db = serviceOptions.prismaClient || defaultPrisma;
    const errors: string[] = [];
    const cap = Math.min(options.cap ?? IMPORT_DEFAULT_CAP, IMPORT_MAX_CAP);
    const updatedWithinDays = options.updatedWithinDays;
    const cutoffMs =
      updatedWithinDays && updatedWithinDays > 0
        ? Date.now() - updatedWithinDays * 86_400_000
        : null;

    let imported = 0;
    let matched = 0;
    let skipped = 0;
    let reachedCap = false;

    // Resolve the mapping + owning project up front. A bad id is a caller
    // misconfiguration — throw before any status tracking so the worker fails
    // the job loudly (mirrors the sync path's posture).
    const mapping = await db.integrationProject.findUnique({
      where: { id: integrationProjectId },
      include: {
        projectIntegration: {
          select: { projectId: true, integrationId: true },
        },
      },
    });
    if (!mapping?.projectIntegration) {
      throw new Error(
        `Integration project mapping ${integrationProjectId} not found`
      );
    }
    if (mapping.projectIntegration.integrationId !== integrationId) {
      throw new Error(
        `Mapping ${integrationProjectId} does not belong to integration ${integrationId}`
      );
    }
    const projectId = mapping.projectIntegration.projectId;

    // Mark syncing — same per-project badge the admin re-sync uses.
    await db.integrationProject.update({
      where: { id: integrationProjectId },
      data: { syncStatus: "syncing", syncError: null },
    });

    try {
      const integration = await db.integration.findUnique({
        where: { id: integrationId },
        select: { provider: true },
      });
      if (!integration) {
        throw new Error("Integration not found");
      }

      const adapter = await integrationManager.getAdapter(
        String(integrationId),
        db
      );
      if (!adapter) {
        throw new Error("Invalid adapter for issue import");
      }

      const projectRef = resolveImportProjectRef(integration.provider, mapping);

      // Guard against providers that don't honor the pagination offset and
      // return overlapping pages — de-dup by external id within this run so the
      // cap/counters reflect distinct issues, not re-scans.
      const seen = new Set<string>();

      let offset = 0;
      let page = 0;
      let hasMore = true;
      // Cursor for token-paginated trackers (Jira Cloud). Offset-paginated
      // adapters leave this undefined and advance via `offset` instead; we pass
      // both so each adapter uses whichever it understands.
      let pageToken: string | undefined;

      while (imported < cap && page < IMPORT_MAX_PAGES && hasMore) {
        const result = await adapter.searchIssues({
          projectId: projectRef,
          updatedWithinDays,
          fullSync: true,
          limit: IMPORT_PAGE_SIZE,
          offset,
          pageToken,
        });
        hasMore = result.hasMore;
        offset += result.issues.length;
        pageToken = result.nextPageToken;
        page++;
        if (result.issues.length === 0) break;
        // Token-paginated trackers report hasMore but stop yielding a cursor on
        // the last page — guard against an infinite loop if hasMore stays true.
        if (hasMore && !pageToken && result.issues.length < IMPORT_PAGE_SIZE) {
          hasMore = false;
        }

        for (const issueData of result.issues) {
          if (seen.has(issueData.id)) continue;
          seen.add(issueData.id);

          // Client-side recency fallback for adapters that couldn't push the
          // window into their query. `updatedAt` is always present on IssueData.
          if (
            cutoffMs !== null &&
            issueData.updatedAt instanceof Date &&
            issueData.updatedAt.getTime() < cutoffMs
          ) {
            skipped++;
            continue;
          }
          if (imported >= cap) {
            reachedCap = true;
            break;
          }
          matched++;
          try {
            await this._createIssueFromExternal(
              db,
              integrationId,
              projectId,
              issueData
            );
            imported++;
            if (job) {
              await job.updateProgress({
                current: imported,
                total: cap,
                percentage: Math.min(Math.round((imported / cap) * 100), 100),
                message: `Importing ${mapping.externalProjectKey}: ${imported}/${cap}`,
              });
            }
          } catch (error: any) {
            errors.push(
              `Failed to import issue ${issueData.key || issueData.id}: ${error.message}`
            );
          }
        }

        if (imported >= cap) {
          reachedCap = true;
          break;
        }

        // GC breather between pages, mirroring performSync.
        if (hasMore) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      await db.integrationProject.update({
        where: { id: integrationProjectId },
        data: {
          syncStatus: "completed",
          lastSyncAt: new Date(),
          syncError: null,
        },
      });
    } catch (error: any) {
      await db.integrationProject
        .update({
          where: { id: integrationProjectId },
          data: { syncStatus: "error", syncError: error.message },
        })
        .catch(() => {});
      errors.push(`Import failed: ${error.message}`);
    }

    return { imported, matched, skipped, cappedAt: cap, reachedCap, errors };
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
   * System-context inner — used by `performIssueRefreshSystem`.
   *
   * Auth strategy depends on the Integration's `authType`:
   *   • API_KEY / PERSONAL_ACCESS_TOKEN → use `Integration.credentials`
   *     directly (e.g., GitHub PAT, Jira Cloud user-API-token, ADO PAT).
   *   • OAUTH2 → reuse the most-recently-active `UserIntegrationAuth`.
   *     Atlassian's preferred Jira integration path is OAuth 2.0 (3LO),
   *     which is per-user, but for system-triggered sync we treat the
   *     latest active OAuth as the integration's effective service
   *     account — same row `IntegrationManager.getAdapter` picks for the
   *     manual-sync path. If that user revokes access or their refresh
   *     token expires, sync fails loudly and an admin re-auths; same
   *     failure mode as today's manual-sync OAuth flow, just visible in
   *     the WebhookDelivery error column instead of an inline UI toast.
   *   • NONE → no auth, pass through.
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
        include: {
          userIntegrationAuths: {
            where: { isActive: true },
            orderBy: { updatedAt: "desc" },
            take: 1,
          },
        },
      });

      if (!integration) {
        throw new Error("Integration not found");
      }

      if (integration.authType === "OAUTH2") {
        // Need at least one active UserIntegrationAuth to act as the
        // service-account surrogate. Fail fast with a clear message so
        // the WebhookDelivery row's error column points at the fix
        // (an admin needs to re-auth in TestPlanIt's integration UI).
        const oauthAuth = integration.userIntegrationAuths[0];
        if (!oauthAuth) {
          throw new Error(
            "OAuth integration has no active user authentication; an admin must (re)authenticate in TestPlanIt's integration settings"
          );
        }
        if (
          oauthAuth.tokenExpiresAt &&
          oauthAuth.tokenExpiresAt < new Date() &&
          !oauthAuth.refreshToken
        ) {
          throw new Error(
            "OAuth access token has expired and no refresh token is on record; an admin must re-authenticate"
          );
        }
      } else if (integration.authType !== "NONE" && !integration.credentials) {
        // API_KEY / PERSONAL_ACCESS_TOKEN / other paired-credential types
        // need Integration.credentials populated.
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

    // Resurrect-on-collision: if a prior soft-deleted Issue exists for
    // this (externalId, integrationId), `create` would 23505. Upsert with
    // overwrite + isDeleted: false brings the row back with the freshest
    // tracker payload — what a re-sync of an externally-restored ticket
    // should produce.
    const issueFields = {
      name: issueData.key || issueData.id,
      title: issueData.title,
      description: issueData.description || "",
      status: issueData.status,
      priority: issueData.priority || "medium",
      externalKey: issueData.key,
      externalUrl: issueData.url,
      externalStatus: issueData.status,
      externalData: issueData.customFields || {},
      // Non-customfield tracker metadata that auto-tag's prompt extractor
      // reads to surface linked-issue context. Kept distinct from
      // externalData (which is custom-fields only) so the shape is stable
      // across providers regardless of their customfield space.
      data: buildSyncedIssueData(issueData),
      issueTypeId: issueData.issueType?.id,
      issueTypeName: issueData.issueType?.name,
      issueTypeIconUrl: issueData.issueType?.iconUrl,
      lastSyncedAt: new Date(),
      projectId,
    };
    const created = await db.issue.upsert({
      where: {
        externalId_integrationId: {
          externalId: issueData.id,
          integrationId,
        },
      },
      create: {
        ...issueFields,
        externalId: issueData.id,
        integrationId,
        createdById: project.createdBy,
      },
      update: {
        ...issueFields,
        isDeleted: false,
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

    // SSE wake-up for any subscriber currently watching this project's
    // issues view. Best-effort — same posture as the Elasticsearch index.
    await publishIssueUpdate({
      projectId,
      issueId: created.id,
      event: "issue-created",
      tenantId: getCurrentTenantId() ?? "default",
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

    // Merge so manual-link writers (jira-link-service writes jiraKey/jiraId/
    // linkedAt to Issue.data) survive a subsequent sync — wholesale replace
    // would drop their keys.
    const existingData =
      existingIssue.data && typeof existingIssue.data === "object"
        ? (existingIssue.data as Record<string, unknown>)
        : {};

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
      // See createNewIssue above — keep the non-customfield tracker metadata
      // (labels, components) fresh on every sync. Existing rows in the wild
      // get backfilled here lazily on their next sync.
      data: { ...existingData, ...buildSyncedIssueData(issueData) },
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

    // SSE wake-up for any subscriber watching this project's issues view.
    // Mirrors the create path — best-effort, swallowed errors. The
    // existingIssue row already carries projectId from the findFirst
    // above (no select projection); guard is for the rare schema-time
    // null-projectId case.
    if (existingIssue.projectId != null) {
      await publishIssueUpdate({
        projectId: existingIssue.projectId,
        issueId: existingIssue.id,
        event: "issue-updated",
        tenantId: getCurrentTenantId() ?? "default",
      });
    }
  }
}

export const syncService = new SyncService();
