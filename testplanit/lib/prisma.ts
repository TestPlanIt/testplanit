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
            auditCreate("RepositoryCases", result, result.projectId).catch(
              (error: any) => {
                console.error(`Failed to audit repository case create:`, error);
              }
            );
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
            auditUpdate(
              "RepositoryCases",
              oldEntity,
              result,
              result.projectId
            ).catch((error: any) => {
              console.error(`Failed to audit repository case update:`, error);
            });
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
              auditUpdate(
                "RepositoryCases",
                oldEntity,
                result,
                result.projectId
              ).catch((error: any) => {
                console.error(
                  `Failed to audit repository case upsert (update):`,
                  error
                );
              });
            } else {
              auditCreate("RepositoryCases", result, result.projectId).catch(
                (error: any) => {
                  console.error(
                    `Failed to audit repository case upsert (create):`,
                    error
                  );
                }
              );
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
            auditDelete(
              "RepositoryCases",
              oldEntity,
              oldEntity.projectId
            ).catch((error: any) => {
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
            const projectId =
              typeof rawProjectId === "number" && rawProjectId > 0
                ? rawProjectId
                : undefined;
            auditBulkCreate("RepositoryCases", result.count, projectId).catch(
              (error: any) => {
                console.error(
                  `Failed to audit repository case bulk create:`,
                  error
                );
              }
            );
          }
          return result;
        },
        async updateMany({ args, query }: any) {
          const result = await query(args);
          // Audit bulk update
          if (result?.count > 0) {
            auditBulkUpdate("RepositoryCases", result.count, args.where).catch(
              (error: any) => {
                console.error(
                  `Failed to audit repository case bulk update:`,
                  error
                );
              }
            );
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          const result = await query(args);
          // Audit bulk delete
          if (result?.count > 0) {
            auditBulkDelete("RepositoryCases", result.count, args.where).catch(
              (error: any) => {
                console.error(
                  `Failed to audit repository case bulk delete:`,
                  error
                );
              }
            );
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
            auditCreate("TestRuns", result, result.projectId).catch(
              (error: any) => {
                console.error(`Failed to audit test run create:`, error);
              }
            );
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
            auditUpdate("TestRuns", oldEntity, result, result.projectId).catch(
              (error: any) => {
                console.error(`Failed to audit test run update:`, error);
              }
            );
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
            auditDelete("TestRuns", oldEntity, oldEntity.projectId).catch(
              (error: any) => {
                console.error(`Failed to audit test run delete:`, error);
              }
            );
          }
          return result;
        },
        async createMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            const projectId = args.data?.[0]?.projectId;
            auditBulkCreate("TestRuns", result.count, projectId).catch(
              (error: any) => {
                console.error(`Failed to audit test run bulk create:`, error);
              }
            );
          }
          return result;
        },
        async updateMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            auditBulkUpdate("TestRuns", result.count, args.where).catch(
              (error: any) => {
                console.error(`Failed to audit test run bulk update:`, error);
              }
            );
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            auditBulkDelete("TestRuns", result.count, args.where).catch(
              (error: any) => {
                console.error(`Failed to audit test run bulk delete:`, error);
              }
            );
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
            auditCreate("Sessions", result, result.projectId).catch(
              (error: any) => {
                console.error(`Failed to audit session create:`, error);
              }
            );
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
            auditUpdate("Sessions", oldEntity, result, result.projectId).catch(
              (error: any) => {
                console.error(`Failed to audit session update:`, error);
              }
            );
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
              auditUpdate(
                "Sessions",
                oldEntity,
                result,
                result.projectId
              ).catch((error: any) => {
                console.error(
                  `Failed to audit session upsert (update):`,
                  error
                );
              });
            } else {
              auditCreate("Sessions", result, result.projectId).catch(
                (error: any) => {
                  console.error(
                    `Failed to audit session upsert (create):`,
                    error
                  );
                }
              );
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
            auditDelete("Sessions", oldEntity, oldEntity.projectId).catch(
              (error: any) => {
                console.error(`Failed to audit session delete:`, error);
              }
            );
          }
          return result;
        },
        async createMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            const projectId = args.data?.[0]?.projectId;
            auditBulkCreate("Sessions", result.count, projectId).catch(
              (error: any) => {
                console.error(`Failed to audit session bulk create:`, error);
              }
            );
          }
          return result;
        },
        async updateMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            auditBulkUpdate("Sessions", result.count, args.where).catch(
              (error: any) => {
                console.error(`Failed to audit session bulk update:`, error);
              }
            );
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            auditBulkDelete("Sessions", result.count, args.where).catch(
              (error: any) => {
                console.error(`Failed to audit session bulk delete:`, error);
              }
            );
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
            auditCreate("SharedStepGroup", result, result.projectId).catch(
              (error: any) => {
                console.error(
                  `Failed to audit shared step group create:`,
                  error
                );
              }
            );
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
            auditUpdate(
              "SharedStepGroup",
              oldEntity,
              result,
              result.projectId
            ).catch((error: any) => {
              console.error(`Failed to audit shared step group update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.sharedStepGroup.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete(
              "SharedStepGroup",
              oldEntity,
              oldEntity.projectId
            ).catch((error: any) => {
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
              console.error(
                `Failed to sync issue ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            auditCreate("Issue", result, result.projectId).catch(
              (error: any) => {
                console.error(`Failed to audit issue create:`, error);
              }
            );
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
            auditUpdate("Issue", oldEntity, result, result.projectId).catch(
              (error: any) => {
                console.error(`Failed to audit issue update:`, error);
              }
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.issue.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete(
              "Issue",
              oldEntity,
              oldEntity.projectId ?? undefined
            ).catch((error: any) => {
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
              console.error(
                `Failed to sync milestone ${result.id} to Elasticsearch:`,
                error
              );
            });
            // Audit log
            auditCreate("Milestones", result, result.projectId).catch(
              (error: any) => {
                console.error(`Failed to audit milestone create:`, error);
              }
            );
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
            auditUpdate(
              "Milestones",
              oldEntity,
              result,
              result.projectId
            ).catch((error: any) => {
              console.error(`Failed to audit milestone update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.milestones.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("Milestones", oldEntity, oldEntity.projectId).catch(
              (error: any) => {
                console.error(`Failed to audit milestone delete:`, error);
              }
            );
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
            auditCreate("Projects", result).catch((error: any) => {
              console.error(`Failed to audit project create:`, error);
            });
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
            auditUpdate("Projects", oldEntity, result).catch((error: any) => {
              console.error(`Failed to audit project update:`, error);
            });
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
              auditRoleChange(
                result.id,
                oldEntity.access,
                result.access,
                result.email
              ).catch((error: any) => {
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
          const oldEntity = args.where
            ? await baseClient.user.findUnique({ where: args.where })
            : null;
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
            auditBulkUpdate("User", result.count, args.where).catch(
              (error: any) => {
                console.error(`Failed to audit user bulk update:`, error);
              }
            );
          }
          return result;
        },
        async deleteMany({ args, query }: any) {
          const result = await query(args);
          if (result?.count > 0) {
            auditBulkDelete("User", result.count, args.where).catch(
              (error: any) => {
                console.error(`Failed to audit user bulk delete:`, error);
              }
            );
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
            auditPermissionGrant(
              "UserProjectPermission",
              result,
              result.projectId
            ).catch((error: any) => {
              console.error(`Failed to audit permission grant:`, error);
            });
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
            auditPermissionRevoke(
              "UserProjectPermission",
              oldEntity,
              oldEntity.projectId
            ).catch((error: any) => {
              console.error(`Failed to audit permission revoke:`, error);
            });
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
            auditPermissionGrant(
              "GroupProjectPermission",
              result,
              result.projectId
            ).catch((error: any) => {
              console.error(`Failed to audit group permission grant:`, error);
            });
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
            auditPermissionRevoke(
              "GroupProjectPermission",
              oldEntity,
              oldEntity.projectId
            ).catch((error: any) => {
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
          const oldEntity = args.where
            ? await baseClient.account.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            auditUpdate("Account", oldEntity, result).catch((error: any) => {
              console.error(`Failed to audit account update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.account.findUnique({ where: args.where })
            : null;
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
          const oldEntity = args.where
            ? await baseClient.ssoProvider.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            auditSsoConfigChange("DELETE", oldEntity).catch((error: any) => {
              console.error(`Failed to audit SSO provider delete:`, error);
            });
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
            auditCreate("AllowedEmailDomain", result).catch((error: any) => {
              console.error(
                `Failed to audit allowed email domain create:`,
                error
              );
            });
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
            auditDelete("AllowedEmailDomain", oldEntity).catch((error: any) => {
              console.error(
                `Failed to audit allowed email domain delete:`,
                error
              );
            });
          }
          return result;
        },
      },
      appConfig: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.key) {
            auditSystemConfigChange(result.key, null, result.value).catch(
              (error: any) => {
                console.error(`Failed to audit app config create:`, error);
              }
            );
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.appConfig.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.key) {
            auditSystemConfigChange(
              result.key,
              oldEntity?.value,
              result.value
            ).catch((error: any) => {
              console.error(`Failed to audit app config update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.appConfig.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            auditSystemConfigChange(oldEntity.key, oldEntity.value, null).catch(
              (error: any) => {
                console.error(`Failed to audit app config delete:`, error);
              }
            );
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
              console.error(
                `Failed to audit user integration auth create:`,
                error
              );
            });
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
            auditUpdate("UserIntegrationAuth", oldEntity, result).catch(
              (error: any) => {
                console.error(
                  `Failed to audit user integration auth update:`,
                  error
                );
              }
            );
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
            auditDelete("UserIntegrationAuth", oldEntity).catch(
              (error: any) => {
                console.error(
                  `Failed to audit user integration auth delete:`,
                  error
                );
              }
            );
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
          const oldEntity = args.where
            ? await baseClient.testRunResults.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            auditUpdate("TestRunResult", oldEntity, result).catch(
              (error: any) => {
                console.error(`Failed to audit test run result update:`, error);
              }
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.testRunResults.findUnique({ where: args.where })
            : null;
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
            auditCreate("Comment", result, result.projectId ?? undefined).catch(
              (error: any) => {
                console.error(`Failed to audit comment create:`, error);
              }
            );
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.comment.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            auditUpdate(
              "Comment",
              oldEntity,
              result,
              result.projectId ?? undefined
            ).catch((error: any) => {
              console.error(`Failed to audit comment update:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.comment.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete(
              "Comment",
              oldEntity,
              oldEntity.projectId ?? undefined
            ).catch((error: any) => {
              console.error(`Failed to audit comment delete:`, error);
            });
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
            auditCreate("Attachment", result).catch((error: any) => {
              console.error(`Failed to audit attachment create:`, error);
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.attachments.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("Attachment", oldEntity).catch((error: any) => {
              console.error(`Failed to audit attachment delete:`, error);
            });
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
            auditCreate("Integration", result).catch((error: any) => {
              console.error(`Failed to audit integration create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.integration.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            auditUpdate("Integration", oldEntity, result).catch(
              (error: any) => {
                console.error(`Failed to audit integration update:`, error);
              }
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.integration.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("Integration", oldEntity).catch((error: any) => {
              console.error(`Failed to audit integration delete:`, error);
            });
          }
          return result;
        },
      },
      projectIntegration: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditCreate("ProjectIntegration", result, result.projectId).catch(
              (error: any) => {
                console.error(
                  `Failed to audit project integration create:`,
                  error
                );
              }
            );
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
            auditUpdate(
              "ProjectIntegration",
              oldEntity,
              result,
              result.projectId
            ).catch((error: any) => {
              console.error(
                `Failed to audit project integration update:`,
                error
              );
            });
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
            auditDelete(
              "ProjectIntegration",
              oldEntity,
              oldEntity.projectId
            ).catch((error: any) => {
              console.error(
                `Failed to audit project integration delete:`,
                error
              );
            });
          }
          return result;
        },
      },
      promptConfig: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditCreate("PromptConfig", result).catch((error: any) => {
              console.error(`Failed to audit prompt config create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.promptConfig.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            auditUpdate("PromptConfig", oldEntity, result).catch(
              (error: any) => {
                console.error(`Failed to audit prompt config update:`, error);
              }
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.promptConfig.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("PromptConfig", oldEntity).catch((error: any) => {
              console.error(`Failed to audit prompt config delete:`, error);
            });
          }
          return result;
        },
      },
      promptConfigPrompt: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditCreate("PromptConfigPrompt", result).catch((error: any) => {
              console.error(
                `Failed to audit prompt config prompt create:`,
                error
              );
            });
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
            auditUpdate("PromptConfigPrompt", oldEntity, result).catch(
              (error: any) => {
                console.error(
                  `Failed to audit prompt config prompt update:`,
                  error
                );
              }
            );
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
            auditDelete("PromptConfigPrompt", oldEntity).catch((error: any) => {
              console.error(
                `Failed to audit prompt config prompt delete:`,
                error
              );
            });
          }
          return result;
        },
      },
      testRunCases: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            auditCreate("TestRunCases", result).catch((error: any) => {
              console.error(`Failed to audit test run case create:`, error);
            });
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.testRunCases.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            auditUpdate("TestRunCases", oldEntity, result).catch(
              (error: any) => {
                console.error(`Failed to audit test run case update:`, error);
              }
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.testRunCases.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            auditDelete("TestRunCases", oldEntity).catch((error: any) => {
              console.error(`Failed to audit test run case delete:`, error);
            });
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
            captureAuditEvent({
              action: "API_KEY_DELETED",
              entityType: "ApiToken",
              entityId: oldEntity.id,
              entityName: oldEntity.name,
              metadata: {
                tokenPrefix: oldEntity.tokenPrefix,
                tokenOwnerId: oldEntity.userId,
                tokenOwnerEmail: oldEntity.user?.email,
              },
            }).catch((error: any) => {
              console.error(`Failed to audit API token delete:`, error);
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
            captureAuditEvent({
              action: "API_KEY_REVOKED",
              entityType: "ApiToken",
              entityId: result.id,
              entityName: result.name,
              metadata: {
                tokenPrefix: result.tokenPrefix,
                tokenOwnerId: result.userId,
                tokenOwnerEmail: oldEntity.user?.email,
              },
            }).catch((error: any) => {
              console.error(`Failed to audit API token revocation:`, error);
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
            auditBulkUpdate("ApiToken", result.count, args.where).catch(
              (error: any) => {
                console.error(`Failed to audit API token bulk update:`, error);
              }
            );
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
            auditBulkDelete("ApiToken", result.count, args.where).catch(
              (error: any) => {
                console.error(`Failed to audit API token bulk delete:`, error);
              }
            );
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
