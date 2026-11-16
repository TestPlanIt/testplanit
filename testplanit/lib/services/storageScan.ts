import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { sql } from "kysely";
import { getS3Client } from "~/lib/s3Client";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { isOnAnotherHost, storageKeyForSrc } from "~/lib/storageKeys";
import type { DbClient } from "~/lib/zenstack";

import { LINK_MIME_TYPE } from "./adminAttachmentRules";
import {
  classifyStorageObject,
  STORAGE_ROOT,
  storageFolderOf,
  storageKeysIn,
} from "./storageScanRules";

/** Rows per statement, well inside Postgres's bound-parameter limit. */
const DB_BATCH = 2_000;
/** The most keys storage deletes in one request. */
const STORAGE_BATCH = 1_000;

/**
 * Tables the search for embedded images skips: logs, whose mention of an
 * image must not keep it alive, raw import staging, and the scan's own tables.
 */
const UNSEARCHED_TABLES = [
  "AuditLog",
  "AuditLogArchive",
  "DataChangeLog",
  "TestmoImportStaging",
  "StorageObject",
  "StorageMissingFile",
  "StorageScan",
  "_prisma_migrations",
];

function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

function bucketName(): string {
  const bucket = process.env.AWS_BUCKET_NAME;
  if (!bucket) throw new Error("AWS_BUCKET_NAME is not set");
  return bucket;
}

/** Every attachment's file, as storage key → the attachments stored there. */
interface AttachmentKeys {
  /** Every key an attachment refers to, with the attachments that do. */
  keys: Map<string, number[]>;
  /**
   * Attachments whose URL is served by another storage host. They keep an
   * object of the same key alive, but this bucket cannot say their file is
   * missing.
   */
  servedElsewhere: Set<number>;
}

async function attachmentKeys(db: DbClient): Promise<AttachmentKeys> {
  const keys = new Map<string, number[]>();
  const servedElsewhere = new Set<number>();
  let after = 0;
  for (;;) {
    const rows = await db.attachments.findMany({
      where: { id: { gt: after }, mimeType: { not: LINK_MIME_TYPE } },
      select: { id: true, url: true },
      orderBy: { id: "asc" },
      take: DB_BATCH,
    });
    for (const row of rows) {
      const key = storageKeyForSrc(row.url);
      if (!key) continue;
      if (isOnAnotherHost(row.url)) servedElsewhere.add(row.id);
      const ids = keys.get(key);
      if (ids) ids.push(row.id);
      else keys.set(key, [row.id]);
    }
    const last = rows.at(-1);
    if (!last || rows.length < DB_BATCH) return { keys, servedElsewhere };
    after = last.id;
  }
}

/**
 * Every storage key named in any text or JSON column of the database: images
 * embedded in rich text, files in version snapshots, attachment URLs.
 */
export async function keysNamedInText(db: DbClient): Promise<Set<string>> {
  const { rows: columns } = await sql<{ table: string; column: string }>`
    SELECT c.table_name AS "table", c.column_name AS "column"
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying', 'json', 'jsonb')
      AND c.table_name NOT IN (${sql.join(UNSEARCHED_TABLES)})
    ORDER BY c.table_name, c.ordinal_position
  `.execute(db.$qb);

  const byTable = new Map<string, string[]>();
  for (const { table, column } of columns) {
    const list = byTable.get(table);
    if (list) list.push(column);
    else byTable.set(table, [column]);
  }

  const keys = new Set<string>();
  for (const [table, tableColumns] of byTable) {
    // One pass over the table, whatever its number of text columns.
    const text = sql`concat_ws(' ', ${sql.join(
      tableColumns.map((column) => sql`${sql.ref(column)}::text`)
    )})`;
    const { rows } = await sql<{ text: string }>`
      SELECT ${text} AS "text"
      FROM ${sql.table(table)}
      WHERE ${text} LIKE '%uploads/%'
    `.execute(db.$qb);
    for (const row of rows) {
      for (const key of storageKeysIn(row.text)) keys.add(key);
    }
  }
  return keys;
}

/** Every key something in the database refers to, other than attachments. */
async function otherReferencedKeys(db: DbClient): Promise<Set<string>> {
  const keys = await keysNamedInText(db);
  const add = (url: string | null | undefined) => {
    const key = url ? storageKeyForSrc(url) : null;
    if (key) keys.add(key);
  };

  const users = await db.user.findMany({
    where: { image: { not: null } },
    select: { image: true },
  });
  for (const user of users) add(user.image);

  const projects = await db.projects.findMany({
    where: { iconUrl: { not: null } },
    select: { iconUrl: true },
  });
  for (const project of projects) add(project.iconUrl);

  const imports = await db.testmoImportJob.findMany({
    select: { storageKey: true },
  });
  for (const job of imports) keys.add(job.storageKey);

  return keys;
}

export interface StorageScanResult {
  objectCount: number;
  objectBytes: number;
  orphanCount: number;
  orphanBytes: number;
  missingCount: number;
}

/**
 * Compare the bucket with the database: record every object under `uploads/`
 * with whether anything refers to it, and every attachment whose file is not
 * there. Replaces the previous scan's findings.
 */
export async function runStorageScan(
  db: DbClient,
  scanId: number,
  onProgress?: (objects: number) => Promise<void> | void
): Promise<StorageScanResult> {
  const bucket = bucketName();
  const s3 = getS3Client();
  const now = new Date();

  const { keys: attachments, servedElsewhere } = await attachmentKeys(db);
  const others = await otherReferencedKeys(db);
  const found = new Set<string>();
  const result: StorageScanResult = {
    objectCount: 0,
    objectBytes: 0,
    orphanCount: 0,
    orphanBytes: 0,
    missingCount: 0,
  };

  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: STORAGE_ROOT,
        ContinuationToken: token,
      })
    );
    const objects = (page.Contents ?? []).flatMap((object) =>
      object.Key
        ? [
            {
              key: object.Key,
              size: object.Size ?? 0,
              lastModified: object.LastModified ?? now,
            },
          ]
        : []
    );
    if (objects.length > 0) {
      const values = objects.map((object) => {
        const status = classifyStorageObject(
          attachments.has(object.key) || others.has(object.key)
        );
        found.add(object.key);
        result.objectCount += 1;
        result.objectBytes += object.size;
        if (status === "ORPHAN") {
          result.orphanCount += 1;
          result.orphanBytes += object.size;
        }
        return sql`(${object.key}, ${object.size}, ${object.lastModified}, ${storageFolderOf(object.key)}, ${status}::"StorageObjectStatus", ${scanId})`;
      });
      await sql`
        INSERT INTO "StorageObject"
          ("key", "size", "lastModified", "folder", "status", "scanId")
        VALUES ${sql.join(values)}
        ON CONFLICT ("key") DO UPDATE SET
          "size" = EXCLUDED."size",
          "lastModified" = EXCLUDED."lastModified",
          "folder" = EXCLUDED."folder",
          "status" = EXCLUDED."status",
          "scanId" = EXCLUDED."scanId"
      `.execute(db.$qb);
      await onProgress?.(result.objectCount);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  // What the last scan saw and this one did not is no longer in the bucket.
  await db.storageObject.deleteMany({ where: { scanId: { not: scanId } } });

  const missing: { attachmentId: number; key: string; scanId: number }[] = [];
  for (const [key, ids] of attachments) {
    if (found.has(key)) continue;
    for (const attachmentId of ids) {
      if (servedElsewhere.has(attachmentId)) continue;
      missing.push({ attachmentId, key, scanId });
    }
  }
  await db.storageMissingFile.deleteMany({});
  for (const batch of batches(missing, DB_BATCH)) {
    await db.storageMissingFile.createMany({ data: batch });
  }
  result.missingCount = missing.length;

  return result;
}

export interface OrphanDeleteResult {
  dryRun: boolean;
  /** Objects deleted (or that would be), and their total size. */
  deleted: number;
  bytes: number;
  /** Objects left alone: not an orphan, in a protected folder, or in use again. */
  skipped: number;
  /** Objects storage would not delete. */
  failed: number;
}

/** The orphans among `keys` that an attachment has come to refer to. */
async function keysUsedByAttachments(
  db: DbClient,
  keys: string[]
): Promise<Set<string>> {
  const used = new Set<string>();
  const wanted = new Set(keys);
  for (const batch of batches(keys, 500)) {
    // Every storage URL shape ends in the object key, so a suffix match
    // finds the candidates; the URL parser then confirms each.
    const patterns = batch.map(
      (key) => `%${key.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    );
    const { rows } = await sql<{ url: string }>`
      SELECT DISTINCT a."url"
      FROM "Attachments" a
      WHERE a."url" LIKE ANY (ARRAY[${sql.join(patterns)}])
    `.execute(db.$qb);
    for (const row of rows) {
      const key = storageKeyForSrc(row.url);
      if (key && wanted.has(key)) used.add(key);
    }
  }
  return used;
}

/**
 * Delete orphaned objects from storage. Each key must be an orphan from the
 * last scan in a folder whose orphans may be deleted, and is checked against
 * the database again before it is deleted, since the scan may be old. A dry
 * run skips that second check, so the delete can leave more alone than the
 * dry run said.
 */
export async function deleteOrphanObjects(
  db: DbClient,
  keys: string[],
  dryRun: boolean
): Promise<OrphanDeleteResult> {
  const unique = [...new Set(keys)];
  const orphans: { key: string; size: bigint; folder: string }[] = [];
  for (const batch of batches(unique, DB_BATCH)) {
    orphans.push(
      ...(await db.storageObject.findMany({
        where: { key: { in: batch }, status: "ORPHAN" },
        select: { key: true, size: true, folder: true },
      }))
    );
  }
  const candidates = orphans.filter((object) =>
    object.key.startsWith(STORAGE_ROOT)
  );

  // Searching the whole database takes a while, so a dry run reports from
  // the scan and only the delete itself looks again.
  const inUse = new Set<string>();
  if (!dryRun && candidates.length > 0) {
    const used = await keysUsedByAttachments(
      db,
      candidates.map((object) => object.key)
    );
    for (const key of used) inUse.add(key);
    for (const key of await keysNamedInText(db)) inUse.add(key);
  }
  const remove = candidates.filter((object) => !inUse.has(object.key));

  const result: OrphanDeleteResult = {
    dryRun,
    deleted: remove.length,
    bytes: remove.reduce((sum, object) => sum + Number(object.size), 0),
    skipped: unique.length - remove.length,
    failed: 0,
  };
  if (dryRun) return result;

  // An object found in use again is no longer an orphan, whatever happens next.
  for (const batch of batches([...inUse], DB_BATCH)) {
    await db.storageObject.updateMany({
      where: { key: { in: batch }, status: "ORPHAN" },
      data: { status: "REFERENCED" },
    });
  }
  if (remove.length === 0) return result;

  const bucket = bucketName();
  const s3 = getS3Client();
  const gone: string[] = [];
  for (const batch of batches(remove, STORAGE_BATCH)) {
    try {
      const response = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((object) => ({ Key: object.key })),
            Quiet: true,
          },
        })
      );
      const refused = new Set(
        (response.Errors ?? []).flatMap((error) =>
          error.Key ? [error.Key] : []
        )
      );
      for (const error of response.Errors ?? []) {
        console.error(
          `[storage scan] Could not delete ${bucket}/${error.Key}: ${error.Code} ${error.Message}`
        );
      }
      for (const object of batch) {
        if (!refused.has(object.key)) gone.push(object.key);
      }
    } catch (error) {
      console.error(
        `[storage scan] Could not delete ${batch.length} objects from ${bucket}:`,
        error
      );
    }
  }
  for (const batch of batches(gone, DB_BATCH)) {
    await db.storageObject.deleteMany({ where: { key: { in: batch } } });
  }

  const goneKeys = new Set(gone);
  result.failed = remove.length - gone.length;
  result.deleted = gone.length;
  result.bytes = remove
    .filter((object) => goneKeys.has(object.key))
    .reduce((sum, object) => sum + Number(object.size), 0);

  if (gone.length > 0) {
    // One audit row for the whole decision rather than one per object.
    await captureAuditEvent({
      action: "DELETE",
      entityType: "StorageObject",
      entityId: gone.length === 1 ? gone[0]! : `bulk:${gone.length}`,
      metadata: {
        operation: "delete_orphan_object",
        bulk: gone.length > 1,
        count: gone.length,
        bytes: result.bytes,
        keys: gone,
      },
    });
  }
  return result;
}
