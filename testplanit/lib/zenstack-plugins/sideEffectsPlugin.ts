// lib/zenstack-plugins/sideEffectsPlugin.ts
//
// v3 ORM plugin carrying the write-side effects that lived in the v2
// lib/db.ts `$extends({ query: { ... } })` block, ported to match the CDC
// branch's behaviour. After the CDC audit refactor the generic config/access
// audit hooks are gone (AUDITED_CONFIG_MODELS and SEMANTIC_ACCESS_AUDIT_MODELS
// are both empty — CDC triggers are the sole source for row-level audit), so
// what remains here is:
//
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
//   - webhook emit / in-tx writes            -> afterEntityMutation with
//       runAfterMutationWithinTransaction: true (so emits commit-or-roll-back
//       with the write; the v2 `proceed()`-inside-$transaction trick does NOT
//       enrol the write — proven in the Phase 0 spike).
//
// Elasticsearch indexing deliberately does NOT live here any more: it must run
// AFTER the transaction commits, because every `sync*ToElasticsearch` reads the
// row back through `rawDb` on a separate connection and cannot see uncommitted
// data. It moved to `esSyncPlugin`, which is the same hook with
// `runAfterMutationWithinTransaction: false`. See that file for the full
// rationale and the measurements.
//
// Runtime behaviours that differ from a single-op `$extends` and are validated
// by the Phase 7 E2E pass: GUC attribution lands in the mutation's tx via the
// before-hook client; onEntityMutation fires once per affected entity, so we
// iterate (v2 only hooked single-row operations).
import { definePlugin } from "@zenstackhq/orm";
import { schema } from "~/zenstack/schema";

import {
  normalizeRichTextWrite,
  normalizeTextLongFieldValueWrite,
  type FieldTypeReader,
} from "~/lib/richTextColumns";
import { decrypt, encrypt, isEncrypted } from "@/utils/encryption";
import {
  assertValidFolderParent,
  type FolderReader,
} from "~/lib/folderParentGuard";
import {
  assertValidMilestoneParent,
  type MilestoneReader,
} from "~/lib/milestoneParentGuard";
import {
  assignResultAttempts,
  type AttemptReader,
} from "~/lib/resultAttemptNumbering";
import {
  applyRunCaseEligibility,
  type EligibilityClient,
} from "~/lib/runCaseEligibilityGuard";
import {
  prepareRunCaseRestore,
  type RunCaseRestoreClient,
} from "~/lib/runCaseRestoreReset";
import {
  prepareRunCaseAssignment,
  type AssigneeReader,
} from "~/lib/runCaseAssignmentHook";
import {
  notifyRunCaseAssignment,
  notifySessionAssignment,
  type AssignmentActor,
} from "~/lib/services/assignmentNotifications";
import {
  enqueueCaseForecastUpdate,
  enqueueRunForecastUpdate,
} from "~/lib/services/forecastEnqueue";
import {
  assertValidCaseLink,
  type CaseLinkReader,
} from "~/lib/caseLinkCycleGuard";
import {
  assertRestrictedFieldWrite,
  type RestrictedFieldReader,
} from "~/lib/restrictedFieldGuard";
import {
  assertRunNotReopened,
  type CompletedRunReader,
} from "~/lib/runReopenGuard";
import {
  isSecretCredentialKey,
  resolveStoredCredentials,
} from "~/lib/integrations/credentials";

/** Write operations whose args can carry a rich-text column value. */
const RICH_TEXT_WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);
import type { TxClient } from "~/lib/zenstack";
import { injectAuditGuc } from "~/lib/audit/gucContext";
import { auditTxStore } from "~/lib/audit/auditTxStore";
import { getAuditContext } from "~/lib/auditContext";
import {
  announceDeletionCancelledReviews,
  cancelReviewsForDeletedEntities,
} from "~/lib/services/reviewCancellation";
import { WorkflowType } from "~/zenstack/models";
import { markExecutionResultsReceived } from "~/lib/execution/service";
import {
  projectJUnitResultOntoRunCase,
  promoteRunToHybrid,
} from "~/lib/services/hybridRunProjection";

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
import { enqueueRunReadyCheck } from "~/lib/services/runReadyCheck";
import {
  enqueueAlertJUnitResultEvaluation,
  enqueueAlertResultEvaluation,
  enqueueAlertRunEvaluation,
  enqueueAlertSessionEvaluation,
  projectHasActiveAlertRules,
} from "~/lib/services/alertEnqueue";
import { snapshotAutomatedFlip } from "~/lib/services/caseAutomatedVersioning";

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
  "WebhookAction",
  "ImpactAnalysis",
  "FailureSignature",
  "CaseQuarantine",
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
  "FailureClassification",
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
  "RepositoryCaseCodePin",
  "ImpactAnalysisCase",
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
  // Deleting a tag link leaves nothing to load afterwards — the before-image is
  // the only way to know which case needs re-indexing.
  "RepositoryCaseTag",
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
 * Flip the in-flight reviews for `names` to CANCELLED and announce them.
 * Shared tail of the soft- and hard-delete paths; `cause` only labels the
 * failure log. Names are carried in because the announcement copy needs them
 * after the subject rows are gone.
 */
async function cancelAndAnnounceReviews(
  tx: TxClient,
  model: keyof typeof REVIEWABLE_ENTITY_TYPE,
  names: Map<number, string>,
  cause: "soft-delete" | "hard-delete"
): Promise<void> {
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
      `Failed to announce reviews cancelled by ${model} ${cause}:`,
      error
    )
  );
}

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
  await cancelAndAnnounceReviews(tx, model, names, "soft-delete");
}

/**
 * Cancel the review requests a genuine hard `delete` leaves in flight.
 *
 * Every current UI delete path soft-deletes (`isDeleted: true`), so the
 * function above is the one that fires in practice — but the per-model `delete`
 * branches below all `break` before reaching it, which would strand PENDING
 * reviews (and their inbox rows) pointing at a row that no longer exists. A
 * hard delete has no after-image to diff, so the ids and names come entirely
 * off the before-image.
 */
async function cancelReviewsForHardDeleted(
  tx: TxClient,
  model: keyof typeof REVIEWABLE_ENTITY_TYPE,
  before: any[]
): Promise<void> {
  const names = new Map<number, string>();
  for (const old of before) {
    if (old?.id == null) continue;
    names.set(old.id, old.name ?? "");
  }
  await cancelAndAnnounceReviews(tx, model, names, "hard-delete");
}

/**
 * Every update that changes `RepositoryCases.automated` leaves a version
 * snapshot behind.
 *
 * Automation Trends reads each case's automated state off its version
 * timeline, not the live flag (see lib/services/caseAutomatedVersioning.ts),
 * so a flag-only write — the reporter SDK's `updateTestCase`, the MCP
 * `cases_update` tool, a JUnit import matching an existing case — left the
 * case counted as its old state for every period. Hooking the model covers
 * every hooked-client writer at once, including reporter versions already
 * deployed in CI, and reverts (true→false) as much as flips.
 *
 * Skip rule: a caller that changes `currentVersion` in the same write is
 * taking responsibility for its own snapshot (the full case editor, bulk
 * edit, submit-result, the imports all bump-then-snapshot). Compared on the
 * before/after images rather than the query args so `updateMany` and an
 * explicit `currentVersion: n` are treated the same as `{ increment: 1 }`.
 *
 * Rows are paired by id, not by index: for a multi-row update the before
 * SELECT and the RETURNING rows are not guaranteed to come back in the same
 * order.
 *
 * The nested writes go through `client.$unuseAll()`: it shares the mutation's
 * transaction (the hook client is transaction-bound) but drops the plugins,
 * so the bump cannot re-enter this hook and, when the write arrived through
 * the policy client, the snapshot is not subject to the acting user's read
 * policy on the case's creator/project relations. The audit GUC set in
 * beforeEntityMutation still attributes the version row to the actor.
 */
async function snapshotAutomatedFlips(
  client: { $unuseAll(): unknown },
  before: any[],
  after: any[]
): Promise<void> {
  const beforeById = new Map<number, any>();
  for (const old of before) {
    if (old?.id != null) beforeById.set(old.id, old);
  }
  const flipped: number[] = [];
  for (const row of after) {
    if (row?.id == null) continue;
    const old = beforeById.get(row.id);
    if (!old) continue;
    if (row.automated === old.automated) continue;
    if (row.currentVersion !== old.currentVersion) continue;
    flipped.push(row.id);
  }
  if (flipped.length === 0) return;

  const plain = client.$unuseAll() as unknown as TxClient;
  for (const caseId of flipped) {
    await snapshotAutomatedFlip(plain, caseId);
  }
}

const CREDENTIAL_WRITE_OPERATIONS = new Set([
  "create",
  "update",
  "upsert",
  "createMany",
  "updateMany",
]);

type CredentialModelReader = {
  findUnique(args: {
    where: Record<string, unknown>;
    select: Record<string, true>;
  }): Promise<Record<string, unknown> | null>;
};

type CredentialReader = {
  codeRepository: CredentialModelReader;
  llmIntegration: CredentialModelReader;
  integration: CredentialModelReader;
  ssoProvider: CredentialModelReader;
};

/**
 * Where each sealed model keeps its secrets, and the column that names it in
 * a decryption error.
 */
const SEALED_FIELDS: Record<
  keyof CredentialReader,
  { field: string; label: string }
> = {
  codeRepository: { field: "credentials", label: "provider" },
  llmIntegration: { field: "credentials", label: "provider" },
  integration: { field: "credentials", label: "provider" },
  ssoProvider: { field: "config", label: "type" },
};

/** The models whose secrets are sealed on every write. */
const CREDENTIAL_MODELS = {
  CodeRepository: "codeRepository",
  LlmIntegration: "llmIntegration",
  Integration: "integration",
  SsoProvider: "ssoProvider",
} as const satisfies Record<string, keyof CredentialReader>;

const isEncryptedBlob = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { encrypted?: unknown }).encrypted === "string";

/**
 * Secrets a writer already encrypted one by one (Integration's older shape)
 * are opened first, so the sealed blob holds plain values, not ciphertext.
 */
async function openPerFieldSecrets(
  plain: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const opened: Record<string, unknown> = { ...plain };
  for (const [key, value] of Object.entries(plain)) {
    if (
      typeof value === "string" &&
      isSecretCredentialKey(key) &&
      isEncrypted(value)
    ) {
      opened[key] = await decrypt(value);
    }
  }
  return opened;
}

/**
 * Encrypt credentials on every CodeRepository write, whatever path it came
 * in on: an admin modal through the model API, a fixture, an import.
 */
export async function encryptCodeRepositoryCredentials(
  operation: string,
  args: Record<string, unknown> | undefined,
  client: Pick<CredentialReader, "codeRepository">
): Promise<void> {
  await encryptCredentialsOnWrite("codeRepository", operation, args, client);
}

/**
 * Seal a model's secret column on every write into the `{ encrypted }` blob
 * resolveStoredCredentials reads. An update carrying only some fields (an
 * admin retyped one key) merges over what is stored, so a blank input keeps
 * the current value instead of wiping the rest.
 */
export async function encryptCredentialsOnWrite<
  K extends keyof CredentialReader,
>(
  modelKey: K,
  operation: string,
  args: Record<string, unknown> | undefined,
  client: Pick<CredentialReader, K>
): Promise<void> {
  if (!args || !CREDENTIAL_WRITE_OPERATIONS.has(operation)) return;
  const { field, label } = SEALED_FIELDS[modelKey];

  const seal = async (
    data: Record<string, unknown> | undefined,
    where?: Record<string, unknown>
  ) => {
    if (!data || !(field in data)) return;
    const value = data[field];
    if (value === null || value === undefined || isEncryptedBlob(value)) return;
    if (typeof value !== "object" || Array.isArray(value)) return;
    const plain = await openPerFieldSecrets(value as Record<string, unknown>);
    let existing: Record<string, unknown> | undefined;
    if (where) {
      const row = await (client[modelKey] as CredentialModelReader).findUnique({
        where,
        select: { [field]: true, [label]: true },
      });
      if (row) {
        try {
          existing = await resolveStoredCredentials(
            row[field],
            String(row[label] ?? modelKey)
          );
        } catch {
          // Unreadable stored credentials are what this write replaces.
          existing = undefined;
        }
      }
    }
    data[field] = {
      encrypted: await encrypt(
        JSON.stringify({ ...(existing ?? {}), ...plain })
      ),
    };
  };

  const where = args.where as Record<string, unknown> | undefined;
  switch (operation) {
    case "create":
      await seal(args.data as Record<string, unknown> | undefined);
      break;
    case "update":
      await seal(args.data as Record<string, unknown> | undefined, where);
      break;
    case "updateMany":
      await seal(args.data as Record<string, unknown> | undefined);
      break;
    case "upsert":
      await seal(args.create as Record<string, unknown> | undefined);
      await seal(args.update as Record<string, unknown> | undefined, where);
      break;
    case "createMany": {
      const rows = args.data;
      for (const row of Array.isArray(rows) ? rows : [rows]) {
        await seal(row as Record<string, unknown> | undefined);
      }
      break;
    }
  }
}

/** Who is making the assignment, from the request's audit context. */
function assignmentActor(): AssignmentActor | null {
  const ctx = getAuditContext();
  if (!ctx?.userId) return null;
  return { id: ctx.userId, name: ctx.userName };
}

export const sideEffectsPlugin = definePlugin(schema, {
  id: "testplanit-side-effects",

  // Arg-rewriting business logic that must run before the write SQL.
  onQuery: async ({ model, operation, args, proceed, client }) => {
    const credentialModel =
      CREDENTIAL_MODELS[model as keyof typeof CREDENTIAL_MODELS];
    if (credentialModel) {
      // The client an onQuery hook receives is ZenStack's un-proxied instance:
      // `$`-members work but model accessors (`client.codeRepository`) do not.
      // A derived client is proxied again and shares the connection; without
      // plugins the read also skips the policy layer and this hook itself.
      await encryptCredentialsOnWrite(
        credentialModel,
        operation,
        args,
        client.$unuseAll() as unknown as CredentialReader
      );
    }

    // One storage shape for rich text. The web UI serializes Tiptap documents
    // before writing, so the same Json column held either a document object or
    // a JSON string of one depending on the client. Normalizing here covers
    // every writer that goes through the ORM instead of trusting each call
    // site. See lib/richTextColumns.ts.
    if (RICH_TEXT_WRITE_OPERATIONS.has(operation)) {
      normalizeRichTextWrite(model, args);
      if (model === "CaseFieldValues") {
        await assertRestrictedFieldWrite(
          model,
          operation,
          args,
          (client as unknown as { $auth?: { id?: string; access?: string } })
            .$auth,
          client.$unuseAll() as unknown as RestrictedFieldReader
        );
        await normalizeTextLongFieldValueWrite(
          model,
          operation,
          args,
          client.$unuseAll() as unknown as FieldTypeReader
        );
      }
    }

    if (model === "RepositoryFolders") {
      await assertValidFolderParent(
        model,
        operation,
        args,
        client.$unuseAll() as unknown as FolderReader
      );
    }

    if (model === "Milestones") {
      await assertValidMilestoneParent(
        model,
        operation,
        args,
        client.$unuseAll() as unknown as MilestoneReader
      );
    }

    if (model === "RepositoryCaseLink") {
      await assertValidCaseLink(
        model,
        operation,
        args,
        client.$unuseAll() as unknown as CaseLinkReader
      );
    }

    if (model === "TestRunResults") {
      await assignResultAttempts(
        model,
        operation,
        args,
        client.$unuseAll() as unknown as AttemptReader
      );
    }

    if (model === "TestRuns") {
      await assertRunNotReopened(
        model,
        operation,
        args,
        client.$unuseAll() as unknown as CompletedRunReader
      );
    }

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

    // Run membership: keep Not Started cases out where the project says so,
    // bring restored cases back untested, and tell new assignees. All three
    // used to live in the browser, so API clients skipped them.
    let afterRestore: (() => Promise<void>) | null = null;
    let pendingAssignment: Awaited<
      ReturnType<typeof prepareRunCaseAssignment>
    > = null;
    if (model === "TestRunCases" || model === "TestRuns") {
      const raw = client.$unuseAll();
      await applyRunCaseEligibility(
        model,
        operation,
        args,
        raw as unknown as EligibilityClient
      );
      afterRestore = await prepareRunCaseRestore(
        model,
        operation,
        args,
        raw as unknown as RunCaseRestoreClient
      );
      pendingAssignment = await prepareRunCaseAssignment(
        model,
        operation,
        args,
        raw as unknown as AssigneeReader
      );
    }

    const result = await proceed(args as never);

    if (afterRestore) {
      // Bookkeeping on rows the write just restored; never fails the write.
      await afterRestore().catch((error) =>
        console.error("[runCaseRestore] iteration restore failed:", error)
      );
    }
    if (pendingAssignment) {
      const actor = assignmentActor();
      if (actor) {
        void notifyRunCaseAssignment(client.$unuseAll() as any, {
          ...pendingAssignment,
          actor,
        }).catch((error) =>
          console.error("[assignment] notification failed:", error)
        );
      }
    }
    return result;
  },

  onEntityMutation: {
    $all: {
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
                await emitCaseDeleted(old, tx);
              }
              await cancelReviewsForHardDeleted(tx, "RepositoryCases", before);
              break;
            }
            for (let i = 0; i < after.length; i++) {
              const row = after[i];
              const old = before[i] ?? null;
              if (!row?.id) continue;
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
                    // Which runs lose a case, read before the update so the
                    // rows are still matchable. Dropping the last unexecuted
                    // case can make a run fully executed, and mutations issued
                    // from inside a hook do not re-enter the plugin, so the
                    // TestRunCases case below will not see this one.
                    const affected = await tx.testRunCases.findMany({
                      where: {
                        repositoryCaseId: row.id,
                        isDeleted: false,
                        testRun: { isCompleted: false },
                        results: { none: {} },
                      },
                      select: { testRunId: true },
                    });
                    await tx.testRunCases.updateMany({
                      where: {
                        repositoryCaseId: row.id,
                        isDeleted: false,
                        testRun: { isCompleted: false },
                        results: { none: {} },
                      },
                      data: { isDeleted: true },
                    });
                    if (affected.length > 0) {
                      const { getCurrentTenantId } =
                        await import("~/lib/multiTenantDb");
                      const tenantId = getCurrentTenantId();
                      for (const runId of new Set(
                        affected.map((c) => c.testRunId)
                      )) {
                        void enqueueRunReadyCheck(runId, tenantId);
                      }
                    }
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
            await snapshotAutomatedFlips(client, before, after);
            break;
          }

          case "TestRuns": {
            if (action === "delete") {
              await cancelReviewsForHardDeleted(tx, "TestRuns", before);
              break;
            }
            for (let i = 0; i < after.length; i++) {
              const row = after[i];
              const old = before[i] ?? null;
              if (!row?.id) continue;
              if (row.projectId != null) {
                if (old) await emitTestRunUpdateEvents(old, row, tx);
                // Alerts (#651): run metrics that wait for
                // completion are evaluated when the run first completes.
                if (
                  old &&
                  row.isCompleted === true &&
                  old.isCompleted !== true &&
                  typeof tx.alertRule?.count === "function"
                ) {
                  if (await projectHasActiveAlertRules(tx, row.projectId)) {
                    const { getCurrentTenantId } =
                      await import("~/lib/multiTenantDb");
                    void enqueueAlertRunEvaluation({
                      runId: row.id,
                      projectId: row.projectId,
                      trigger: "completion",
                      tenantId: getCurrentTenantId(),
                    });
                  }
                }
                // A duplicate carries the source run id — emit the richer
                // test_run.duplicated event instead of the generic .created.
                else if (row.duplicatedFromId != null)
                  await emitTestRunDuplicated(
                    row.id,
                    row.duplicatedFromId,
                    tx,
                    {
                      projectId: row.projectId,
                    }
                  );
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
              await cancelReviewsForHardDeleted(tx, "Sessions", before);
              break;
            }
            for (let i = 0; i < after.length; i++) {
              const row = after[i];
              const old = before[i] ?? null;
              if (!row?.id) continue;
              if (
                typeof row.assignedToId === "string" &&
                row.assignedToId &&
                row.assignedToId !== old?.assignedToId
              ) {
                const actor = assignmentActor();
                if (actor) {
                  void notifySessionAssignment(tx as any, {
                    sessionId: row.id,
                    assignedToId: row.assignedToId,
                    actor,
                  }).catch((error) =>
                    console.error("[assignment] notification failed:", error)
                  );
                }
              }
              if (row.projectId != null) {
                if (old) await emitSessionUpdateEvents(old, row, tx);
                // Alerts: the session overrun metric is evaluated when a
                // session first completes.
                if (
                  old &&
                  row.isCompleted === true &&
                  old.isCompleted !== true &&
                  typeof tx.alertRule?.count === "function"
                ) {
                  if (await projectHasActiveAlertRules(tx, row.projectId)) {
                    const { getCurrentTenantId } =
                      await import("~/lib/multiTenantDb");
                    void enqueueAlertSessionEvaluation({
                      sessionId: row.id,
                      projectId: row.projectId,
                      tenantId: getCurrentTenantId(),
                    });
                  }
                }
                // A duplicate carries the source session id — emit the richer
                // session.duplicated event instead of the generic .created.
                else if (row.duplicatedFromId != null)
                  await emitSessionDuplicated(
                    row.id,
                    row.duplicatedFromId,
                    tx,
                    {
                      projectId: row.projectId,
                    }
                  );
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

          case "JUnitTestSuite": {
            // First automated write into a manual run promotes it to HYBRID so
            // the run page and summaries show both result trees.
            if (action !== "create") break;
            for (const row of after) {
              if (row?.id && row.testRunId != null) {
                await promoteRunToHybrid(tx as never, row.testRunId);
                // Reporters write suites through the RPC, never the import
                // route, so this is where a dispatched execution learns that
                // its results have started arriving.
                await markExecutionResultsReceived(tx as never, row.testRunId);
              }
            }
            break;
          }

          case "JUnitTestResult": {
            if (action !== "create") break;
            for (const row of after) {
              if (row?.id && row.testSuiteId != null) {
                // Reporter-SDK results never touch TestRunCases.statusId; on a
                // manual (REGULAR/HYBRID) run the manual UI, progress bar and
                // ready-to-complete check all read that column, so mirror the
                // result onto it here (same write the import route makes).
                await projectJUnitResultOntoRunCase(tx as never, {
                  testSuiteId: row.testSuiteId,
                  repositoryCaseId: row.repositoryCaseId ?? null,
                  statusId: row.statusId ?? null,
                });
                await emitJUnitResultAdded(row, tx);
              }
            }
            await enqueueAlertEvaluationsForJUnitResults(tx, after).catch(
              (error) =>
                console.error(
                  "[alerts] automated result enqueue failed:",
                  error
                )
            );
            await enqueueFailureTriageForJUnitResults(tx, after).catch(
              (error) =>
                console.error("[failure-triage] enqueue failed:", error)
            );
            await enqueueRiskScoreForJUnitResults(tx, after).catch((error) =>
              console.error("[risk-score] enqueue failed:", error)
            );
            break;
          }

          case "TestRunResults": {
            if (action !== "create") break;
            for (const row of after) {
              if (row?.id && row.testRunId != null)
                await emitTestRunResultAdded(row, tx);
            }
            // A recorded elapsed time feeds the case's forecast (and, through
            // it, every run holding the case) — what the web UI's result dialog
            // asked for from the browser.
            const timedCaseIds = new Set<number>();
            for (const row of after) {
              if (row?.elapsed == null || typeof row.testRunCaseId !== "number")
                continue;
              const runCase = await tx.testRunCases.findUnique({
                where: { id: row.testRunCaseId },
                select: { repositoryCaseId: true },
              });
              if (runCase) timedCaseIds.add(runCase.repositoryCaseId);
            }
            if (timedCaseIds.size > 0) {
              const { getCurrentTenantId } =
                await import("~/lib/multiTenantDb");
              const tenantId = getCurrentTenantId();
              for (const caseId of timedCaseIds) {
                void enqueueCaseForecastUpdate(caseId, tenantId);
              }
            }
            await enqueueAlertEvaluationsForResults(tx, after).catch((error) =>
              console.error("[alerts] result enqueue failed:", error)
            );
            await enqueueRiskScoreForTestRunResults(tx, after).catch((error) =>
              console.error("[risk-score] enqueue failed:", error)
            );
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
                    console.error(
                      "Failed to invalidate API token cache:",
                      error
                    )
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
                    console.error(
                      "Failed to invalidate API token cache:",
                      error
                    )
                  );
              }
            }
            break;
          }

          // Every path that can change how much of a run is left to execute
          // writes a TestRunCases row in the same transaction — recording a
          // result, editing one, deleting one, bulk-skipping, fanning out
          // iterations, adding or removing cases. Hooking this one model is
          // therefore the single seam that catches a run both filling up and
          // emptying again, which is what lets the notification re-arm.
          //
          // Iterations need no case of their own: every iteration status write
          // is paired with a case write inside the same transaction.
          //
          // Only run ids are collected here. The predicate itself runs in a
          // debounced worker job, so a bulk import writing thousands of rows
          // costs one enqueue per run rather than a pair of COUNTs per row.
          case "TestRunCases": {
            // Hard deletes arrive with neither `after` nor a before-image
            // (TestRunCases is deliberately not in BEFORE_IMAGE_MODELS — a
            // before-load on the hottest table in the app is not worth it).
            // The only hard-delete callers re-create the row immediately
            // afterwards, which re-enqueues.
            const runIds = new Set<number>();
            for (const row of after) {
              if (typeof row?.testRunId === "number") runIds.add(row.testRunId);
            }
            if (runIds.size > 0) {
              const { getCurrentTenantId } =
                await import("~/lib/multiTenantDb");
              const tenantId = getCurrentTenantId();
              for (const runId of runIds) {
                // Detached: this hook body runs inside the writer's transaction
                // and must never hold it open or fail it.
                void enqueueRunReadyCheck(runId, tenantId);
                // The run's forecast sums its live cases; any membership change
                // moves it.
                void enqueueRunForecastUpdate(runId, tenantId);
              }
            }
            // Cases created already assigned (a duplicated run that copies
            // assignments, an API client): the assignee is told, as for an
            // assignment made later. Updates are handled in onQuery, where
            // the previous assignee can still be read.
            if (action === "create") {
              const byAssignee = new Map<string, number[]>();
              for (const row of after) {
                if (typeof row?.assignedToId === "string" && row.assignedToId) {
                  byAssignee.set(row.assignedToId, [
                    ...(byAssignee.get(row.assignedToId) ?? []),
                    row.id,
                  ]);
                }
              }
              const actor = byAssignee.size > 0 ? assignmentActor() : null;
              if (actor) {
                for (const [assignedToId, testRunCaseIds] of byAssignee) {
                  void notifyRunCaseAssignment(tx as any, {
                    testRunCaseIds,
                    assignedToId,
                    actor,
                  }).catch((error) =>
                    console.error("[assignment] notification failed:", error)
                  );
                }
              }
            }
            break;
          }

          case "RepositoryCaseLink": {
            // Linked cases share a forecast group; a link change moves both
            // ends' forecasts (the browser used to ask for this).
            const linkedCaseIds = new Set<number>();
            for (const row of [...before, ...after]) {
              if (typeof row?.caseAId === "number")
                linkedCaseIds.add(row.caseAId);
              if (typeof row?.caseBId === "number")
                linkedCaseIds.add(row.caseBId);
            }
            if (linkedCaseIds.size > 0) {
              const { getCurrentTenantId } =
                await import("~/lib/multiTenantDb");
              const tenantId = getCurrentTenantId();
              for (const caseId of linkedCaseIds) {
                void enqueueCaseForecastUpdate(caseId, tenantId);
              }
            }
            break;
          }

          default:
            break;
        }
      },
    },
  },
});

/**
 * Alerts (#651): hand each new manual result, and its run, to
 * the evaluation worker. One indexed count per project gates the enqueue so
 * projects without rules pay nothing; the enqueues are detached because this
 * runs inside the writer's transaction. Results from a CI import share one
 * run, so the run job is deduplicated by the enqueue helper.
 */
async function enqueueAlertEvaluationsForResults(
  tx: TxClient,
  rows: any[]
): Promise<void> {
  const created = rows.filter((row) => row?.id && row.testRunId != null);
  if (created.length === 0 || typeof tx.alertRule?.count !== "function") {
    return;
  }
  const runIds = [...new Set(created.map((row) => Number(row.testRunId)))];
  const runs = await tx.testRuns.findMany({
    where: { id: { in: runIds } },
    select: { id: true, projectId: true },
  });
  const projectByRun = new Map(runs.map((r) => [r.id, r.projectId]));
  const activeByProject = new Map<number, boolean>();
  const { getCurrentTenantId } = await import("~/lib/multiTenantDb");
  const tenantId = getCurrentTenantId();
  const runJobs = new Set<number>();
  for (const row of created) {
    const projectId = projectByRun.get(Number(row.testRunId));
    if (projectId == null) continue;
    let active = activeByProject.get(projectId);
    if (active === undefined) {
      active = await projectHasActiveAlertRules(tx, projectId);
      activeByProject.set(projectId, active);
    }
    if (!active) continue;
    void enqueueAlertResultEvaluation({
      resultId: Number(row.id),
      projectId,
      tenantId,
    });
    if (!runJobs.has(Number(row.testRunId))) {
      runJobs.add(Number(row.testRunId));
      void enqueueAlertRunEvaluation({
        runId: Number(row.testRunId),
        projectId,
        trigger: "result",
        tenantId,
      });
    }
  }
}

/** Same as above for reporter (JUnit) results, which reach the run via their suite. */
/**
 * Failure triage: one debounced per-run job per result burst, so the worker
 * groups a run's FAILURE/ERROR rows after they have all landed. Gated on the
 * project flag so a project that turned triage off costs nothing here.
 */
async function enqueueFailureTriageForJUnitResults(
  tx: TxClient,
  rows: any[]
): Promise<void> {
  if (typeof tx.jUnitTestSuite?.findMany !== "function") return;
  const valid = rows.filter((row) => row?.id && row.testSuiteId != null);
  const failed = valid.filter(
    (row) => row.type === "FAILURE" || row.type === "ERROR"
  );
  let relevant = failed;
  if (failed.length === 0) {
    // A passing burst matters only to quarantined cases, whose quarantine
    // lifts after enough consecutive passes.
    const caseIds = [
      ...new Set(
        valid
          .map((row) => Number(row.repositoryCaseId))
          .filter((id) => Number.isInteger(id))
      ),
    ];
    if (
      caseIds.length === 0 ||
      typeof tx.caseQuarantine?.findMany !== "function"
    ) {
      return;
    }
    const quarantined = await tx.caseQuarantine.findMany({
      where: { caseId: { in: caseIds } },
      select: { caseId: true },
    });
    if (quarantined.length === 0) return;
    const quarantinedIds = new Set(quarantined.map((q) => q.caseId));
    relevant = valid.filter((row) =>
      quarantinedIds.has(Number(row.repositoryCaseId))
    );
    if (relevant.length === 0) return;
  }
  const suiteIds = [...new Set(relevant.map((row) => Number(row.testSuiteId)))];
  const suites = await tx.jUnitTestSuite.findMany({
    where: { id: { in: suiteIds } },
    select: {
      id: true,
      testRun: {
        select: {
          id: true,
          projectId: true,
          project: { select: { failureTriageEnabled: true } },
        },
      },
    },
  });
  const { getCurrentTenantId } = await import("~/lib/multiTenantDb");
  const { enqueueFailureTriageForRun } =
    await import("~/lib/services/triage/enqueue");
  const tenantId = getCurrentTenantId();
  const seenRuns = new Set<number>();
  for (const suite of suites) {
    const run = suite.testRun as {
      id: number;
      projectId: number;
      project: { failureTriageEnabled: boolean } | null;
    };
    if (!run?.project?.failureTriageEnabled || seenRuns.has(run.id)) continue;
    seenRuns.add(run.id);
    void enqueueFailureTriageForRun({
      testRunId: run.id,
      projectId: run.projectId,
      tenantId,
    });
  }
}

/**
 * Every automated verdict moves a case's failure, flakiness and staleness
 * signals, so each affected run gets one debounced risk recompute. Gated on
 * the per-project flag so a project with risk scoring off costs one select.
 */
async function enqueueRiskScoreForJUnitResults(
  tx: TxClient,
  rows: any[]
): Promise<void> {
  if (typeof tx.jUnitTestSuite?.findMany !== "function") return;
  const valid = rows.filter((row) => row?.id && row.testSuiteId != null);
  if (valid.length === 0) return;
  const suiteIds = [...new Set(valid.map((row) => Number(row.testSuiteId)))];
  const suites = await tx.jUnitTestSuite.findMany({
    where: { id: { in: suiteIds } },
    select: {
      id: true,
      testRun: {
        select: {
          id: true,
          projectId: true,
          project: { select: { riskScoringEnabled: true } },
        },
      },
    },
  });
  const { getCurrentTenantId } = await import("~/lib/multiTenantDb");
  const { enqueueRiskScoreForRun } =
    await import("~/lib/services/risk/enqueue");
  const tenantId = getCurrentTenantId();
  const seenRuns = new Set<number>();
  for (const suite of suites) {
    const run = suite.testRun as {
      id: number;
      projectId: number;
      project: { riskScoringEnabled: boolean } | null;
    };
    if (!run?.project?.riskScoringEnabled || seenRuns.has(run.id)) continue;
    seenRuns.add(run.id);
    void enqueueRiskScoreForRun({
      testRunId: run.id,
      projectId: run.projectId,
      tenantId,
    });
  }
}

/** Manual results carry their run directly; same per-run debounce as above. */
async function enqueueRiskScoreForTestRunResults(
  tx: TxClient,
  rows: any[]
): Promise<void> {
  if (typeof tx.testRuns?.findMany !== "function") return;
  const runIds = [
    ...new Set(
      rows
        .filter((row) => row?.id && row.testRunId != null)
        .map((row) => Number(row.testRunId))
    ),
  ];
  if (runIds.length === 0) return;
  const runs = await tx.testRuns.findMany({
    where: { id: { in: runIds } },
    select: {
      id: true,
      projectId: true,
      project: { select: { riskScoringEnabled: true } },
    },
  });
  const { getCurrentTenantId } = await import("~/lib/multiTenantDb");
  const { enqueueRiskScoreForRun } =
    await import("~/lib/services/risk/enqueue");
  const tenantId = getCurrentTenantId();
  for (const run of runs) {
    if (!run.project?.riskScoringEnabled) continue;
    void enqueueRiskScoreForRun({
      testRunId: run.id,
      projectId: run.projectId,
      tenantId,
    });
  }
}

async function enqueueAlertEvaluationsForJUnitResults(
  tx: TxClient,
  rows: any[]
): Promise<void> {
  const created = rows.filter((row) => row?.id && row.testSuiteId != null);
  if (created.length === 0 || typeof tx.alertRule?.count !== "function") {
    return;
  }
  const suiteIds = [...new Set(created.map((row) => Number(row.testSuiteId)))];
  const suites = await tx.jUnitTestSuite.findMany({
    where: { id: { in: suiteIds } },
    select: { id: true, testRun: { select: { id: true, projectId: true } } },
  });
  const runBySuite = new Map(
    suites.map((s) => [s.id, s.testRun as { id: number; projectId: number }])
  );
  const activeByProject = new Map<number, boolean>();
  const { getCurrentTenantId } = await import("~/lib/multiTenantDb");
  const tenantId = getCurrentTenantId();
  const runJobs = new Set<number>();
  for (const row of created) {
    const run = runBySuite.get(Number(row.testSuiteId));
    if (!run) continue;
    let active = activeByProject.get(run.projectId);
    if (active === undefined) {
      active = await projectHasActiveAlertRules(tx, run.projectId);
      activeByProject.set(run.projectId, active);
    }
    if (!active) continue;
    void enqueueAlertJUnitResultEvaluation({
      junitResultId: Number(row.id),
      projectId: run.projectId,
      tenantId,
    });
    if (!runJobs.has(run.id)) {
      runJobs.add(run.id);
      void enqueueAlertRunEvaluation({
        runId: run.id,
        projectId: run.projectId,
        trigger: "result",
        tenantId,
      });
    }
  }
}
