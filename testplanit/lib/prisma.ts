// app/lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { enhance } from "@zenstackhq/runtime";
import { syncRepositoryCaseToElasticsearch } from "../services/repositoryCaseSync";
import { syncTestRunToElasticsearch } from "../services/testRunSearch";
import { syncSessionToElasticsearch } from "../services/sessionSearch";
import { syncSharedStepToElasticsearch } from "../services/sharedStepSearch";
import { syncIssueToElasticsearch } from "../services/issueSearch";
import { syncMilestoneToElasticsearch } from "../services/milestoneSearch";
import { syncProjectToElasticsearch } from "../services/projectSearch";

// Declare global types
declare global {
  var prisma: PrismaClient | undefined;
  var db: any;
}

// Use different variable names to avoid redeclaration
let prismaClient: PrismaClient;
let dbClient: any;

// Helper function to create and configure PrismaClient with Elasticsearch sync
function createPrismaClient(errorFormat: "pretty" | "colorless") {
  const baseClient = new PrismaClient({ errorFormat });
  
  // Add Elasticsearch sync using client extensions
  const client = baseClient.$extends({
    query: {
      repositoryCases: {
        async create({ args, query }: any) {
          const result = await query(args);
          // Sync to Elasticsearch asynchronously
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync repository case ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          // Sync to Elasticsearch asynchronously
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync repository case ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async upsert({ args, query }: any) {
          const result = await query(args);
          // Sync to Elasticsearch asynchronously
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync repository case ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const result = await query(args);
          // Sync to Elasticsearch asynchronously (will handle removal if needed)
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync repository case ${result.id} to Elasticsearch after delete:`, error);
            });
          }
          return result;
        },
      },
      testRuns: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncTestRunToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync test run ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncTestRunToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync test run ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
      },
      sessions: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync session ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync session ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async upsert({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync session ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync session ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
      },
      sharedStepGroups: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncSharedStepToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync shared step ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncSharedStepToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync shared step ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
      },
      issues: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncIssueToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync issue ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncIssueToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync issue ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
      },
      milestones: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncMilestoneToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync milestone ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncMilestoneToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync milestone ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
      },
      projects: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncProjectToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync project ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncProjectToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync project ${result.id} to Elasticsearch:`, error);
            });
          }
          return result;
        },
      },
    } as any,
  });
  
  return client as unknown as PrismaClient;
}

// Check if we're in a production environment or not.
// In development, Next.js might hot-reload and create new instances, so we prevent that.
if (process.env.NODE_ENV === "production") {
  prismaClient = createPrismaClient("pretty");
  dbClient = enhance(prismaClient);
} else {
  // Check if there's already a global instance of PrismaClient
  if (!global.prisma) {
    global.prisma = createPrismaClient("colorless");
    global.db = enhance(global.prisma);
  }
  prismaClient = global.prisma;
  dbClient = global.db;
}

export const prisma = prismaClient;
export const db = dbClient;
