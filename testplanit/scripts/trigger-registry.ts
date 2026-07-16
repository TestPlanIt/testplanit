/**
 * Trigger registry — the single source of truth for which Postgres tables receive
 * the generic audit_row_change() trigger, their primary-key column, and the per-table
 * column denylist. Consumed by scripts/apply-triggers.ts (attaches the triggers) and by
 * the drift test (computes the expected trigger count).
 *
 * Coverage:
 *   COV-01 — Cases / Runs / Sessions families + every child/value table.
 *   COV-02 — implicit many-to-many join tables linking Tags/Issue to those entities.
 *   COV-04 — all remaining app-audited data entities (45 tables, Phase 15).
 *   SAF-02 — per-table denylist: camelCase timestamps (where the table has them) + credential
 *            columns on User/Integration/LlmIntegration/CodeRepository/WebhookConfig + opaque
 *            machine-written integration payloads (Issue.externalData/data) + the high-volume TipTap
 *            step columns (Steps.step/expectedResult). Human-authored rich-text description columns
 *            (Milestones.note/docs, Sessions.note/mission, Issue.note, Comment.content) are NOT
 *            denylisted — they are captured and flattened to plain text at render
 *            (lib/audit/humanize.ts RICH_TEXT_COLUMNS), mirroring how case Text-Long field values show.
 *   SAF-04 — credential/token tables are deliberately ABSENT (see the exclusion block below);
 *            DataChangeLog/AuditLog can never appear (REGISTRY_PROHIBITED + assertRegistrySafe).
 */

export interface TriggerConfig {
  /** Postgres table name (exact case, no quotes — the apply script quotes it). */
  table: string;
  /** Primary-key column name. Default 'id'. Join tables have no id — their composite PK is (A,B), so pkCol is 'A'. */
  pkCol?: string;
  /** Columns excluded from the captured diff. Default DEFAULT_DENYLIST. */
  denylist?: string[];
  /**
   * Column holding this entity's human-readable name. The trigger snapshots its value off the
   * changed row at write time into DataChangeLog.entity_name (immutable — no later lookup). Set
   * only on root/self-attributed entities; child/value/join tables omit it (they inherit their
   * owner's name in correlation, or the GUC subject for child-only operations).
   */
  nameCol?: string;
  /**
   * Column holding this entity's owning project id (Int FK, or 'id' for Projects itself). The
   * trigger snapshots its value into DataChangeLog.project_id at write time. Omitted on global/
   * admin entities (no project) and on children (they inherit / fall back to the GUC subject).
   */
  projectCol?: string;
  /**
   * Extra stable identity columns the trigger captures on EVERY update even when unchanged (the
   * rollup FK from ROLLUP_MAP is added automatically). A value table only writes its `value`, so
   * without this the diff wouldn't say WHICH field changed — set `["fieldId"]` so correlation can
   * render "Priority: Medium → High" rather than a bare "value: 3 → 2".
   */
  captureCols?: string[];
}

/** Default denylist applied to a table when its entry omits `denylist`. */
export const DEFAULT_DENYLIST = ["createdAt", "updatedAt"];

export const TRIGGER_REGISTRY: TriggerConfig[] = [
  // ── Cases family ──────────────────────────────────────────────────────────
  {
    table: "RepositoryCases",
    denylist: ["createdAt"],
    nameCol: "name",
    projectCol: "projectId",
  }, // NOTE: no updatedAt column on this table (Finding C)
  { table: "CaseFieldValues", denylist: [], captureCols: ["fieldId"] }, // no timestamps; fieldId identifies which field
  {
    table: "Steps",
    denylist: ["createdAt", "updatedAt", "step", "expectedResult"],
  }, // step/expectedResult are TipTap
  { table: "TestCaseParameter", denylist: ["createdAt", "updatedAt"] },

  // Cases <-> Tags/Issue explicit join tables (composite (caseId,X) PK → pkCol 'caseId')
  { table: "RepositoryCaseTag", pkCol: "caseId", denylist: [] },
  { table: "RepositoryCaseIssue", pkCol: "caseId", denylist: [] },

  // ── Runs family ───────────────────────────────────────────────────────────
  {
    table: "TestRuns",
    denylist: ["createdAt", "updatedAt"],
    nameCol: "name",
    projectCol: "projectId",
  },
  // captureCols repositoryCaseId so a soft-delete (UPDATE isDeleted) still records WHICH case
  // left the run — correlation renders "N test cases removed: <names>", mirroring the add side.
  {
    table: "TestRunCases",
    denylist: ["createdAt", "updatedAt"],
    captureCols: ["repositoryCaseId"],
  },
  { table: "TestRunResults", denylist: ["createdAt", "updatedAt"] },
  { table: "TestRunStepResults", denylist: ["createdAt", "updatedAt"] },
  { table: "TestRunCaseIteration", denylist: ["createdAt", "updatedAt"] },
  // Shared 3-way value table: a result field value belongs to a test-run result, a session result,
  // OR a case. Capture all three owner FKs (+ fieldId) so correlation can roll it up to the right
  // owner even on a value-only update. (The rollup FK testRunResultsId is added from ROLLUP_MAP.)
  {
    table: "ResultFieldValues",
    denylist: [],
    captureCols: ["fieldId", "sessionResultsId", "testCaseId"],
  }, // no timestamps

  // Runs implicit m2m join tables
  { table: "_IssueToTestRuns", pkCol: "A", denylist: [] },
  { table: "_IssueToTestRunResults", pkCol: "A", denylist: [] },
  { table: "_IssueToTestRunStepResults", pkCol: "A", denylist: [] },

  // ── Sessions family ───────────────────────────────────────────────────────
  {
    table: "Sessions",
    denylist: ["createdAt", "updatedAt"],
    nameCol: "name",
    projectCol: "projectId",
  }, // note/mission are TipTap descriptions — captured, flattened at render (humanize.ts)
  { table: "SessionResults", denylist: ["createdAt", "updatedAt"] },
  { table: "SessionFieldValues", denylist: [], captureCols: ["fieldId"] }, // no timestamps; fieldId identifies which field
  // SessionVersions deliberately NOT audited — it is a version snapshot the app
  // writes in its own transaction on every session save, producing a redundant
  // "no-name" audit row. Mirrors RepositoryCaseVersions, which is also excluded.

  // Sessions implicit m2m join tables
  { table: "_IssueToSessions", pkCol: "A", denylist: [] },
  { table: "_IssueToSessionResults", pkCol: "A", denylist: [] },
  { table: "_SessionsToTags", pkCol: "A", denylist: [] }, // [VERIFIED] live spike DB (Tags↔Sessions)
  { table: "_TagsToTestRuns", pkCol: "A", denylist: [] }, // [VERIFIED] live spike DB (Tags↔TestRuns)

  // ── COV-04: Group A — Top-level project/user entities ─────────────────────
  // lastActiveAt is write-frequent (keep-alive ping every 5 min) — mirrors the existing
  // app-hook isLastActiveOnly skip; denylisting avoids thousands of zero-value rows/day.
  // password / twoFactorSecret / twoFactorBackupCodes are credential material —
  // denylisted so they never land in the append-only DataChangeLog (SAF-02/04),
  // mirroring the semantic audit's SENSITIVE_FIELDS. These columns are @omit in
  // schema, but the trigger reads raw row values, so it must exclude them itself.
  // The change EVENTS are still audited semantically (PASSWORD_CHANGED,
  // TWO_FACTOR_ENABLED, …) with the value redacted — nothing is lost here.
  {
    table: "User",
    denylist: [
      "createdAt",
      "updatedAt",
      "lastActiveAt",
      "password",
      "twoFactorSecret",
      "twoFactorBackupCodes",
    ],
    nameCol: "name",
  },
  {
    table: "Projects",
    denylist: ["createdAt"],
    nameCol: "name",
    projectCol: "id",
  }, // no updatedAt column; a Projects audit belongs to its own id
  // externalData/data are opaque machine-written integration payloads (denylisted); note is a
  // human-authored TipTap description — captured, flattened at render (humanize.ts). No updatedAt.
  {
    table: "Issue",
    denylist: ["createdAt", "externalData", "data"],
    // Issue.name is the reference key (e.g. "#213"); title is the human summary
    // ("[FEATURE] Webhook System"), which reads far better in the audit log.
    nameCol: "title",
    projectCol: "projectId",
  },
  // note/docs are human-authored TipTap description columns — captured and flattened to plain text
  // at render (humanize.ts RICH_TEXT_COLUMNS). No updatedAt column.
  {
    table: "Milestones",
    denylist: ["createdAt"],
    nameCol: "name",
    projectCol: "projectId",
  },
  // content is a human-authored TipTap description — captured and flattened to plain text at render
  // (humanize.ts RICH_TEXT_COLUMNS).
  {
    table: "Comment",
    denylist: ["createdAt", "updatedAt"],
    projectCol: "projectId",
  },
  {
    table: "SharedStepGroup",
    denylist: ["createdAt", "updatedAt"],
    nameCol: "name",
    projectCol: "projectId",
  },
  { table: "Attachments", denylist: ["createdAt"], nameCol: "name" }, // no updatedAt (immutable once uploaded)
  {
    table: "ReviewRequest",
    denylist: ["createdAt", "updatedAt"],
    projectCol: "projectId",
  },

  // ── COV-04: Group B — Admin-config catalog ─────────────────────────────────
  { table: "Workflows", denylist: [], nameCol: "name" }, // no timestamp columns
  { table: "Status", denylist: [], nameCol: "name" }, // no timestamp columns
  { table: "CaseFields", denylist: [], nameCol: "displayName" }, // no timestamp columns
  { table: "ResultFields", denylist: [], nameCol: "displayName" }, // no timestamp columns
  { table: "FieldOptions", denylist: [], nameCol: "name" }, // no timestamp columns
  { table: "Tags", denylist: [], nameCol: "name" }, // no timestamp columns
  { table: "Templates", denylist: [], nameCol: "templateName" }, // no timestamp columns
  {
    table: "CaseExportTemplate",
    denylist: ["createdAt", "updatedAt"],
    nameCol: "name",
  },
  { table: "Roles", denylist: [], nameCol: "name" }, // no timestamp columns
  { table: "MilestoneTypes", denylist: [], nameCol: "name" }, // no timestamp columns
  { table: "ConfigCategories", denylist: [], nameCol: "name" }, // no timestamp columns
  { table: "ConfigVariants", denylist: [], nameCol: "name" }, // no timestamp columns
  { table: "Configurations", denylist: [], nameCol: "name" }, // no timestamp columns
  // Groups has updatedAt but no createdAt (unusual schema).
  { table: "Groups", denylist: ["updatedAt"], nameCol: "name" },

  // ── COV-04: Group C — Integration / AI / Provider catalog ──────────────────
  // SAF-02/SAF-04 trigger-layer credential guard: credentials column is denylisted to
  // prevent encrypted secrets from landing in the append-only DataChangeLog.
  {
    table: "Integration",
    denylist: ["createdAt", "updatedAt", "credentials"],
    nameCol: "name",
  },
  {
    table: "LlmIntegration",
    denylist: ["createdAt", "updatedAt", "credentials"],
    nameCol: "name",
  },
  {
    table: "CodeRepository",
    denylist: ["createdAt", "updatedAt", "credentials"],
    nameCol: "name",
  },
  { table: "SamlConfiguration", denylist: ["createdAt", "updatedAt"] },
  { table: "LlmProviderConfig", denylist: ["createdAt", "updatedAt"] },
  { table: "LlmFeatureConfig", denylist: ["createdAt", "updatedAt"] },
  { table: "OllamaModelRegistry", denylist: ["createdAt", "updatedAt"] },
  {
    table: "PromptConfig",
    denylist: ["createdAt", "updatedAt"],
    nameCol: "name",
  },
  { table: "PromptConfigPrompt", denylist: ["createdAt", "updatedAt"] },

  // ── COV-04: Group D — System config ────────────────────────────────────────
  // AppConfig PK is `key` (String @id), not `id` — requires explicit pkCol.
  { table: "AppConfig", pkCol: "key", denylist: [], nameCol: "key" }, // no timestamp columns; value IS the audited data
  {
    table: "AllowedEmailDomain",
    denylist: ["createdAt", "updatedAt"],
    nameCol: "domain",
  },

  // ── COV-04: Group E — Project-scoped link/config (scalar PK) ───────────────
  {
    table: "ProjectIntegration",
    denylist: ["createdAt", "updatedAt"],
    projectCol: "projectId",
  },
  {
    table: "ProjectLlmIntegration",
    denylist: ["createdAt", "updatedAt"],
    projectCol: "projectId",
  },
  {
    table: "ProjectCodeRepositoryConfig",
    denylist: ["createdAt", "updatedAt"],
    projectCol: "projectId",
  },
  // External-project mapping under a ProjectIntegration (projectId is two hops
  // away via projectIntegration, so no direct projectCol — self-attributes).
  {
    table: "IntegrationProject",
    denylist: ["createdAt", "updatedAt"],
    nameCol: "externalProjectName",
  },
  // Webhook configuration. token + secret are credential material and are
  // DENYLISTED so they never land in the append-only DataChangeLog (SAF-02/04);
  // the dedicated WebhookConfigSecret table stays excluded entirely.
  {
    table: "WebhookConfig",
    denylist: ["createdAt", "updatedAt", "token", "secret"],
    nameCol: "name",
    projectCol: "projectId",
  },

  // ── COV-04: Group F — Composite-PK permission/assignment tables ─────────────
  // These tables have @@id([colA, colB]) — no scalar id. pkCol = first column of the composite key.
  // denylist: [] because none of these tables have timestamp or credential columns.
  { table: "UserProjectPermission", pkCol: "userId", denylist: [] },
  { table: "GroupProjectPermission", pkCol: "groupId", denylist: [] },
  { table: "RolePermission", pkCol: "roleId", denylist: [] },
  { table: "GroupAssignment", pkCol: "userId", denylist: [] },
  { table: "ProjectAssignment", pkCol: "userId", denylist: [] },
  { table: "ProjectStatusAssignment", pkCol: "statusId", denylist: [] },
  { table: "ProjectWorkflowAssignment", pkCol: "workflowId", denylist: [] },
  {
    table: "ProjectConfigurationAssignment",
    pkCol: "configurationId",
    denylist: [],
  },
  { table: "MilestoneTypesAssignment", pkCol: "projectId", denylist: [] },
];

/**
 * Tables that must NEVER appear in TRIGGER_REGISTRY. assertRegistrySafe() enforces this so a
 * future mistake fails fast instead of attaching the generic audit trigger to the log itself
 * (DataChangeLog gets only the dedicated tpl_dcl_* append-only enforcement triggers).
 */
export const REGISTRY_PROHIBITED = [
  "DataChangeLog", // append-only audit substrate — recursion + tamper risk
  "AuditLog", // semantic audit log (app-layer captureAuditEvent)
  // BullMQ job tables are managed by BullMQ, not the application schema, and are likewise excluded.
];

/*
 * SAF-04 — credential/token tables deliberately EXCLUDED from the registry (absence is the
 * control; they are covered by semantic captureAuditEvent calls, never by row triggers):
 *   ApiToken, ScimToken, VerificationToken, PasswordHistory, Account,
 *   UserIntegrationAuth, WebhookConfigSecret, SsoProvider.
 * Do not add any of these to TRIGGER_REGISTRY.
 */

/**
 * Fail fast if any registry entry names a prohibited table. Called by the apply script
 * before connecting so a bad registry never reaches the database.
 */
export function assertRegistrySafe(): void {
  const offenders = TRIGGER_REGISTRY.filter((entry) =>
    REGISTRY_PROHIBITED.includes(entry.table)
  ).map((entry) => entry.table);
  if (offenders.length > 0) {
    throw new Error(
      `TRIGGER_REGISTRY contains prohibited table(s): ${offenders.join(", ")}. ` +
        `These must never receive the generic audit trigger (REGISTRY_PROHIBITED).`
    );
  }
}

/**
 * Single-default enforcement (a business rule, NOT audit capture). Each listed
 * table enforces "at most one row with isDefault = true" (per `scopeCol` when
 * set) via a `tpl_single_default_<table>` trigger that clears the other
 * in-scope defaults in the SAME transaction whenever a row is set default. This
 * replaces the app's non-atomic "updateMany-clear-all → set-one" client
 * sequence (which could leave zero defaults on a mid-sequence failure and
 * churned the target isDefault true→false→true). The clear excludes the target
 * row, so setting an already-default row is a no-op rather than a churn.
 *
 * The `tpl_single_default_` prefix keeps these out of the `tpl_audit_%` drift
 * self-check in scripts/apply-triggers.ts. Attaching the trigger is idempotent
 * and applied on the same startup / db-push paths as the audit triggers.
 */
export interface SingleDefaultConfig {
  table: string;
  /**
   * Column that scopes uniqueness (e.g. `Workflows.scope` — one default per
   * scope). Omit for a single global default across the whole table.
   */
  scopeCol?: string;
}

export const SINGLE_DEFAULT_REGISTRY: SingleDefaultConfig[] = [
  { table: "MilestoneTypes" }, // one default milestone type (global)
  { table: "Workflows", scopeCol: "scope" }, // one default per RUNS/SESSIONS scope
  { table: "Roles" }, // one default role
  { table: "CaseExportTemplate" }, // QuickScript admin: one default export template
  { table: "Templates" }, // one default case/result field template
  { table: "LlmProviderConfig" }, // one default LLM provider
  { table: "PromptConfig" }, // one default prompt config
  { table: "IntegrationProject", scopeCol: "projectIntegrationId" }, // one default external project per project-integration
];

/**
 * Soft-delete deletedAt stamping (a business rule, NOT audit capture). Every table
 * carrying an `isDeleted` boolean also carries a nullable `deletedAt` timestamp
 * (Option A — additive; `isDeleted` stays the queryable liveness flag). Each listed
 * table gets a `tpl_stamp_deleted_at_<table>` BEFORE UPDATE trigger that stamps
 * `deletedAt = now()` on the isDeleted false→true flip and clears it (→ NULL) on a
 * true→false restore, in the SAME write. The trigger is gated on an actual flip
 * (WHEN NEW.isDeleted IS DISTINCT FROM OLD.isDeleted), so normal updates never enter
 * the function — no overhead on hot write paths. Doing it in the DB, not app code,
 * means every soft-delete write path (both Prisma clients, raw SQL, future code) is
 * covered with zero drift; an explicit deletedAt in the flip write is respected
 * (only stamped when NULL).
 *
 * The `tpl_stamp_deleted_at_` prefix keeps these out of the `tpl_audit_%` and
 * `tpl_single_default_%` drift self-checks in scripts/apply-triggers.ts. Attaching is
 * idempotent and runs on the same startup / db-push paths as the other triggers.
 *
 * INVARIANT: this list must equal the set of models declaring `isDeleted` in
 * schema.zmodel — enforced by scripts/__tests__/softDeleteRegistry.test.ts, so a new
 * soft-deletable model that forgets its trigger fails the unit lane, not silently in prod.
 */
export interface SoftDeleteConfig {
  /** Postgres table name (exact case, no quotes — the apply script quotes it). Must have an `isDeleted` boolean + a nullable `deletedAt` column. */
  table: string;
}

export const SOFT_DELETE_REGISTRY: SoftDeleteConfig[] = [
  { table: "User" },
  { table: "Groups" },
  { table: "Roles" },
  { table: "Projects" },
  { table: "Milestones" },
  { table: "MilestoneTypes" },
  { table: "CaseFields" },
  { table: "ResultFields" },
  { table: "FieldOptions" },
  { table: "Templates" },
  { table: "CaseExportTemplate" },
  { table: "Status" },
  { table: "Workflows" },
  { table: "ConfigCategories" },
  { table: "ConfigVariants" },
  { table: "Configurations" },
  { table: "Tags" },
  { table: "Repositories" },
  { table: "RepositoryFolders" },
  { table: "RepositoryCaseLink" },
  { table: "DuplicateScanResult" },
  { table: "StepSequenceMatch" },
  { table: "StepSequenceMatchCase" },
  { table: "RepositoryCases" },
  { table: "RepositoryCaseVersions" },
  { table: "Attachments" },
  { table: "Steps" },
  { table: "TestCaseParameter" },
  { table: "Sessions" },
  { table: "SessionResults" },
  { table: "TestRuns" },
  { table: "TestRunCases" },
  { table: "TestRunResults" },
  { table: "TestRunStepResults" },
  { table: "TestRunCaseIteration" },
  { table: "TestRunCaseDataSetSnapshot" },
  { table: "Issue" },
  { table: "Integration" },
  { table: "CodeRepository" },
  { table: "LlmIntegration" },
  { table: "SharedStepGroup" },
  { table: "DataSet" },
  { table: "DataSetRow" },
  { table: "Notification" },
  { table: "ReviewRequest" },
  { table: "ShareLink" },
  { table: "PromptConfig" },
  { table: "LlmReportSnapshot" },
  { table: "Comment" },
];
