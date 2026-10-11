import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import type { DbClient } from "~/lib/zenstack";

import { SYSTEM_ACTOR_ID } from "../lib/auditContextConstants";
import {
  disconnectAllTenantClients,
  getAllTenantIds,
  getTenantConfig,
  getTenantDbClient,
  isMultiTenantMode,
} from "../lib/multiTenantDb";
import { rawDb } from "../lib/rawDb";
import { getS3Client } from "../lib/s3Client";
import { captureAuditEvent } from "../lib/services/auditLog";
import {
  type AuditLogRetention,
  buildAuditLogArchiveKey,
  getAuditLogArchiveBucket,
  resolveAuditLogRetention,
} from "../lib/services/auditLogRetention";

/**
 * Audit log retention worker.
 *
 * Polled-loop standalone process, mirroring dataChangeLogRetentionWorker. Once
 * a day it removes AuditLog rows older than the tenant's retention window
 * (AUDIT_LOG_RETENTION_DAYS, or the tenant's own override) in one of two modes.
 *
 * archive (default) — moves rows into object storage, one calendar month (UTC)
 * at a time, in batches of BATCH_ROWS:
 *
 *   1. Select the oldest batch, serialized by Postgres itself (row_to_json),
 *      so microsecond timestamps and JSON columns survive byte-for-byte.
 *   2. gzip the NDJSON, upload it, then download it again and compare SHA-256.
 *   3. In one transaction, record the AuditLogArchive manifest row and delete
 *      exactly the archived ids.
 *
 *   A row is never deleted unless the object holding it was read back intact,
 *   and the manifest exists if and only if its rows are gone. A crash between
 *   upload and commit leaves an orphan object that the next pass overwrites
 *   with the same bytes.
 *
 * delete — batched deletes, nothing kept (e.g. to enforce a plan's history limit).
 *
 * With retention off everywhere the loop stays idle (exiting would make PM2
 * restart it in a loop).
 */

const BATCH_ROWS = 25_000;
const DELETE_CHUNK = 1000;

/** Wake once per day. */
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Per-tenant time budget, so a tenant's first-time backlog cannot starve the
 * other tenants. Whatever remains is picked up on the next pass.
 */
const TENANT_BUDGET_MS = 15 * 60 * 1000;

export interface RetentionResult {
  mode: AuditLogRetention["mode"];
  rows: number;
  objects: number;
  bytes: number;
  durationMs: number;
  /** The time budget elapsed before every eligible row was removed. */
  truncated: boolean;
  error?: string;
}

interface ArchiveOptions {
  retentionDays: number;
  bucket: string;
  s3?: S3Client;
  budgetMs?: number;
  batchRows?: number;
}

interface PurgeOptions {
  retentionDays: number;
  budgetMs?: number;
}

interface BatchRow {
  id: string;
  timestamp: Date;
  line: string;
}

let stopRequested = false;
let inflight: Promise<unknown> | null = null;

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfNextUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Archive one batch. Returns null when nothing older than the cutoff remains.
 */
async function archiveBatch(
  client: DbClient,
  s3: S3Client,
  bucket: string,
  cutoff: Date,
  batchRows: number,
  tenantId?: string
): Promise<{ rows: number; bytes: number } | null> {
  const oldest = await client.$queryRaw<Array<{ timestamp: Date }>>`
    SELECT "timestamp" FROM "AuditLog"
    WHERE "timestamp" < ${cutoff}
    ORDER BY "timestamp", id
    LIMIT 1
  `;
  if (oldest.length === 0) return null;

  const periodStart = startOfUtcMonth(oldest[0].timestamp);
  const nextMonth = startOfNextUtcMonth(periodStart);
  const periodEnd = nextMonth < cutoff ? nextMonth : cutoff;

  const rows = await client.$queryRaw<BatchRow[]>`
    SELECT a.id, a."timestamp", row_to_json(a)::text AS line
    FROM "AuditLog" a
    WHERE a."timestamp" >= ${periodStart}
      AND a."timestamp" < ${periodEnd}
    ORDER BY a."timestamp", a.id
    LIMIT ${batchRows}
  `;
  if (rows.length === 0) return null;

  const body = gzipSync(
    Buffer.from(rows.map((r) => r.line).join("\n") + "\n", "utf8")
  );
  const sha256 = sha256Hex(body);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const key = buildAuditLogArchiveKey({
    tenantId,
    periodStart,
    firstTimestamp: first.timestamp,
    firstId: first.id,
    sha256,
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/gzip",
      Metadata: {
        "row-count": String(rows.length),
        sha256,
        "first-timestamp": first.timestamp.toISOString(),
        "last-timestamp": last.timestamp.toISOString(),
      },
    })
  );

  const stored = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  const storedBytes = await stored.Body?.transformToByteArray();
  if (!storedBytes || sha256Hex(storedBytes) !== sha256) {
    throw new Error(
      `Archive object ${key} failed read-back verification; no rows were deleted`
    );
  }

  const ids = rows.map((r) => r.id);
  await client.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "AuditLogArchive"
        ("bucket", "key", "periodStart", "firstTimestamp", "lastTimestamp", "rowCount", "byteSize", "sha256")
      VALUES
        (${bucket}, ${key}, ${periodStart}, ${first.timestamp}, ${last.timestamp}, ${rows.length}, ${body.length}, ${sha256})
    `;
    for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
      const chunk = ids.slice(i, i + DELETE_CHUNK);
      await tx.$executeRaw`DELETE FROM "AuditLog" WHERE id = ANY(${chunk})`;
    }
  });

  return { rows: rows.length, bytes: body.length };
}

export async function archiveOnce(
  options: ArchiveOptions,
  client: DbClient = rawDb,
  tenantId?: string
): Promise<RetentionResult> {
  const {
    retentionDays,
    bucket,
    s3 = getS3Client(),
    budgetMs = TENANT_BUDGET_MS,
    batchRows = BATCH_ROWS,
  } = options;
  const startedAt = Date.now();
  const deadlineMs = startedAt + budgetMs;
  const cutoff = new Date(startedAt - retentionDays * 24 * 60 * 60 * 1000);
  const tenantSuffix = tenantId ? ` tenant=${tenantId}` : "";

  let rows = 0;
  let objects = 0;
  let bytes = 0;
  let drained = false;
  let error: string | undefined;

  try {
    while (Date.now() < deadlineMs) {
      const batch = await archiveBatch(
        client,
        s3,
        bucket,
        cutoff,
        batchRows,
        tenantId
      );
      if (!batch) {
        drained = true;
        break;
      }
      rows += batch.rows;
      bytes += batch.bytes;
      objects += 1;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error(`[AuditLogRetention] Archive error${tenantSuffix}:`, err);
  }

  const durationMs = Date.now() - startedAt;
  const truncated = !drained && !error;

  console.log(
    `[AuditLogRetention] archived ${rows} AuditLog rows into ${objects} objects (${bytes} bytes, cutoff=${cutoff.toISOString()}, durationMs=${durationMs})${tenantSuffix}`
  );
  if (truncated) {
    console.warn(
      `[AuditLogRetention] tenant time budget (${budgetMs}ms) elapsed${tenantSuffix}; remaining rows will be archived on the next pass`
    );
  }

  await captureAuditEvent({
    action: "AUDIT_LOG_ARCHIVED",
    entityType: "AuditLog",
    entityId: `archive-${cutoff.toISOString()}`,
    userId: SYSTEM_ACTOR_ID,
    tenantId,
    metadata: {
      retentionDays,
      bucket,
      rows,
      objects,
      bytes,
      durationMs,
      truncated,
      cutoff: cutoff.toISOString(),
      ...(error ? { error } : {}),
    },
  });

  return {
    mode: "archive",
    rows,
    objects,
    bytes,
    durationMs,
    truncated,
    error,
  };
}

export async function purgeOnce(
  options: PurgeOptions,
  client: DbClient = rawDb,
  tenantId?: string
): Promise<RetentionResult> {
  const { retentionDays, budgetMs = TENANT_BUDGET_MS } = options;
  const startedAt = Date.now();
  const deadlineMs = startedAt + budgetMs;
  const cutoff = new Date(startedAt - retentionDays * 24 * 60 * 60 * 1000);
  const tenantSuffix = tenantId ? ` tenant=${tenantId}` : "";

  let rows = 0;
  let drained = false;
  let error: string | undefined;

  try {
    while (Date.now() < deadlineMs) {
      const n = Number(
        await client.$executeRaw`
          DELETE FROM "AuditLog"
          WHERE id IN (
            SELECT id FROM "AuditLog"
            WHERE "timestamp" < ${cutoff}
            ORDER BY "timestamp", id
            LIMIT ${DELETE_CHUNK}
          )
        `
      );
      rows += n;
      if (n === 0) {
        drained = true;
        break;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error(`[AuditLogRetention] Purge error${tenantSuffix}:`, err);
  }

  const durationMs = Date.now() - startedAt;
  const truncated = !drained && !error;

  console.log(
    `[AuditLogRetention] deleted ${rows} AuditLog rows (cutoff=${cutoff.toISOString()}, durationMs=${durationMs})${tenantSuffix}`
  );
  if (truncated) {
    console.warn(
      `[AuditLogRetention] tenant time budget (${budgetMs}ms) elapsed${tenantSuffix}; remaining rows will be deleted on the next pass`
    );
  }

  await captureAuditEvent({
    action: "AUDIT_LOG_PURGED",
    entityType: "AuditLog",
    entityId: `purge-${cutoff.toISOString()}`,
    userId: SYSTEM_ACTOR_ID,
    tenantId,
    metadata: {
      retentionDays,
      rows,
      durationMs,
      truncated,
      cutoff: cutoff.toISOString(),
      ...(error ? { error } : {}),
    },
  });

  return {
    mode: "delete",
    rows,
    objects: 0,
    bytes: 0,
    durationMs,
    truncated,
    error,
  };
}

/**
 * Apply one tenant's retention. Returns null when retention is off for it, or
 * when it archives and no bucket is configured (never falls back to deleting).
 */
async function applyRetention(
  retention: AuditLogRetention | null,
  client: DbClient,
  tenantId: string | undefined,
  s3: () => S3Client
): Promise<RetentionResult | null> {
  if (!retention) return null;
  if (retention.mode === "delete") {
    return purgeOnce({ retentionDays: retention.days }, client, tenantId);
  }
  const bucket = getAuditLogArchiveBucket();
  if (!bucket) {
    console.error(
      `[AuditLogRetention] archive mode needs AUDIT_LOG_ARCHIVE_BUCKET or AWS_BUCKET_NAME; skipping${tenantId ? ` tenant=${tenantId}` : ""}`
    );
    return null;
  }
  return archiveOnce(
    { retentionDays: retention.days, bucket, s3: s3() },
    client,
    tenantId
  );
}

/**
 * Run one pass across every tenant in multi-tenant mode (each with its own
 * retention), or against rawDb in single-tenant mode. Per-tenant errors never
 * abort the rest of the pass.
 */
export async function applyRetentionAllTenantsOnce(): Promise<
  RetentionResult[]
> {
  let s3Client: S3Client | null = null;
  const s3 = () => (s3Client ??= getS3Client());

  if (!isMultiTenantMode()) {
    const result = await applyRetention(
      resolveAuditLogRetention(),
      rawDb,
      undefined,
      s3
    );
    return result ? [result] : [];
  }

  const tenantIds = getAllTenantIds();
  if (tenantIds.length === 0) return [];

  const results: RetentionResult[] = [];
  try {
    for (const tenantId of tenantIds) {
      try {
        const retention = resolveAuditLogRetention(getTenantConfig(tenantId));
        if (!retention) continue;
        const result = await applyRetention(
          retention,
          getTenantDbClient(tenantId),
          tenantId,
          s3
        );
        if (result) results.push(result);
      } catch (err) {
        console.error(
          `[AuditLogRetention] Retention error for tenant ${tenantId}:`,
          err
        );
      }
    }
  } finally {
    try {
      await disconnectAllTenantClients();
    } catch (err) {
      console.error(
        "[AuditLogRetention] Failed to disconnect tenant clients after pass:",
        err
      );
    }
  }
  return results;
}

export async function startLoop(): Promise<void> {
  const retention = resolveAuditLogRetention();
  console.log(
    `[AuditLogRetention] Starting ${isMultiTenantMode() ? "MULTI-TENANT" : "SINGLE-TENANT"} daily retention loop (cadence=${POLL_INTERVAL_MS}ms, default=${retention ? `${retention.mode} after ${retention.days} days` : "off"}, bucket=${getAuditLogArchiveBucket() ?? "<none>"})`
  );
  while (!stopRequested) {
    try {
      inflight = applyRetentionAllTenantsOnce();
      await inflight;
    } catch (err) {
      console.error("[AuditLogRetention] Retention error:", err);
    } finally {
      inflight = null;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  console.log("[AuditLogRetention] Retention loop exited");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[AuditLogRetention] Received ${signal}, shutting down...`);
  stopRequested = true;
  if (inflight) {
    try {
      await inflight;
    } catch {
      // Ignore — startLoop catches retention errors
    }
  }
  if (isMultiTenantMode()) {
    await disconnectAllTenantClients();
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  gracefulShutdown("SIGINT").catch(() => process.exit(1));
});
process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch(() => process.exit(1));
});

if (require.main === module) {
  console.log("[AuditLogRetention] Running as standalone process...");
  startLoop().catch((err) => {
    console.error("[AuditLogRetention] Loop failed:", err);
    process.exit(1);
  });
}
