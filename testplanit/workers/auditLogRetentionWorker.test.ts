import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit log archive worker unit tests.
 *
 * The DB client is a fake that serves AuditLog rows from an in-memory list
 * (oldest-row probe, batch select, delete by id) and records the manifest
 * INSERT. The S3 client stores PUT bodies in a map so GET can read them back —
 * or corrupt them to exercise read-back verification.
 */

const mockCaptureAuditEvent = vi.fn();
const mockIsMultiTenantMode = vi.fn();
const mockGetAllTenantIds = vi.fn();
const mockGetTenantDbClient = vi.fn();
const mockGetTenantConfig = vi.fn();
const mockDisconnectAllTenantClients = vi.fn();

vi.mock("../lib/rawDb", () => ({ rawDb: {} }));
vi.mock("../lib/s3Client", () => ({ getS3Client: () => ({}) }));
vi.mock("../lib/services/auditLog", () => ({
  captureAuditEvent: (...args: unknown[]) => mockCaptureAuditEvent(...args),
}));
vi.mock("../lib/multiTenantDb", () => ({
  isMultiTenantMode: () => mockIsMultiTenantMode(),
  getAllTenantIds: () => mockGetAllTenantIds(),
  getTenantDbClient: (tenantId: string) => mockGetTenantDbClient(tenantId),
  getTenantConfig: (tenantId: string) => mockGetTenantConfig(tenantId),
  disconnectAllTenantClients: () => mockDisconnectAllTenantClients(),
}));

import {
  applyRetentionAllTenantsOnce,
  archiveOnce,
  purgeOnce,
} from "./auditLogRetentionWorker";

interface Row {
  id: string;
  timestamp: Date;
}

function sqlText(strings: TemplateStringsArray): string {
  return strings.join("?").replace(/\s+/g, " ");
}

function fakeDb(initial: Row[]) {
  let rows = [...initial].sort(
    (a, b) =>
      a.timestamp.getTime() - b.timestamp.getTime() || a.id.localeCompare(b.id)
  );
  const manifests: unknown[][] = [];
  const deleted: string[] = [];
  let failInsert = false;

  const executeRaw = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = sqlText(strings);
      if (text.includes('INSERT INTO "AuditLogArchive"')) {
        if (failInsert) throw new Error("insert failed");
        manifests.push(values);
        return 1;
      }
      if (
        text.includes('DELETE FROM "AuditLog"') &&
        text.includes("SELECT id")
      ) {
        const [cutoff, limit] = values as [Date, number];
        const ids = rows
          .filter((r) => r.timestamp < cutoff)
          .slice(0, limit)
          .map((r) => r.id);
        deleted.push(...ids);
        rows = rows.filter((r) => !ids.includes(r.id));
        return ids.length;
      }
      if (text.includes('DELETE FROM "AuditLog"')) {
        const ids = values[0] as string[];
        deleted.push(...ids);
        rows = rows.filter((r) => !ids.includes(r.id));
        return ids.length;
      }
      throw new Error(`unexpected executeRaw: ${text}`);
    }
  );

  const client = {
    $queryRaw: vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = sqlText(strings);
        if (text.includes("LIMIT 1")) {
          const cutoff = values[0] as Date;
          return rows
            .filter((r) => r.timestamp < cutoff)
            .slice(0, 1)
            .map((r) => ({ timestamp: r.timestamp }));
        }
        if (text.includes("row_to_json")) {
          const [start, end, limit] = values as [Date, Date, number];
          return rows
            .filter((r) => r.timestamp >= start && r.timestamp < end)
            .slice(0, limit)
            .map((r) => ({
              id: r.id,
              timestamp: r.timestamp,
              line: JSON.stringify({
                id: r.id,
                timestamp: r.timestamp.toISOString(),
              }),
            }));
        }
        throw new Error(`unexpected queryRaw: ${text}`);
      }
    ),
    $executeRaw: executeRaw,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = [...rows];
      const manifestCount = manifests.length;
      const deletedCount = deleted.length;
      try {
        return await fn({ $executeRaw: executeRaw });
      } catch (err) {
        rows = snapshot;
        manifests.length = manifestCount;
        deleted.length = deletedCount;
        throw err;
      }
    }),
  };

  return {
    client,
    manifests,
    deleted,
    remaining: () => rows,
    failNextInsert: () => {
      failInsert = true;
    },
  };
}

function fakeS3(opts: { corrupt?: boolean } = {}) {
  const objects = new Map<string, Uint8Array>();
  const send = vi.fn(
    async (command: { constructor: { name: string }; input: any }) => {
      const { Key, Body } = command.input;
      if (command.constructor.name === "PutObjectCommand") {
        objects.set(Key, new Uint8Array(Body));
        return {};
      }
      if (command.constructor.name === "GetObjectCommand") {
        const stored = objects.get(Key)!;
        const bytes = opts.corrupt ? new Uint8Array([...stored, 0]) : stored;
        return { Body: { transformToByteArray: async () => bytes } };
      }
      throw new Error(`unexpected command ${command.constructor.name}`);
    }
  );
  return { s3: { send } as never, objects, send };
}

const NOW = new Date("2026-10-10T03:00:00.000Z");
const day = (iso: string) => new Date(iso);

describe("workers/auditLogRetentionWorker.archiveOnce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockCaptureAuditEvent.mockReset();
    mockCaptureAuditEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("archives rows older than the window month by month and deletes only those", async () => {
    const db = fakeDb([
      { id: "a1", timestamp: day("2026-01-05T10:00:00Z") },
      { id: "a2", timestamp: day("2026-01-20T10:00:00Z") },
      { id: "b1", timestamp: day("2026-02-03T10:00:00Z") },
      { id: "recent", timestamp: day("2026-09-30T10:00:00Z") },
    ]);
    const { s3, objects } = fakeS3();

    const result = await archiveOnce(
      { retentionDays: 90, bucket: "archive-bucket", s3 },
      db.client as never
    );

    expect(result).toMatchObject({
      mode: "archive",
      rows: 3,
      objects: 2,
      truncated: false,
    });
    expect(result.error).toBeUndefined();
    expect(db.remaining().map((r) => r.id)).toEqual(["recent"]);

    const keys = [...objects.keys()];
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(
      /^audit-log-archive\/2026\/01\/20260105T100000000Z-a1-[0-9a-f]{12}\.ndjson\.gz$/
    );
    expect(keys[1]).toMatch(/^audit-log-archive\/2026\/02\//);

    const january = gunzipSync(objects.get(keys[0])!).toString("utf8");
    expect(
      january
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l).id)
    ).toEqual(["a1", "a2"]);

    // Manifest: bucket, key, periodStart, first, last, rowCount, byteSize, sha256
    const [bucket, key, periodStart, , , rowCount, byteSize, sha] =
      db.manifests[0];
    expect(bucket).toBe("archive-bucket");
    expect(key).toBe(keys[0]);
    expect((periodStart as Date).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z"
    );
    expect(rowCount).toBe(2);
    expect(byteSize).toBe(objects.get(keys[0])!.length);
    expect(sha).toBe(
      createHash("sha256").update(objects.get(keys[0])!).digest("hex")
    );

    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
    const evt = mockCaptureAuditEvent.mock.calls[0][0];
    expect(evt.action).toBe("AUDIT_LOG_ARCHIVED");
    expect(evt.metadata).toMatchObject({
      retentionDays: 90,
      rows: 3,
      objects: 2,
      bucket: "archive-bucket",
    });
  });

  it("splits a month into several objects when it exceeds the batch size", async () => {
    const db = fakeDb(
      Array.from({ length: 5 }, (_, i) => ({
        id: `r${i}`,
        timestamp: day(`2026-03-0${i + 1}T00:00:00Z`),
      }))
    );
    const { s3, objects } = fakeS3();

    const result = await archiveOnce(
      { retentionDays: 30, bucket: "b", s3, batchRows: 2 },
      db.client as never
    );

    expect(result).toMatchObject({ rows: 5, objects: 3 });
    expect(objects.size).toBe(3);
    expect(db.remaining()).toHaveLength(0);
  });

  it("keeps every row when the uploaded object fails read-back verification", async () => {
    const db = fakeDb([{ id: "a1", timestamp: day("2026-01-05T10:00:00Z") }]);
    const { s3 } = fakeS3({ corrupt: true });

    const result = await archiveOnce(
      { retentionDays: 30, bucket: "b", s3 },
      db.client as never
    );

    expect(result.rows).toBe(0);
    expect(result.error).toMatch(/read-back verification/);
    expect(db.remaining()).toHaveLength(1);
    expect(db.manifests).toHaveLength(0);
    expect(mockCaptureAuditEvent.mock.calls[0][0].metadata.error).toMatch(
      /read-back/
    );
  });

  it("keeps the rows when the manifest insert fails", async () => {
    const db = fakeDb([{ id: "a1", timestamp: day("2026-01-05T10:00:00Z") }]);
    db.failNextInsert();
    const { s3 } = fakeS3();

    const result = await archiveOnce(
      { retentionDays: 30, bucket: "b", s3 },
      db.client as never
    );

    expect(result.error).toBe("insert failed");
    expect(db.remaining()).toHaveLength(1);
    expect(db.deleted).toHaveLength(0);
  });

  it("reports truncated when the time budget runs out first", async () => {
    const db = fakeDb([{ id: "a1", timestamp: day("2026-01-05T10:00:00Z") }]);
    const { s3 } = fakeS3();

    const result = await archiveOnce(
      { retentionDays: 30, bucket: "b", s3, budgetMs: 0 },
      db.client as never
    );

    expect(result).toMatchObject({ rows: 0, truncated: true });
    expect(db.remaining()).toHaveLength(1);
  });

  it("puts tenant archives under the tenant prefix and stamps the tenant on the event", async () => {
    const db = fakeDb([{ id: "a1", timestamp: day("2026-01-05T10:00:00Z") }]);
    const { s3, objects } = fakeS3();

    await archiveOnce(
      { retentionDays: 30, bucket: "b", s3 },
      db.client as never,
      "acme"
    );

    expect([...objects.keys()][0]).toMatch(
      /^audit-log-archive\/acme\/2026\/01\//
    );
    expect(mockCaptureAuditEvent.mock.calls[0][0].tenantId).toBe("acme");
  });
});

describe("workers/auditLogRetentionWorker.purgeOnce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockCaptureAuditEvent.mockReset();
    mockCaptureAuditEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes everything older than the window in batches and keeps nothing", async () => {
    const db = fakeDb([
      ...Array.from({ length: 2500 }, (_, i) => ({
        id: `old${String(i).padStart(4, "0")}`,
        timestamp: day("2026-01-05T10:00:00Z"),
      })),
      { id: "recent", timestamp: day("2026-10-01T10:00:00Z") },
    ]);

    const result = await purgeOnce({ retentionDays: 30 }, db.client as never);

    expect(result).toMatchObject({
      mode: "delete",
      rows: 2500,
      objects: 0,
      truncated: false,
    });
    expect(db.remaining().map((r) => r.id)).toEqual(["recent"]);
    expect(db.manifests).toHaveLength(0);
    // 1000 + 1000 + 500 + final empty sweep
    expect(db.client.$executeRaw).toHaveBeenCalledTimes(4);

    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
    const evt = mockCaptureAuditEvent.mock.calls[0][0];
    expect(evt.action).toBe("AUDIT_LOG_PURGED");
    expect(evt.metadata).toMatchObject({ retentionDays: 30, rows: 2500 });
  });

  it("records the error and stops when a delete fails", async () => {
    const client = {
      $executeRaw: vi.fn().mockRejectedValue(new Error("lock timeout")),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await purgeOnce(
      { retentionDays: 30 },
      client as never,
      "acme"
    );

    expect(result).toMatchObject({ rows: 0, truncated: false });
    expect(result.error).toBe("lock timeout");
    const evt = mockCaptureAuditEvent.mock.calls[0][0];
    expect(evt.tenantId).toBe("acme");
    expect(evt.metadata.error).toBe("lock timeout");
  });
});

describe("workers/auditLogRetentionWorker.applyRetentionAllTenantsOnce", () => {
  const env = { ...process.env };

  beforeEach(() => {
    mockCaptureAuditEvent.mockReset();
    mockIsMultiTenantMode.mockReset();
    mockGetAllTenantIds.mockReset();
    mockGetTenantDbClient.mockReset();
    mockGetTenantConfig.mockReset();
    mockDisconnectAllTenantClients.mockReset();
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
    delete process.env.AUDIT_LOG_RETENTION_MODE;
    delete process.env.AUDIT_LOG_ARCHIVE_BUCKET;
    delete process.env.AWS_BUCKET_NAME;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("does nothing in single-tenant mode when retention is off", async () => {
    mockIsMultiTenantMode.mockReturnValue(false);
    expect(await applyRetentionAllTenantsOnce()).toEqual([]);
    expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
  });

  it("never falls back to deleting when archive mode has no bucket", async () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = "365";
    mockIsMultiTenantMode.mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await applyRetentionAllTenantsOnce()).toEqual([]);
    expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
  });

  it("applies each tenant's own retention and skips tenants with none", async () => {
    process.env.AUDIT_LOG_ARCHIVE_BUCKET = "b";
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue(["free", "pro", "selfmanaged"]);
    mockGetTenantConfig.mockImplementation((id: string) =>
      id === "free"
        ? { auditLogRetentionDays: 30, auditLogRetentionMode: "delete" }
        : id === "pro"
          ? { auditLogRetentionDays: "365" }
          : {}
    );
    const clients: Record<string, ReturnType<typeof fakeDb>> = {
      free: fakeDb([]),
      pro: fakeDb([]),
      selfmanaged: fakeDb([]),
    };
    mockGetTenantDbClient.mockImplementation(
      (id: string) => clients[id].client
    );

    const results = await applyRetentionAllTenantsOnce();

    expect(results.map((r) => r.mode)).toEqual(["delete", "archive"]);
    expect(mockCaptureAuditEvent.mock.calls.map((c) => c[0].tenantId)).toEqual([
      "free",
      "pro",
    ]);
    expect(mockCaptureAuditEvent.mock.calls[0][0].action).toBe(
      "AUDIT_LOG_PURGED"
    );
    expect(mockCaptureAuditEvent.mock.calls[1][0].action).toBe(
      "AUDIT_LOG_ARCHIVED"
    );
    expect(mockGetTenantDbClient).not.toHaveBeenCalledWith("selfmanaged");
    expect(mockDisconnectAllTenantClients).toHaveBeenCalledTimes(1);
  });

  it("isolates tenant failures", async () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = "365";
    process.env.AUDIT_LOG_RETENTION_MODE = "delete";
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue(["bad", "good"]);
    mockGetTenantConfig.mockReturnValue({});
    mockGetTenantDbClient.mockImplementation((id: string) => {
      if (id === "bad") throw new Error("no such tenant");
      return fakeDb([]).client;
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await applyRetentionAllTenantsOnce();

    expect(results).toHaveLength(1);
    expect(mockCaptureAuditEvent.mock.calls[0][0].tenantId).toBe("good");
    expect(mockDisconnectAllTenantClients).toHaveBeenCalledTimes(1);
  });
});
