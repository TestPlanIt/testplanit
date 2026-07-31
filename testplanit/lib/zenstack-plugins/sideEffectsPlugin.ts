// lib/zenstack-plugins/sideEffectsPlugin.ts
//
// v3 ORM plugin carrying the write-side effects that lived in the v2
// lib/db.ts `$extends({ query: { ... } })` block, ported to match the CDC
// branch's behaviour. After the CDC audit refactor the generic config/access
// audit hooks are gone (AUDITED_CONFIG_MODELS and SEMANTIC_ACCESS_AUDIT_MODELS
// are both empty — CDC triggers are the sole source for row-level audit), so
// what remains here is:
//
//   - Elasticsearch sync          (fire-and-forget, by model)
//   - outbound webhook emission    (atomic with the write, in-transaction)
//   - the app.audit_context GUC bridge so the CDC trigger attributes the actor
//     for standalone hooked-client writes (parity with v2 `withHookTx`)
//   - write-time business logic    (auto-completedAt, draft-case run exclusion)
//   - the remaining semantic audit events (SSO / system-config change) and the
//     API-token auth-cache eviction
//
// v2 -> v3 mapping:
//   - arg-mutating business logic            -> onQuery (can rewrite args)
//   - GUC SET LOCAL + before-image load      -> beforeEntityMutation
//       (its client runs inside the mutation's transaction)
//   - webhook emit / ES sync / in-tx writes  -> afterEntityMutation with
//       runAfterMutationWithinTransaction: true (so emits commit-or-roll-back
//       with the write; the v2 `proceed()`-inside-$transaction trick does NOT
//       enrol the write — proven in the Phase 0 spike).
//
// Runtime behaviours that differ from a single-op `$extends` and are validated
// by the Phase 7 E2E pass: GUC attribution lands in the mutation's tx via the
// before-hook client; onEntityMutation fires once per affected entity, so we
// iterate (v2 only hooked single-row operations).
import { definePlugin } from "@zenstackhq/orm";
import { schema } from "~/zenstack/schema";
import type { TxClient } from "~/lib/zenstack";
import { injectAuditGuc } from "~/lib/audit/gucContext";
import { auditTxStore } from "~/lib/audit/auditTxStore";
import { getAuditContext } from "~/lib/auditContext";
import {
  announceDeletionCancelledReviews,
  cancelReviewsForDeletedEntities,
} from "~/lib/services/reviewCancellation";
import { WorkflowType } from "~/zenstack/models";

import { syncRepositoryCaseToElasticsearch } from "~/services/repositoryCaseSync";
import { syncTestRunToElasticsearch } from "~/services/testRunSearch";
import { syncSessionToElasticsearch } from "~/services/sessionSearch";
import { syncSharedStepToElasticsearch } from "~/services/sharedStepSearch";
import { syncIssueToElasticsearch } from "~/services/issueSearch";
import { syncMilestoneToElasticsearch } from "~/services/milestoneSearch";
import { syncProjectToElasticsearch } from "~/services/projectSearch";

import {
  emitTestRunCreated,
  emitTestRunDuplicated,
  emitTestRunResultAdded,
  emitJUnitResultAdded,
  emitTestRunUpdateEvents,
} from "~/lib/webhooks/event-emitters/testRunEvents";
import {
  emitSessionCreated,
  emitSessionDuplicated,
  emitSessionResultAdded,
  emitSessionUpdateEvents,
} from "~/lib/webhooks/event-emitters/sessionEvents";
import {
  emitIssueCreated,
  emitIssueDeleted,
  emitIssueUpdated,
} from "~/lib/webhooks/event-emitters/issueEvents";
import {
  emitCaseCreated,
  emitCaseDeleted,
  emitCaseUpdated,
} from "~/lib/webhooks/event-emitters/caseEvents";

import {
  auditSsoConfigChange,
  auditSystemConfigChange,
  captureAuditEvent,
  isEntityAuditSuppressed,
} from "~/lib/services/auditLog";
import { invalidateApiTokenCache } from "~/lib/api-token-cache";

// Models whose standalone hooked-client writes set the app.audit_context GUC so
// the CDC trigger records the acting user. When the write is already inside an
// `auditedTransaction` the GUC was set as that transaction's first statement, so
// the beforeEntityMutation gate skips a redundant SET LOCAL.
//
// A user-editable audited root entity edited directly via the model API (not an
// auditedTransaction) MUST appear here, or the CDC trigger records a null actor
// and the change is mis-attributed to `__system__` — general entity edits are
// CDC-only (ENTITY_AUDIT_MODELS / AUDITED_CONFIG_MODELS are both empty). Entities
// that instead emit an app-layer `captureAuditEvent`/`auditSystemConfigChange`
// for their edits are left OUT to avoid double-logging the same change: User,
// Groups, ApiToken, DataSet, ReviewRequest, SsoProvider, AppConfig, WebhookDelivery.
export const GUC_MODELS = new Set<string>([
  // Content root entities.
  "RepositoryCases",
  "TestRuns",
  "TestRunResults",
  "Sessions",
  "SessionResults",
  "Milestones",
  "Projects",
  "Issue",
  "Comment",
  "SharedStepGroup",
  "WebhookConfig",
  // Admin-config catalog — CDC-only, no semantic (captureAuditEvent /
  // auditSystemConfigChange) coverage for general edits, so no double-logging.
  "Workflows",
  "Status",
  "CaseFields",
  "ResultFields",
  "FieldOptions",
  "Tags",
  "Templates",
  "CaseExportTemplate",
  "Roles",
  "MilestoneTypes",
  "ConfigCategories",
  "ConfigVariants",
  "Configurations",
  "Integration",
  "LlmIntegration",
  "CodeRepository",
  "SamlConfiguration",
  "LlmProviderConfig",
  "LlmFeatureConfig",
  "OllamaModelRegistry",
  "PromptConfig",
  "AllowedEmailDomain",
  // Child/value/link tables mutated as TOP-LEVEL operations (a case save issues
  // standalone caseFieldValues/tag/issue-link writes; run execution writes step
  // results directly). Their CDC rows roll up to the owning root entity, but the
  // rollup only groups rows that share an operationId — which, like the actor,
  // comes from the GUC. Without these entries a case save materializes attributed
  // RepositoryCases rows plus orphaned __system__ child rows (ew, 2026-07-31).
  "CaseFieldValues",
  "Steps",
  "TestCaseParameter",
  "RepositoryCaseTag",
  "RepositoryCaseIssue",
  "Attachments",
  "TestRunCases",
  "TestRunCaseIteration",
  "TestRunStepResults",
  "ResultFieldValues",
  "SessionFieldValues",
  // Project-setup/config assignment tables — bulk-written on project create and
  // edited standalone from the admin pages.
  "ProjectAssignment",
  "ProjectWorkflowAssignment",
  "ProjectStatusAssignment",
  "ProjectConfigurationAssignment",
  "MilestoneTypesAssignment",
  "IntegrationProject",
  "ProjectIntegration",
  "ProjectLlmIntegration",
  "ProjectCodeRepositoryConfig",
  "PromptConfigPrompt",
  // Access/permission tables: their semantic audit events are decommissioned —
  // the CDC row is the SOLE record of an access change (see lib/audit/
  // correlation.ts ACCESS_LABEL_COLS), so it must carry the acting user.
  "UserProjectPermission",
  "GroupProjectPermission",
  "GroupAssignment",
  "RolePermission",
]);

// Models that need their before-image for an update/delete diff or emit.
const BEFORE_IMAGE_MODELS = new Set<string>([
  "RepositoryCases",
  "TestRuns",
  "Sessions",
  "Issue",
  "ApiToken",
  "AppConfig",
  "SsoProvider",
]);

/** Soft-deletable models mapped to the `ReviewRequest.entityType` discriminator. */
const REVIEWABLE_ENTITY_TYPE = {
  RepositoryCases: "CASE",
  TestRuns: "RUN",
  Sessions: "SESSION",
} as const;

/**
 * Cancel the review requests a soft-delete leaves in flight. Fires on the
 * false → true `isDeleted` edge only, so a re-save can't re-cancel or
 * re-notify. Names come off the before-image for the notification copy.
 */
async function cancelReviewsForSoftDeleted(
  tx: TxClient,
  model: keyof typeof REVIEWABLE_ENTITY_TYPE,
  before: any[],
  after: any[]
): Promise<void> {
  const names = new Map<number, string>();
  for (let i = 0; i < after.length; i++) {
    const row = after[i];
    const old = before[i] ?? null;
    if (!row?.id) continue;
    if (row.isDeleted !== true || old?.isDeleted !== false) continue;
    names.set(row.id, old.name ?? row.name ?? "");
  }
  if (names.size === 0) return;

  const cancelled = await cancelReviewsForDeletedEntities(
    tx,
    REVIEWABLE_ENTITY_TYPE[model],
    [...names.keys()]
  );
  if (cancelled.length === 0) return;

  // Snapshot the actor before detaching — the AsyncLocalStorage frame may not
  // still be current when the promise runs.
  const ctx = getAuditContext();
  void announceDeletionCancelledReviews(cancelled, names, {
    userId: ctx?.userId ?? null,
    userName: ctx?.userName ?? null,
  }).catch((error) =>
    console.error(
      `Failed to announce reviews cancelled by ${model} soft-delete:`,
      error
    )
  );
}

function logEsError(kind: string, id: unknown) {
  return (error: unknown) =>
    console.error(
      `Failed to sync ${kind} ${String(id)} to Elasticsearch:`,
      error
    );
}

export const sideEffectsPlugin = definePlugin(schema, {
  id: "testplanit-side-effects",

  // Arg-rewriting business logic that must run before the write SQL.
  onQuery: async ({ model, operation, args, proceed }) => {
    if (
      model === "TestRuns" &&
      (operation === "update" || operation === "upsert")
    ) {
      const data = (args as { data?: Record<string, unknown> } | undefined)
        ?.data;
      // Auto-set completedAt when isCompleted flips to true.
      if (data && data.isCompleted === true && !data.completedAt) {
        data.completedAt = new Date();
      }
    }
    return proceed(args as never);
  },

  onEntityMutation: {
    runAfterMutationWithinTransaction: true,

    beforeEntityMutation: async ({
      model,
      client,
      loadBeforeMutationEntities,
    }) => {
      // Set the audit-context GUC inside the mutation's transaction so the CDC
      // trigger attributes the originating actor. Skip when an audited
      // transaction already set it (auditTxStore is populated).
      if (GUC_MODELS.has(model) && !auditTxStore.getStore()) {
        await injectAuditGuc(client as unknown as TxClient);
      }
      // Capture the before-image inside the mutation's transaction for
      // update/delete diffs and emits.
      if (BEFORE_IMAGE_MODELS.has(model)) {
        await loadBeforeMutationEntities();
      }
    },

    afterEntityMutation: async ({
      model,
      action,
      client,
      loadAfterMutationEntities,
      beforeMutationEntities,
    }) => {
      const tx = client as unknown as TxClient;

      const after = ((await loadAfterMutationEntities()) ?? []) as any[];

      const before = (beforeMutationEntities ?? []) as any[];

      switch (model) {
        case "RepositoryCases": {
          if (action === "delete") {
            for (const old of before) {
              if (!old?.id) continue;
              syncRepositoryCaseToElasticsearch(old.id).catch(
                logEsError("repository case", old.id)
              );
              await emitCaseDeleted(old, tx);
            }
            break;
          }
          for (let i = 0; i < after.length; i++) {
            const row = after[i];
            const old = before[i] ?? null;
            if (!row?.id) continue;
            syncRepositoryCaseToElasticsearch(row.id).catch(
              logEsError("repository case", row.id)
            );
            if (row.projectId != null) {
              if (old) await emitCaseUpdated(old, row, tx);
              else await emitCaseCreated(row, tx);
            }
            // Per-project "exclude draft cases from runs": when the case state
            // transitions to a NOT_STARTED workflow and the project flag is on,
            // soft-delete the case's unexecuted entries in open runs. In-tx so
            // it commits-or-rolls-back with the state change.
            if (old && row.stateId !== old.stateId && row.projectId != null) {
              const project = await tx.projects.findUnique({
                where: { id: row.projectId },
                select: { excludeNotStartedFromRuns: true },
              });
              if (project?.excludeNotStartedFromRuns) {
                const newState = await tx.workflows.findUnique({
                  where: { id: row.stateId },
                  select: { workflowType: true },
                });
                if (newState?.workflowType === WorkflowType.NOT_STARTED) {
                  await tx.testRunCases.updateMany({
                    where: {
                      repositoryCaseId: row.id,
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
          await cancelReviewsForSoftDeleted(
            tx,
            "RepositoryCases",
            before,
            after
          );
          break;
        }

        case "TestRuns": {
          if (action === "delete") break;
          for (let i = 0; i < after.length; i++) {
            const row = after[i];
            const old = before[i] ?? null;
            if (!row?.id) continue;
            syncTestRunToElasticsearch(row.id).catch(
              logEsError("test run", row.id)
            );
            if (row.projectId != null) {
              if (old) await emitTestRunUpdateEvents(old, row, tx);
              // A duplicate carries the source run id — emit the richer
              // test_run.duplicated event instead of the generic .created.
              else if (row.duplicatedFromId != null)
                await emitTestRunDuplicated(row.id, row.duplicatedFromId, tx, {
                  projectId: row.projectId,
                });
              else await emitTestRunCreated(row, tx);
            }
            // Execution-start auto-lock: when a run TRANSITIONS into an
            // IN_PROGRESS state and the project opts in, freeze its case
            // composition (add/remove/reorder) while execution continues.
            // lockedBy is left null = automatic; reversible in-app by the
            // creator / a Project Admin. In-tx so it commits with the state
            // change. Only fires on an update that changes stateId (execution
            // "start" is a transition, not a create), and skips when already
            // locked — which also breaks the recursion from the nested update
            // below (it changes only lock fields, so it re-enters here with the
            // stateId unchanged and short-circuits).
            if (
              old != null &&
              row.compositionLockedAt == null &&
              row.projectId != null &&
              row.stateId !== old.stateId
            ) {
              const newState = await tx.workflows.findUnique({
                where: { id: row.stateId },
                select: { workflowType: true },
              });
              if (newState?.workflowType === WorkflowType.IN_PROGRESS) {
                const project = await tx.projects.findUnique({
                  where: { id: row.projectId },
                  select: { autoLockCompositionOnInProgress: true },
                });
                if (project?.autoLockCompositionOnInProgress) {
                  // Raw UPDATE, not tx.testRuns.update: when the triggering
                  // mutation arrived through the policy client (every
                  // /api/model call), `tx` carries the policy layer and the
                  // field-level @deny('update', true) on compositionLockedAt
                  // rejects the nested write — failing the user's own state
                  // change with a 422. Raw SQL is the same sanctioned bypass
                  // the audit-context GUC uses (PolicyPlugin is constructed
                  // with dangerouslyAllowRawSql for exactly these internal,
                  // parameterized statements), stays inside the transaction,
                  // and still fires the DB-level CDC triggers.
                  await tx.$executeRaw`UPDATE "TestRuns" SET "compositionLockedAt" = NOW() WHERE "id" = ${row.id}`;
                }
              }
            }
          }
          await cancelReviewsForSoftDeleted(tx, "TestRuns", before, after);
          break;
        }

        case "Sessions": {
          if (action === "delete") {
            for (const old of before) {
              if (old?.id)
                syncSessionToElasticsearch(old.id).catch(
                  logEsError("session", old.id)
                );
            }
            break;
          }
          for (let i = 0; i < after.length; i++) {
            const row = after[i];
            const old = before[i] ?? null;
            if (!row?.id) continue;
            syncSessionToElasticsearch(row.id).catch(
              logEsError("session", row.id)
            );
            if (row.projectId != null) {
              if (old) await emitSessionUpdateEvents(old, row, tx);
              // A duplicate carries the source session id — emit the richer
              // session.duplicated event instead of the generic .created.
              else if (row.duplicatedFromId != null)
                await emitSessionDuplicated(row.id, row.duplicatedFromId, tx, {
                  projectId: row.projectId,
                });
              else await emitSessionCreated(row, tx);
            }
          }
          await cancelReviewsForSoftDeleted(tx, "Sessions", before, after);
          break;
        }

        case "Issue": {
          if (action === "delete") {
            for (const old of before) {
              if (old?.id) await emitIssueDeleted(old, tx);
            }
            break;
          }
          for (let i = 0; i < after.length; i++) {
            const row = after[i];
            const old = before[i] ?? null;
            if (!row?.id) continue;
            syncIssueToElasticsearch(row.id).catch(logEsError("issue", row.id));
            // No projectId gate here — the emitter resolves the full set of
            // target projects (home ∪ linked-entity projects) and no-ops when
            // there is nothing to fan out to. Integration-only issues with a
            // null home project still reach subscribers in the projects their
            // linked entities live in.
            if (old) await emitIssueUpdated(old, row, tx);
            else await emitIssueCreated(row, tx);
          }
          break;
        }

        case "SharedStepGroup": {
          if (action === "delete") break;
          for (const row of after) {
            if (row?.id)
              syncSharedStepToElasticsearch(row.id).catch(
                logEsError("shared step", row.id)
              );
          }
          break;
        }

        case "Milestones": {
          if (action === "delete") break;
          for (const row of after) {
            if (row?.id)
              syncMilestoneToElasticsearch(row.id).catch(
                logEsError("milestone", row.id)
              );
          }
          break;
        }

        case "Projects": {
          if (action === "delete") break;
          for (const row of after) {
            if (row?.id)
              syncProjectToElasticsearch(row.id).catch(
                logEsError("project", row.id)
              );
          }
          break;
        }

        case "JUnitTestResult": {
          if (action !== "create") break;
          for (const row of after) {
            if (row?.id && row.testSuiteId != null)
              await emitJUnitResultAdded(row, tx);
          }
          break;
        }

        case "TestRunResults": {
          if (action !== "create") break;
          for (const row of after) {
            if (row?.id && row.testRunId != null)
              await emitTestRunResultAdded(row, tx);
          }
          break;
        }

        case "SessionResults": {
          if (action !== "create") break;
          for (const row of after) {
            if (row?.id && row.sessionId != null)
              await emitSessionResultAdded(row, tx);
          }
          break;
        }

        // Semantic config-change audit. The RPC route shim emits the canonical
        // row and suppresses these to avoid a duplicate; they still fire for
        // non-RPC writes (workers, custom routes, direct client).
        case "SsoProvider": {
          if (isEntityAuditSuppressed()) break;
          if (action === "delete") {
            for (const old of before)
              if (old?.id) await auditSsoConfigChange("DELETE", old);
          } else {
            for (const row of after) {
              if (!row?.id) continue;
              await auditSsoConfigChange(
                action === "create" ? "CREATE" : "UPDATE",
                row
              );
            }
          }
          break;
        }

        case "AppConfig": {
          if (isEntityAuditSuppressed()) break;
          if (action === "delete") {
            for (const old of before)
              if (old?.key)
                await auditSystemConfigChange(old.key, old.value, null);
          } else {
            for (let i = 0; i < after.length; i++) {
              const row = after[i];
              const old = before[i] ?? null;
              if (!row?.key) continue;
              await auditSystemConfigChange(row.key, old?.value, row.value);
            }
          }
          break;
        }

        // API-token writes: audit revocation/deletion (gated, the RPC shim emits
        // the canonical row) and always evict the short-TTL auth cache.
        case "ApiToken": {
          if (action === "delete") {
            for (const old of before) {
              if (!old?.id) continue;
              if (!isEntityAuditSuppressed()) {
                await captureAuditEvent({
                  action: "API_KEY_DELETED",
                  entityType: "ApiToken",
                  entityId: old.id,
                  entityName: old.name,
                  metadata: {
                    tokenPrefix: old.tokenPrefix,
                    tokenOwnerId: old.userId,
                  },
                });
              }
              if (old.token)
                invalidateApiTokenCache(old.token).catch((error: unknown) =>
                  console.error("Failed to invalidate API token cache:", error)
                );
            }
            break;
          }
          if (action === "update") {
            for (let i = 0; i < after.length; i++) {
              const row = after[i];
              const old = before[i] ?? null;
              if (!row?.id) continue;
              if (
                old &&
                old.isActive === true &&
                row.isActive === false &&
                !isEntityAuditSuppressed()
              ) {
                await captureAuditEvent({
                  action: "API_KEY_REVOKED",
                  entityType: "ApiToken",
                  entityId: row.id,
                  entityName: row.name,
                  metadata: {
                    tokenPrefix: row.tokenPrefix,
                    tokenOwnerId: row.userId,
                  },
                });
              }
              const token = old?.token ?? row.token;
              if (token)
                invalidateApiTokenCache(token).catch((error: unknown) =>
                  console.error("Failed to invalidate API token cache:", error)
                );
            }
          }
          break;
        }

        default:
          break;
      }
    },
  },
});
