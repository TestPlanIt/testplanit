import type { AuditAction } from "@prisma/client";
import { getAuditContext, type AuditContext } from "~/lib/auditContext";
import type { MultiTenantJobData } from "~/lib/multiTenantPrisma";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import { getAuditLogQueue } from "~/lib/queues";

/**
 * Represents an audit event to be logged.
 */
export interface AuditEvent {
  /** The action being performed */
  action: AuditAction;
  /** The type of entity (table name, e.g., "User", "RepositoryCases") */
  entityType: string;
  /** The ID of the entity being acted upon */
  entityId: string;
  /** Optional display name for the entity */
  entityName?: string;
  /** Field-level changes for UPDATE actions */
  changes?: Record<string, { old: unknown; new: unknown }>;
  /** Optional project ID for project-scoped entities */
  projectId?: number;
  /** Override user info (for cases where context isn't available) */
  userId?: string;
  userEmail?: string;
  userName?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Optional tenantId override (for workers where env var isn't available) */
  tenantId?: string;
}

/**
 * Job data structure for audit log queue.
 */
export interface AuditLogJobData extends MultiTenantJobData {
  event: AuditEvent;
  context: AuditContext | null;
  queuedAt: string;
}

/**
 * Configuration for entity display names.
 * Maps entity type to the field(s) used for display name.
 */
export const ENTITY_NAME_FIELDS: Record<string, string | string[]> = {
  User: "email",
  RepositoryCases: "name",
  TestRuns: "name",
  Sessions: "name",
  Projects: "name",
  Milestones: "name",
  SharedStepGroup: "name",
  Issue: "title",
  Comment: "id",
  Attachments: "name",
  SsoProvider: "name",
  AllowedEmailDomain: "domain",
  AppConfig: "key",
  ApiToken: "name",
  UserProjectPermission: ["userId", "projectId"],
  GroupProjectPermission: ["groupId", "projectId"],
  Account: ["provider", "providerAccountId"],
  UserIntegrationAuth: ["userId", "integrationId"],
  // Admin-config catalog models (see AUDITED_CONFIG_MODELS below).
  Workflows: "name",
  Status: "name",
  Configurations: "name",
  ConfigVariants: "name",
  ConfigCategories: "name",
  Roles: "name",
  Tags: "name",
  Templates: "templateName",
  CaseExportTemplate: "name",
  CaseFields: "displayName",
  ResultFields: "displayName",
  FieldOptions: "name",
  MilestoneTypes: "name",
  Groups: "name",
  Integration: "name",
  DataSet: "name",
  PromptConfig: "name",
  LlmIntegration: "name",
  CodeRepository: "name",
  SamlConfiguration: "issuer",
  LlmProviderConfig: "defaultModel",
  LlmFeatureConfig: "feature",
  OllamaModelRegistry: "modelName",
  // Admin-config join / assignment models (composite keys).
  RolePermission: ["roleId", "area"],
  GroupAssignment: ["userId", "groupId"],
  ProjectAssignment: ["userId", "projectId"],
  ProjectStatusAssignment: ["statusId", "projectId"],
  ProjectWorkflowAssignment: ["workflowId", "projectId"],
  ProjectConfigurationAssignment: ["configurationId", "projectId"],
  MilestoneTypesAssignment: ["milestoneTypeId", "projectId"],
  ProjectLlmIntegration: "llmIntegration.name",
  ProjectCodeRepositoryConfig: "repository.name",
  // Issue-integration link + test-run case link: named from their related
  // entity (see buildEntityAuditHooks / ENTITY_AUDIT_MODELS in entityAuditHooks).
  ProjectIntegration: "integration.name",
  TestRunCases: "repositoryCase.name",
  // Custom field value on a test case: named from its field definition's
  // display name (see ENTITY_AUDIT_MODELS in entityAuditHooks).
  CaseFieldValues: "field.displayName",
};

/**
 * Entity types that are project-scoped through a parent relation rather than a
 * scalar `projectId` column. Maps the audit entityType to the dotted relation
 * path that reaches the project-bearing ancestor. Consumed by
 * `resolveAuditEntityScope` to backfill `projectId` from a committed re-read.
 */
export const PROJECT_SCOPE_PARENTS: Record<string, string> = {
  TestRunCases: "testRun",
  TestRunResults: "testRun",
  TestRunCaseIteration: "testRunCase.testRun",
  CaseFieldValues: "testCase",
};

/**
 * Entity types that belong to a project, either via a scalar `projectId` column
 * or via a parent relation (see PROJECT_SCOPE_PARENTS). The audit worker only
 * attempts to backfill a missing `projectId` for these types, so global/catalog
 * entities (User, Roles, SsoProvider, …) never incur a wasted re-read and never
 * acquire a spurious project association.
 */
export const PROJECT_SCOPED_ENTITY_TYPES: ReadonlySet<string> = new Set([
  // Scalar projectId column
  "RepositoryCases",
  "TestRuns",
  "Sessions",
  "Milestones",
  "SharedStepGroup",
  "Issue",
  "Comment",
  "ReviewRequest",
  "ProjectIntegration",
  "ProjectAssignment",
  "ProjectStatusAssignment",
  "ProjectWorkflowAssignment",
  "ProjectConfigurationAssignment",
  "MilestoneTypesAssignment",
  "ProjectLlmIntegration",
  "ProjectCodeRepositoryConfig",
  "LlmFeatureConfig",
  "UserProjectPermission",
  "GroupProjectPermission",
  // Project-scoped through a parent relation (see PROJECT_SCOPE_PARENTS)
  "TestRunCases",
  "TestRunResults",
  "TestRunCaseIteration",
  "CaseFieldValues",
]);

/**
 * Describes an admin-managed configuration/catalog model whose CRUD should be
 * audited via the generic hook factory in `lib/prisma.ts`. This array is the
 * single source of truth for the admin-config audit sweep and is cross-checked
 * against the live Prisma datamodel in tests so a mistyped `accessor` (the
 * historical `issue`/`issues` dead-hook bug) fails loudly instead of silently
 * skipping audit.
 */
export interface AuditedConfigModel {
  /** Audit entityType; must match an ENTITY_NAME_FIELDS key (PascalCase model). */
  entityType: string;
  /** Prisma client accessor (camelCase model name) — the `$extends` query key. */
  accessor: string;
  /** Forward the row's `projectId` to the audit entry when present. */
  hasProjectId?: boolean;
  /**
   * "catalog" → single-entity models: create + update (also captures the
   * soft-delete `isDeleted` flip) + upsert + delete.
   * "join" → assignment/link models the admin UI mutates in bulk
   * (useCreateMany* / useDeleteMany*); also get createMany + deleteMany, and
   * derive entityId from their composite key when they lack a scalar `id`.
   */
  kind: "catalog" | "join";
}

export const AUDITED_CONFIG_MODELS: AuditedConfigModel[] = [
  // Catalog / config models
  { entityType: "Workflows", accessor: "workflows", kind: "catalog" },
  { entityType: "Status", accessor: "status", kind: "catalog" },
  { entityType: "Configurations", accessor: "configurations", kind: "catalog" },
  { entityType: "ConfigVariants", accessor: "configVariants", kind: "catalog" },
  {
    entityType: "ConfigCategories",
    accessor: "configCategories",
    kind: "catalog",
  },
  { entityType: "Roles", accessor: "roles", kind: "catalog" },
  { entityType: "Tags", accessor: "tags", kind: "catalog" },
  { entityType: "Templates", accessor: "templates", kind: "catalog" },
  {
    entityType: "CaseExportTemplate",
    accessor: "caseExportTemplate",
    kind: "catalog",
  },
  { entityType: "CaseFields", accessor: "caseFields", kind: "catalog" },
  { entityType: "ResultFields", accessor: "resultFields", kind: "catalog" },
  { entityType: "FieldOptions", accessor: "fieldOptions", kind: "catalog" },
  { entityType: "MilestoneTypes", accessor: "milestoneTypes", kind: "catalog" },
  { entityType: "Groups", accessor: "groups", kind: "catalog" },
  { entityType: "LlmIntegration", accessor: "llmIntegration", kind: "catalog" },
  { entityType: "CodeRepository", accessor: "codeRepository", kind: "catalog" },
  {
    entityType: "SamlConfiguration",
    accessor: "samlConfiguration",
    kind: "catalog",
  },
  {
    entityType: "LlmProviderConfig",
    accessor: "llmProviderConfig",
    kind: "catalog",
  },
  {
    entityType: "LlmFeatureConfig",
    accessor: "llmFeatureConfig",
    hasProjectId: true,
    kind: "catalog",
  },
  {
    entityType: "OllamaModelRegistry",
    accessor: "ollamaModelRegistry",
    kind: "catalog",
  },
  // Join / assignment models (access control + project-scoped config links)
  { entityType: "RolePermission", accessor: "rolePermission", kind: "join" },
  { entityType: "GroupAssignment", accessor: "groupAssignment", kind: "join" },
  {
    entityType: "ProjectAssignment",
    accessor: "projectAssignment",
    hasProjectId: true,
    kind: "join",
  },
  {
    entityType: "ProjectStatusAssignment",
    accessor: "projectStatusAssignment",
    hasProjectId: true,
    kind: "join",
  },
  {
    entityType: "ProjectWorkflowAssignment",
    accessor: "projectWorkflowAssignment",
    hasProjectId: true,
    kind: "join",
  },
  {
    entityType: "ProjectConfigurationAssignment",
    accessor: "projectConfigurationAssignment",
    hasProjectId: true,
    kind: "join",
  },
  {
    entityType: "MilestoneTypesAssignment",
    accessor: "milestoneTypesAssignment",
    hasProjectId: true,
    kind: "join",
  },
  {
    entityType: "ProjectLlmIntegration",
    accessor: "projectLlmIntegration",
    hasProjectId: true,
    kind: "join",
  },
  {
    entityType: "ProjectCodeRepositoryConfig",
    accessor: "projectCodeRepositoryConfig",
    hasProjectId: true,
    kind: "join",
  },
];

/**
 * Non-config entity accessors the ZenStack RPC route (`app/api/model`) audits
 * canonically on the dominant admin/app mutation path. Each accessor MUST be a
 * real Prisma client field (camelCase model name) — a singular/plural typo here
 * is silent dead code (the historical `issues`/`sharedStepGroups`/`attachment`
 * bug), so the route's audit shim never fires and the lib/prisma.ts `$extends`
 * hook becomes the sole path. Cross-checked against the live datamodel in
 * `auditLog.rpc-wiring.test.ts`. Config/catalog accessors are appended at the
 * route from AUDITED_CONFIG_MODELS; attachments are audited solely by the
 * dedicated lib/prisma.ts `attachments` hook (immutable, bespoke), so they are
 * intentionally absent here.
 */
export const AUDITED_RPC_ENTITY_ACCESSORS: readonly string[] = [
  "user",
  "userProjectPermission",
  "groupProjectPermission",
  "ssoProvider",
  "allowedEmailDomain",
  "appConfig",
  "apiToken",
];

/**
 * Maps each AUDITED_RPC_ENTITY_ACCESSORS accessor (camelCase model field) to its
 * audit entityType (PascalCase model name, an ENTITY_NAME_FIELDS key). Used by
 * the RPC route to label audit rows. Kept in lockstep with the accessor list and
 * guarded against the datamodel in `auditLog.rpc-wiring.test.ts`.
 */
export const RPC_ENTITY_TYPE_MAP: Record<string, string> = {
  user: "User",
  userProjectPermission: "UserProjectPermission",
  groupProjectPermission: "GroupProjectPermission",
  ssoProvider: "SsoProvider",
  allowedEmailDomain: "AllowedEmailDomain",
  appConfig: "AppConfig",
  apiToken: "ApiToken",
};

/**
 * Fields that should be masked in audit logs for security.
 */
const SENSITIVE_FIELDS = new Set([
  "password",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "apiKey",
  "api_key",
  "secret",
  "privateKey",
  "private_key",
  "token",
  "emailVerifToken",
  "credentials",
  "twoFactorSecret",
  "twoFactorBackupCodes",
]);

/**
 * Redact sensitive field values embedded in free-form strings (e.g., error
 * messages, serialized job payloads echoed by BullMQ/Prisma). Pattern-matches
 * `"fieldName":"value"` (JSON form) and `fieldName=value` (query-string/kv form)
 * and replaces the value with `[REDACTED]`.
 *
 * Defense-in-depth against the class of bug: if an upstream
 * library serializes a job payload containing 2FA secrets, passwords, or
 * tokens into an error message, running the message through this helper
 * before logging prevents those values from hitting the log aggregator.
 *
 * @param s The string that may contain sensitive values
 * @param fields Set of field names to redact (pass SENSITIVE_FIELDS)
 * @returns The input string with sensitive values replaced by [REDACTED]
 */
export function redactSensitiveInString(
  s: string,
  fields: Set<string>
): string {
  if (!s || fields.size === 0) return s;
  let result = s;
  for (const fieldName of fields) {
    // Escape regex-special characters in the field name defensively.
    const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Matches either JSON form ("field":"value") or kv form (field=value).
    // Group 1 captures the JSON prefix ("field":); group 2 captures kv prefix (field=).
    const pattern = new RegExp(
      `("${escaped}"\\s*:\\s*)"[^"]*"|(\\b${escaped}\\s*=\\s*)\\S+`,
      "g"
    );
    result = result.replace(pattern, (_match, jsonPrefix, kvPrefix) => {
      if (jsonPrefix) return `${jsonPrefix}"[REDACTED]"`;
      return `${kvPrefix}[REDACTED]`;
    });
  }
  return result;
}

/**
 * JSON.stringify replacer that renders BigInt as its decimal string. Used for
 * value comparison in calculateDiff so a BigInt column never aborts the diff.
 */
function bigIntJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Mask sensitive field values for audit logging.
 */
function maskSensitiveValue(fieldName: string, value: unknown): unknown {
  if (!SENSITIVE_FIELDS.has(fieldName)) {
    // Diffs are persisted as JSON (BullMQ payload + Prisma Json column), and
    // JSON.stringify throws on BigInt. Coerce BigInt scalars (e.g. a file
    // `size`, `modelSize`, `cacheTotalSize`) to strings — matching how the RPC
    // layer serializes them — so a real change to such a column is recorded
    // instead of throwing and being swallowed into a diff-less row.
    return typeof value === "bigint" ? value.toString() : value;
  }

  if (value === null || value === undefined) {
    return value;
  }

  const strValue = String(value);
  if (strValue.length <= 4) {
    return "[REDACTED]";
  }

  // Show last 4 characters for tokens/keys
  if (
    fieldName.toLowerCase().includes("token") ||
    fieldName.toLowerCase().includes("key")
  ) {
    return `[****${strValue.slice(-4)}]`;
  }

  return "[REDACTED]";
}

/**
 * Calculate the diff between old and new entity states.
 * Only includes fields that actually changed.
 */
export function calculateDiff(
  oldEntity: Record<string, unknown> | null | undefined,
  newEntity: Record<string, unknown> | null | undefined
): Record<string, { old: unknown; new: unknown }> | undefined {
  if (!oldEntity && !newEntity) {
    return undefined;
  }

  if (!oldEntity) {
    // CREATE - show all new values (masked)
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const [key, value] of Object.entries(newEntity || {})) {
      // Skip internal fields
      if (key === "createdAt" || key === "updatedAt") continue;
      changes[key] = { old: null, new: maskSensitiveValue(key, value) };
    }
    return Object.keys(changes).length > 0 ? changes : undefined;
  }

  if (!newEntity) {
    // DELETE - show all old values (masked)
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const [key, value] of Object.entries(oldEntity)) {
      // Skip internal fields
      if (key === "createdAt" || key === "updatedAt") continue;
      changes[key] = { old: maskSensitiveValue(key, value), new: null };
    }
    return Object.keys(changes).length > 0 ? changes : undefined;
  }

  // UPDATE - only include changed fields
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const allKeys = new Set([
    ...Object.keys(oldEntity),
    ...Object.keys(newEntity),
  ]);

  for (const key of allKeys) {
    // Skip internal timestamp fields
    if (key === "createdAt" || key === "updatedAt") continue;

    const oldValue = oldEntity[key];
    const newValue = newEntity[key];

    // Compare values (handle objects/arrays with JSON comparison). The replacer
    // coerces BigInt so JSON.stringify never throws on columns like `size` /
    // `modelSize` / `cacheTotalSize` (which would otherwise abort the whole diff
    // and leave a no-change-looking row).
    const oldJson = JSON.stringify(oldValue, bigIntJsonReplacer);
    const newJson = JSON.stringify(newValue, bigIntJsonReplacer);

    if (oldJson !== newJson) {
      changes[key] = {
        old: maskSensitiveValue(key, oldValue),
        new: maskSensitiveValue(key, newValue),
      };
    }
  }

  return Object.keys(changes).length > 0 ? changes : undefined;
}

/**
 * Extract entity display name from an entity object.
 */
export function extractEntityName(
  entityType: string,
  entity: Record<string, unknown> | null | undefined
): string | undefined {
  if (!entity) return undefined;

  const fieldConfig = ENTITY_NAME_FIELDS[entityType];
  if (!fieldConfig) return undefined;

  if (Array.isArray(fieldConfig)) {
    // Composite key - join values
    const parts = fieldConfig
      .map((field) => entity[field])
      .filter((v) => v !== null && v !== undefined)
      .map(String);
    return parts.length > 0 ? parts.join(":") : undefined;
  }

  // Support dot-notation for nested relation fields (e.g. "llmIntegration.name")
  if (fieldConfig.includes(".")) {
    const [rel, field] = fieldConfig.split(".", 2);
    const nested = entity[rel];
    if (nested && typeof nested === "object") {
      const value = (nested as Record<string, unknown>)[field];
      return value !== null && value !== undefined ? String(value) : undefined;
    }
    return undefined;
  }

  const value = entity[fieldConfig];
  return value !== null && value !== undefined ? String(value) : undefined;
}

/**
 * Minimal Prisma client surface needed to resolve a result's audit scope.
 * Declared structurally so both the raw base client and the access-enhanced
 * RPC client can be passed without importing either (which would create an
 * import cycle with lib/prisma).
 */
type ResultScopeClient = {
  testRuns: {
    findUnique(args: {
      where: { id: number };
      select: { projectId: true };
    }): Promise<{ projectId: number | null } | null>;
  };
  testRunCases: {
    findUnique(args: {
      where: { id: number };
      select: { repositoryCase: { select: { name: true } } };
    }): Promise<{ repositoryCase: { name: string | null } | null } | null>;
  };
};

/**
 * Resolve the project scope and display name for a TestRunResults audit row.
 *
 * A result row carries neither a `projectId` nor a name of its own. It is
 * project-scoped through its parent run (`testRunId` -> TestRuns.projectId)
 * and is named after the test case it records a result for, which lives two
 * relations away (`testRunCaseId` -> TestRunCases.repositoryCase.name). Both
 * parents are already committed by the time a result is created, so resolving
 * from the foreign keys works even when called from inside the result-create
 * transaction, where the new result row is not yet visible on a separate
 * connection. The display name reuses the same ENTITY_NAME_FIELDS path that
 * names a TestRunCases row, so a result and its test case read identically.
 */
export async function resolveTestRunResultAuditScope(
  client: ResultScopeClient,
  row: { testRunId?: number | null; testRunCaseId?: number | null }
): Promise<{ projectId?: number; entityName?: string }> {
  const [testRun, testRunCase] = await Promise.all([
    row.testRunId != null
      ? client.testRuns.findUnique({
          where: { id: row.testRunId },
          select: { projectId: true },
        })
      : Promise.resolve(null),
    row.testRunCaseId != null
      ? client.testRunCases.findUnique({
          where: { id: row.testRunCaseId },
          select: { repositoryCase: { select: { name: true } } },
        })
      : Promise.resolve(null),
  ]);
  return {
    projectId: testRun?.projectId ?? undefined,
    entityName: extractEntityName(
      "TestRunCases",
      testRunCase as Record<string, unknown> | null
    ),
  };
}

/** Derive the Prisma delegate accessor (camelCase) from a PascalCase entityType. */
function accessorForEntityType(entityType: string): string {
  return entityType.charAt(0).toLowerCase() + entityType.slice(1);
}

/**
 * Build a nested `select` include that reaches a leaf scalar through a relation
 * path. `["testRun"]` + `"projectId"` -> `{ testRun: { select: { projectId: true } } }`;
 * `["testRunCase", "testRun"]` -> `{ testRunCase: { select: { testRun: { select: { projectId: true } } } } }`.
 */
function nestedSelectInclude(
  path: string[],
  leaf: string
): Record<string, unknown> {
  const [head, ...rest] = path;
  if (rest.length === 0) {
    return { [head]: { select: { [leaf]: true } } };
  }
  return { [head]: { select: nestedSelectInclude(rest, leaf) } };
}

/** Read a leaf scalar through a relation path, returning undefined on any gap. */
function nestedValue(obj: unknown, path: string[], leaf: string): unknown {
  let cur: unknown = obj;
  for (const segment of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  if (cur == null || typeof cur !== "object") return undefined;
  return (cur as Record<string, unknown>)[leaf];
}

/** Structural Prisma surface: any delegate exposing a permissive findUnique. */
type AuditScopeClient = Record<
  string,
  | {
      findUnique?: (args: {
        where: Record<string, unknown>;
        include?: Record<string, unknown>;
      }) => Promise<Record<string, unknown> | null>;
    }
  | undefined
>;

/**
 * Re-read a committed entity by id to recover a display name and/or project
 * scope the emitter could not capture at enqueue time. The dominant cause is a
 * ZenStack RPC mutation whose result is a partial `{ id }` (it injects
 * `select: { id: true }`), so the inline name/projectId resolution sees nulls;
 * a secondary cause is rows project-scoped only through a parent relation.
 *
 * This is a post-commit, best-effort backfill run from the audit worker: the
 * mutation's transaction has already committed, so a fresh read on a separate
 * connection always sees the row (unlike the pre-commit `$extends` hooks). Any
 * failure — synthetic/composite id, hard-deleted row, unknown model, query
 * error — returns the empty gap-set so the audit write is never blocked. Only
 * the gaps named in `opts` are resolved; nothing already captured is touched.
 */
export async function resolveAuditEntityScope(
  client: AuditScopeClient,
  entityType: string,
  entityId: string,
  opts: { needName: boolean; needProjectId: boolean }
): Promise<{ entityName?: string; projectId?: number }> {
  const { needName, needProjectId } = opts;
  if (!needName && !needProjectId) return {};

  const nameConfig = ENTITY_NAME_FIELDS[entityType];
  const parentPath = PROJECT_SCOPE_PARENTS[entityType];
  const projectScoped = PROJECT_SCOPED_ENTITY_TYPES.has(entityType);

  // Decide whether a re-read can possibly help before paying for the query.
  const canResolveName = needName && nameConfig != null;
  const canResolveProjectId = needProjectId && projectScoped;
  if (!canResolveName && !canResolveProjectId) return {};

  // Synthetic ids (bulk ops), composite-key strings ("5:390"), and empty ids
  // cannot be re-read by a single-column primary key.
  if (
    !entityId ||
    entityId.includes(":") ||
    /^(bulk|createMany|deleteMany|create|update|delete)-/.test(entityId)
  ) {
    return {};
  }

  const delegate = client[accessorForEntityType(entityType)];
  if (!delegate?.findUnique) return {};

  // Compose the include: relation-derived name (dot-notation config) and/or a
  // parent-derived projectId. Scalar fields (own `name`, own `projectId`) are
  // returned by findUnique without an explicit include.
  const include: Record<string, unknown> = {};
  if (
    canResolveName &&
    typeof nameConfig === "string" &&
    nameConfig.includes(".")
  ) {
    const [rel, field] = nameConfig.split(".", 2);
    include[rel] = { select: { [field]: true } };
  }
  if (canResolveProjectId && parentPath) {
    Object.assign(
      include,
      nestedSelectInclude(parentPath.split("."), "projectId")
    );
  }

  // Numeric PKs must be passed as numbers; cuid/string PKs pass through.
  const idValue: string | number = /^\d+$/.test(entityId)
    ? Number(entityId)
    : entityId;

  let row: Record<string, unknown> | null;
  try {
    row = await delegate.findUnique(
      Object.keys(include).length > 0
        ? { where: { id: idValue }, include }
        : { where: { id: idValue } }
    );
  } catch {
    return {};
  }
  if (!row) return {};

  const resolved: { entityName?: string; projectId?: number } = {};
  if (canResolveName) {
    const name = extractEntityName(entityType, row);
    if (name) resolved.entityName = name;
  }
  if (canResolveProjectId) {
    if (typeof row.projectId === "number") {
      resolved.projectId = row.projectId;
    } else if (parentPath) {
      const pid = nestedValue(row, parentPath.split("."), "projectId");
      if (typeof pid === "number") resolved.projectId = pid;
    }
  }
  return resolved;
}

/**
 * Queue an audit event for async processing.
 * This is the main entry point for capturing audit events.
 * Returns immediately without blocking the mutation.
 */
export async function captureAuditEvent(event: AuditEvent): Promise<void> {
  const queue = getAuditLogQueue();
  if (!queue) {
    // Queue not available (Valkey not connected)
    // Log to console as fallback
    console.warn("[AuditLog] Queue not available, logging to console:", {
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
    });
    return;
  }

  const context = getAuditContext() || null;
  const existingMetadata = event.metadata;
  const alsSystemReason = context?.systemReason;
  // Phase 5 (TOK-01 / SRV-06 / T-05-03): derive metadata.source from the
  // authenticating token's scopes. The value lives on the ALS frame
  // (set by enrichFromApiAuth) and is unforgeable by request-time headers.
  // Bearer-with-MCP-scope -> "mcp"; any other Bearer -> "api"; no token
  // (session auth) or empty scopes -> undefined. Caller-explicit
  // event.metadata.source wins over derived value to preserve intent
  // for hand-stamped sources like "import".
  // SCIM auth: when the request was authed via a tps_ bearer the audit
  // context's scimTokenId field is set; the SCIM branch wins over the
  // scope-derived attribution below because the two auth surfaces are
  // mutually exclusive at the route layer (a single request cannot carry
  // both a SCIM bearer and an ApiToken). When the SCIM branch fires, the
  // token id is also hand-stamped onto metadata.scimTokenId so each audit
  // row carries the per-token discriminator alongside the source label.
  const alsScimTokenId = context?.scimTokenId;
  const alsScimGroupId = context?.scimGroupId;
  const derivedSource: "mcp" | "api" | "scim" | undefined = alsScimTokenId
    ? "scim"
    : context?.tokenScopes && context.tokenScopes.length > 0
      ? context.tokenScopes.includes("client:mcp")
        ? "mcp"
        : "api"
      : undefined;
  const mergedMetadata: Record<string, unknown> | undefined =
    alsSystemReason || derivedSource || alsScimGroupId
      ? {
          ...(existingMetadata ?? {}),
          ...(alsSystemReason
            ? {
                systemReason:
                  (existingMetadata?.systemReason as string | undefined) ??
                  alsSystemReason,
              }
            : {}),
          ...(derivedSource && existingMetadata?.source === undefined
            ? { source: derivedSource }
            : {}),
          ...(derivedSource === "scim" &&
          alsScimTokenId &&
          existingMetadata?.scimTokenId === undefined
            ? { scimTokenId: alsScimTokenId }
            : {}),
          ...(alsScimGroupId && existingMetadata?.scimGroupId === undefined
            ? { scimGroupId: alsScimGroupId }
            : {}),
        }
      : existingMetadata;
  const eventWithMergedMetadata: AuditEvent =
    mergedMetadata === existingMetadata
      ? event
      : { ...event, metadata: mergedMetadata };

  const jobData: AuditLogJobData = {
    event: eventWithMergedMetadata,
    context,
    queuedAt: new Date().toISOString(),
    // Include tenantId for multi-tenant support
    // Use explicitly passed tenantId (from workers) or fall back to env var
    tenantId: event.tenantId ?? getCurrentTenantId(),
  };

  try {
    // BullMQ rejects `:` in custom job IDs. Entity IDs may legitimately
    // contain `:` as a pair separator (e.g., DUPLICATE_RESOLVED uses
    // `${caseAId}:${caseBId}`), so sanitize here rather than force every
    // caller to pre-mangle their entity IDs.
    const safeEntityId = String(event.entityId).replace(/:/g, "_");
    await queue.add("audit-event", jobData, {
      // Use entity ID for deduplication within short window
      jobId: `${event.action}-${event.entityType}-${safeEntityId}-${Date.now()}`,
    });
  } catch (error) {
    // Don't throw - audit logging should never block the main operation.
    // Emit a structured payload so ops can diagnose enqueue failures
    // without leaking sensitive values that BullMQ/Prisma errors may echo
    // from serialized job payloads (defense-in-depth against CR-01 regressions).
    const err = error instanceof Error ? error : new Error(String(error));
    const rawMessage = err.message ?? "";
    const redactedMessage = redactSensitiveInString(
      rawMessage,
      SENSITIVE_FIELDS
    );
    console.error("[AuditLog] Failed to queue audit event:", {
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      userId: event.userId ?? context?.userId ?? null,
      requestId: context?.requestId ?? null,
      errorName: err.name,
      errorMessage: redactedMessage,
    });
  }
}

/**
 * Whether the current request has opted out of generic entity-audit emission
 * (set by the ZenStack RPC route, which audits canonically via its own shim).
 * The generic CREATE/UPDATE/DELETE + BULK_* helpers honor this. The specialized
 * semantic helpers (role change, SSO/system config, permission grant/revoke)
 * stay ungated so admin routes that call them directly always emit; the
 * lib/prisma.ts `$extends` hooks that ALSO wrap those helpers for apiToken /
 * appConfig / ssoProvider consult this at their call site, because on the RPC
 * path the route's shim already emits the canonical semantic row for them.
 */
export function isEntityAuditSuppressed(): boolean {
  return getAuditContext()?.suppressEntityAudit === true;
}

/**
 * Capture a CREATE action audit event.
 */
export async function auditCreate(
  entityType: string,
  entity: Record<string, unknown>,
  projectId?: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (isEntityAuditSuppressed()) return;
  const entityId = String(
    entity.id ||
      entity.key ||
      extractEntityName(entityType, entity) ||
      "unknown"
  );
  await captureAuditEvent({
    action: "CREATE",
    entityType,
    entityId,
    entityName: extractEntityName(entityType, entity),
    changes: calculateDiff(null, entity),
    projectId,
    metadata,
  });
}

/**
 * Capture an UPDATE action audit event.
 */
export async function auditUpdate(
  entityType: string,
  oldEntity: Record<string, unknown> | null,
  newEntity: Record<string, unknown>,
  projectId?: number
): Promise<void> {
  if (isEntityAuditSuppressed()) return;
  const entityId = String(
    newEntity.id ||
      newEntity.key ||
      extractEntityName(entityType, newEntity) ||
      "unknown"
  );
  const changes = calculateDiff(oldEntity, newEntity);

  // Only log if there are actual changes
  if (!changes || Object.keys(changes).length === 0) {
    return;
  }

  await captureAuditEvent({
    action: "UPDATE",
    entityType,
    entityId,
    // newEntity may be a partial result (caller passed a select that omitted
    // the name field). Fall back to oldEntity so entityName is never blank.
    entityName:
      extractEntityName(entityType, newEntity) ??
      extractEntityName(entityType, oldEntity ?? {}),
    changes,
    projectId,
  });
}

/**
 * Capture a DELETE action audit event.
 */
export async function auditDelete(
  entityType: string,
  entity: Record<string, unknown>,
  projectId?: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (isEntityAuditSuppressed()) return;
  const entityId = String(
    entity.id ||
      entity.key ||
      extractEntityName(entityType, entity) ||
      "unknown"
  );
  await captureAuditEvent({
    action: "DELETE",
    entityType,
    entityId,
    entityName: extractEntityName(entityType, entity),
    changes: calculateDiff(entity, null),
    projectId,
    metadata,
  });
}

/**
 * Capture a CREATE/UPDATE/DELETE audit event with a caller-resolved display
 * name and pre-split old/new rows. Unlike auditCreate/auditUpdate/auditDelete
 * (which derive the name from the row via extractEntityName), this primitive
 * accepts an explicit entityName so callers can name join/link rows from a
 * related entity that is not part of the diffed scalar set — and so they can
 * still supply a name on the ZenStack RPC path, where the mutation result is a
 * partial `{ id }` row. UPDATE no-ops when nothing changed, matching
 * auditUpdate(); honors the request-level entity-audit suppression flag.
 */
export async function auditEntity(params: {
  action: "CREATE" | "UPDATE" | "DELETE";
  entityType: string;
  entityId: string;
  entityName?: string;
  oldRow?: Record<string, unknown> | null;
  newRow?: Record<string, unknown> | null;
  projectId?: number;
}): Promise<void> {
  if (isEntityAuditSuppressed()) return;
  const {
    action,
    entityType,
    entityId,
    entityName,
    oldRow,
    newRow,
    projectId,
  } = params;

  const changes =
    action === "CREATE"
      ? calculateDiff(null, newRow)
      : action === "DELETE"
        ? calculateDiff(oldRow, null)
        : calculateDiff(oldRow, newRow);

  // Match auditUpdate(): never persist a no-op UPDATE row.
  if (action === "UPDATE" && (!changes || Object.keys(changes).length === 0)) {
    return;
  }

  await captureAuditEvent({
    action,
    entityType,
    entityId,
    entityName,
    changes,
    projectId,
  });
}

/**
 * Capture a role change event (special case of UPDATE).
 */
export async function auditRoleChange(
  userId: string,
  oldAccess: string | null,
  newAccess: string,
  userEmail?: string
): Promise<void> {
  await captureAuditEvent({
    action: "ROLE_CHANGED",
    entityType: "User",
    entityId: userId,
    entityName: userEmail,
    changes: {
      access: { old: oldAccess, new: newAccess },
    },
  });
}

/**
 * Capture a permission grant event.
 */
export async function auditPermissionGrant(
  entityType: "UserProjectPermission" | "GroupProjectPermission",
  entity: Record<string, unknown>,
  projectId: number
): Promise<void> {
  const entityId = extractEntityName(entityType, entity) || String(entity.id);
  await captureAuditEvent({
    action: "PERMISSION_GRANT",
    entityType,
    entityId,
    changes: calculateDiff(null, entity),
    projectId,
  });
}

/**
 * Capture a permission revoke event.
 */
export async function auditPermissionRevoke(
  entityType: "UserProjectPermission" | "GroupProjectPermission",
  entity: Record<string, unknown>,
  projectId: number
): Promise<void> {
  const entityId = extractEntityName(entityType, entity) || String(entity.id);
  await captureAuditEvent({
    action: "PERMISSION_REVOKE",
    entityType,
    entityId,
    changes: calculateDiff(entity, null),
    projectId,
  });
}

/**
 * Capture an authentication event (login, logout, failed login).
 */
export async function auditAuthEvent(
  action:
    | "LOGIN"
    | "LOGOUT"
    | "LOGIN_FAILED"
    | "MAGIC_LINK_REQUESTED"
    | "TWO_FACTOR_ENABLED"
    | "TWO_FACTOR_SETUP_REQUIRED"
    | "TWO_FACTOR_CODES_REGENERATED"
    | "TWO_FACTOR_VERIFIED"
    | "SHARE_LINK_PASSWORD_VERIFY"
    | "ACCOUNT_LOCKED"
    | "ACCOUNT_UNLOCKED",
  userId: string | null,
  userEmail: string,
  metadata?: Record<string, unknown>,
  userName?: string | null
): Promise<void> {
  await captureAuditEvent({
    action,
    entityType: "User",
    entityId: userId || userEmail,
    entityName: userEmail,
    userId: userId || undefined,
    userEmail,
    userName: userName || undefined,
    metadata,
  });
}

/**
 * Capture a password change event.
 */
export async function auditPasswordChange(
  userId: string,
  userEmail: string,
  isReset: boolean = false,
  userName?: string | null
): Promise<void> {
  await captureAuditEvent({
    action: isReset ? "PASSWORD_RESET" : "PASSWORD_CHANGED",
    entityType: "User",
    entityId: userId,
    entityName: userEmail,
    userId,
    userEmail,
    userName: userName || undefined,
  });
}

/**
 * Capture a system configuration change event.
 */
export async function auditSystemConfigChange(
  configKey: string,
  oldValue: unknown,
  newValue: unknown
): Promise<void> {
  await captureAuditEvent({
    action: "SYSTEM_CONFIG_CHANGED",
    entityType: "AppConfig",
    entityId: configKey,
    entityName: configKey,
    changes: {
      value: { old: oldValue, new: newValue },
    },
  });
}

/**
 * Capture an SSO configuration change event.
 */
export async function auditSsoConfigChange(
  action: "CREATE" | "UPDATE" | "DELETE",
  ssoProvider: Record<string, unknown>
): Promise<void> {
  const entityId = String(ssoProvider.id || ssoProvider.type);
  await captureAuditEvent({
    action: "SSO_CONFIG_CHANGED",
    entityType: "SsoProvider",
    entityId,
    entityName: String(ssoProvider.type),
    metadata: {
      originalAction: action,
    },
  });
}

/**
 * Capture a data export event.
 */
export async function auditDataExport(
  exportType: string,
  entityType: string,
  filters?: Record<string, unknown>
): Promise<void> {
  await captureAuditEvent({
    action: "DATA_EXPORTED",
    entityType,
    entityId: exportType,
    entityName: `${entityType} Export`,
    metadata: {
      exportType,
      filters,
    },
  });
}

/**
 * Capture a bulk CREATE action audit event.
 */
export async function auditBulkCreate(
  entityType: string,
  count: number,
  projectId?: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (isEntityAuditSuppressed()) return;
  await captureAuditEvent({
    action: "BULK_CREATE",
    entityType,
    entityId: `bulk-${Date.now()}`,
    entityName: `${count} ${entityType}`,
    projectId,
    metadata: {
      count,
      ...metadata,
    },
  });
}

/**
 * Capture a bulk UPDATE action audit event.
 */
export async function auditBulkUpdate(
  entityType: string,
  count: number,
  where: Record<string, unknown>,
  projectId?: number
): Promise<void> {
  if (isEntityAuditSuppressed()) return;
  await captureAuditEvent({
    action: "BULK_UPDATE",
    entityType,
    entityId: `bulk-${Date.now()}`,
    entityName: `${count} ${entityType}`,
    projectId,
    metadata: {
      count,
      where,
    },
  });
}

/**
 * Capture a bulk DELETE action audit event.
 */
export async function auditBulkDelete(
  entityType: string,
  count: number,
  where: Record<string, unknown>,
  projectId?: number
): Promise<void> {
  if (isEntityAuditSuppressed()) return;
  await captureAuditEvent({
    action: "BULK_DELETE",
    entityType,
    entityId: `bulk-${Date.now()}`,
    entityName: `${count} ${entityType}`,
    projectId,
    metadata: {
      count,
      where,
    },
  });
}
