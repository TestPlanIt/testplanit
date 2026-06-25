import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DataChangeLog retention worker unit tests.
 *
 * Mocks:
 * - rawDb.$executeRaw — driven via mockResolvedValueOnce chains to simulate
 *   the LIMIT 1000 batch loop (n, n, ..., 0).
 * - captureAuditEvent — assert exactly ONE call per purgeOnce() carrying the
 *   tenantId + totals.
 * - multiTenantDb — drive single- vs multi-tenant fan-out.
 *
 * Clock is locked via vi.useFakeTimers() so the cutoff + budget math is
 * deterministic (frozen time keeps the budget loop terminating on the 0-row
 * sweep, exactly as a fast real purge would).
 */

const mockExecuteRaw = vi.fn();
const mockCaptureAuditEvent = vi.fn();
const mockIsMultiTenantMode = vi.fn();
const mockGetAllTenantIds = vi.fn();
const mockGetTenantDbClient = vi.fn();
const mockDisconnectAllTenantClients = vi.fn();

vi.mock("../lib/rawDb", () => ({
  rawDb: {
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  },
}));

vi.mock("../lib/services/auditLog", () => ({
  captureAuditEvent: (...args: unknown[]) => mockCaptureAuditEvent(...args),
}));

vi.mock("../lib/multiTenantDb", () => ({
  isMultiTenantMode: () => mockIsMultiTenantMode(),
  getAllTenantIds: () => mockGetAllTenantIds(),
  getTenantDbClient: (tenantId: string) =>
    mockGetTenantDbClient(tenantId),
  disconnectAllTenantClients: () => mockDisconnectAllTenantClients(),
}));

import { purgeAllTenantsOnce, purgeOnce } from "./dataChangeLogRetentionWorker";

describe("workers/dataChangeLogRetentionWorker.purgeOnce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T03:00:00.000Z"));
    mockExecuteRaw.mockReset();
    mockCaptureAuditEvent.mockReset();
    mockCaptureAuditEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("batched-deletes processed rows until a 0-row sweep and emits one audit event", async () => {
    mockExecuteRaw
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(250)
      .mockResolvedValueOnce(0);

    const result = await purgeOnce();

    expect(result.dataChangeLogRows).toBe(2250);
    expect(result.truncated).toBe(false);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(4);
    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
    const evt = mockCaptureAuditEvent.mock.calls[0][0];
    expect(evt.action).toBe("DCL_RETENTION_PURGED");
    expect(evt.entityType).toBe("DataChangeLog");
    expect(evt.tenantId).toBeUndefined();
    expect(evt.metadata.dataChangeLogRows).toBe(2250);
    expect(evt.metadata.retentionDays).toBe(30);
  });

  it("stamps the tenantId onto the audit event when purging a tenant client", async () => {
    const tenantExecute = vi.fn().mockResolvedValue(0);
    await purgeOnce({ $executeRaw: tenantExecute } as never, "tenant-x");

    expect(tenantExecute).toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled(); // used the tenant client, not rawDb
    expect(mockCaptureAuditEvent.mock.calls[0][0].tenantId).toBe("tenant-x");
  });
});

describe("workers/dataChangeLogRetentionWorker.purgeAllTenantsOnce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T03:00:00.000Z"));
    mockExecuteRaw.mockReset();
    mockCaptureAuditEvent.mockReset();
    mockCaptureAuditEvent.mockResolvedValue(undefined);
    mockIsMultiTenantMode.mockReset();
    mockGetAllTenantIds.mockReset();
    mockGetTenantDbClient.mockReset();
    mockDisconnectAllTenantClients.mockReset();
    mockDisconnectAllTenantClients.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("single-tenant mode: purges the singleton client and returns one result", async () => {
    mockIsMultiTenantMode.mockReturnValue(false);
    mockExecuteRaw.mockResolvedValue(0);

    const results = await purgeAllTenantsOnce();

    expect(results).toHaveLength(1);
    expect(mockExecuteRaw).toHaveBeenCalled();
    expect(mockGetTenantDbClient).not.toHaveBeenCalled();
    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockCaptureAuditEvent.mock.calls[0][0].tenantId).toBeUndefined();
  });

  it("multi-tenant mode: purges each tenant's database and emits one audit row per tenant", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue(["tenant-a", "tenant-b"]);
    const tenantAExecute = vi.fn().mockResolvedValue(0);
    const tenantBExecute = vi.fn().mockResolvedValue(0);
    mockGetTenantDbClient.mockImplementation((id: string) =>
      id === "tenant-a"
        ? { $executeRaw: tenantAExecute }
        : { $executeRaw: tenantBExecute }
    );

    const results = await purgeAllTenantsOnce();

    expect(results).toHaveLength(2);
    expect(tenantAExecute).toHaveBeenCalled();
    expect(tenantBExecute).toHaveBeenCalled();
    expect(mockExecuteRaw).not.toHaveBeenCalled(); // never touches rawDb in multi-tenant mode
    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(2);
    expect(mockCaptureAuditEvent.mock.calls[0][0].tenantId).toBe("tenant-a");
    expect(mockCaptureAuditEvent.mock.calls[1][0].tenantId).toBe("tenant-b");
  });

  it("multi-tenant mode: a tenant-level error does NOT abort other tenants", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue(["tenant-a", "tenant-b"]);
    const tenantBExecute = vi.fn().mockResolvedValue(0);
    mockGetTenantDbClient.mockImplementation((id: string) => {
      if (id === "tenant-a") throw new Error("tenant-a config missing");
      return { $executeRaw: tenantBExecute };
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await purgeAllTenantsOnce();

    expect(results).toHaveLength(1);
    expect(tenantBExecute).toHaveBeenCalled();
    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockCaptureAuditEvent.mock.calls[0][0].tenantId).toBe("tenant-b");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("multi-tenant mode with zero tenants returns an empty array and touches nothing", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue([]);

    const results = await purgeAllTenantsOnce();

    expect(results).toEqual([]);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
  });

  it("multi-tenant mode: disconnects all tenant clients after the pass", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue(["tenant-a", "tenant-b"]);
    mockGetTenantDbClient.mockImplementation(() => ({
      $executeRaw: vi.fn().mockResolvedValue(0),
    }));

    await purgeAllTenantsOnce();

    expect(mockDisconnectAllTenantClients).toHaveBeenCalledTimes(1);
  });

  it("multi-tenant mode: disconnect still runs even when a tenant errors mid-pass", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue(["tenant-a", "tenant-b"]);
    mockGetTenantDbClient.mockImplementation((id: string) => {
      if (id === "tenant-a") throw new Error("boom");
      return { $executeRaw: vi.fn().mockResolvedValue(0) };
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await purgeAllTenantsOnce();

    expect(mockDisconnectAllTenantClients).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("single-tenant mode: does NOT disconnect tenant clients", async () => {
    mockIsMultiTenantMode.mockReturnValue(false);
    mockExecuteRaw.mockResolvedValue(0);

    await purgeAllTenantsOnce();

    expect(mockDisconnectAllTenantClients).not.toHaveBeenCalled();
  });
});
