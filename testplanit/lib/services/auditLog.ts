import type { AuditAction } from "@prisma/client";
import { getAuditLogQueue } from "~/lib/queues";
import { getAuditContext, type AuditContext } from "~/lib/auditContext";
import type { MultiTenantJobData } from "~/lib/multiTenantPrisma";
import { getCurrentTenantId, isMultiTenantMode } from "~/lib/multiTenantPrisma";

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
  Sessions: "title",
  Projects: "name",
  Milestones: "name",
  SharedStepGroup: "name",
  Issue: "title",
  Comment: "id",
  SsoProvider: "type",
  AllowedEmailDomain: "domain",
  AppConfig: "key",
  UserProjectPermission: ["userId", "projectId"],
  GroupProjectPermission: ["groupId", "projectId"],
  Account: ["provider", "providerAccountId"],
  UserIntegrationAuth: ["userId", "integrationType"],
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
]);

/**
 * Mask sensitive field values for audit logging.
 */
function maskSensitiveValue(fieldName: string, value: unknown): unknown {
  if (!SENSITIVE_FIELDS.has(fieldName)) {
    return value;
  }

  if (value === null || value === undefined) {
    return value;
  }

  const strValue = String(value);
  if (strValue.length <= 4) {
    return "[REDACTED]";
  }

  // Show last 4 characters for tokens/keys
  if (fieldName.toLowerCase().includes("token") || fieldName.toLowerCase().includes("key")) {
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
  const allKeys = new Set([...Object.keys(oldEntity), ...Object.keys(newEntity)]);

  for (const key of allKeys) {
    // Skip internal timestamp fields
    if (key === "createdAt" || key === "updatedAt") continue;

    const oldValue = oldEntity[key];
    const newValue = newEntity[key];

    // Compare values (handle objects/arrays with JSON comparison)
    const oldJson = JSON.stringify(oldValue);
    const newJson = JSON.stringify(newValue);

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

  const value = entity[fieldConfig];
  return value !== null && value !== undefined ? String(value) : undefined;
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

  const jobData: AuditLogJobData = {
    event,
    context,
    queuedAt: new Date().toISOString(),
    // Include tenantId for multi-tenant support
    ...(isMultiTenantMode() ? { tenantId: getCurrentTenantId() } : {}),
  };

  try {
    await queue.add("audit-event", jobData, {
      // Use entity ID for deduplication within short window
      jobId: `${event.action}-${event.entityType}-${event.entityId}-${Date.now()}`,
    });
  } catch (error) {
    // Don't throw - audit logging should never block the main operation
    console.error("[AuditLog] Failed to queue audit event:", error);
  }
}

/**
 * Capture a CREATE action audit event.
 */
export async function auditCreate(
  entityType: string,
  entity: Record<string, unknown>,
  projectId?: number
): Promise<void> {
  const entityId = String(entity.id || entity.key || "unknown");
  await captureAuditEvent({
    action: "CREATE",
    entityType,
    entityId,
    entityName: extractEntityName(entityType, entity),
    changes: calculateDiff(null, entity),
    projectId,
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
  const entityId = String(newEntity.id || newEntity.key || "unknown");
  const changes = calculateDiff(oldEntity, newEntity);

  // Only log if there are actual changes
  if (!changes || Object.keys(changes).length === 0) {
    return;
  }

  await captureAuditEvent({
    action: "UPDATE",
    entityType,
    entityId,
    entityName: extractEntityName(entityType, newEntity),
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
  projectId?: number
): Promise<void> {
  const entityId = String(entity.id || entity.key || "unknown");
  await captureAuditEvent({
    action: "DELETE",
    entityType,
    entityId,
    entityName: extractEntityName(entityType, entity),
    changes: calculateDiff(entity, null),
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
  action: "LOGIN" | "LOGOUT" | "LOGIN_FAILED",
  userId: string | null,
  userEmail: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await captureAuditEvent({
    action,
    entityType: "User",
    entityId: userId || userEmail,
    entityName: userEmail,
    userId: userId || undefined,
    userEmail,
    metadata,
  });
}

/**
 * Capture a password change event.
 */
export async function auditPasswordChange(
  userId: string,
  userEmail: string,
  isReset: boolean = false
): Promise<void> {
  await captureAuditEvent({
    action: isReset ? "PASSWORD_RESET" : "PASSWORD_CHANGED",
    entityType: "User",
    entityId: userId,
    entityName: userEmail,
    userId,
    userEmail,
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
