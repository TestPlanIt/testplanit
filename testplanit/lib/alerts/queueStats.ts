import { isMultiTenantMode } from "~/lib/multiTenantDb";
import { getAllQueues } from "~/lib/queues";

/** What the queue alerts read: one row per BullMQ queue. */
export interface QueueStat {
  name: string;
  failed: number;
  waiting: number;
  /** Age in minutes of the oldest job still waiting, null when none waits. */
  oldestWaitingMinutes: number | null;
}

/**
 * Reads failed and waiting counts for every queue. In multi-tenant mode the
 * queues are shared, so only the tenant's own jobs count, the way the admin
 * Queues page counts them. Delayed jobs are not a backlog: they wait on
 * purpose.
 */
export async function readQueueStats(
  tenantId: string | undefined,
  now: Date = new Date()
): Promise<QueueStat[]> {
  const multiTenant = isMultiTenantMode();
  const stats: QueueStat[] = [];
  for (const queue of Object.values(getAllQueues())) {
    if (!queue) continue;
    try {
      const [failedJobs, waitingJobs] = await Promise.all([
        queue.getJobs(["failed"], 0, 1000),
        queue.getJobs(["waiting"], 0, 1000),
      ]);
      const mine = (jobs: any[]) =>
        jobs.filter(
          (job) =>
            job != null && (!multiTenant || job.data?.tenantId === tenantId)
        );
      const waiting = mine(waitingJobs);
      const oldest = waiting.reduce<number | null>((min, job) => {
        const ts = Number(job.timestamp);
        if (!Number.isFinite(ts)) return min;
        return min == null || ts < min ? ts : min;
      }, null);
      stats.push({
        name: queue.name,
        failed: mine(failedJobs).length,
        waiting: waiting.length,
        oldestWaitingMinutes:
          oldest == null ? null : (now.getTime() - oldest) / 60_000,
      });
    } catch (error) {
      console.error(`[alerts] could not read queue "${queue.name}":`, error);
    }
  }
  return stats;
}
