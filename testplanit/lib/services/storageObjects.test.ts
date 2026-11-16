import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageScan, storageObject, add, queue } = vi.hoisted(() => {
  const add = vi.fn();
  return {
    storageScan: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    storageObject: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    add,
    queue: { current: { add } as { add: typeof add } | null },
  };
});

vi.mock("~/server/db", () => ({ db: { storageScan, storageObject } }));
vi.mock("~/lib/queues", () => ({
  getStorageScanQueue: () => queue.current,
}));
vi.mock("~/lib/multiTenantDb", () => ({
  getCurrentTenantId: () => "tenant-1",
}));

import {
  getStorageScanState,
  listStorageObjects,
  orphanDeleteSchema,
  startStorageScan,
  storageObjectQuerySchema,
} from "./storageObjects";

beforeEach(() => {
  vi.clearAllMocks();
  queue.current = { add };
  storageScan.findFirst.mockResolvedValue(null);
  storageScan.create.mockResolvedValue({ id: 5 });
});

describe("storageObjectQuerySchema", () => {
  it("lists the largest objects first by default", () => {
    expect(storageObjectQuerySchema.parse({})).toMatchObject({
      statuses: [],
      folders: [],
      sortBy: "size",
      sortDir: "desc",
      take: 25,
    });
  });

  it("takes several statuses and folders, and rejects an unknown status", () => {
    expect(
      storageObjectQuerySchema.parse({
        statuses: "ORPHAN,REFERENCED",
        folders: "uploads/attachments, uploads/imports",
      })
    ).toMatchObject({
      statuses: ["ORPHAN", "REFERENCED"],
      folders: ["uploads/attachments", "uploads/imports"],
    });
    expect(
      storageObjectQuerySchema.safeParse({ statuses: "LOST" }).success
    ).toBe(false);
  });
});

describe("orphanDeleteSchema", () => {
  it("needs at least one key", () => {
    expect(orphanDeleteSchema.safeParse({ keys: [] }).success).toBe(false);
    expect(orphanDeleteSchema.parse({ keys: ["uploads/a"] }).dryRun).toBe(
      false
    );
  });
});

describe("listStorageObjects", () => {
  it("filters, sorts and says which objects may be deleted", async () => {
    storageObject.findMany.mockResolvedValue([
      {
        key: "uploads/attachments/a.png",
        size: BigInt(10),
        lastModified: new Date("2026-01-01T00:00:00Z"),
        folder: "uploads/attachments",
        status: "ORPHAN",
      },
      {
        key: "uploads/imports/testmo/b.zip",
        size: BigInt(20),
        lastModified: new Date("2026-01-02T00:00:00Z"),
        folder: "uploads/imports",
        status: "REFERENCED",
      },
    ]);
    storageObject.count.mockResolvedValue(2);

    const { items, totalCount } = await listStorageObjects(
      storageObjectQuerySchema.parse({ statuses: "ORPHAN", q: "upl" })
    );

    expect(totalCount).toBe(2);
    expect(items.map((item) => item.deletable)).toEqual([true, false]);
    expect(items[0]).toMatchObject({
      id: "uploads/attachments/a.png",
      size: 10,
      lastModified: "2026-01-01T00:00:00.000Z",
    });
    expect(storageObject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ["ORPHAN"] },
          key: { contains: "upl", mode: "insensitive" },
        },
        orderBy: [{ size: "desc" }, { key: "asc" }],
      })
    );
  });
});

describe("getStorageScanState", () => {
  it("adds up what is in each folder and how much of it is orphaned", async () => {
    storageScan.findFirst.mockResolvedValue({
      id: 3,
      status: "COMPLETED",
      startedAt: new Date("2026-11-15T10:00:00Z"),
      finishedAt: new Date("2026-11-15T10:01:00Z"),
      objectCount: 3,
      missingCount: 2,
      error: null,
    });
    storageObject.groupBy.mockResolvedValue([
      {
        folder: "uploads/attachments",
        status: "REFERENCED",
        _count: { _all: 2 },
        _sum: { size: BigInt(100) },
      },
      {
        folder: "uploads/attachments",
        status: "ORPHAN",
        _count: { _all: 1 },
        _sum: { size: BigInt(40) },
      },
    ]);

    const state = await getStorageScanState();

    expect(state.scan).toMatchObject({ id: 3, status: "COMPLETED" });
    expect(state.folders).toEqual([
      {
        folder: "uploads/attachments",
        objects: 3,
        bytes: 140,
        orphans: 1,
        orphanBytes: 40,
      },
    ]);
  });
});

describe("startStorageScan", () => {
  it("records the scan and queues it for this tenant", async () => {
    expect(await startStorageScan("admin-1")).toEqual({
      started: true,
      scanId: 5,
    });
    expect(storageScan.create).toHaveBeenCalledWith({
      data: { startedById: "admin-1" },
    });
    expect(add).toHaveBeenCalledWith("storage-scan", {
      scanId: 5,
      tenantId: "tenant-1",
    });
  });

  it("does not start a second scan while one is running", async () => {
    storageScan.findFirst.mockResolvedValue({
      id: 4,
      startedAt: new Date(Date.now() - 60_000),
    });

    expect(await startStorageScan("admin-1")).toEqual({
      started: false,
      reason: "alreadyRunning",
    });
    expect(add).not.toHaveBeenCalled();
  });

  it("gives up on a scan that has run for hours and starts a new one", async () => {
    storageScan.findFirst.mockResolvedValue({
      id: 4,
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });

    expect((await startStorageScan("admin-1")).started).toBe(true);
    expect(storageScan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "RUNNING" },
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });

  it("says so when there is no queue to run it", async () => {
    queue.current = null;
    expect(await startStorageScan("admin-1")).toEqual({
      started: false,
      reason: "queueUnavailable",
    });
    expect(storageScan.create).not.toHaveBeenCalled();
  });
});
