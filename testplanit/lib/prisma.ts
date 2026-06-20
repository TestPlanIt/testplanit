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
  auditRoleChange,
  auditPermissionGrant,
  auditPermissionRevoke,
  auditSsoConfigChange,
  auditSystemConfigChange,
  captureAuditEvent,
  isEntityAuditSuppressed,
  AUDITED_CONFIG_MODELS,
  SEMANTIC_ACCESS_AUDIT_MODELS,
} from "./services/auditLog";
import { buildConfigAuditHooks } from "./services/configAuditHooks";
import { invalidateApiTokenCache } from "./api-token-cache";
import { injectAuditGuc } from "~/lib/audit/gucContext";
import { auditTxStore } from "~/lib/audit/auditTxStore";
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

  // Run a write hook's body either on the caller's already-open audited
  // transaction (the GUC was set, and the tx published on auditTxStore, by
  // auditedTransaction) or — when the write is standalone — in a fresh
  // transaction this helper owns with the GUC set first. Reusing the caller's
  // transaction keeps every row it touches (parent + child/value tables)
  // attributed to one actor and preserves atomicity; opening a second nested
  // transaction (the prior behavior) did neither.
  //
  // `write()` performs the mutation: on the ambient transaction it is the inner
  // `query(args)` (so the hook does not re-enter itself); standalone it runs on
  // the owned, un-extended tx. `tx` is for before-image reads, webhook/live
  // emit, and side effects.
  async function withHookTx(
    hook: {
      query: (a: any) => Promise<any>;
      args: any;
      accessor: string;
      op: string;
    },
    body: (tx: any, write: () => Promise<any>) => Promise<any>
  ): Promise<any> {
    const { query, args, accessor, op } = hook;
    const ambient = auditTxStore.getStore();
    if (ambient) {
      return body(ambient as any, () => query(args));
    }
    return baseClient.$transaction(async (tx) => {
      await injectAuditGuc(tx);
      return auditTxStore.run(tx as any, () =>
        body(tx, () => (tx as any)[accessor][op](args))
      );
    });
  }

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

  // Add Elasticsearch sync using client extensions
  const client = baseClient.$extends({
    query: {
      ...configAuditHooks,
      // WebhookConfig is trigger-audited (scripts/trigger-registry.ts) but the
      // webhook-config server actions write it through this hooked client, which
      // has no other reason to wrap webhookConfig. These hooks exist only to set
      // the app.audit_context GUC (via withHookTx) so the trigger records the
      // acting admin rather than __system__. No ES/webhook emit or before-image.
      webhookConfig: {
        async create({ args, query }: any) {
          return withHookTx(
            { query, args, accessor: "webhookConfig", op: "create" },
            async (_tx, write) => write()
          );
        },
        async update({ args, query }: any) {
          return withHookTx(
            { query, args, accessor: "webhookConfig", op: "update" },
            async (_tx, write) => write()
          );
        },
        async delete({ args, query }: any) {
          return withHookTx(
            { query, args, accessor: "webhookConfig", op: "delete" },
            async (_tx, write) => write()
          );
        },
      },
      repositoryCases: {
        async create({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "repositoryCases", op: "create" },
            async (tx, write) => {
              const result = await write();
              if (result?.id) {
                syncRepositoryCaseToElasticsearch(result.id).catch(
                  (error: any) => {
                    console.error(
                      `Failed to sync repository case ${result.id} to Elasticsearch:`,
                      error
                    );
                  }
                );
                if (result.projectId !== undefined) {
                  await emitCaseCreated(result, tx);
                }
              }
              return result;
            }
          );
        },
        async update({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "repositoryCases", op: "update" },
            async (tx, write) => {
              // Fetch old state for emit diff
              const oldEntity = args.where
                ? await tx.repositoryCases.findUnique({ where: args.where })
                : null;
              const result = await write();
              if (result?.id) {
                syncRepositoryCaseToElasticsearch(result.id).catch(
                  (error: any) => {
                    console.error(
                      `Failed to sync repository case ${result.id} to Elasticsearch:`,
                      error
                    );
                  }
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
            }
          );
        },
        async upsert({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "repositoryCases", op: "upsert" },
            async (tx, write) => {
              const oldEntity = args.where
                ? await tx.repositoryCases.findUnique({ where: args.where })
                : null;
              const result = await write();
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
                  if (result.projectId !== undefined) {
                    await emitCaseUpdated(oldEntity, result, tx);
                  }
                } else {
                  if (result.projectId !== undefined) {
                    await emitCaseCreated(result, tx);
                  }
                }
              }
              return result;
            }
          );
        },
        async delete({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "repositoryCases", op: "delete" },
            async (tx, write) => {
              const oldEntity = args.where
                ? await tx.repositoryCases.findUnique({ where: args.where })
                : null;
              const result = await write();
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
                await emitCaseDeleted(oldEntity, tx);
              }
              return result;
            }
          );
        },
      },
      testRuns: {
        async create({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "testRuns", op: "create" },
            async (tx, write) => {
              const result = await write();
              if (result?.id) {
                syncTestRunToElasticsearch(result.id).catch((error: any) => {
                  console.error(
                    `Failed to sync test run ${result.id} to Elasticsearch:`,
                    error
                  );
                });
                if (result.projectId !== undefined) {
                  await emitTestRunCreated(result, tx);
                }
              }
              return result;
            }
          );
        },
        async update({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "testRuns", op: "update" },
            async (tx, write) => {
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

              const result = await write();
              if (result?.id) {
                syncTestRunToElasticsearch(result.id).catch((error: any) => {
                  console.error(
                    `Failed to sync test run ${result.id} to Elasticsearch:`,
                    error
                  );
                });
                if (result.projectId !== undefined) {
                  await emitTestRunUpdateEvents(oldEntity, result, tx);
                }
              }
              return result;
            }
          );
        },
        async delete({ args, query }: any) {
          const result = await query(args);
          return result;
        },
      },
      sessions: {
        async create({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "sessions", op: "create" },
            async (tx, write) => {
              const result = await write();
              if (result?.id) {
                syncSessionToElasticsearch(result.id).catch((error: any) => {
                  console.error(
                    `Failed to sync session ${result.id} to Elasticsearch:`,
                    error
                  );
                });
                if (result.projectId !== undefined) {
                  await emitSessionCreated(result, tx);
                }
              }
              return result;
            }
          );
        },
        async update({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "sessions", op: "update" },
            async (tx, write) => {
              const oldEntity = args.where
                ? await tx.sessions.findUnique({ where: args.where })
                : null;
              const result = await write();
              if (result?.id) {
                syncSessionToElasticsearch(result.id).catch((error: any) => {
                  console.error(
                    `Failed to sync session ${result.id} to Elasticsearch:`,
                    error
                  );
                });
                if (result.projectId !== undefined) {
                  await emitSessionUpdateEvents(oldEntity, result, tx);
                }
              }
              return result;
            }
          );
        },
        async upsert({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "sessions", op: "upsert" },
            async (tx, write) => {
              const oldEntity = args.where
                ? await tx.sessions.findUnique({ where: args.where })
                : null;
              const result = await write();
              if (result?.id) {
                syncSessionToElasticsearch(result.id).catch((error: any) => {
                  console.error(
                    `Failed to sync session ${result.id} to Elasticsearch:`,
                    error
                  );
                });
                if (oldEntity) {
                  if (result.projectId !== undefined) {
                    await emitSessionUpdateEvents(oldEntity, result, tx);
                  }
                } else {
                  if (result.projectId !== undefined) {
                    await emitSessionCreated(result, tx);
                  }
                }
              }
              return result;
            }
          );
        },
        async delete({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncSessionToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync session ${result.id} to Elasticsearch:`,
                error
              );
            });
          }
          return result;
        },
      },
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
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncSharedStepToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync shared step ${result.id} to Elasticsearch:`,
                error
              );
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const result = await query(args);
          return result;
        },
      },
      issue: {
        async create({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "issue", op: "create" },
            async (tx, write) => {
              const result = await write();
              if (result?.id) {
                syncIssueToElasticsearch(result.id).catch((error: any) => {
                  console.error(
                    `Failed to sync issue ${result.id} to Elasticsearch:`,
                    error
                  );
                });
                if (result.projectId !== undefined) {
                  await emitIssueCreated(result, tx);
                }
              }
              return result;
            }
          );
        },
        async update({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "issue", op: "update" },
            async (tx, write) => {
              const oldEntity = args.where
                ? await tx.issue.findUnique({ where: args.where })
                : null;
              const result = await write();
              if (result?.id) {
                syncIssueToElasticsearch(result.id).catch((error: any) => {
                  console.error(
                    `Failed to sync issue ${result.id} to Elasticsearch:`,
                    error
                  );
                });
                if (result.projectId !== undefined) {
                  await emitIssueUpdated(oldEntity, result, tx);
                }
              }
              return result;
            }
          );
        },
        async upsert({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "issue", op: "upsert" },
            async (tx, write) => {
              const oldEntity = args.where
                ? await tx.issue.findUnique({ where: args.where })
                : null;
              const result = await write();
              if (result?.id) {
                syncIssueToElasticsearch(result.id).catch((error: any) => {
                  console.error(
                    `Failed to sync issue ${result.id} to Elasticsearch:`,
                    error
                  );
                });
                if (oldEntity) {
                  if (result.projectId !== undefined) {
                    await emitIssueUpdated(oldEntity, result, tx);
                  }
                } else {
                  if (result.projectId !== undefined) {
                    await emitIssueCreated(result, tx);
                  }
                }
              }
              return result;
            }
          );
        },
        async delete({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "issue", op: "delete" },
            async (tx, write) => {
              const oldEntity = args.where
                ? await tx.issue.findUnique({ where: args.where })
                : null;
              const result = await write();
              if (oldEntity) {
                await emitIssueDeleted(oldEntity, tx);
              }
              return result;
            }
          );
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
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncMilestoneToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync milestone ${result.id} to Elasticsearch:`,
                error
              );
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const result = await query(args);
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
          }
          return result;
        },
        async update({ args, query }: any) {
          const result = await query(args);
          if (result?.id) {
            syncProjectToElasticsearch(result.id).catch((error: any) => {
              console.error(
                `Failed to sync project ${result.id} to Elasticsearch:`,
                error
              );
            });
          }
          return result;
        },
        async delete({ args, query }: any) {
          const result = await query(args);
          return result;
        },
      },
      // =============================================================================
      // Phase 1: Security & Access Control Audit Logging
      // =============================================================================
      user: {
        async update({ args, query }: any) {
          // Skip audit for session keep-alive writes (throttled lastActiveAt
          // pings from the session callback). Auditing these produces a log
          // entry every 5 minutes per active user with no security value.
          const dataKeys = args.data ? Object.keys(args.data) : [];
          const isLastActiveOnly =
            dataKeys.length === 1 && dataKeys[0] === "lastActiveAt";
          // The CDC trigger on User is the sole source for access-tier changes;
          // the ROLE_CHANGED semantic event is decommissioned (empty set), so the
          // hook is a pass-through and skips the now-pointless old-entity fetch.
          if (isLastActiveOnly || !SEMANTIC_ACCESS_AUDIT_MODELS.has("User")) {
            return query(args);
          }

          const oldEntity = args.where
            ? await baseClient.user.findUnique({ where: args.where })
            : null;
          const result = await query(args);
          if (result?.id) {
            if (oldEntity && oldEntity.access !== result.access) {
              await auditRoleChange(
                result.id,
                oldEntity.access,
                result.access,
                result.email
              );
            }
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
          if (
            SEMANTIC_ACCESS_AUDIT_MODELS.has("UserProjectPermission") &&
            result?.id
          ) {
            await auditPermissionGrant(
              "UserProjectPermission",
              result,
              result.projectId
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity =
            SEMANTIC_ACCESS_AUDIT_MODELS.has("UserProjectPermission") &&
            args.where
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
          if (
            SEMANTIC_ACCESS_AUDIT_MODELS.has("GroupProjectPermission") &&
            result?.id
          ) {
            await auditPermissionGrant(
              "GroupProjectPermission",
              result,
              result.projectId
            );
          }
          return result;
        },
        async delete({ args, query }: any) {
          const oldEntity =
            SEMANTIC_ACCESS_AUDIT_MODELS.has("GroupProjectPermission") &&
            args.where
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
      testRunResults: {
        async create({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "testRunResults", op: "create" },
            async (tx, write) => {
              const result = await write();
              if (result?.id) {
                if (result.testRunId !== undefined) {
                  await emitTestRunResultAdded(result, tx);
                }
              }
              return result;
            }
          );
        },
        async update({ args, query }: any) {
          const result = await query(args);
          return result;
        },
        async delete({ args, query }: any) {
          const result = await query(args);
          return result;
        },
      },
      // Plan 02-05 Warning-9 fix — NEW hook block for SessionResults. The
      // model had no $extends entry today.
      // We add only the webhook emit here; audit can slot in later as a
      // sibling line if SessionResults coverage is desired.
      sessionResults: {
        async create({ args, query }: any) {
          return await withHookTx(
            { query, args, accessor: "sessionResults", op: "create" },
            async (tx, write) => {
              const result = await write();
              if (result?.id && result.sessionId !== undefined) {
                await emitSessionResultAdded(result, tx);
              }
              return result;
            }
          );
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
          const affected = args.where
            ? await baseClient.apiToken.findMany({
                where: args.where,
                select: { token: true },
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
          return result;
        },
        async deleteMany({ args, query }: any) {
          const affected = args.where
            ? await baseClient.apiToken.findMany({
                where: args.where,
                select: { token: true },
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
