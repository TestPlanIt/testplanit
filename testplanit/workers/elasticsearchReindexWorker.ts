import { Worker, Job } from "bullmq";
import valkeyConnection from "../lib/valkey";
import { ELASTICSEARCH_REINDEX_QUEUE_NAME } from "../lib/queueNames";
import {
  syncProjectCasesToElasticsearch,
  initializeElasticsearchIndexes,
} from "~/services/repositoryCaseSync";
import { syncProjectSharedStepsToElasticsearch } from "~/services/sharedStepSearch";
import { syncProjectTestRunsToElasticsearch } from "~/services/testRunSearch";
import { syncProjectSessionsToElasticsearch } from "~/services/sessionSearch";
import { syncProjectIssuesToElasticsearch } from "~/services/issueSearch";
import { syncProjectMilestonesToElasticsearch } from "~/services/milestoneSearch";
import { syncAllProjectsToElasticsearch } from "~/services/projectSearch";
import { getElasticsearchClient } from "~/services/elasticsearchService";
import { pathToFileURL } from "node:url";
import {
  getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  disconnectAllTenantClients,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";

export interface ReindexJobData extends MultiTenantJobData {
  entityType: "all" | "repositoryCases" | "testRuns" | "sessions" | "sharedSteps" | "issues" | "milestones" | "projects";
  projectId?: number;
  userId: string; // User who initiated the reindex
}

const processor = async (job: Job<ReindexJobData>) => {
  console.log(`Processing Elasticsearch reindex job ${job.id}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`);

  // Validate multi-tenant job data if in multi-tenant mode
  validateMultiTenantJobData(job.data);

  // Get the appropriate Prisma client (tenant-specific or default)
  const prisma = getPrismaClientForJob(job.data);

  const { entityType, projectId } = job.data;

  try {
    // Check Elasticsearch connection
    const esClient = getElasticsearchClient();
    if (!esClient) {
      throw new Error("Elasticsearch is not configured or unavailable");
    }

    await job.updateProgress(0);
    await job.log("Starting reindex operation...");

    // Initialize indexes if needed
    if (entityType === "all" || entityType === "repositoryCases") {
      await job.updateProgress(5);
      await job.log("Initializing Elasticsearch indexes...");
      await initializeElasticsearchIndexes();
    }

    const projects = projectId
      ? await prisma.projects.findMany({
          where: { id: projectId, isDeleted: false }
        })
      : await prisma.projects.findMany({
          where: { isDeleted: false }
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
        totalCounts.repositoryCases = (totalCounts.repositoryCases || 0) + await prisma.repositoryCases.count({
          where: { projectId: project.id, isDeleted: false, isArchived: false }
        });
      }
      if (entityType === "all" || entityType === "sharedSteps") {
        totalCounts.sharedSteps = (totalCounts.sharedSteps || 0) + await prisma.sharedStepGroup.count({
          where: { projectId: project.id, isDeleted: false }
        });
      }
      if (entityType === "all" || entityType === "testRuns") {
        totalCounts.testRuns = (totalCounts.testRuns || 0) + await prisma.testRuns.count({
          where: { projectId: project.id, isDeleted: false }
        });
      }
      if (entityType === "all" || entityType === "sessions") {
        totalCounts.sessions = (totalCounts.sessions || 0) + await prisma.sessions.count({
          where: { projectId: project.id, isDeleted: false }
        });
      }
      if (entityType === "all" || entityType === "issues") {
        totalCounts.issues = (totalCounts.issues || 0) + await prisma.issue.count({
          where: { isDeleted: false, testRuns: { some: { projectId: project.id } } }
        });
      }
      if (entityType === "all" || entityType === "milestones") {
        totalCounts.milestones = (totalCounts.milestones || 0) + await prisma.milestones.count({
          where: { projectId: project.id, isDeleted: false }
        });
      }
    }

    const totalDocuments = Object.values(totalCounts).reduce((a, b) => a + b, 0);
    let processedDocuments = 0;

    let currentProgress = 10;
    const progressPerProject = 80 / projects.length;

    // Reindex based on entity type
    if (entityType === "all" || entityType === "projects") {
      await job.updateProgress(currentProgress);
      await job.log("Indexing projects...");
      await syncAllProjectsToElasticsearch();
      results.projects = await prisma.projects.count({
        where: { isDeleted: false }
      });
    }

    for (const project of projects) {
      const projectStart = currentProgress;

      await job.updateProgress(currentProgress);
      await job.log(`Processing project: ${project.name}`);

      if (entityType === "all" || entityType === "repositoryCases") {
        const count = await prisma.repositoryCases.count({
          where: {
            projectId: project.id,
            isDeleted: false,
            isArchived: false,
          },
        });
        if (count > 0) {
          await job.log(`Syncing ${count} repository cases for project ${project.name}`);

          // Create progress callback that updates job progress
          const progressCallback = async (processed: number, total: number, message: string) => {
            processedDocuments = results.repositoryCases + processed;
            const overallProgress = 10 + ((processedDocuments / totalDocuments) * 80);
            await job.updateProgress(Math.min(overallProgress, 90));
            await job.log(message);
          };

          await syncProjectCasesToElasticsearch(project.id, 100, progressCallback);
          results.repositoryCases += count;
          processedDocuments = results.repositoryCases;
        }
      }

      if (entityType === "all" || entityType === "sharedSteps") {
        const count = await prisma.sharedStepGroup.count({
          where: {
            projectId: project.id,
            isDeleted: false,
          },
        });
        if (count > 0) {
          await job.log(`Syncing ${count} shared steps for project ${project.name}`);
          await syncProjectSharedStepsToElasticsearch(project.id);
          results.sharedSteps += count;
        }
      }

      if (entityType === "all" || entityType === "testRuns") {
        const count = await prisma.testRuns.count({
          where: {
            projectId: project.id,
            isDeleted: false,
          },
        });
        if (count > 0) {
          await job.log(`Syncing ${count} test runs for project ${project.name}`);
          await syncProjectTestRunsToElasticsearch(project.id, prisma);
          results.testRuns += count;
        }
      }

      if (entityType === "all" || entityType === "sessions") {
        const count = await prisma.sessions.count({
          where: {
            projectId: project.id,
            isDeleted: false,
          },
        });
        if (count > 0) {
          await job.log(`Syncing ${count} sessions for project ${project.name}`);
          await syncProjectSessionsToElasticsearch(project.id, prisma);
          results.sessions += count;
        }
      }

      if (entityType === "all" || entityType === "issues") {
        const count = await prisma.issue.count({
          where: {
            isDeleted: false,
            testRuns: {
              some: {
                projectId: project.id,
              },
            },
          },
        });
        if (count > 0) {
          await job.log(`Syncing ${count} issues for project ${project.name}`);
          await syncProjectIssuesToElasticsearch(project.id, prisma);
          results.issues += count;
        }
      }

      if (entityType === "all" || entityType === "milestones") {
        const count = await prisma.milestones.count({
          where: {
            projectId: project.id,
            isDeleted: false,
          },
        });
        if (count > 0) {
          await job.log(`Syncing ${count} milestones for project ${project.name}`);
          await syncProjectMilestonesToElasticsearch(project.id, prisma);
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

    const finalTotalDocuments = Object.values(results).reduce((a, b) => a + b, 0);
    console.log(`Reindex job ${job.id} completed. Indexed ${finalTotalDocuments} documents.`);

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
    worker = new Worker(ELASTICSEARCH_REINDEX_QUEUE_NAME, processor, {
      connection: valkeyConnection,
      concurrency: 2, // Process 2 reindex jobs at a time
      lockDuration: 3600000, // 1 hour - allows for very large reindex operations
      maxStalledCount: 1, // Reduce automatic stalled job retries
      stalledInterval: 300000, // Check for stalled jobs every 5 minutes
    });

    worker.on("completed", (job) => {
      console.log(`Elasticsearch reindex job ${job.id} completed successfully.`);
    });

    worker.on("failed", (job, err) => {
      console.error(`Elasticsearch reindex job ${job?.id} failed:`, err);
    });

    worker.on("error", (err) => {
      console.error("Elasticsearch reindex worker error:", err);
    });

    console.log(`Elasticsearch reindex worker started for queue "${ELASTICSEARCH_REINDEX_QUEUE_NAME}".`);
  } else {
    console.warn("Valkey connection not available. Elasticsearch reindex worker not started.");
  }

  // Allow graceful shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down Elasticsearch reindex worker...");
    if (worker) {
      await worker.close();
    }
    // Disconnect all tenant Prisma clients in multi-tenant mode
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
};

// Run the worker if this file is executed directly (works with both ESM and CommonJS)
if (
  (typeof import.meta !== "undefined" &&
    import.meta.url === pathToFileURL(process.argv[1]).href) ||
  (typeof import.meta === "undefined" ||
    (import.meta as any).url === undefined)
) {
  console.log("Elasticsearch reindex worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start Elasticsearch reindex worker:", err);
    process.exit(1);
  });
}

export default worker;
