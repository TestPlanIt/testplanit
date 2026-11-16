import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { sql } from "kysely";
import { z } from "zod";
import { getS3Client } from "~/lib/s3Client";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { storageKeyForSrc } from "~/lib/storageKeys";
import { db } from "~/server/db";

import {
  ATTACHMENT_ACTIONS,
  LINK_MIME_TYPE,
  MAX_ACTION_ATTACHMENTS,
  type AttachmentAction,
} from "./adminAttachmentRules";

export const attachmentActionSchema = z.object({
  action: z.enum(ATTACHMENT_ACTIONS),
  ids: z.array(z.number().int().positive()).min(1).max(MAX_ACTION_ATTACHMENTS),
  /** Report what would happen without changing anything. */
  dryRun: z.boolean().default(false),
});
export type AttachmentActionRequest = z.infer<typeof attachmentActionSchema>;

/** Why an action left an attachment alone. */
export type AttachmentSkipReason =
  "notFound" | "notAttached" | "alreadyDeleted" | "notDeleted";

export interface AttachmentActionResult {
  action: AttachmentAction;
  dryRun: boolean;
  /** The attachments the action applied to (or would, on a dry run). */
  applied: number[];
  skipped: { id: number; reason: AttachmentSkipReason }[];
  /** What a purge does to the stored files behind the purged attachments. */
  files?: {
    /** Stored files removed, and their total size. */
    deleted: number;
    bytes: number;
    /** Files kept because an attachment outside this purge still uses them. */
    shared: number;
    /** Files to remove that a saved case or session version still shows. */
    inVersions: number;
    /** Files storage refused to remove; the rows are gone regardless. */
    failed: number;
  };
}

/** The foreign keys an attachment can hang off; exactly one is ever set. */
const PARENT_COLUMNS = [
  "testCaseId",
  "sessionId",
  "sessionResultsId",
  "testRunsId",
  "testRunResultsId",
  "testRunStepResultId",
  "junitTestResultId",
  "issueId",
] as const;
type ParentColumn = (typeof PARENT_COLUMNS)[number];

const ROW_SELECT = {
  id: true,
  name: true,
  url: true,
  mimeType: true,
  size: true,
  isDeleted: true,
  ...(Object.fromEntries(
    PARENT_COLUMNS.map((column) => [column, true])
  ) as Record<ParentColumn, true>),
} as const;

type ActionRow = {
  id: number;
  name: string;
  url: string;
  mimeType: string;
  size: bigint;
  isDeleted: boolean;
} & Record<ParentColumn, number | null>;

function parentOf(row: ActionRow): { column: ParentColumn; id: number } | null {
  for (const column of PARENT_COLUMNS) {
    const id = row[column];
    if (id != null) return { column, id };
  }
  return null;
}

/** Why `action` does not apply to `row`, or null when it does. */
function skipReason(
  action: AttachmentAction,
  row: ActionRow
): AttachmentSkipReason | null {
  switch (action) {
    case "detach":
      return parentOf(row) ? null : "notAttached";
    case "softDelete":
      return row.isDeleted ? "alreadyDeleted" : null;
    case "restore":
    // Permanent removal is the second step: only what is already deleted.
    case "purge":
      return row.isDeleted ? null : "notDeleted";
  }
}

interface FilePlan {
  /** Storage key and size of each file the purge removes. */
  remove: { url: string; key: string; bytes: number }[];
  shared: number;
  inVersions: number;
}

/** Rows per statement, well inside Postgres's bound-parameter limit. */
const DB_BATCH = 5_000;
/** The most keys storage deletes in one request. */
const STORAGE_BATCH = 1_000;

function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}

/** The URLs among `urls` that a saved case or session version still shows. */
async function urlsInVersions(urls: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  // A version keeps its attachments as a JSON array, or as that array encoded
  // in a JSON string; anything else holds no attachments.
  const snapshot = (table: string, batch: string[]) => sql`
    SELECT DISTINCT item->>'url' AS "url"
    FROM ${sql.table(table)} v
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE jsonb_typeof(v."attachments"::jsonb)
        WHEN 'array' THEN v."attachments"::jsonb
        WHEN 'string' THEN
          CASE WHEN (v."attachments"::jsonb #>> '{}') LIKE '[%'
            THEN (v."attachments"::jsonb #>> '{}')::jsonb
            ELSE '[]'::jsonb
          END
        ELSE '[]'::jsonb
      END
    ) item
    WHERE item->>'url' IN (${sql.join(batch)})
  `;
  for (const batch of batches(urls, DB_BATCH)) {
    const { rows } = await sql<{ url: string }>`
      ${snapshot("RepositoryCaseVersions", batch)}
      UNION
      ${snapshot("SessionVersions", batch)}
    `.execute(db.$qb);
    for (const row of rows) found.add(row.url);
  }
  return found;
}

/** What purging `rows` does to the files behind them. */
async function planFiles(rows: ActionRow[]): Promise<FilePlan> {
  // Each file once, with how many of the purged attachments point at it.
  const files = new Map<string, { row: ActionRow; purged: number }>();
  for (const row of rows) {
    if (row.mimeType === LINK_MIME_TYPE) continue;
    const file = files.get(row.url);
    if (file) file.purged += 1;
    else files.set(row.url, { row, purged: 1 });
  }
  const urls = [...files.keys()];
  if (urls.length === 0) return { remove: [], shared: 0, inVersions: 0 };

  // Copying a case copies its attachment rows, not the files, so a file goes
  // only when every attachment pointing at it is in this purge. A deleted
  // attachment counts: it can still be restored.
  const uses = new Map<string, number>();
  for (const batch of batches(urls, DB_BATCH)) {
    const { rows: counted } = await sql<{ url: string; uses: bigint }>`
      SELECT a."url", COUNT(*) AS "uses"
      FROM "Attachments" a
      WHERE a."url" IN (${sql.join(batch)})
      GROUP BY a."url"
    `.execute(db.$qb);
    for (const row of counted) uses.set(row.url, Number(row.uses));
  }

  const remove: FilePlan["remove"] = [];
  let shared = 0;
  for (const [url, { row, purged }] of files) {
    if ((uses.get(url) ?? purged) > purged) {
      shared += 1;
      continue;
    }
    const key = storageKeyForSrc(url);
    if (key) remove.push({ url, key, bytes: Number(row.size) });
  }
  const versioned = await urlsInVersions(remove.map((file) => file.url));
  return { remove, shared, inVersions: versioned.size };
}

/** Remove the planned files; returns how many storage would not give up. */
async function removeFiles(files: FilePlan["remove"]): Promise<number> {
  if (files.length === 0) return 0;
  const bucket = process.env.AWS_BUCKET_NAME;
  if (!bucket) {
    console.error(
      "[admin attachments] AWS_BUCKET_NAME is not set; stored files kept."
    );
    return files.length;
  }
  const s3 = getS3Client();
  let failed = 0;
  for (const batch of batches(files, STORAGE_BATCH)) {
    try {
      const response = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((file) => ({ Key: file.key })),
            Quiet: true,
          },
        })
      );
      const errors = response.Errors ?? [];
      failed += errors.length;
      for (const error of errors) {
        console.error(
          `[admin attachments] Could not delete ${bucket}/${error.Key}: ${error.Code} ${error.Message}`
        );
      }
    } catch (error) {
      failed += batch.length;
      console.error(
        `[admin attachments] Could not delete ${batch.length} objects from ${bucket}:`,
        error
      );
    }
  }
  return failed;
}

const AUDIT_OPERATION: Record<AttachmentAction, string> = {
  detach: "detach",
  softDelete: "soft_delete",
  restore: "restore_from_trash",
  purge: "permanent_delete",
};

/**
 * Apply one action to a set of attachments on an administrator's behalf, in
 * one request however many there are. Attachments the action does not fit are
 * skipped and reported, never an error, so a mixed selection does what it can.
 */
export async function applyAttachmentAction(
  request: AttachmentActionRequest,
  actorId: string
): Promise<AttachmentActionResult> {
  const { action, dryRun } = request;
  const ids = [...new Set(request.ids)];
  const byId = new Map<number, ActionRow>();
  for (const batch of batches(ids, DB_BATCH)) {
    const rows = (await db.attachments.findMany({
      where: { id: { in: batch } },
      select: ROW_SELECT,
    })) as ActionRow[];
    for (const row of rows) byId.set(row.id, row);
  }

  const eligible: ActionRow[] = [];
  const skipped: AttachmentActionResult["skipped"] = [];
  for (const id of ids) {
    const row = byId.get(id);
    const reason = row ? skipReason(action, row) : "notFound";
    if (row && !reason) eligible.push(row);
    else skipped.push({ id, reason: reason ?? "notFound" });
  }
  const applied = eligible.map((row) => row.id);
  const result: AttachmentActionResult = { action, dryRun, applied, skipped };

  const plan = action === "purge" ? await planFiles(eligible) : null;
  if (plan) {
    result.files = {
      deleted: plan.remove.length,
      bytes: plan.remove.reduce((sum, file) => sum + file.bytes, 0),
      shared: plan.shared,
      inVersions: plan.inVersions,
      failed: 0,
    };
  }
  if (dryRun || eligible.length === 0) return result;

  for (const batch of batches(applied, DB_BATCH)) {
    const where = { id: { in: batch } };
    switch (action) {
      case "detach":
        await db.attachments.updateMany({
          where,
          data: Object.fromEntries(
            PARENT_COLUMNS.map((column) => [column, null])
          ),
        });
        break;
      case "softDelete":
        await db.attachments.updateMany({
          where,
          data: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedById: actorId,
          },
        });
        break;
      case "restore":
        await db.attachments.updateMany({
          where,
          data: { isDeleted: false, deletedAt: null, deletedById: null },
        });
        break;
      case "purge":
        await db.attachments.deleteMany({ where });
        break;
    }
  }
  if (plan) {
    const failed = await removeFiles(plan.remove);
    result.files!.failed = failed;
    result.files!.deleted -= failed;
  }

  const operation = AUDIT_OPERATION[action];
  const auditAction = action === "purge" ? "DELETE" : "UPDATE";
  const [only] = eligible;
  if (eligible.length === 1 && only) {
    const parent = parentOf(only);
    await captureAuditEvent({
      action: auditAction,
      entityType: "Attachments",
      entityId: String(only.id),
      entityName: only.name,
      metadata: {
        operation,
        ...(action === "detach" && parent
          ? { detachedFrom: { [parent.column]: parent.id } }
          : {}),
        ...(plan ? { storageKeys: plan.remove.map((file) => file.key) } : {}),
      },
    });
  } else {
    // One audit row for the whole bulk decision rather than one per attachment.
    await captureAuditEvent({
      action: auditAction,
      entityType: "Attachments",
      entityId: `bulk:${eligible.length}`,
      metadata: {
        operation,
        bulk: true,
        count: eligible.length,
        ids: applied,
        ...(plan ? { storageKeys: plan.remove.map((file) => file.key) } : {}),
      },
    });
  }

  return result;
}
