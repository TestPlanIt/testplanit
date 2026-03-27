import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantPrisma";
import { prisma } from "@/lib/prisma";
import { getAllQueues } from "@/lib/queues";
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { getServerAuthSession } from "~/server/auth";

// GET: Get all queues with their stats
export async function GET(request: NextRequest) {
  try {
    // Check authentication - try session first, then API token
    const session = await getServerAuthSession();
    let userId = session?.user?.id;
    let userAccess: string | undefined;

    if (!userId) {
      const apiAuth = await authenticateApiToken(request);
      if (!apiAuth.authenticated) {
        return NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status: 401 }
        );
      }
      userId = apiAuth.userId;
      userAccess = apiAuth.access;
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user access level if not already known from API token
    if (!userAccess) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { access: true }
      });
      userAccess = user?.access;
    }

    if (userAccess !== 'ADMIN') {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Get stats for all queues
    // Default concurrency values from worker configuration
    const defaultConcurrency: Record<string, number> = {
      'forecast-updates': 5,
      'notifications': 5,
      'emails': 3,
      'issue-sync': 2,
      'testmo-imports': 1,
      'elasticsearch-reindex': 2,
      'audit-logs': 5,
      'budget-alerts': 3,
      'auto-tag': 1,
      'repo-cache': 2,
      'copy-move': 1,
      'duplicate-scan': 1,
      'magic-select': 1,
      'step-scan': 1
    };

    // Get configured concurrency from environment (or use defaults)
    const configuredConcurrency: Record<string, number> = {
      'forecast-updates': parseInt(process.env.FORECAST_CONCURRENCY || String(defaultConcurrency['forecast-updates']), 10),
      'notifications': parseInt(process.env.NOTIFICATION_CONCURRENCY || String(defaultConcurrency['notifications']), 10),
      'emails': parseInt(process.env.EMAIL_CONCURRENCY || String(defaultConcurrency['emails']), 10),
      'issue-sync': parseInt(process.env.SYNC_CONCURRENCY || String(defaultConcurrency['issue-sync']), 10),
      'testmo-imports': parseInt(process.env.TESTMO_IMPORT_CONCURRENCY || String(defaultConcurrency['testmo-imports']), 10),
      'elasticsearch-reindex': parseInt(process.env.ELASTICSEARCH_REINDEX_CONCURRENCY || String(defaultConcurrency['elasticsearch-reindex']), 10),
      'audit-logs': parseInt(process.env.AUDIT_LOG_CONCURRENCY || String(defaultConcurrency['audit-logs']), 10),
      'budget-alerts': parseInt(process.env.BUDGET_ALERT_CONCURRENCY || String(defaultConcurrency['budget-alerts']), 10),
      'auto-tag': parseInt(process.env.AUTO_TAG_CONCURRENCY || String(defaultConcurrency['auto-tag']), 10),
      'repo-cache': parseInt(process.env.REPO_CACHE_CONCURRENCY || String(defaultConcurrency['repo-cache']), 10),
      'copy-move': parseInt(process.env.COPY_MOVE_CONCURRENCY || String(defaultConcurrency['copy-move']), 10),
      'duplicate-scan': parseInt(process.env.DUPLICATE_SCAN_CONCURRENCY || String(defaultConcurrency['duplicate-scan']), 10),
      'magic-select': parseInt(process.env.MAGIC_SELECT_CONCURRENCY || String(defaultConcurrency['magic-select']), 10),
      'step-scan': parseInt(process.env.STEP_SCAN_CONCURRENCY || String(defaultConcurrency['step-scan']), 10)
    };

    const allQueues = getAllQueues();
    const queues = [
      { name: 'forecast-updates', queue: allQueues.forecastQueue },
      { name: 'notifications', queue: allQueues.notificationQueue },
      { name: 'emails', queue: allQueues.emailQueue },
      { name: 'issue-sync', queue: allQueues.syncQueue },
      { name: 'testmo-imports', queue: allQueues.testmoImportQueue },
      { name: 'elasticsearch-reindex', queue: allQueues.elasticsearchReindexQueue },
      { name: 'audit-logs', queue: allQueues.auditLogQueue },
      { name: 'budget-alerts', queue: allQueues.budgetAlertQueue },
      { name: 'auto-tag', queue: allQueues.autoTagQueue },
      { name: 'repo-cache', queue: allQueues.repoCacheQueue },
      { name: 'copy-move', queue: allQueues.copyMoveQueue },
      { name: 'duplicate-scan', queue: allQueues.duplicateScanQueue },
      { name: 'magic-select', queue: allQueues["magic-select"] },
      { name: 'step-scan', queue: allQueues.stepScanQueue }
    ];

    // Get current tenant ID for filtering in multi-tenant mode
    const currentTenantId = getCurrentTenantId();
    const multiTenant = isMultiTenantMode();

    // Validate multi-tenant configuration
    if (multiTenant && !currentTenantId) {
      return NextResponse.json(
        { error: "Multi-tenant mode is enabled but INSTANCE_TENANT_ID is not configured" },
        { status: 500 }
      );
    }

    const queueStats = await Promise.all(
      queues.map(async ({ name, queue }) => {
        if (!queue) {
          return {
            name,
            error: 'Queue not initialized',
            counts: null,
            isPaused: false,
            concurrency: configuredConcurrency[name] || 1
          };
        }

        try {
          const isPaused = await queue.isPaused();

          // In multi-tenant mode, we need to count jobs filtered by tenantId
          // In single-tenant mode, use the standard counts
          let counts;
          if (multiTenant) {
            // Get all jobs and filter by tenantId
            const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
              queue.getJobs(['waiting'], 0, 1000),
              queue.getJobs(['active'], 0, 1000),
              queue.getJobs(['completed'], 0, 1000),
              queue.getJobs(['failed'], 0, 1000),
              queue.getJobs(['delayed'], 0, 1000),
              queue.getJobs(['paused'], 0, 1000)
            ]);

            // Filter jobs by tenantId (strip null entries from getJobs)
            const filterByTenant = (jobs: any[]) =>
              jobs.filter(job => job != null && job.data?.tenantId === currentTenantId).length;

            counts = {
              waiting: filterByTenant(waiting),
              active: filterByTenant(active),
              completed: filterByTenant(completed),
              failed: filterByTenant(failed),
              delayed: filterByTenant(delayed),
              paused: filterByTenant(paused)
            };
          } else {
            // Single-tenant mode: use standard counts
            counts = await queue.getJobCounts();
          }

          return {
            name,
            counts,
            isPaused,
            error: null,
            concurrency: configuredConcurrency[name] || 1
          };
        } catch (error: any) {
          return {
            name,
            error: error.message,
            counts: null,
            isPaused: false,
            concurrency: configuredConcurrency[name] || 1
          };
        }
      })
    );

    return NextResponse.json({ queues: queueStats });
  } catch (error: any) {
    console.error("Error fetching queue stats:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
