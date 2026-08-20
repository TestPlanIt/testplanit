import { Job, Worker } from "bullmq";
import { getElasticsearchClient } from "~/services/elasticsearchService";
import { syncProjectIssuesToElasticsearch } from "~/services/issueSearch";
import { syncProjectMilestonesToElasticsearch } from "~/services/milestoneSearch";
import { syncAllProjectsToElasticsearch } from "~/services/projectSearch";
import { syncProjectCasesToElasticsearch } from "~/services/repositoryCaseSync";
import { syncProjectSessionsToElasticsearch } from "~/services/sessionSearch";
import { syncProjectSharedStepsToElasticsearch } from "~/services/sharedStepSearch";
import { syncProjectTestRunsToElasticsearch } from "~/services/testRunSearch";
import {
  createAllEntityIndices,
  getEntityIndexName,
} from "~/services/unifiedElasticsearchService";
import { SearchableEntityType } from "~/types/search";
import {
  disconnectAllTenantClients,
  getDbClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import { ELASTICSEARCH_REINDEX_QUEUE_NAME } from "../lib/queueNames";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";

export interface ReindexJobData extends MultiTenantJobData {
  entityType:
    | "all"
    | "repositoryCases"
    | "testRuns"
    | "sessions"
    | "sharedSteps"
    | "issues"
    | "milestones"
    | "projects";
  projectId?: number;
  userId: string; // User who initiated the reindex
}

/**
 * Count non-deleted issues linked to a test run in the project.
 *
 * Semantically the same as an ORM count on the Issue model, filtered to
 * non-deleted rows with a relation `some` filter across the project's test
 * runs — but ZenStack v3 compiles that `some` filter inside a count into a
 * correlated nested-loop semi-join that materializes every project run
 * against every issue (~413M-row cost, ~60s per call on production data —
 * it stalled the whole reindex). Counting through the join table is a hash
 * join (~25ms). See lib/projectIssueIds.ts for the same pattern.
 */
async function countProjectIssuesLinkedToRuns(
  db: any,
  projectId: number
): Promise<number> {
  const rows = (await db.$queryRaw`
    SELECT count(DISTINCT i."id")::int AS count
    FROM "Issue" i
    JOIN "_IssueToTestRuns" it ON it."A" = i."id"
    JOIN "TestRuns" tr ON tr."id" = it."B"
    WHERE i."isDeleted" = false AND tr."projectId" = ${projectId}
  `) as Array<{ count: number }>;
  return Number(rows[0]?.count ?? 0);
}

const processor = async (job: Job<ReindexJobData>) => {
  console.log(
    `Processing Elasticsearch reindex job ${job.id}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`
  );

  // Validate multi-tenant job data if in multi-tenant mode
  validateMultiTenantJobData(job.data);

  // Get the appropriate Prisma client (tenant-specific or default)
  const db = getDbClientForJob(job.data);

  const { entityType, projectId, tenantId } = job.data;

  try {
    // Check Elasticsearch connection
    const esClient = getElasticsearchClient();
    if (!esClient) {
      throw new Error("Elasticsearch is not configured or unavailable");
    }

    await job.updateProgress(0);
    await job.log("Starting reindex operation...");

    // Delete and recreate indices to ensure mappings are up to date
    const entityTypesToReindex =
      entityType === "all"
        ? Object.values(SearchableEntityType)
        : [
            entityType === "repositoryCases"
              ? SearchableEntityType.REPOSITORY_CASE
              : entityType === "sharedSteps"
                ? SearchableEntityType.SHARED_STEP
                : entityType === "testRuns"
                  ? SearchableEntityType.TEST_RUN
                  : entityType === "sessions"
                    ? SearchableEntityType.SESSION
                    : entityType === "issues"
                      ? SearchableEntityType.ISSUE
                      : entityType === "milestones"
                        ? SearchableEntityType.MILESTONE
                        : SearchableEntityType.PROJECT,
          ];

    await job.updateProgress(2);
    await job.log("Deleting old indices to apply latest mappings...");
    for (const et of entityTypesToReindex) {
      const indexName = getEntityIndexName(et, tenantId);
      try {
        const exists = await esClient.indices.exists({ index: indexName });
        if (exists) {
          await esClient.indices.delete({ index: indexName });
          await job.log(`Deleted index: ${indexName}`);
        }
      } catch (err: any) {
        await job.log(
          `Warning: failed to delete index ${indexName}: ${err.message}`
        );
      }
    }

    await job.updateProgress(5);
    await job.log("Creating indices with current mappings...");
    await createAllEntityIndices(db, tenantId);

    const projects = projectId
      ? await db.projects.findMany({
          where: { id: projectId, isDeleted: false },
        })
      : await db.projects.findMany({
          where: { isDeleted: false },
        });

    await job.updateProgress(10);
    await job.log(`Found ${projects.length} projects to process`);

    const results = {
      projects: 0,
      repositoryCases: 0,
      sharedSteps: 0,
      testRuns: 0,
      sessions: 0,
      issues: 0,
      milestones: 0,
    };

    // Count total documents for accurate progress tracking
    const totalCounts: Record<string, number> = {};
    for (const project of projects) {
      if (entityType === "all" || entityType === "repositoryCases") {
        totalCounts.repositoryCases =
          (totalCounts.repositoryCases || 0) +
          (await db.repositoryCases.count({
            where: {
              projectId: project.id,
              isDeleted: false,
              isArchived: false,
            },
          }));
      }
      if (entityType === "all" || entityType === "sharedSteps") {
        totalCounts.sharedSteps =
          (totalCounts.sharedSteps || 0) +
          (await db.sharedStepGroup.count({
            where: { projectId: project.id, isDeleted: false },
          }));
      }
      if (entityType === "all" || entityType === "testRuns") {
        totalCounts.testRuns =
          (totalCounts.testRuns || 0) +
          (await db.testRuns.count({
            where: { projectId: project.id, isDeleted: false },
          }));
      }
      if (entityType === "all" || entityType === "sessions") {
        totalCounts.sessions =
          (totalCounts.sessions || 0) +
          (await db.sessions.count({
            where: { projectId: project.id, isDeleted: false },
          }));
      }
      if (entityType === "all" || entityType === "issues") {
        totalCounts.issues =
          (totalCounts.issues || 0) +
          (await countProjectIssuesLinkedToRuns(db, project.id));
      }
      if (entityType === "all" || entityType === "milestones") {
        totalCounts.milestones =
          (totalCounts.milestones || 0) +
          (await db.milestones.count({
            where: { projectId: project.id, isDeleted: false },
          }));
      }
    }

    const totalDocuments = Object.values(totalCounts).reduce(
      (a, b) => a + b,
      0
    );
    let processedDocuments = 0;

    let currentProgress = 10;
    const progressPerProject = 80 / projects.length;

    // Reindex based on entity type
    if (entityType === "all" || entityType === "projects") {
      await job.updateProgress(currentProgress);
      await job.log("Indexing projects...");
      await syncAllProjectsToElasticsearch(db, tenantId);
      results.projects = await db.projects.count({
        where: { isDeleted: false },
      });
    }

    for (const project of projects) {
      const projectStart = currentProgress;

      await job.updateProgress(currentProgress);
      await job.log(`Processing project: ${project.name}`);

      if (entityType === "all" || entityType === "repositoryCases") {
        const count = await db.repositoryCases.count({
          where: {
            projectId: project.id,
            isDeleted: false,
            isArchived: false,
          },
        });
        if (count > 0) {
          await job.log(
            `Syncing ${count} repository cases for project ${project.name}`
          );

          // Create progress callback that updates job progress
          const progressCallback = async (
            processed: number,
            total: number,
            message: string
          ) => {
            processedDocuments = results.repositoryCases + processed;
            const overallProgress =
              10 + (processedDocuments / totalDocuments) * 80;
            await job.updateProgress(Math.min(overallProgress, 90));
            await job.log(message);
          };

          await syncProjectCasesToElasticsearch(
            project.id,
            100,
            progressCallback,
            db,
            tenantId
          );
          results.repositoryCases += count;
          processedDocuments = results.repositoryCases;
        }
      }

      if (entityType === "all" || entityType === "sharedSteps") {
        const count = await db.sharedStepGroup.count({
          where: {
            projectId: project.id,
            isDeleted: false,
          },
        });
        if (count > 0) {
          await job.log(
            `Syncing ${count} shared steps for project ${project.name}`
          );
          await syncProjectSharedStepsToElasticsearch(
            project.id,
            100,
            db,
            tenantId
          );
          results.sharedSteps += count;
        }
      }

      if (entityType === "all" || entityType === "testRuns") {
        const count = await db.testRuns.count({
          where: {
            projectId: project.id,
            isDeleted: false,
          },
        });
        if (count > 0) {
          await job.log(
            `Syncing ${count} test runs for project ${project.name}`
          );
          await syncProjectTestRunsToElasticsearch(project.id, db, tenantId);
          results.testRuns += count;
        }
      }

      if (entityType === "all" || entityType === "sessions") {
        const count = await db.sessions.count({
          where: {
            projectId: project.id,
            isDeleted: false,
          },
        });
        if (count > 0) {
          await job.log(
            `Syncing ${count} sessions for project ${project.name}`
          );
          await syncProjectSessionsToElasticsearch(project.id, db, tenantId);
          results.sessions += count;
        }
      }

      if (entityType === "all" || entityType === "issues") {
        const count = await countProjectIssuesLinkedToRuns(db, project.id);
        if (count > 0) {
          await job.log(`Syncing ${count} issues for project ${project.name}`);
          await syncProjectIssuesToElasticsearch(project.id, db, tenantId);
          results.issues += count;
        }
      }

      if (entityType === "all" || entityType === "milestones") {
        const count = await db.milestones.count({
          where: {
            projectId: project.id,
            isDeleted: false,
          },
        });
        if (count > 0) {
          await job.log(
            `Syncing ${count} milestones for project ${project.name}`
          );
          await syncProjectMilestonesToElasticsearch(project.id, db, tenantId);
          results.milestones += count;
        }
      }

      currentProgress = projectStart + progressPerProject;
      await job.updateProgress(Math.min(currentProgress, 90));
      await job.log(`Completed project: ${project.name}`);
    }

    // Final completion
    await job.updateProgress(100);
    await job.log("Reindex completed successfully!");

    const finalTotalDocuments = Object.values(results).reduce(
      (a, b) => a + b,
      0
    );
    console.log(
      `Reindex job ${job.id} completed. Indexed ${finalTotalDocuments} documents.`
    );

    return {
      success: true,
      results,
      totalDocuments: finalTotalDocuments,
    };
  } catch (error: any) {
    console.error(`Reindex job ${job.id} failed:`, error);
    await job.log(`Error: ${error.message}`);
    throw error;
  }
};

let worker: Worker | null = null;

// Function to start the worker
const startWorker = async () => {
  // Log multi-tenant mode status
  if (isMultiTenantMode()) {
    console.log("Elasticsearch reindex worker starting in MULTI-TENANT mode");
  } else {
    console.log("Elasticsearch reindex worker starting in SINGLE-TENANT mode");
  }

  if (valkeyConnection) {
    worker = new Worker(
      ELASTICSEARCH_REINDEX_QUEUE_NAME,
      withTenantContext(processor),
      {
        connection: valkeyConnection as any,
        prefix: BULLMQ_PREFIX,
        concurrency: parseInt(
          process.env.ELASTICSEARCH_REINDEX_CONCURRENCY || "2",
          10
        ),
        lockDuration: 3600000,
        maxStalledCount: 3,
        stalledInterval: 300000,
      }
    );

    worker.on("completed", (job) => {
      console.log(
        `Elasticsearch reindex job ${job.id} completed successfully.`
      );
    });

    worker.on("failed", (job, err) => {
      console.error(`Elasticsearch reindex job ${job?.id} failed:`, err);
    });

    worker.on("error", (err) => {
      console.error("Elasticsearch reindex worker error:", err);
    });

    console.log(
      `Elasticsearch reindex worker started for queue "${ELASTICSEARCH_REINDEX_QUEUE_NAME}".`
    );
  } else {
    console.warn(
      "Valkey connection not available. Elasticsearch reindex worker not started."
    );
  }

  // Allow graceful shutdown
  const shutdown = async () => {
    console.log("Shutting down Elasticsearch reindex worker...");
    if (worker) {
      await worker.close();
    }
    // Disconnect all tenant Prisma clients in multi-tenant mode
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

// Run the worker only when this file is executed directly (not on require)
if (require.main === module) {
  console.log("Elasticsearch reindex worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start Elasticsearch reindex worker:", err);
    process.exit(1);
  });
}

export default worker;
