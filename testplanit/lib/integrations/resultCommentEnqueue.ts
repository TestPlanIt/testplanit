/**
 * Enqueue side of result comments.
 *
 * The side-effect plugin calls these from inside the transaction that
 * completes a run, so they never throw into the caller: a failed lookup or
 * a Valkey hiccup is logged, and the run completes all the same. The
 * comments themselves are written by the sync worker.
 */

import { getAuditContext, SYSTEM_ACTOR_ID } from "~/lib/auditContext";
import { enqueueWithAuditContext } from "~/lib/auditContextEnqueue";
import { JOB_POST_RESULT_COMMENTS } from "~/lib/queueNames";
import { getSyncQueue } from "~/lib/queues";
import {
  readResultCommentsConfig,
  supportsResultComments,
} from "./resultCommentsConfig";

/**
 * The worker reads committed state, and the hook that enqueues runs inside
 * the writer's transaction, so the job waits this long.
 */
export const RESULT_COMMENT_DELAY_MS = 5000;

export interface ResultCommentJobData {
  userId: string;
  integrationId: number;
  projectId: string;
  action: "sync";
  data: { runId: number };
  tenantId?: string;
}

interface ProjectIntegrationClient {
  projectIntegration: {
    findFirst: (args: any) => Promise<any>;
  };
}

/**
 * The integration a project posts result comments through, or null when the
 * project has not switched them on or its connection cannot post them. One
 * indexed read per completed run.
 */
export async function resultCommentIntegrationId(
  db: ProjectIntegrationClient,
  projectId: number
): Promise<number | null> {
  try {
    const projectIntegration = await db.projectIntegration.findFirst({
      where: { projectId, isActive: true, integration: { isDeleted: false } },
      select: {
        config: true,
        integration: { select: { id: true, provider: true, authType: true } },
      },
    });
    const integration = projectIntegration?.integration;
    return integration &&
      supportsResultComments(integration) &&
      readResultCommentsConfig(projectIntegration.config).enabled
      ? integration.id
      : null;
  } catch (error) {
    console.error(
      `[resultComments] failed to read the integration of project ${projectId}:`,
      error
    );
    return null;
  }
}

export function resultCommentDedupId(
  runId: number,
  tenantId: string | undefined
): string {
  return `result-comments:${tenantId ?? "default"}:${runId}`;
}

/** Queues the comments of one completed run, once however often it is asked. */
export async function enqueueRunResultComments(data: {
  runId: number;
  projectId: number;
  integrationId: number;
  tenantId?: string;
}): Promise<void> {
  const queue = getSyncQueue();
  if (!queue) return;
  const jobData: ResultCommentJobData = {
    userId: getAuditContext()?.userId || SYSTEM_ACTOR_ID,
    integrationId: data.integrationId,
    projectId: String(data.projectId),
    action: "sync",
    data: { runId: data.runId },
    tenantId: data.tenantId,
  };
  try {
    await enqueueWithAuditContext(
      queue,
      JOB_POST_RESULT_COMMENTS,
      jobData,
      { systemReason: `result-comments:run-${data.runId}` },
      {
        deduplication: {
          id: resultCommentDedupId(data.runId, data.tenantId),
          ttl: RESULT_COMMENT_DELAY_MS,
        },
        delay: RESULT_COMMENT_DELAY_MS,
        removeOnComplete: true,
      }
    );
  } catch (error) {
    console.error(
      `[resultComments] failed to queue the comments of run ${data.runId}:`,
      error
    );
  }
}
