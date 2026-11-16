import { beforeEach, describe, expect, it, vi } from "vitest";

const { send, audit, executed, canned } = vi.hoisted(() => ({
  send: vi.fn(),
  audit: vi.fn(),
  /** Every raw statement sent, as compiled SQL. */
  executed: [] as { sql: string; parameters: readonly unknown[] }[],
  /** What the raw statements answer with. */
  canned: {
    columns: [] as { table: string; column: string }[],
    text: [] as { text: string }[],
    urls: [] as { url: string }[],
  },
}));

vi.mock("~/lib/s3Client", () => ({ getS3Client: () => ({ send }) }));
vi.mock("~/lib/services/auditLog", () => ({ captureAuditEvent: audit }));

import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";
import { deleteOrphanObjects, runStorageScan } from "./storageScan";

class CannedDriver extends DummyDriver {
  async acquireConnection() {
    return {
      executeQuery: async (compiled: any) => {
        executed.push({ sql: compiled.sql, parameters: compiled.parameters });
        if (compiled.sql.includes("information_schema")) {
          return { rows: canned.columns };
        }
        if (compiled.sql.includes("LIKE ANY")) return { rows: canned.urls };
        if (compiled.sql.includes("concat_ws")) return { rows: canned.text };
        return { rows: [] };
      },
      streamQuery: async function* () {},
    } as any;
  }
}

function fakeDb() {
  return {
    attachments: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    projects: { findMany: vi.fn().mockResolvedValue([]) },
    testmoImportJob: { findMany: vi.fn().mockResolvedValue([]) },
    storageObject: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    storageMissingFile: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $qb: new Kysely<any>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new CannedDriver(),
        createIntrospector: (db) => new PostgresIntrospector(db),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    }),
  };
}

const OLD = new Date("2026-01-01T00:00:00Z");
const object = (key: string, size = 10, lastModified = OLD) => ({
  Key: key,
  Size: size,
  LastModified: lastModified,
});

beforeEach(() => {
  vi.clearAllMocks();
  executed.length = 0;
  canned.columns = [{ table: "Projects", column: "docs" }];
  canned.text = [];
  canned.urls = [];
  vi.stubEnv("AWS_BUCKET_NAME", "bucket");
});

describe("runStorageScan", () => {
  it("marks what is in use, what is orphaned and which files are missing", async () => {
    const db = fakeDb();
    db.attachments.findMany.mockResolvedValue([
      { id: 1, url: "/api/storage/uploads/attachments/kept.png" },
      { id: 2, url: "/api/storage/uploads/attachments/gone.png" },
      { id: 3, url: "/api/storage/uploads/attachments/gone.png" },
      { id: 4, url: "https://elsewhere.example.com/not-ours.png" },
    ]);
    db.user.findMany.mockResolvedValue([
      { image: "/api/storage/uploads/avatars/me.png" },
    ]);
    db.testmoImportJob.findMany.mockResolvedValue([
      { storageKey: "uploads/imports/testmo/export.zip" },
    ]);
    canned.text = [
      { text: '{"src":"/api/storage/uploads/document-images/1/in-doc.png"}' },
    ];
    send.mockResolvedValue({
      Contents: [
        object("uploads/attachments/kept.png", 100),
        object("uploads/attachments/stray.png", 40),
        object("uploads/attachments/new.png", 5, new Date()),
        object("uploads/avatars/me.png", 7),
        object("uploads/imports/testmo/export.zip", 900),
        object("uploads/document-images/1/in-doc.png", 30),
        object("uploads/document-images/1/unused.png", 60),
      ],
    });

    const result = await runStorageScan(db as any, 7);

    expect(result).toEqual({
      objectCount: 7,
      objectBytes: 1142,
      orphanCount: 3,
      orphanBytes: 105,
      missingCount: 2,
    });

    const insert = executed.find((statement) =>
      statement.sql.includes('INSERT INTO "StorageObject"')
    )!;
    const statusOf = (key: string) =>
      insert.parameters[insert.parameters.indexOf(key) + 4];
    expect(statusOf("uploads/attachments/kept.png")).toBe("REFERENCED");
    expect(statusOf("uploads/attachments/stray.png")).toBe("ORPHAN");
    expect(statusOf("uploads/attachments/new.png")).toBe("ORPHAN");
    expect(statusOf("uploads/avatars/me.png")).toBe("REFERENCED");
    expect(statusOf("uploads/imports/testmo/export.zip")).toBe("REFERENCED");
    expect(statusOf("uploads/document-images/1/in-doc.png")).toBe("REFERENCED");
    expect(statusOf("uploads/document-images/1/unused.png")).toBe("ORPHAN");

    // The previous scan's findings give way to this one's.
    expect(db.storageObject.deleteMany).toHaveBeenCalledWith({
      where: { scanId: { not: 7 } },
    });
    expect(db.storageMissingFile.createMany).toHaveBeenCalledWith({
      data: [
        { attachmentId: 2, key: "uploads/attachments/gone.png", scanId: 7 },
        { attachmentId: 3, key: "uploads/attachments/gone.png", scanId: 7 },
      ],
    });
  });

  it("does not call a file missing when another storage host serves it", async () => {
    vi.stubEnv("AWS_ENDPOINT_URL", "https://files.example.com");
    const db = fakeDb();
    db.attachments.findMany.mockResolvedValue([
      {
        id: 1,
        url: "https://bucket.s3.us-east-1.amazonaws.com/uploads/attachments/old.png",
      },
      {
        id: 2,
        url: "https://bucket.s3.us-east-1.amazonaws.com/uploads/attachments/copied.png",
      },
      {
        id: 3,
        url: "https://files.example.com/bucket/uploads/attachments/gone.png",
      },
    ]);
    send.mockResolvedValue({
      Contents: [object("uploads/attachments/copied.png")],
    });

    const result = await runStorageScan(db as any, 7);

    expect(result.missingCount).toBe(1);
    expect(result.orphanCount).toBe(0);
    expect(db.storageMissingFile.createMany).toHaveBeenCalledWith({
      data: [
        { attachmentId: 3, key: "uploads/attachments/gone.png", scanId: 7 },
      ],
    });
  });

  it("only looks under uploads/ and follows the listing to its end", async () => {
    const db = fakeDb();
    send
      .mockResolvedValueOnce({
        Contents: [object("uploads/attachments/a.png")],
        IsTruncated: true,
        NextContinuationToken: "next",
      })
      .mockResolvedValueOnce({
        Contents: [object("uploads/attachments/b.png")],
      });

    const result = await runStorageScan(db as any, 1);

    expect(result.objectCount).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0].input).toMatchObject({
      Bucket: "bucket",
      Prefix: "uploads/",
    });
    expect(send.mock.calls[1]![0].input.ContinuationToken).toBe("next");
  });

  it("never reads the logs or the raw import staging for references", async () => {
    await runStorageScan(fakeDb() as any, 1).catch(() => {});
    const lookup = executed.find((statement) =>
      statement.sql.includes("information_schema")
    )!;
    expect(lookup.parameters).toEqual(
      expect.arrayContaining([
        "AuditLog",
        "DataChangeLog",
        "TestmoImportStaging",
      ])
    );
  });
});

describe("deleteOrphanObjects", () => {
  const orphan = (key: string, folder: string, size = 10) => ({
    key,
    folder,
    size: BigInt(size),
  });

  it("deletes orphans in any folder, and only orphans, in one request", async () => {
    const db = fakeDb();
    db.storageObject.findMany.mockResolvedValue([
      orphan("uploads/attachments/a.png", "uploads/attachments", 10),
      orphan("uploads/document-images/1/b.png", "uploads/document-images", 20),
      orphan("uploads/imports/testmo/c.zip", "uploads/imports", 999),
    ]);
    send.mockResolvedValue({});

    const result = await deleteOrphanObjects(
      db as any,
      [
        "uploads/attachments/a.png",
        "uploads/document-images/1/b.png",
        "uploads/imports/testmo/c.zip",
        "uploads/attachments/not-an-orphan.png",
      ],
      false
    );

    expect(result).toEqual({
      dryRun: false,
      deleted: 3,
      bytes: 1029,
      skipped: 1,
      failed: 0,
    });
    expect(db.storageObject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ORPHAN" }),
      })
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].input.Delete.Objects).toEqual([
      { Key: "uploads/attachments/a.png" },
      { Key: "uploads/document-images/1/b.png" },
      { Key: "uploads/imports/testmo/c.zip" },
    ]);
    expect(db.storageObject.deleteMany).toHaveBeenCalledWith({
      where: {
        key: {
          in: [
            "uploads/attachments/a.png",
            "uploads/document-images/1/b.png",
            "uploads/imports/testmo/c.zip",
          ],
        },
      },
    });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DELETE",
        entityType: "StorageObject",
        entityId: "bulk:3",
        metadata: expect.objectContaining({ count: 3, bytes: 1029 }),
      })
    );
  });

  it("keeps an orphan that an attachment or a document has come to use", async () => {
    const db = fakeDb();
    db.storageObject.findMany.mockResolvedValue([
      orphan("uploads/attachments/reused.png", "uploads/attachments"),
      orphan(
        "uploads/document-images/1/embedded.png",
        "uploads/document-images"
      ),
      orphan("uploads/attachments/free.png", "uploads/attachments"),
    ]);
    canned.urls = [{ url: "/api/storage/uploads/attachments/reused.png" }];
    canned.text = [
      { text: '"/api/storage/uploads/document-images/1/embedded.png"' },
    ];
    send.mockResolvedValue({});

    const result = await deleteOrphanObjects(
      db as any,
      [
        "uploads/attachments/reused.png",
        "uploads/document-images/1/embedded.png",
        "uploads/attachments/free.png",
      ],
      false
    );

    expect(result).toMatchObject({ deleted: 1, skipped: 2 });
    expect(send.mock.calls[0]![0].input.Delete.Objects).toEqual([
      { Key: "uploads/attachments/free.png" },
    ]);
    expect(db.storageObject.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "REFERENCED" } })
    );
  });

  it("changes nothing on a dry run", async () => {
    const db = fakeDb();
    db.storageObject.findMany.mockResolvedValue([
      orphan("uploads/attachments/a.png", "uploads/attachments", 10),
    ]);

    const result = await deleteOrphanObjects(
      db as any,
      ["uploads/attachments/a.png"],
      true
    );

    expect(result).toMatchObject({ dryRun: true, deleted: 1, bytes: 10 });
    expect(send).not.toHaveBeenCalled();
    expect(db.storageObject.deleteMany).not.toHaveBeenCalled();
    expect(db.storageObject.updateMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("keeps the record of an object storage would not delete", async () => {
    const db = fakeDb();
    db.storageObject.findMany.mockResolvedValue([
      orphan("uploads/attachments/a.png", "uploads/attachments", 10),
      orphan("uploads/attachments/b.png", "uploads/attachments", 20),
    ]);
    send.mockResolvedValue({
      Errors: [{ Key: "uploads/attachments/b.png", Code: "AccessDenied" }],
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await deleteOrphanObjects(
      db as any,
      ["uploads/attachments/a.png", "uploads/attachments/b.png"],
      false
    );

    expect(result).toMatchObject({ deleted: 1, bytes: 10, failed: 1 });
    expect(db.storageObject.deleteMany).toHaveBeenCalledWith({
      where: { key: { in: ["uploads/attachments/a.png"] } },
    });
    logged.mockRestore();
  });
});
