/**
 * Audit log retention settings, shared by the retention worker and the admin
 * archive API.
 *
 * Retention is off unless AUDIT_LOG_RETENTION_DAYS is a positive integer.
 * Entries older than that are either archived to object storage (the default)
 * or deleted outright (AUDIT_LOG_RETENTION_MODE=delete). Archive files go to
 * AUDIT_LOG_ARCHIVE_BUCKET when set, otherwise to the attachments bucket.
 *
 * In multi-tenant mode a tenant's own `auditLogRetentionDays` /
 * `auditLogRetentionMode` override the global values.
 */

export const AUDIT_LOG_ARCHIVE_PREFIX = "audit-log-archive";

export type AuditLogRetentionMode = "archive" | "delete";

export interface AuditLogRetention {
  days: number;
  mode: AuditLogRetentionMode;
}

export function parseRetentionDays(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const days = Number.parseInt(raw, 10);
  return days > 0 ? days : null;
}

export function parseRetentionMode(
  value: unknown
): AuditLogRetentionMode | null {
  if (typeof value !== "string") return null;
  const mode = value.trim().toLowerCase();
  return mode === "archive" || mode === "delete" ? mode : null;
}

/**
 * The retention in force for a tenant (or the single-tenant instance), or null
 * when retention is off. An unrecognized mode falls back to archive so a typo
 * never deletes entries.
 */
export function resolveAuditLogRetention(tenant?: {
  auditLogRetentionDays?: unknown;
  auditLogRetentionMode?: unknown;
}): AuditLogRetention | null {
  const days =
    parseRetentionDays(tenant?.auditLogRetentionDays) ??
    parseRetentionDays(process.env.AUDIT_LOG_RETENTION_DAYS);
  if (days === null) return null;
  const mode =
    parseRetentionMode(tenant?.auditLogRetentionMode) ??
    parseRetentionMode(process.env.AUDIT_LOG_RETENTION_MODE) ??
    "archive";
  return { days, mode };
}

export function getAuditLogArchiveBucket(): string | null {
  return (
    process.env.AUDIT_LOG_ARCHIVE_BUCKET?.trim() ||
    process.env.AWS_BUCKET_NAME?.trim() ||
    null
  );
}

/**
 * `audit-log-archive/[<tenantId>/]YYYY/MM/<firstTimestamp>-<firstId>-<sha256 prefix>.ndjson.gz`
 *
 * The checksum prefix means an object is only ever overwritten by identical
 * bytes, so a retried batch can never clobber an archive with different rows.
 */
export function buildAuditLogArchiveKey(params: {
  tenantId?: string;
  periodStart: Date;
  firstTimestamp: Date;
  firstId: string;
  sha256: string;
}): string {
  const { tenantId, periodStart, firstTimestamp, firstId, sha256 } = params;
  const year = String(periodStart.getUTCFullYear());
  const month = String(periodStart.getUTCMonth() + 1).padStart(2, "0");
  const stamp = firstTimestamp.toISOString().replace(/[-:.]/g, "");
  const safeId = firstId.replace(/[^A-Za-z0-9_-]/g, "");
  const segments = [AUDIT_LOG_ARCHIVE_PREFIX];
  if (tenantId) segments.push(tenantId.replace(/[^A-Za-z0-9_-]/g, "_"));
  segments.push(
    year,
    month,
    `${stamp}-${safeId}-${sha256.slice(0, 12)}.ndjson.gz`
  );
  return segments.join("/");
}
