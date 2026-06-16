// app/lib/prisma.ts
import { PrismaClient, WorkflowType } from "@prisma/client";
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
  auditEntity,
  auditRoleChange,
  auditPermissionGrant,
  auditPermissionRevoke,
  auditSsoConfigChange,
  auditSystemConfigChange,
  auditBulkCreate,
  auditBulkUpdate,
  auditBulkDelete,
  captureAuditEvent,
  isEntityAuditSuppressed,
  resolveTestRunResultAuditScope,
  AUDITED_CONFIG_MODELS,
} from "./services/auditLog";
import { buildConfigAuditHooks } from "./services/configAuditHooks";
import {
  buildEntityAuditHooks,
  ENTITY_AUDIT_MODELS,
} from "./services/entityAuditHooks";
import { invalidateApiTokenCache } from "./api-token-cache";
// Plan 02-05 — outbound webhook emitters spliced alongside the existing
// audit/ES-sync calls. Each emit is bound to a Prisma.TransactionClient
// constructed inside an explicit baseClient.$transaction wrapper (Blocker 3
// fix — see Plan 02-05 02-CONTEXT D-01 for the crash-safety reasoning).
import {
  emitTestRunCreated,
  emitTestRunResultAdded,
  emitTestRunUpdateEvents,
} from "./webhooks/event-emitters/testRunEvents";
import {
  emitSessionCreated,
  emitSessionResultAdded,
  emitSessionUpdateEvents,
} from "./webhooks/event-emitters/sessionEvents";
import {
  emitIssueCreated,
  emitIssueDeleted,
  emitIssueUpdated,
} from "./webhooks/event-emitters/issueEvents";
import {
  emitCaseCreated,
  emitCaseDeleted,
  emitCaseUpdated,
} from "./webhooks/event-emitters/caseEvents";

// An attachment hangs off exactly one of several optional parents (a case,
// session, run, or one of their results). It has no scalar projectId column and
// no single relation chain to a project, so it is intentionally absent from the
// audit project-scope backfill. To keep attachment events traceable to their
// owning context, record whichever parent FK is set on the audit row's metadata
// (read from the committed row on delete, or the create payload on the partial
// ZenStack RPC create path). Returns undefined for an orphan attachment so no
// empty `parent` object is stamped.
const ATTACHMENT_PARENT_FKS = [
  "testCaseId",
  "sessionId",
  "sessionResultsId",
  "testRunsId",
  "testRunResultsId",
  "testRunStepResultId",
  "junitTestResultId",
] as const;
function attachmentParentMetadata(
  ...sources: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> | undefined {
  const parent: Record<string, unknown> = {};
  for (const key of ATTACHMENT_PARENT_FKS) {
    if (key in parent) continue;
    for (const source of sources) {
      const value = source?.[key];
      if (value != null) {
        parent[key] = value;
        break;
      }
    }
  }
  return Object.keys(parent).length > 0 ? { parent } : undefined;
}

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

  // Generic audit hooks for admin-managed configuration/catalog models. These
  // models need only audit logging (no Elasticsearch sync, webhook emit, or
  // transaction wrapping), so a single factory (lib/services/configAuditHooks)
  // mirrors the per-model pattern used by the hand-written blocks below. The
  // driving list lives in AUDITED_CONFIG_MODELS (lib/services/auditLog.ts) and
  // is validated against the datamodel in tests — a mistyped accessor would
  // otherwise be silent dead code because the `$extends` block is cast `as any`.
  const configAuditHooks: Record<string, unknown> = Object.fromEntries(
    AUDITED_CONFIG_MODELS.map((cfg) => [
      cfg.accessor,
      buildConfigAuditHooks(cfg, (baseClient as any)[cfg.accessor]),
    ])
  );

  // Generic re-read audit hooks for the entity models whose ZenStack RPC
  // mutation result is a partial { id } row (Integration, PromptConfig and the
  // ProjectIntegration / TestRunCases link models). The factory resolves a
  // human display name + full diff on every write path (RPC and direct Prisma),
  // using only pre-reads / committed FK lookups so it is correct inside
  // interactive transactions. The driving list lives in ENTITY_AUDIT_MODELS
  // (lib/services/entityAuditHooks.ts) and is validated against the datamodel
  // in tests, mirroring the configAuditHooks pattern above.
  const entityAuditHooks: Record<string, unknown> = Object.fromEntries(
    ENTITY_AUDIT_MODELS.map((cfg) => [
      cfg.accessor,
      buildEntityAuditHooks(cfg, {
        self: (baseClient as any)[cfg.accessor],
        related: cfg.relatedAccessor
          ? (baseClient as any)[cfg.relatedAccessor]
          : undefined,
      }),
    ])
  );

  // Add Elasticsearch sync using client extensions
  const client = baseClient.$extends({
    query: {
      ...configAuditHooks,
      ...entityAuditHooks,
      repositoryCases: {
        // Plan 02-05 Blocker 3 — wrap entity write + emit in an explicit
        // baseClient.$transaction so both commit-or-rollback atomically.
        // Existing audit/ES-sync calls keep their async-via-queue /
        // fire-and-forget shape inside the closure (they don't need tx
        // binding for their own correctness).
        async create({ args, query }: any) {
          return await baseClient.$transaction(async (tx) => {
            const result = await query(args);
            if (result?.id) {
              syncRepositoryCaseToElasticsearch(result.id).catch(
                (error: any) => {
                  console.error(
                    `Failed to sync repository case ${result.id} to Elasticsearch:`,
                    error
                  );
                }
              );
              await auditCreate("RepositoryCases", result, result.projectId);
              if (result.projectId !== undefined) {
                await emitCaseCreated(result, tx);
              }
            }
            return result;
          });
        },
        async update({ args, query }: any) {
          return await baseClient.$transaction(async (tx) => {
            // Fetch old state for audit diff
            const oldEntity = args.where
              ? await tx.repositoryCases.findUnique({ where: args.where })
              : null;
            const result = await query(args);
            if (result?.id) {
              syncRepositoryCaseToElasticsearch(result.id).catch(
                (error: any) => {
                  console.error(
                    `Failed to sync repository case ${result.id} to Elasticsearch:`,
                    error
                  );
                }
              );
              await auditUpdate(
                "RepositoryCases",
                oldEntity,
                result,
                result.projectId
              );
              if (result.projectId !== undefined) {
                await emitCaseUpdated(oldEntity, result, tx);
              }
              // Per-project "exclude draft cases from runs" hook: when the
              // case's state transitions to a Workflows row of type
              // NOT_STARTED AND the project has the flag on, soft-delete the
              // case's UNEXECUTED entries in any open run. Executed run-cases
              // (one with at least one TestRunResults row) are left in place
              // so the recorded outcome stays visible; the existing edit-
              // window machinery already locks them. Inside the same
              // transaction so the soft-deletes commit-or-rollback with the
              // state change. See `Projects.excludeNotStartedFromRuns` in
              // schema.zmodel for the contract.
              if (
                oldEntity &&
                result.stateId !== oldEntity.stateId &&
                result.projectId !== undefined
              ) {
                const project = await tx.projects.findUnique({
                  where: { id: result.projectId },
                  select: { excludeNotStartedFromRuns: true },
                });
                if (project?.excludeNotStartedFromRuns) {
                  const newState = await tx.workflows.findUnique({
                    where: { id: result.stateId },
                    select: { workflowType: true },
                  });
                  if (newState?.workflowType === WorkflowType.NOT_STARTED) {
                    await tx.testRunCases.updateMany({
                      where: {
                        repositoryCaseId: result.id,
                        isDeleted: false,
                        testRun: { isCompleted: false },
                        results: { none: {} },
                      },
                      data: { isDeleted: true },
                    });
                  }
                }
              }
            }
            return result;
          });
        },
        async upsert({ args, query }: any) {
          return await baseClient.$transaction(async (tx) => {
            const oldEntity = args.where
              ? await tx.repositoryCases.findUnique({ where: args.where })
              : null;
            const result = await query(args);
            if (result?.id) {
              syncRepositoryCaseToElasticsearch(result.id).catch(
                (error: any) => {
                  console.error(
                    `Failed to sync repository case ${result.id} to Elasticsearch:`,
                    error
                  );
                }
              );
              if (oldEntity) {
                await auditUpdate(
                  "RepositoryCases",
                  oldEntity,
                  result,
                  result.projectId
                );
                if (result.projectId !== undefined) {
                  await emitCaseUpdated(oldEntity, result, tx);
                }
              } else {
                await auditCreate("RepositoryCases", result, result.projectId);
                if (result.projectId !== undefined) {
                  await emitCaseCreated(result, tx);
                }
              }
            }
            return result;
          });
        },
        async delete({ args, query }: any) {
          return await baseClient.$transaction(async (tx) => {
            const oldEntity = args.where
              ? await tx.repositoryCases.findUnique({ where: args.where })
              : null;
            const result = await query(args);
            if (result?.id) {
              syncRepositoryCaseToElasticsearch(result.id).catch(
                (error: any) => {
                  console.error(
                    `Failed to sync repository case ${result.id} to Elasticsearch after delete:`,
                    error
                  );
                }
              );
            }
            if (oldEntity) {
              await auditDelete(
                "RepositoryCases",
                oldEntity,
                oldEntity.projectId
              );
              await emitCaseDeleted(oldEntity, tx);
            }
            return result;
          });
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
          return await baseClient.$transaction(async (tx) => {
            const result = await query(args);
            if (result?.id) {
              syncTestRunToElasticsearch(result.id).catch((error: any) => {
                console.error(
                  `Failed to sync test run ${result.id} to Elasticsearch:`,
                  error
                );
              });
              await auditCreate("TestRuns", result, result.projectId);
              if (result.projectId !== undefined) {
                await emitTestRunCreated(result, tx);
              }
            }
            return result;
          });
        },
        async update({ args, query }: any) {
          return await baseClient.$transaction(async (tx) => {
            const oldEntity = args.where
              ? await tx.testRuns.findUnique({ where: args.where })
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
              await auditUpdate(
                "TestRuns",
                oldEntity,
                result,
                result.projectId
              );
              if (result.projectId !== undefined) {
                await emitTestRunUpdateEvents(oldEntity, result, tx);
              }
            }
            return result;
          });
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
          return await baseClient.$transaction(async (tx) => {
            const result = await query(args);
            if (result?.id) {
              syncSessionToElasticsearch(result.id).catch((error: any) => {
                console.error(
                  `Failed to sync session ${result.id} to Elasticsearch:`,
                  error
                );
              });
              await auditCreate("Sessions", result, result.projectId);
              if (result.projectId !== undefined) {
                await emitSessionCreated(result, tx);
              }
            }
            return result;
          });
        },
        async update({ args, query }: any) {
          return await baseClient.$transaction(async (tx) => {
            const oldEntity = args.where
              ? await tx.sessions.findUnique({ where: args.where })
              : null;
            const result = await query(args);
            if (result?.id) {
              syncSessionToElasticsearch(result.id).catch((error: any) => {
                console.error(
                  `Failed to sync session ${result.id} to Elasticsearch:`,
                  error
                );
              });
              await auditUpdate(
                "Sessions",
                oldEntity,
                result,
                result.projectId
              );
              if (result.projectId !== undefined) {
                await emitSessionUpdateEvents(oldEntity, result, tx);
              }
            }
            return result;
          });
        },
        async upsert({ args, query }: any) {
          return await baseClient.$transaction(async (tx) => {
            const oldEntity = args.where
              ? await tx.sessions.findUnique({ where: args.where })
              : null;
            const result = await query(args);
            if (result?.id) {
              syncSessionToElasticsearch(result.id).catch((error: any) => {
                console.error(
                  `Failed to sync session ${result.id} to Elasticsearch:`,
                  error
                );
              });
              if (oldEntity) {
                await auditUpdate(
                  "Sessions",
                  oldEntity,
                  result,
                  result.projectId
                );
                if (result.projectId !== undefined) {
                  await emitSessionUpdateEvents(oldEntity, result, tx);
                }
              } else {
                await auditCreate("Sessions", result, result.projectId);
                if (result.projectId !== undefined) {
                  await emitSessionCreated(result, tx);
                }
              }
            }
            return result;
          });
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
      // Keyed to the Prisma client field `sharedStepGroup` (singular). A prior
      // `sharedStepGroups:` (plural) key never matched the delegate, so the
      // audit + ES-sync side effects below were dead on every shared-step-group
      // mutation — the same class of bug fixed for `issue` below.
      sharedStepGroup: {
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
      // Plan 02-05 Rule-1 fix: this hook block was previously keyed `issues:`
      // (plural) which never matched the Prisma client field (`prisma.issue`,
      // singular). The audit + ES-sync side effects below were therefore
      // dead code on every Issue mutation. Renaming to the correct singular
      // key activates BOTH the existing audit/ES sync AND the new webhook
      // emit. Documented as a deviation in the SUMMARY.
      issue: {
        async create({ args, query }: any) {
          return await baseClient.$transaction(async (tx) => {
            const result = await query(args);
            if (result?.id) {
              syncIssueToElasticsearch(result.id).catch((error: any) => {
                console.error(
                  `Failed to sync issue ${result.id} to Elasticsearch:`,
                  error
                );
              });
              await auditCreate("Issue", result, result.projectId);
              if (result.projectId !== undefined) {
                await emitIssueCreated(result, tx);
              }
            }
            return result;
          });
        },
        async update({ args, query }: any) {
          return await baseClient.$transaction(async (tx) => {
            const oldEntity = args.where
              ? await tx.issue.findUnique({ where: args.where })
              : null;
            const result = await query(args);
            if (result?.id) {
              syncIssueToElasticsearch(result.id).catch((error: any) => {
                console.error(
                  `Failed to sync issue ${result.id} to Elasticsearch:`,
                  error
                );
              });
              await auditUpdate("Issue", oldEntity, result, result.projectId);
              if (result.projectId !== undefined) {
                await emitIssueUpdated(oldEntity, result, tx);
              }
            }
            return result;
          });
        },
        async upsert({ args, query }: any) {
          // Mirror the repositoryCases/testRuns/sessions upsert pattern:
          // pre-fetch oldEntity so we can branch into create-vs-update emit.
          // The Jira integration's /api/integrations/[id]/create-issue route
          // uses upsert (so a re-link of an existing Jira ticket doesn't
          // create a duplicate row) — without this hook, audit + emit were
          // silently skipped.
          return await baseClient.$transaction(async (tx) => {
            const oldEntity = args.where
              ? await tx.issue.findUnique({ where: args.where })
              : null;
            const result = await query(args);
            if (result?.id) {
              syncIssueToElasticsearch(result.id).catch((error: any) => {
                console.error(
                  `Failed to sync issue ${result.id} to Elasticsearch:`,
                  error
                );
              });
              if (oldEntity) {
                await auditUpdate("Issue", oldEntity, result, result.projectId);
                if (result.projectId !== undefined) {
                  await emitIssueUpdated(oldEntity, result, tx);
                }
              } else {
                await auditCreate("Issue", result, result.projectId);
                if (result.projectId !== undefined) {
                  await emitIssueCreated(result, tx);
                }
              }
            }
            return result;
          });
        },
        async delete({ args, query }: any) {
          return await baseClient.$transaction(async (tx) => {
            const oldEntity = args.where
              ? await tx.issue.findUnique({ where: args.where })
              : null;
            const result = await query(args);
            if (oldEntity) {
              await auditDelete(
                "Issue",
                oldEntity,
                oldEntity.projectId ?? undefined
              );
              await emitIssueDeleted(oldEntity, tx);
            }
            return result;
          });
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
      // On the ZenStack RPC path the route's shim emits the canonical
      // SSO_CONFIG_CHANGED row, so these hooks gate on suppression to avoid a
      // second, partial row. They still fire for non-RPC writes (workers,
      // custom routes, direct prisma).
      ssoProvider: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id && !isEntityAuditSuppressed()) {
            await auditSsoConfigChange("CREATE", result);
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          if (result?.id && !isEntityAuditSuppressed()) {
            await auditSsoConfigChange("UPDATE", result);
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.ssoProvider.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity && !isEntityAuditSuppressed()) {
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
      // On the ZenStack RPC path the route's shim emits the canonical
      // SYSTEM_CONFIG_CHANGED row, so these hooks gate on suppression to avoid a
      // second, partial row. They still fire for non-RPC writes.
      appConfig: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.key && !isEntityAuditSuppressed()) {
            await auditSystemConfigChange(result.key, null, result.value);
          }
          return result;
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.appConfig.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.key && !isEntityAuditSuppressed()) {
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
          if (oldEntity && !isEntityAuditSuppressed()) {
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
      // A test run result is audited under the plural model name
      // `TestRunResults` (matching every other entityType) regardless of which
      // path mutated it. It carries no projectId or name column of its own, so
      // both are resolved from its parents (run -> projectId, case ->
      // repository case name) via resolveTestRunResultAuditScope. auditEntity
      // diffs the scalar row while taking the resolved name/projectId
      // explicitly, so the nested relations never leak into the change set.
      testRunResults: {
        async create({ args, query }: any) {
          return await baseClient.$transaction(async (tx) => {
            const result = await query(args);
            if (result?.id) {
              const scope = await resolveTestRunResultAuditScope(
                baseClient,
                result
              );
              await auditEntity({
                action: "CREATE",
                entityType: "TestRunResults",
                entityId: String(result.id),
                entityName: scope.entityName,
                newRow: result,
                projectId: scope.projectId,
              });
              if (result.testRunId !== undefined) {
                await emitTestRunResultAdded(result, tx);
              }
            }
            return result;
          });
        },
        async update({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.testRunResults.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            const scope = await resolveTestRunResultAuditScope(
              baseClient,
              result
            );
            await auditEntity({
              action: "UPDATE",
              entityType: "TestRunResults",
              entityId: String(result.id),
              entityName: scope.entityName,
              oldRow: oldEntity,
              newRow: result,
              projectId: scope.projectId,
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.testRunResults.findUnique({ where: args.where })
            : null;
          // Resolve scope while the row (and its FKs) still exists.
          const scope = oldEntity
            ? await resolveTestRunResultAuditScope(baseClient, oldEntity)
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditEntity({
              action: "DELETE",
              entityType: "TestRunResults",
              entityId: String(oldEntity.id),
              entityName: scope?.entityName,
              oldRow: oldEntity,
              projectId: scope?.projectId,
            });
          }
          return result;
        },
      },
      // Plan 02-05 Warning-9 fix — NEW hook block for SessionResults. The
      // model had no $extends entry today.
      // We add only the webhook emit here; audit can slot in later as a
      // sibling line if SessionResults coverage is desired.
      sessionResults: {
        async create({ args, query }: any) {
          return await baseClient.$transaction(async (tx) => {
            const result = await query(args);
            if (result?.id && result.sessionId !== undefined) {
              await emitSessionResultAdded(result, tx);
            }
            return result;
          });
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
      // Keyed to the Prisma client field `attachments` (the model is named
      // `Attachments`); a prior `attachment:` (singular) key never matched the
      // delegate, so attachment audit was dead on every upload/delete.
      // Audit parity exempt: attachments.update is not hooked because
      // attachments are immutable once uploaded (no in-place mutation path).
      // Matches the lastActiveAt precedent at lib/prisma.ts:693-701.
      attachments: {
        async create({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            // The RPC create result is a partial { id }, so the display name
            // must come from the create payload (the file name the client
            // sent); fall back to the result on the direct-Prisma path. Resolve
            // it here rather than leaning on the worker re-read so the name is
            // never lost, and pass only id + name to keep the BigInt `size`
            // column out of the serialized diff. The owning parent FK rides
            // along in metadata for project traceability.
            await auditCreate(
              "Attachments",
              { id: result.id, name: args?.data?.name ?? result.name },
              undefined,
              attachmentParentMetadata(result, args?.data)
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity = args.where
            ? await baseClient.attachments.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (oldEntity) {
            await auditDelete(
              "Attachments",
              { id: oldEntity.id, name: oldEntity.name },
              undefined,
              attachmentParentMetadata(oldEntity)
            );
          }
          return result;
        },
      },
      // =============================================================================
      // Phase 62: Prompt Configuration prompts
      // Integration, ProjectIntegration, PromptConfig and TestRunCases are
      // audited via buildEntityAuditHooks (ENTITY_AUDIT_MODELS) wired above.
      // =============================================================================
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
            // The RPC route's shim maps apiToken delete to API_KEY_DELETED;
            // gate here so we don't emit a duplicate on that path. Cache
            // eviction below must run regardless of audit suppression.
            if (!isEntityAuditSuppressed()) {
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
            }
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
          // Check if token was revoked (isActive changed from true to false).
          // The RPC route's shim maps the revoke update to API_KEY_REVOKED, so
          // gate here to avoid a duplicate on that path.
          if (
            oldEntity &&
            result &&
            oldEntity.isActive === true &&
            result.isActive === false &&
            !isEntityAuditSuppressed()
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
