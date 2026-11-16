import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, updateMany, deleteMany, versionRows, useRows, send, audit } =
  vi.hoisted(() => ({
    findMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    /** The URLs the version-snapshot lookup reports. */
    versionRows: { current: [] as { url: string }[] },
    /** How many attachments use each URL, as the usage count reports. */
    useRows: { current: [] as { url: string; uses: bigint }[] },
    send: vi.fn(),
    audit: vi.fn(),
  }));

vi.mock("~/server/db", async () => {
  const {
    DummyDriver,
    Kysely,
    PostgresAdapter,
    PostgresIntrospector,
    PostgresQueryCompiler,
  } = await import("kysely");

  class CannedDriver extends DummyDriver {
    async acquireConnection() {
      return {
        executeQuery: async (compiled: any) => ({
          rows: compiled.sql.includes("GROUP BY")
            ? useRows.current
            : versionRows.current,
        }),
        streamQuery: async function* () {},
      } as any;
    }
  }

  return {
    db: {
      attachments: { findMany, updateMany, deleteMany },
      $qb: new Kysely<any>({
        dialect: {
          createAdapter: () => new PostgresAdapter(),
          createDriver: () => new CannedDriver(),
          createIntrospector: (db) => new PostgresIntrospector(db),
          createQueryCompiler: () => new PostgresQueryCompiler(),
        },
      }),
    },
  };
});
vi.mock("~/lib/s3Client", () => ({ getS3Client: () => ({ send }) }));
vi.mock("~/lib/services/auditLog", () => ({ captureAuditEvent: audit }));

import {
  applyAttachmentAction,
  attachmentActionSchema,
} from "./adminAttachmentActions";

const file = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `file-${id}.png`,
  url: `/api/storage/uploads/attachments/file-${id}.png`,
  mimeType: "image/png",
  size: BigInt(1000),
  isDeleted: false,
  testCaseId: null,
  sessionId: null,
  sessionResultsId: null,
  testRunsId: null,
  testRunResultsId: null,
  testRunStepResultId: null,
  junitTestResultId: null,
  issueId: null,
  ...overrides,
});

/**
 * `rows` are the attachments acted on. `uses` says how many attachments in
 * all point at a URL, for the files something outside `rows` also uses.
 */
function stubRows(
  rows: ReturnType<typeof file>[],
  uses: Record<string, number> = {}
) {
  findMany.mockResolvedValue(rows);
  useRows.current = Object.entries(uses).map(([url, count]) => ({
    url,
    uses: BigInt(count),
  }));
}

const deletedKeys = () =>
  send.mock.calls.flatMap((call) =>
    call[0].input.Delete.Objects.map((object: { Key: string }) => object.Key)
  );

const run = (
  action: "detach" | "softDelete" | "restore" | "purge",
  ids: number[],
  dryRun = false
) =>
  applyAttachmentAction(
    attachmentActionSchema.parse({ action, ids, dryRun }),
    "admin-1"
  );

beforeEach(() => {
  vi.clearAllMocks();
  versionRows.current = [];
  useRows.current = [];
  send.mockResolvedValue({});
  vi.stubEnv("AWS_BUCKET_NAME", "bucket");
});

describe("attachmentActionSchema", () => {
  it("needs a known action and at least one id", () => {
    expect(
      attachmentActionSchema.safeParse({ action: "purge", ids: [] }).success
    ).toBe(false);
    expect(
      attachmentActionSchema.safeParse({ action: "wipe", ids: [1] }).success
    ).toBe(false);
  });
});

describe("applyAttachmentAction", () => {
  it("detaches from whatever the attachment hangs off and records it", async () => {
    stubRows([file(1, { testRunsId: 9 }), file(2)]);

    const result = await run("detach", [1, 2, 3]);

    expect(result.applied).toEqual([1]);
    expect(result.skipped).toEqual([
      { id: 2, reason: "notAttached" },
      { id: 3, reason: "notFound" },
    ]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: expect.objectContaining({ testRunsId: null, testCaseId: null }),
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "UPDATE",
        entityId: "1",
        metadata: expect.objectContaining({
          operation: "detach",
          detachedFrom: { testRunsId: 9 },
        }),
      })
    );
  });

  it("deletes what is live and restores what is deleted", async () => {
    stubRows([file(1), file(2, { isDeleted: true })]);

    const deleted = await run("softDelete", [1, 2]);
    expect(deleted.applied).toEqual([1]);
    expect(deleted.skipped).toEqual([{ id: 2, reason: "alreadyDeleted" }]);
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: { in: [1] } },
      data: expect.objectContaining({
        isDeleted: true,
        deletedById: "admin-1",
      }),
    });

    const restored = await run("restore", [1, 2]);
    expect(restored.applied).toEqual([2]);
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: { in: [2] } },
      data: { isDeleted: false, deletedAt: null, deletedById: null },
    });
  });

  it("changes nothing on a dry run", async () => {
    stubRows([file(1, { isDeleted: true })]);

    const result = await run("purge", [1], true);

    expect(result.applied).toEqual([1]);
    expect(result.files).toMatchObject({ deleted: 1, bytes: 1000 });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("purges only what is already deleted", async () => {
    stubRows([file(1), file(2, { isDeleted: true })]);

    const result = await run("purge", [1, 2]);

    expect(result.applied).toEqual([2]);
    expect(result.skipped).toEqual([{ id: 1, reason: "notDeleted" }]);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2] } } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].input.Bucket).toBe("bucket");
    expect(deletedKeys()).toEqual(["uploads/attachments/file-2.png"]);
  });

  it("keeps a file another attachment still uses", async () => {
    const shared = "/api/storage/uploads/attachments/shared.png";
    stubRows(
      [file(1, { isDeleted: true, url: shared }), file(2, { isDeleted: true })],
      { [shared]: 2 }
    );

    const result = await run("purge", [1, 2]);

    expect(result.applied).toEqual([1, 2]);
    expect(result.files).toMatchObject({ deleted: 1, shared: 1 });
    expect(deletedKeys()).toEqual(["uploads/attachments/file-2.png"]);
  });

  it("removes a file once when every attachment using it is purged together", async () => {
    const shared = "/api/storage/uploads/attachments/shared.png";
    stubRows(
      [
        file(1, { isDeleted: true, url: shared }),
        file(2, { isDeleted: true, url: shared }),
      ],
      { [shared]: 2 }
    );

    const result = await run("purge", [1, 2]);

    expect(result.files).toMatchObject({ deleted: 1, bytes: 1000, shared: 0 });
    expect(deletedKeys()).toEqual(["uploads/attachments/shared.png"]);
  });

  it("never asks storage to delete an external link", async () => {
    stubRows([
      file(1, {
        isDeleted: true,
        mimeType: "text/uri-list",
        url: "https://example.com/x",
      }),
    ]);

    const result = await run("purge", [1]);

    expect(result.applied).toEqual([1]);
    expect(result.files).toMatchObject({ deleted: 0, bytes: 0 });
    expect(deleteMany).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("counts the files a saved version still shows", async () => {
    const row = file(1, { isDeleted: true });
    stubRows([row]);
    versionRows.current = [{ url: row.url }];

    expect((await run("purge", [1], true)).files).toMatchObject({
      deleted: 1,
      inVersions: 1,
    });
  });

  it("does a large selection in batches with one audit row and bulk storage deletes", async () => {
    const rows = Array.from({ length: 12_000 }, (_, index) =>
      file(index + 1, { isDeleted: true })
    );
    findMany.mockImplementation(async (args: any) => {
      const wanted = new Set(args.where.id.in);
      return rows.filter((row) => wanted.has(row.id));
    });

    const result = await run(
      "purge",
      rows.map((row) => row.id)
    );

    expect(result.applied).toHaveLength(12_000);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(deleteMany).toHaveBeenCalledTimes(3);
    // Storage takes at most 1,000 keys a request.
    expect(send).toHaveBeenCalledTimes(12);
    expect(deletedKeys()).toHaveLength(12_000);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DELETE",
        entityId: "bulk:12000",
        metadata: expect.objectContaining({
          operation: "permanent_delete",
          bulk: true,
          count: 12_000,
        }),
      })
    );
  });

  it("counts the files storage reports it could not delete", async () => {
    stubRows([file(1, { isDeleted: true }), file(2, { isDeleted: true })]);
    send.mockResolvedValue({
      Errors: [{ Key: "uploads/attachments/file-2.png", Code: "AccessDenied" }],
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await run("purge", [1, 2]);

    expect(result.files).toMatchObject({ deleted: 1, failed: 1 });
    logged.mockRestore();
  });

  it("reports a file storage would not delete, with the row still purged", async () => {
    stubRows([file(1, { isDeleted: true })]);
    send.mockRejectedValue(new Error("denied"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await run("purge", [1]);

    expect(result.applied).toEqual([1]);
    expect(result.files).toMatchObject({ deleted: 0, failed: 1 });
    expect(deleteMany).toHaveBeenCalled();
    logged.mockRestore();
  });
});
