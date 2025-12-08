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
import {
  auditCreate,
  auditUpdate,
  auditDelete,
  auditRoleChange,
  auditPermissionGrant,
  auditPermissionRevoke,
  auditSsoConfigChange,
  auditSystemConfigChange,
  auditBulkCreate,
  auditBulkUpdate,
  auditBulkDelete,
} from "./services/auditLog";

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
          // Fetch old state for audit diff
          const oldEntity = args.where ? await baseClient.repositoryCases.findUnique({ where: args.where }) : null;
          const result = await query(args);
          // Sync to Elasticsearch asynchronously
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync repository case ${result.id} to Elasticsearch:`, error);
            });
            // Audit log
            auditUpdate("RepositoryCases", oldEntity, result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit repository case update:`, error);
            });
          }
          return result;
        },
        async upsert({ args, query }: any) {
          // Check if entity exists for audit
          const oldEntity = args.where ? await baseClient.repositoryCases.findUnique({ where: args.where }) : null;
          const result = await query(args);
          // Sync to Elasticsearch asynchronously
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync repository case ${result.id} to Elasticsearch:`, error);
            });
            // Audit log - determine if create or update
            if (oldEntity) {
              auditUpdate("RepositoryCases", oldEntity, result, result.projectId).catch((error: any) => {
                console.error(`Failed to audit repository case upsert (update):`, error);
              });
            } else {
              auditCreate("RepositoryCases", result, result.projectId).catch((error: any) => {
                console.error(`Failed to audit repository case upsert (create):`, error);
              });
            }
          }
          return result;
        },
        async delete({ args, query }: any) {
          // Fetch entity before deletion for audit
          const oldEntity = args.where ? await baseClient.repositoryCases.findUnique({ where: args.where }) : null;
          const result = await query(args);
          // Sync to Elasticsearch asynchronously (will handle removal if needed)
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync repository case ${result.id} to Elasticsearch after delete:`, error);
            });
          }
          if (oldEntity) {
            auditDelete("RepositoryCases", oldEntity, oldEntity.projectId).catch((error: any) => {
              console.error(`Failed to audit repository case delete:`, error);
            });
          }
          return result;
        },
        async createMany({ args, query }: any) {
          const result = await query(args);
          // Audit bulk create
          if (result?.count > 0) {
            // args.data is an array of objects for createMany
            // Ensure projectId is a valid number before passing to audit
            const rawProjectId = args.data?.[0]?.projectId;
            const projectId = typeof rawProjectId === 'number' && rawProjectId > 0 ? rawProjectId : undefined;
            auditBulkCreate("RepositoryCases", result.count, projectId).catch((error: any) => {
              console.error(`Failed to audit repository case bulk create:`, error);
            });
          }
          return result;
        },
        async updateMany({ args, query }: any) {
          const result = await query(args);
          // Audit bulk update
          if (result?.count > 0) {
            auditBulkUpdate("RepositoryCases", result.count, args.where).catch((error: any) => {
              console.error(`Failed to audit repository case bulk update:`, error);
            });
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          const result = await query(args);
          // Audit bulk delete
          if (result?.count > 0) {
            auditBulkDelete("RepositoryCases", result.count, args.where).catch((error: any) => {
              console.error(`Failed to audit repository case bulk delete:`, error);
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
            // Audit log
            auditCreate("TestRuns", result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit test run create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where ? await baseClient.testRuns.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            syncTestRunToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync test run ${result.id} to Elasticsearch:`, error);
            });
            // Audit log
            auditUpdate("TestRuns", oldEntity, result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit test run update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          // Fetch entity before deletion for audit
          const oldEntity = args.where ? await baseClient.testRuns.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("TestRuns", oldEntity, oldEntity.projectId).catch((error: any) => {
              console.error(`Failed to audit test run delete:`, error);
            });
          }
          return result;
        },
        async createMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            const projectId = args.data?.[0]?.projectId;
            auditBulkCreate("TestRuns", result.count, projectId).catch((error: any) => {
              console.error(`Failed to audit test run bulk create:`, error);
            });
          }
          return result;
        },
        async updateMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            auditBulkUpdate("TestRuns", result.count, args.where).catch((error: any) => {
              console.error(`Failed to audit test run bulk update:`, error);
            });
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            auditBulkDelete("TestRuns", result.count, args.where).catch((error: any) => {
              console.error(`Failed to audit test run bulk delete:`, error);
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
            // Audit log
            auditCreate("Sessions", result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit session create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where ? await baseClient.sessions.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync session ${result.id} to Elasticsearch:`, error);
            });
            // Audit log
            auditUpdate("Sessions", oldEntity, result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit session update:`, error);
            });
          }
          return result;
        },
        async upsert({ args, query }: any) {
          // Check if entity exists for audit
          const oldEntity = args.where ? await baseClient.sessions.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync session ${result.id} to Elasticsearch:`, error);
            });
            // Audit log - determine if create or update
            if (oldEntity) {
              auditUpdate("Sessions", oldEntity, result, result.projectId).catch((error: any) => {
                console.error(`Failed to audit session upsert (update):`, error);
              });
            } else {
              auditCreate("Sessions", result, result.projectId).catch((error: any) => {
                console.error(`Failed to audit session upsert (create):`, error);
              });
            }
          }
          return result;
        },
        async delete({ args, query }: any) {
          // Fetch entity before deletion for audit
          const oldEntity = args.where ? await baseClient.sessions.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync session ${result.id} to Elasticsearch:`, error);
            });
          }
          if (oldEntity) {
            auditDelete("Sessions", oldEntity, oldEntity.projectId).catch((error: any) => {
              console.error(`Failed to audit session delete:`, error);
            });
          }
          return result;
        },
        async createMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            const projectId = args.data?.[0]?.projectId;
            auditBulkCreate("Sessions", result.count, projectId).catch((error: any) => {
              console.error(`Failed to audit session bulk create:`, error);
            });
          }
          return result;
        },
        async updateMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            auditBulkUpdate("Sessions", result.count, args.where).catch((error: any) => {
              console.error(`Failed to audit session bulk update:`, error);
            });
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            auditBulkDelete("Sessions", result.count, args.where).catch((error: any) => {
              console.error(`Failed to audit session bulk delete:`, error);
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
            // Audit log
            auditCreate("SharedStepGroup", result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit shared step group create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where ? await baseClient.sharedStepGroup.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            syncSharedStepToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync shared step ${result.id} to Elasticsearch:`, error);
            });
            // Audit log
            auditUpdate("SharedStepGroup", oldEntity, result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit shared step group update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.sharedStepGroup.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("SharedStepGroup", oldEntity, oldEntity.projectId).catch((error: any) => {
              console.error(`Failed to audit shared step group delete:`, error);
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
            // Audit log
            auditCreate("Issue", result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit issue create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where ? await baseClient.issue.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            syncIssueToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync issue ${result.id} to Elasticsearch:`, error);
            });
            // Audit log
            auditUpdate("Issue", oldEntity, result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit issue update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.issue.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("Issue", oldEntity, oldEntity.projectId ?? undefined).catch((error: any) => {
              console.error(`Failed to audit issue delete:`, error);
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
            // Audit log
            auditCreate("Milestones", result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit milestone create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where ? await baseClient.milestones.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            syncMilestoneToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync milestone ${result.id} to Elasticsearch:`, error);
            });
            // Audit log
            auditUpdate("Milestones", oldEntity, result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit milestone update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.milestones.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("Milestones", oldEntity, oldEntity.projectId).catch((error: any) => {
              console.error(`Failed to audit milestone delete:`, error);
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
            // Audit log
            auditCreate("Projects", result).catch((error: any) => {
              console.error(`Failed to audit project create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where ? await baseClient.projects.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            syncProjectToElasticsearch(result.id).catch((error: any) => {
              console.error(`Failed to sync project ${result.id} to Elasticsearch:`, error);
            });
            // Audit log
            auditUpdate("Projects", oldEntity, result).catch((error: any) => {
              console.error(`Failed to audit project update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          // Fetch entity before deletion for audit
          const oldEntity = args.where ? await baseClient.projects.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("Projects", oldEntity).catch((error: any) => {
              console.error(`Failed to audit project delete:`, error);
            });
          }
          return result;
        },
      },
      // =============================================================================
      // Phase 1: Security & Access Control Audit Logging
      // =============================================================================
      user: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditCreate("User", result).catch((error: any) => {
              console.error(`Failed to audit user create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff, especially for role changes
          const oldEntity = args.where ? await baseClient.user.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            // Check for role/access level change
            if (oldEntity && oldEntity.access !== result.access) {
              auditRoleChange(result.id, oldEntity.access, result.access, result.email).catch((error: any) => {
                console.error(`Failed to audit role change:`, error);
              });
            } else {
              auditUpdate("User", oldEntity, result).catch((error: any) => {
                console.error(`Failed to audit user update:`, error);
              });
            }
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.user.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("User", oldEntity).catch((error: any) => {
              console.error(`Failed to audit user delete:`, error);
            });
          }
          return result;
        },
        async updateMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            auditBulkUpdate("User", result.count, args.where).catch((error: any) => {
              console.error(`Failed to audit user bulk update:`, error);
            });
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            auditBulkDelete("User", result.count, args.where).catch((error: any) => {
              console.error(`Failed to audit user bulk delete:`, error);
            });
          }
          return result;
        },
      },
      userProjectPermission: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditPermissionGrant("UserProjectPermission", result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit permission grant:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.userProjectPermission.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditPermissionRevoke("UserProjectPermission", oldEntity, oldEntity.projectId).catch((error: any) => {
              console.error(`Failed to audit permission revoke:`, error);
            });
          }
          return result;
        },
      },
      groupProjectPermission: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditPermissionGrant("GroupProjectPermission", result, result.projectId).catch((error: any) => {
              console.error(`Failed to audit group permission grant:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.groupProjectPermission.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditPermissionRevoke("GroupProjectPermission", oldEntity, oldEntity.projectId).catch((error: any) => {
              console.error(`Failed to audit group permission revoke:`, error);
            });
          }
          return result;
        },
      },
      account: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditCreate("Account", result).catch((error: any) => {
              console.error(`Failed to audit account create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.account.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            auditUpdate("Account", oldEntity, result).catch((error: any) => {
              console.error(`Failed to audit account update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.account.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("Account", oldEntity).catch((error: any) => {
              console.error(`Failed to audit account delete:`, error);
            });
          }
          return result;
        },
      },
      ssoProvider: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditSsoConfigChange("CREATE", result).catch((error: any) => {
              console.error(`Failed to audit SSO provider create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditSsoConfigChange("UPDATE", result).catch((error: any) => {
              console.error(`Failed to audit SSO provider update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.ssoProvider.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditSsoConfigChange("DELETE", oldEntity).catch((error: any) => {
              console.error(`Failed to audit SSO provider delete:`, error);
            });
          }
          return result;
        },
      },
      allowedEmailDomain: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditCreate("AllowedEmailDomain", result).catch((error: any) => {
              console.error(`Failed to audit allowed email domain create:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.allowedEmailDomain.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("AllowedEmailDomain", oldEntity).catch((error: any) => {
              console.error(`Failed to audit allowed email domain delete:`, error);
            });
          }
          return result;
        },
      },
      appConfig: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.key) {
            auditSystemConfigChange(result.key, null, result.value).catch((error: any) => {
              console.error(`Failed to audit app config create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.appConfig.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.key) {
            auditSystemConfigChange(result.key, oldEntity?.value, result.value).catch((error: any) => {
              console.error(`Failed to audit app config update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.appConfig.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditSystemConfigChange(oldEntity.key, oldEntity.value, null).catch((error: any) => {
              console.error(`Failed to audit app config delete:`, error);
            });
          }
          return result;
        },
      },
      // =============================================================================
      // Phase 2: Core Data - UserIntegrationAuth (external integration credentials)
      // =============================================================================
      userIntegrationAuth: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditCreate("UserIntegrationAuth", result).catch((error: any) => {
              console.error(`Failed to audit user integration auth create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.userIntegrationAuth.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            auditUpdate("UserIntegrationAuth", oldEntity, result).catch((error: any) => {
              console.error(`Failed to audit user integration auth update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.userIntegrationAuth.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("UserIntegrationAuth", oldEntity).catch((error: any) => {
              console.error(`Failed to audit user integration auth delete:`, error);
            });
          }
          return result;
        },
      },
      // =============================================================================
      // Phase 3: Core Data - Test Execution & Content
      // =============================================================================
      testRunResult: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditCreate("TestRunResult", result).catch((error: any) => {
              console.error(`Failed to audit test run result create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.testRunResults.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            auditUpdate("TestRunResult", oldEntity, result).catch((error: any) => {
              console.error(`Failed to audit test run result update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.testRunResults.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("TestRunResult", oldEntity).catch((error: any) => {
              console.error(`Failed to audit test run result delete:`, error);
            });
          }
          return result;
        },
      },
      comment: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditCreate("Comment", result, result.projectId ?? undefined).catch((error: any) => {
              console.error(`Failed to audit comment create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.comment.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (result?.id) {
            auditUpdate("Comment", oldEntity, result, result.projectId ?? undefined).catch((error: any) => {
              console.error(`Failed to audit comment update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.comment.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("Comment", oldEntity, oldEntity.projectId ?? undefined).catch((error: any) => {
              console.error(`Failed to audit comment delete:`, error);
            });
          }
          return result;
        },
      },
      attachment: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditCreate("Attachment", result).catch((error: any) => {
              console.error(`Failed to audit attachment create:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where ? await baseClient.attachments.findUnique({ where: args.where }) : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("Attachment", oldEntity).catch((error: any) => {
              console.error(`Failed to audit attachment delete:`, error);
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
