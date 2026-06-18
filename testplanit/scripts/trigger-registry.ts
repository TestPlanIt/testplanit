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
 *   SAF-02 — per-table denylist: camelCase timestamps (where the table has them) + named
 *            TipTap rich-text columns (Steps.step/expectedResult, Sessions.note/mission,
 *            SessionVersions.note/mission, Comment.content, Issue.note/externalData/data,
 *            Milestones.note/docs) + credential columns on Integration/LlmIntegration/CodeRepository.
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
}

/** Default denylist applied to a table when its entry omits `denylist`. */
export const DEFAULT_DENYLIST = ["createdAt", "updatedAt"];

export const TRIGGER_REGISTRY: TriggerConfig[] = [
  // ── Cases family ──────────────────────────────────────────────────────────
  { table: "RepositoryCases", denylist: ["createdAt"] }, // NOTE: no updatedAt column on this table (Finding C)
  { table: "CaseFieldValues", denylist: [] }, // no timestamps
  { table: "Steps", denylist: ["createdAt", "updatedAt", "step", "expectedResult"] }, // step/expectedResult are TipTap
  { table: "TestCaseParameter", denylist: ["createdAt", "updatedAt"] },

  // Cases implicit m2m join tables (no timestamps; composite (A,B) PK → pkCol 'A')
  { table: "_RepositoryCasesToTags", pkCol: "A", denylist: [] },
  { table: "_IssueToRepositoryCases", pkCol: "A", denylist: [] },

  // ── Runs family ───────────────────────────────────────────────────────────
  { table: "TestRuns", denylist: ["createdAt", "updatedAt"] },
  { table: "TestRunCases", denylist: ["createdAt", "updatedAt"] },
  { table: "TestRunResults", denylist: ["createdAt", "updatedAt"] },
  { table: "TestRunStepResults", denylist: ["createdAt", "updatedAt"] },
  { table: "TestRunCaseIteration", denylist: ["createdAt", "updatedAt"] },
  { table: "ResultFieldValues", denylist: [] }, // no timestamps

  // Runs implicit m2m join tables
  { table: "_IssueToTestRuns", pkCol: "A", denylist: [] },
  { table: "_IssueToTestRunResults", pkCol: "A", denylist: [] },
  { table: "_IssueToTestRunStepResults", pkCol: "A", denylist: [] },

  // ── Sessions family ───────────────────────────────────────────────────────
  { table: "Sessions", denylist: ["createdAt", "updatedAt", "note", "mission"] }, // note/mission are TipTap
  { table: "SessionResults", denylist: ["createdAt", "updatedAt"] },
  { table: "SessionFieldValues", denylist: [] }, // no timestamps
  { table: "SessionVersions", denylist: ["createdAt", "updatedAt", "note", "mission"] }, // note/mission are TipTap

  // Sessions implicit m2m join tables
  { table: "_IssueToSessions", pkCol: "A", denylist: [] },
  { table: "_IssueToSessionResults", pkCol: "A", denylist: [] },
  { table: "_SessionsToTags", pkCol: "A", denylist: [] }, // [VERIFIED] live spike DB (Tags↔Sessions)
  { table: "_TagsToTestRuns", pkCol: "A", denylist: [] }, // [VERIFIED] live spike DB (Tags↔TestRuns)

  // ── COV-04: Group A — Top-level project/user entities ─────────────────────
  // lastActiveAt is write-frequent (keep-alive ping every 5 min) — mirrors the existing
  // app-hook isLastActiveOnly skip; denylisting avoids thousands of zero-value rows/day.
  { table: "User", denylist: ["createdAt", "updatedAt", "lastActiveAt"] },
  { table: "Projects", denylist: ["createdAt"] }, // no updatedAt column
  // note/externalData/data are TipTap or opaque integration payloads; no updatedAt column.
  { table: "Issue", denylist: ["createdAt", "note", "externalData", "data"] },
  // note/docs are TipTap (confirmed: AddMilestoneModal and page.tsx use TipTapEditor); no updatedAt.
  { table: "Milestones", denylist: ["createdAt", "note", "docs"] },
  // content is explicitly TipTap JSON (schema comment: "TipTap JSON format").
  { table: "Comment", denylist: ["createdAt", "updatedAt", "content"] },
  { table: "SharedStepGroup", denylist: ["createdAt", "updatedAt"] },
  { table: "Attachments", denylist: ["createdAt"] }, // no updatedAt (immutable once uploaded)
  { table: "ReviewRequest", denylist: ["createdAt", "updatedAt"] },

  // ── COV-04: Group B — Admin-config catalog ─────────────────────────────────
  { table: "Workflows", denylist: [] }, // no timestamp columns
  { table: "Status", denylist: [] }, // no timestamp columns
  { table: "CaseFields", denylist: [] }, // no timestamp columns
  { table: "ResultFields", denylist: [] }, // no timestamp columns
  { table: "FieldOptions", denylist: [] }, // no timestamp columns
  { table: "Tags", denylist: [] }, // no timestamp columns
  { table: "Templates", denylist: [] }, // no timestamp columns
  { table: "CaseExportTemplate", denylist: ["createdAt", "updatedAt"] },
  { table: "Roles", denylist: [] }, // no timestamp columns
  { table: "MilestoneTypes", denylist: [] }, // no timestamp columns
  { table: "ConfigCategories", denylist: [] }, // no timestamp columns
  { table: "ConfigVariants", denylist: [] }, // no timestamp columns
  { table: "Configurations", denylist: [] }, // no timestamp columns
  // Groups has updatedAt but no createdAt (unusual schema).
  { table: "Groups", denylist: ["updatedAt"] },

  // ── COV-04: Group C — Integration / AI / Provider catalog ──────────────────
  // SAF-02/SAF-04 trigger-layer credential guard: credentials column is denylisted to
  // prevent encrypted secrets from landing in the append-only DataChangeLog.
  { table: "Integration", denylist: ["createdAt", "updatedAt", "credentials"] },
  { table: "LlmIntegration", denylist: ["createdAt", "updatedAt", "credentials"] },
  { table: "CodeRepository", denylist: ["createdAt", "updatedAt", "credentials"] },
  { table: "SamlConfiguration", denylist: ["createdAt", "updatedAt"] },
  { table: "LlmProviderConfig", denylist: ["createdAt", "updatedAt"] },
  { table: "LlmFeatureConfig", denylist: ["createdAt", "updatedAt"] },
  { table: "OllamaModelRegistry", denylist: ["createdAt", "updatedAt"] },
  { table: "PromptConfig", denylist: ["createdAt", "updatedAt"] },
  { table: "PromptConfigPrompt", denylist: ["createdAt", "updatedAt"] },

  // ── COV-04: Group D — System config ────────────────────────────────────────
  // AppConfig PK is `key` (String @id), not `id` — requires explicit pkCol.
  { table: "AppConfig", pkCol: "key", denylist: [] }, // no timestamp columns; value IS the audited data
  { table: "AllowedEmailDomain", denylist: ["createdAt", "updatedAt"] },

  // ── COV-04: Group E — Project-scoped link/config (scalar PK) ───────────────
  { table: "ProjectIntegration", denylist: ["createdAt", "updatedAt"] },
  { table: "ProjectLlmIntegration", denylist: ["createdAt", "updatedAt"] },
  { table: "ProjectCodeRepositoryConfig", denylist: ["createdAt", "updatedAt"] },

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
  { table: "ProjectConfigurationAssignment", pkCol: "configurationId", denylist: [] },
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
    REGISTRY_PROHIBITED.includes(entry.table),
  ).map((entry) => entry.table);
  if (offenders.length > 0) {
    throw new Error(
      `TRIGGER_REGISTRY contains prohibited table(s): ${offenders.join(", ")}. ` +
        `These must never receive the generic audit trigger (REGISTRY_PROHIBITED).`,
    );
  }
}
