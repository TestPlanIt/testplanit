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
  captureAuditEvent,
} from "./services/auditLog";
import { invalidateApiTokenCache } from "./api-token-cache";

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
              console.error(
                `Failed to sync repository case ${result.id} to Elasticsearch:`,
                error
              );
            });
            await auditCreate("RepositoryCases", result, result.projectId);
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where
            ? await baseClient.repositoryCases.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          // Sync to Elasticsearch asynchronously
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync repository case ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditUpdate(
              "RepositoryCases",
              oldEntity,
              result,
              result.projectId
            );
          }
          return result;
        },
        async upsert({ args, query }: any) {
          // Check if entity exists for audit
          const oldEntity = args.where
            ? await baseClient.repositoryCases.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          // Sync to Elasticsearch asynchronously
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync repository case ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log - determine if create or update
            if (oldEntity) {
              await auditUpdate(
                "RepositoryCases",
                oldEntity,
                result,
                result.projectId
              );
            } else {
              await auditCreate("RepositoryCases", result, result.projectId);
            }
          }
          return result;
        },
        async delete({ args, query }: any) {
          // Fetch entity before deletion for audit
          const oldEntity = args.where
            ? await baseClient.repositoryCases.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          // Sync to Elasticsearch asynchronously (will handle removal if needed)
          if (result?.id) {
            syncRepositoryCaseToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync repository case ${result.id} to Elasticsearch after delete:`,
                error
              );
            });
          }
          if (oldEntity) {
            await auditDelete(
              "RepositoryCases",
              oldEntity,
              oldEntity.projectId
            );
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
            const projectId =
              typeof rawProjectId === "number" && rawProjectId > 0
                ? rawProjectId
                : undefined;
            await auditBulkCreate("RepositoryCases", result.count, projectId);
          }
          return result;
        },
        async updateMany({ args, query }: any) {
          const result = await query(args);
          // Audit bulk update
          if (result?.count > 0) {
            await auditBulkUpdate("RepositoryCases", result.count, args.where);
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          const result = await query(args);
          // Audit bulk delete
          if (result?.count > 0) {
            await auditBulkDelete("RepositoryCases", result.count, args.where);
          }
          return result;
        },
      },
      testRuns: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncTestRunToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync test run ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditCreate("TestRuns", result, result.projectId);
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where
            ? await baseClient.testRuns.findUnique({ where: args.where })
            : null;

          // Auto-set completedAt when isCompleted changes to true
          if (
            args.data?.isCompleted === true &&
            !args.data?.completedAt &&
            oldEntity?.isCompleted !== true
          ) {
            args.data.completedAt = new Date();
          }

          const result = await query(args);
          if (result?.id) {
            syncTestRunToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync test run ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditUpdate("TestRuns", oldEntity, result, result.projectId);
          }
          return result;
        },
        async delete({ args, query }: any) {
          // Fetch entity before deletion for audit
          const oldEntity = args.where
            ? await baseClient.testRuns.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("TestRuns", oldEntity, oldEntity.projectId);
          }
          return result;
        },
        async createMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            const projectId = args.data?.[0]?.projectId;
            await auditBulkCreate("TestRuns", result.count, projectId);
          }
          return result;
        },
        async updateMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            await auditBulkUpdate("TestRuns", result.count, args.where);
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            await auditBulkDelete("TestRuns", result.count, args.where);
          }
          return result;
        },
      },
      // Audit parity exempt (informational): sessions has full CRUD hook parity
      // but the lifecycle events that matter (login/logout/invalidation) are
      // audited at the NextAuth event-callback layer above the DB hook — see
      // app/api/auth/logout/route.ts for the LOGOUT pair. The hooks here still
      // fire for completeness but are not the primary audit signal.
      // Matches the lastActiveAt precedent at lib/prisma.ts:693-701.
      sessions: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync session ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditCreate("Sessions", result, result.projectId);
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where
            ? await baseClient.sessions.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync session ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditUpdate("Sessions", oldEntity, result, result.projectId);
          }
          return result;
        },
        async upsert({ args, query }: any) {
          // Check if entity exists for audit
          const oldEntity = args.where
            ? await baseClient.sessions.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync session ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log - determine if create or update
            if (oldEntity) {
              await auditUpdate(
                "Sessions",
                oldEntity,
                result,
                result.projectId
              );
            } else {
              await auditCreate("Sessions", result, result.projectId);
            }
          }
          return result;
        },
        async delete({ args, query }: any) {
          // Fetch entity before deletion for audit
          const oldEntity = args.where
            ? await baseClient.sessions.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync session ${result.id} to Elasticsearch:`,
                error
              );
            });
          }
          if (oldEntity) {
            await auditDelete("Sessions", oldEntity, oldEntity.projectId);
          }
          return result;
        },
        async createMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            const projectId = args.data?.[0]?.projectId;
            await auditBulkCreate("Sessions", result.count, projectId);
          }
          return result;
        },
        async updateMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            await auditBulkUpdate("Sessions", result.count, args.where);
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            await auditBulkDelete("Sessions", result.count, args.where);
          }
          return result;
        },
      },
      sharedStepGroups: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncSharedStepToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync shared step ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditCreate("SharedStepGroup", result, result.projectId);
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where
            ? await baseClient.sharedStepGroup.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            syncSharedStepToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync shared step ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditUpdate(
              "SharedStepGroup",
              oldEntity,
              result,
              result.projectId
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.sharedStepGroup.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete(
              "SharedStepGroup",
              oldEntity,
              oldEntity.projectId
            );
          }
          return result;
        },
      },
      issues: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncIssueToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync issue ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditCreate("Issue", result, result.projectId);
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where
            ? await baseClient.issue.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            syncIssueToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync issue ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditUpdate("Issue", oldEntity, result, result.projectId);
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.issue.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete(
              "Issue",
              oldEntity,
              oldEntity.projectId ?? undefined
            );
          }
          return result;
        },
      },
      milestones: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncMilestoneToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync milestone ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditCreate("Milestones", result, result.projectId);
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where
            ? await baseClient.milestones.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            syncMilestoneToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync milestone ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditUpdate(
              "Milestones",
              oldEntity,
              result,
              result.projectId
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.milestones.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("Milestones", oldEntity, oldEntity.projectId);
          }
          return result;
        },
      },
      projects: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncProjectToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync project ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditCreate("Projects", result);
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state for audit diff
          const oldEntity = args.where
            ? await baseClient.projects.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            syncProjectToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync project ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            await auditUpdate("Projects", oldEntity, result);
          }
          return result;
        },
        async delete({ args, query }: any) {
          // Fetch entity before deletion for audit
          const oldEntity = args.where
            ? await baseClient.projects.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("Projects", oldEntity);
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
            await auditCreate("User", result);
          }
          return result;
        },
        async update({ args, query }: any) {
          // Skip audit for session keep-alive writes (throttled lastActiveAt
          // pings from the session callback). Auditing these produces a log
          // entry every 5 minutes per active user with no security value.
          const dataKeys = args.data ? Object.keys(args.data) : [];
          const isLastActiveOnly =
            dataKeys.length === 1 && dataKeys[0] === "lastActiveAt";
          if (isLastActiveOnly) {
            return query(args);
          }

          // Fetch old state for audit diff, especially for role changes
          const oldEntity = args.where
            ? await baseClient.user.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            // Check for role/access level change
            if (oldEntity && oldEntity.access !== result.access) {
              await auditRoleChange(
                result.id,
                oldEntity.access,
                result.access,
                result.email
              );
            } else {
              await auditUpdate("User", oldEntity, result);
            }
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.user.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("User", oldEntity);
          }
          return result;
        },
        async updateMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            await auditBulkUpdate("User", result.count, args.where);
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            await auditBulkDelete("User", result.count, args.where);
          }
          return result;
        },
      },
      // Audit parity exempt: userProjectPermission.update is not hooked because
      // permissions are grant/revoke only (no intermediate UPDATE path).
      // The create/delete hooks call auditPermissionGrant/Revoke respectively.
      // Matches the lastActiveAt precedent at lib/prisma.ts:693-701.
      userProjectPermission: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditPermissionGrant(
              "UserProjectPermission",
              result,
              result.projectId
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.userProjectPermission.findUnique({
                where: args.where,
              })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditPermissionRevoke(
              "UserProjectPermission",
              oldEntity,
              oldEntity.projectId
            );
          }
          return result;
        },
      },
      // Audit parity exempt: groupProjectPermission.update is not hooked because
      // group permissions are grant/revoke only (no intermediate UPDATE path).
      // The create/delete hooks call auditPermissionGrant/Revoke respectively.
      // Matches the lastActiveAt precedent at lib/prisma.ts:693-701.
      groupProjectPermission: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditPermissionGrant(
              "GroupProjectPermission",
              result,
              result.projectId
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.groupProjectPermission.findUnique({
                where: args.where,
              })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditPermissionRevoke(
              "GroupProjectPermission",
              oldEntity,
              oldEntity.projectId
            );
          }
          return result;
        },
      },
      account: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditCreate("Account", result);
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.account.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            await auditUpdate("Account", oldEntity, result);
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.account.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("Account", oldEntity);
          }
          return result;
        },
      },
      ssoProvider: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditSsoConfigChange("CREATE", result);
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditSsoConfigChange("UPDATE", result);
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.ssoProvider.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditSsoConfigChange("DELETE", oldEntity);
          }
          return result;
        },
      },
      // Audit parity exempt: allowedEmailDomain.update is not hooked because
      // domain entries are immutable (allowed or not — no intermediate state).
      // Matches the lastActiveAt precedent at lib/prisma.ts:693-701.
      allowedEmailDomain: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditCreate("AllowedEmailDomain", result);
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.allowedEmailDomain.findUnique({
                where: args.where,
              })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("AllowedEmailDomain", oldEntity);
          }
          return result;
        },
      },
      appConfig: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.key) {
            await auditSystemConfigChange(result.key, null, result.value);
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.appConfig.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.key) {
            await auditSystemConfigChange(
              result.key,
              oldEntity?.value,
              result.value
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.appConfig.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditSystemConfigChange(oldEntity.key, oldEntity.value, null);
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
            await auditCreate("UserIntegrationAuth", result);
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.userIntegrationAuth.findUnique({
                where: args.where,
              })
            : null;
          const result = await query(args);
          if (result?.id) {
            await auditUpdate("UserIntegrationAuth", oldEntity, result);
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.userIntegrationAuth.findUnique({
                where: args.where,
              })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("UserIntegrationAuth", oldEntity);
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
            await auditCreate("TestRunResult", result);
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.testRunResults.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            await auditUpdate("TestRunResult", oldEntity, result);
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.testRunResults.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("TestRunResult", oldEntity);
          }
          return result;
        },
      },
      comment: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditCreate("Comment", result, result.projectId ?? undefined);
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.comment.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            await auditUpdate(
              "Comment",
              oldEntity,
              result,
              result.projectId ?? undefined
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.comment.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete(
              "Comment",
              oldEntity,
              oldEntity.projectId ?? undefined
            );
          }
          return result;
        },
      },
      // Audit parity exempt: attachment.update is not hooked because attachments
      // are immutable once uploaded (no in-place mutation path). Matches the
      // lastActiveAt precedent at lib/prisma.ts:693-701.
      attachment: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditCreate("Attachment", result);
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.attachments.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("Attachment", oldEntity);
          }
          return result;
        },
      },
      // =============================================================================
      // Phase 62: Integrations, Prompt Configurations, Test Run Cases
      // =============================================================================
      integration: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditCreate("Integration", result);
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.integration.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            await auditUpdate("Integration", oldEntity, result);
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.integration.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("Integration", oldEntity);
          }
          return result;
        },
      },
      projectIntegration: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditCreate("ProjectIntegration", result, result.projectId);
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.projectIntegration.findUnique({
                where: args.where,
              })
            : null;
          const result = await query(args);
          if (result?.id) {
            await auditUpdate(
              "ProjectIntegration",
              oldEntity,
              result,
              result.projectId
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.projectIntegration.findUnique({
                where: args.where,
              })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete(
              "ProjectIntegration",
              oldEntity,
              oldEntity.projectId
            );
          }
          return result;
        },
      },
      promptConfig: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditCreate("PromptConfig", result);
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.promptConfig.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            await auditUpdate("PromptConfig", oldEntity, result);
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.promptConfig.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("PromptConfig", oldEntity);
          }
          return result;
        },
      },
      promptConfigPrompt: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditCreate("PromptConfigPrompt", result);
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.promptConfigPrompt.findUnique({
                where: args.where,
              })
            : null;
          const result = await query(args);
          if (result?.id) {
            await auditUpdate("PromptConfigPrompt", oldEntity, result);
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.promptConfigPrompt.findUnique({
                where: args.where,
              })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("PromptConfigPrompt", oldEntity);
          }
          return result;
        },
      },
      testRunCases: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            await auditCreate("TestRunCases", result);
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.testRunCases.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            await auditUpdate("TestRunCases", oldEntity, result);
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.testRunCases.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete("TestRunCases", oldEntity);
          }
          return result;
        },
      },
      // =============================================================================
      // API Tokens - Security audit logging
      // =============================================================================
      // Audit parity exempt: apiToken.create is not hooked because API token
      // creation is audited explicitly at app/api/api-tokens/route.ts via
      // captureAuditEvent("API_KEY_CREATED", ...) — the explicit route call
      // masks the token secret value in a way the generic auditCreate cannot.
      // Matches the lastActiveAt precedent at lib/prisma.ts:693-701.
      apiToken: {
        async delete({ args, query }: any) {
          // Fetch entity before deletion for audit (including user info)
          const oldEntity = args.where
            ? await baseClient.apiToken.findUnique({
                where: args.where,
                include: {
                  user: { select: { id: true, email: true, name: true } },
                },
              })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await captureAuditEvent({
              action: "API_KEY_DELETED",
              entityType: "ApiToken",
              entityId: oldEntity.id,
              entityName: oldEntity.name,
              metadata: {
                tokenPrefix: oldEntity.tokenPrefix,
                tokenOwnerId: oldEntity.userId,
                tokenOwnerEmail: oldEntity.user?.email,
              },
            });
            // Evict the short-TTL auth cache so the token is rejected immediately.
            invalidateApiTokenCache(oldEntity.token).catch((error: any) => {
              console.error(
                `Failed to invalidate API token cache on delete:`,
                error
              );
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          // Fetch old state to detect revocation (isActive: false)
          const oldEntity = args.where
            ? await baseClient.apiToken.findUnique({
                where: args.where,
                include: {
                  user: { select: { id: true, email: true, name: true } },
                },
              })
            : null;
          const result = await query(args);
          // Check if token was revoked (isActive changed from true to false)
          if (
            oldEntity &&
            result &&
            oldEntity.isActive === true &&
            result.isActive === false
          ) {
            await captureAuditEvent({
              action: "API_KEY_REVOKED",
              entityType: "ApiToken",
              entityId: result.id,
              entityName: result.name,
              metadata: {
                tokenPrefix: result.tokenPrefix,
                tokenOwnerId: result.userId,
                tokenOwnerEmail: oldEntity.user?.email,
              },
            });
          }
          // Evict the short-TTL auth cache on every write: revocation must be
          // immediate, and rotated scopes/expiresAt/isActive all need to
          // invalidate a prior cached lookup.
          if (oldEntity) {
            invalidateApiTokenCache(oldEntity.token).catch((error: any) => {
              console.error(
                `Failed to invalidate API token cache on update:`,
                error
              );
            });
          }
          return result;
        },
        async updateMany({ args, query }: any) {
          // Capture tokens affected by the bulk update so we can invalidate
          // their cached entries after the write completes. We also widen the
          // selection to non-sensitive forensic fields (id, tokenPrefix,
          // userId, name) so the bulk-update audit retains enough context to
          // reconstruct which tokens were touched. The raw `token` secret is
          // used only to key the in-memory cache and is never passed to audit.
          const affected = args.where
            ? await baseClient.apiToken.findMany({
                where: args.where,
                select: {
                  token: true,
                  id: true,
                  tokenPrefix: true,
                  userId: true,
                  name: true,
                },
              })
            : [];
          const result = await query(args);
          if (affected.length > 0) {
            Promise.all(
              affected.map((t: { token: string }) =>
                invalidateApiTokenCache(t.token)
              )
            ).catch((error: any) => {
              console.error(
                `Failed to invalidate API token caches on updateMany:`,
                error
              );
            });
          }
          if (result?.count > 0) {
            await auditBulkUpdate("ApiToken", result.count, args.where);
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          // Pre-query MUST run BEFORE the delete — post-delete these rows are
          // unrecoverable. Widened selection captures non-sensitive forensic
          // fields (id, tokenPrefix, userId, name) for the audit record; the
          // raw `token` value remains for cache eviction only and is never
          // logged.
          const affected = args.where
            ? await baseClient.apiToken.findMany({
                where: args.where,
                select: {
                  token: true,
                  id: true,
                  tokenPrefix: true,
                  userId: true,
                  name: true,
                },
              })
            : [];
          const result = await query(args);
          if (affected.length > 0) {
            Promise.all(
              affected.map((t: { token: string }) =>
                invalidateApiTokenCache(t.token)
              )
            ).catch((error: any) => {
              console.error(
                `Failed to invalidate API token caches on deleteMany:`,
                error
              );
            });
          }
          if (result?.count > 0) {
            await auditBulkDelete("ApiToken", result.count, args.where);
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
