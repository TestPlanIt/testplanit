import { z } from "zod";
import { getCurrentTenantId } from "~/lib/multiTenantDb";
import { getStorageScanQueue } from "~/lib/queues";
import { db } from "~/server/db";

import { MAX_ACTION_ATTACHMENTS } from "./adminAttachmentRules";
import {
  STORAGE_OBJECT_STATUSES,
  type StorageObjectStatus,
} from "./storageScanRules";

const SORTABLE = ["key", "size", "lastModified"] as const;

/** A scan that has run this long without finishing is taken to have died. */
const STALE_SCAN_MS = 2 * 60 * 60 * 1000;

const commaList = z
  .string()
  .max(4000)
  .optional()
  .transform((value) =>
    value
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : []
  );

export const storageObjectQuerySchema = z.object({
  statuses: commaList.pipe(z.array(z.enum(STORAGE_OBJECT_STATUSES))),
  /** Folders to keep (a folder name holds no comma). */
  folders: commaList,
  q: z.string().trim().max(200).optional(),
  sortBy: z.enum(SORTABLE).default("size"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(200).default(25),
});
export type StorageObjectQuery = z.infer<typeof storageObjectQuerySchema>;

export const orphanDeleteSchema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(MAX_ACTION_ATTACHMENTS),
  /** Report what would happen without deleting anything. */
  dryRun: z.boolean().default(false),
});

export interface AdminStorageObject {
  /** The key again: the shared table identifies a row by `id`. */
  id: string;
  key: string;
  size: number;
  lastModified: string;
  folder: string;
  status: StorageObjectStatus;
  /** Whether this object may be deleted from the Storage view. */
  deletable: boolean;
}

function whereFor(query: StorageObjectQuery) {
  return {
    ...(query.statuses.length > 0 ? { status: { in: query.statuses } } : {}),
    ...(query.folders.length > 0 ? { folder: { in: query.folders } } : {}),
    ...(query.q
      ? { key: { contains: query.q, mode: "insensitive" as const } }
      : {}),
  };
}

export async function listStorageObjects(
  query: StorageObjectQuery
): Promise<{ items: AdminStorageObject[]; totalCount: number }> {
  const where = whereFor(query);
  const [rows, totalCount] = await Promise.all([
    db.storageObject.findMany({
      where,
      orderBy: [{ [query.sortBy]: query.sortDir }, { key: "asc" }],
      skip: query.skip,
      take: query.take,
    }),
    db.storageObject.count({ where }),
  ]);
  return {
    totalCount,
    items: rows.map((row) => ({
      id: row.key,
      key: row.key,
      size: Number(row.size),
      lastModified: row.lastModified.toISOString(),
      folder: row.folder,
      status: row.status,
      deletable: row.status === "ORPHAN",
    })),
  };
}

/**
 * The keys of every object a query matches, for selecting all of them
 * without paging them in. Stops at the most one action takes.
 */
export async function listStorageObjectKeys(
  query: StorageObjectQuery
): Promise<string[]> {
  const rows = await db.storageObject.findMany({
    where: whereFor(query),
    select: { key: true },
    orderBy: { key: "asc" },
    take: MAX_ACTION_ATTACHMENTS,
  });
  return rows.map((row) => row.key);
}

export interface StorageFolderSummary {
  folder: string;
  objects: number;
  bytes: number;
  orphans: number;
  orphanBytes: number;
}

export interface StorageScanState {
  /** The most recent scan, or null when none has been started. */
  scan: {
    id: number;
    status: "RUNNING" | "COMPLETED" | "FAILED";
    startedAt: string;
    finishedAt: string | null;
    objectCount: number;
    missingCount: number;
    error: string | null;
  } | null;
  /** What is in the bucket now, by folder, as of the last completed scan. */
  folders: StorageFolderSummary[];
}

export async function getStorageScanState(): Promise<StorageScanState> {
  const [scan, byFolder] = await Promise.all([
    db.storageScan.findFirst({ orderBy: { id: "desc" } }),
    db.storageObject.groupBy({
      by: ["folder", "status"],
      _count: { _all: true },
      _sum: { size: true },
    }),
  ]);

  const folders = new Map<string, StorageFolderSummary>();
  for (const group of byFolder) {
    const summary = folders.get(group.folder) ?? {
      folder: group.folder,
      objects: 0,
      bytes: 0,
      orphans: 0,
      orphanBytes: 0,
    };
    const count = group._count._all;
    const bytes = Number(group._sum.size ?? 0);
    summary.objects += count;
    summary.bytes += bytes;
    if (group.status === "ORPHAN") {
      summary.orphans += count;
      summary.orphanBytes += bytes;
    }
    folders.set(group.folder, summary);
  }

  return {
    scan: scan
      ? {
          id: scan.id,
          status: scan.status,
          startedAt: scan.startedAt.toISOString(),
          finishedAt: scan.finishedAt ? scan.finishedAt.toISOString() : null,
          objectCount: scan.objectCount,
          missingCount: scan.missingCount,
          error: scan.error,
        }
      : null,
    folders: [...folders.values()].sort((a, b) =>
      a.folder.localeCompare(b.folder)
    ),
  };
}

export type StartScanOutcome =
  | { started: true; scanId: number }
  | { started: false; reason: "alreadyRunning" | "queueUnavailable" };

/** Start a storage scan, unless one is already running. */
export async function startStorageScan(
  userId: string
): Promise<StartScanOutcome> {
  const queue = getStorageScanQueue();
  if (!queue) return { started: false, reason: "queueUnavailable" };

  const running = await db.storageScan.findFirst({
    where: { status: "RUNNING" },
    orderBy: { id: "desc" },
  });
  if (running) {
    if (Date.now() - running.startedAt.getTime() < STALE_SCAN_MS) {
      return { started: false, reason: "alreadyRunning" };
    }
    await db.storageScan.updateMany({
      where: { status: "RUNNING" },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: "The scan stopped without finishing.",
      },
    });
  }

  const scan = await db.storageScan.create({
    data: { startedById: userId },
  });
  await queue.add("storage-scan", {
    scanId: scan.id,
    tenantId: getCurrentTenantId(),
  });
  return { started: true, scanId: scan.id };
}
