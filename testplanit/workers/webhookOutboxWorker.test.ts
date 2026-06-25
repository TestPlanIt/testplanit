import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockClaim = vi.fn();
const mockFanout = vi.fn();
const mockGetQueue = vi.fn();
const mockIsMultiTenantMode = vi.fn();
const mockGetAllTenantIds = vi.fn();
const mockGetTenantDbClient = vi.fn();

vi.mock("../lib/db", () => ({
  baseDb: { __mock: "baseDb" },
}));

vi.mock("../lib/webhooks/outbox", () => ({
  claimOutboxBatch: (...args: unknown[]) => mockClaim(...args),
  fanoutToConfigs: (...args: unknown[]) => mockFanout(...args),
}));

vi.mock("../lib/queues", () => ({
  getWebhookDispatchQueue: () => mockGetQueue(),
  WEBHOOK_DISPATCH_QUEUE_NAME: "webhook-dispatch",
}));

vi.mock("../lib/multiTenantDb", () => ({
  isMultiTenantMode: () => mockIsMultiTenantMode(),
  getAllTenantIds: () => mockGetAllTenantIds(),
  getTenantDbClient: (tenantId: string) =>
    mockGetTenantDbClient(tenantId),
  disconnectAllTenantClients: vi.fn(),
}));

import { pollAllTenantsOnce, pollOnce } from "./webhookOutboxWorker";

const sampleRow = {
  id: "outbox-1",
  projectId: 7,
  eventName: "test_run.completed",
  eventId: "evt_00000000-0000-4000-8000-000000000000",
  eventTimestamp: new Date("2026-04-27T12:00:00.000Z"),
  actorUserId: "user-1",
  payload: { runId: 1 },
  dispatchedAt: new Date("2026-04-27T12:00:01.000Z"),
  createdAt: new Date("2026-04-27T11:59:00.000Z"),
};

describe("webhookOutboxWorker.pollOnce", () => {
  beforeEach(() => {
    mockClaim.mockReset();
    mockFanout.mockReset();
    mockGetQueue.mockReset();
    mockIsMultiTenantMode.mockReset();
    mockGetAllTenantIds.mockReset();
    mockGetTenantDbClient.mockReset();
    mockIsMultiTenantMode.mockReturnValue(false);
  });

  it("1. calls claimOutboxBatch with baseDb and 100 (default batch size)", async () => {
    mockClaim.mockResolvedValue([]);
    mockGetQueue.mockReturnValue({ add: vi.fn() });

    await pollOnce();

    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(mockClaim).toHaveBeenCalledWith({ __mock: "baseDb" }, 100);
  });

  it("2. returns 0 when no rows claimed; queue.add is NOT called", async () => {
    mockClaim.mockResolvedValue([]);
    const addSpy = vi.fn();
    mockGetQueue.mockReturnValue({ add: addSpy });

    const n = await pollOnce();

    expect(n).toBe(0);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it("3. returns N when N rows claimed", async () => {
    const rows = [sampleRow, { ...sampleRow, id: "outbox-2" }];
    mockClaim.mockResolvedValue(rows);
    mockFanout.mockResolvedValue([]); // no matching configs
    mockGetQueue.mockReturnValue({ add: vi.fn() });

    const n = await pollOnce();

    expect(n).toBe(2);
  });

  it('4. for each row, fanoutToConfigs is called and queue.add("dispatch", { outboxEventId, webhookConfigId, attempt: 1 }) is called once per config', async () => {
    mockClaim.mockResolvedValue([sampleRow]);
    mockFanout.mockResolvedValue(["c1", "c2"]);
    const addSpy = vi.fn();
    mockGetQueue.mockReturnValue({ add: addSpy });

    await pollOnce();

    expect(mockFanout).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledTimes(2);
    const firstCall = addSpy.mock.calls[0];
    expect(firstCall[0]).toBe("dispatch");
    expect(firstCall[1]).toMatchObject({
      outboxEventId: "outbox-1",
      webhookConfigId: "c1",
      attempt: 1,
    });
    const secondCall = addSpy.mock.calls[1];
    expect(secondCall[1]).toMatchObject({
      outboxEventId: "outbox-1",
      webhookConfigId: "c2",
      attempt: 1,
    });
  });

  it("5. queue.add is called with deterministic jobId: ${row.id}--${webhookConfigId} (idempotency lock; `--` separator because BullMQ rejects `:` in custom jobIds)", async () => {
    mockClaim.mockResolvedValue([sampleRow]);
    mockFanout.mockResolvedValue(["c1", "c2"]);
    const addSpy = vi.fn();
    mockGetQueue.mockReturnValue({ add: addSpy });

    await pollOnce();

    const firstOpts = addSpy.mock.calls[0][2];
    expect(firstOpts.jobId).toBe("outbox-1--c1");
    const secondOpts = addSpy.mock.calls[1][2];
    expect(secondOpts.jobId).toBe("outbox-1--c2");
  });

  it("6. when getWebhookDispatchQueue() returns null: logs error, returns claimed count, does NOT call queue.add", async () => {
    mockClaim.mockResolvedValue([sampleRow]);
    mockGetQueue.mockReturnValue(null);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const n = await pollOnce();

    expect(n).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("7. when fanoutToConfigs throws for one row: loop continues to the next row (does NOT abort the batch)", async () => {
    const row1 = sampleRow;
    const row2 = { ...sampleRow, id: "outbox-2" };
    mockClaim.mockResolvedValue([row1, row2]);
    // First fanout throws, second succeeds
    mockFanout
      .mockRejectedValueOnce(new Error("DB hiccup"))
      .mockResolvedValueOnce(["c2"]);
    const addSpy = vi.fn();
    mockGetQueue.mockReturnValue({ add: addSpy });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const n = await pollOnce();

    expect(n).toBe(2); // claimed count returned, NOT zero
    expect(mockFanout).toHaveBeenCalledTimes(2);
    expect(addSpy).toHaveBeenCalledTimes(1); // only the second row enqueued
    expect(addSpy.mock.calls[0][1].outboxEventId).toBe("outbox-2");
    errorSpy.mockRestore();
  });

  it("8. empty configs list (zero subscribers): pollOnce processes the row but emits zero queue.add calls", async () => {
    mockClaim.mockResolvedValue([sampleRow]);
    mockFanout.mockResolvedValue([]); // no subscribers
    const addSpy = vi.fn();
    mockGetQueue.mockReturnValue({ add: addSpy });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const n = await pollOnce();

    expect(n).toBe(1);
    expect(addSpy).not.toHaveBeenCalled();
    // Log should mention configs=0 per plan
    const fanoutLog = logSpy.mock.calls.find((args) =>
      args.some((a) => typeof a === "string" && a.includes("configs=0"))
    );
    expect(fanoutLog).toBeDefined();
    logSpy.mockRestore();
  });

  it("9. when called with explicit tenantId, stamps it on the enqueued dispatch job", async () => {
    mockClaim.mockResolvedValue([sampleRow]);
    mockFanout.mockResolvedValue(["c1"]);
    const addSpy = vi.fn();
    mockGetQueue.mockReturnValue({ add: addSpy });

    await pollOnce({ __mock: "tenant-baseDb" } as never, "tenant-a");

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls[0][1]).toMatchObject({
      outboxEventId: "outbox-1",
      webhookConfigId: "c1",
      attempt: 1,
      tenantId: "tenant-a",
    });
    expect(mockClaim).toHaveBeenCalledWith({ __mock: "tenant-baseDb" }, 100);
  });

  it("10. tenant-aware jobId: `${tenantId}--${row.id}--${webhookConfigId}` to namespace BullMQ idempotency keys per tenant", async () => {
    mockClaim.mockResolvedValue([sampleRow]);
    mockFanout.mockResolvedValue(["c1", "c2"]);
    const addSpy = vi.fn();
    mockGetQueue.mockReturnValue({ add: addSpy });

    await pollOnce({ __mock: "tenant-baseDb" } as never, "tenant-a");

    expect(addSpy.mock.calls[0][2].jobId).toBe("tenant-a--outbox-1--c1");
    expect(addSpy.mock.calls[1][2].jobId).toBe("tenant-a--outbox-1--c2");
  });
});

describe("webhookOutboxWorker.pollAllTenantsOnce", () => {
  beforeEach(() => {
    mockClaim.mockReset();
    mockFanout.mockReset();
    mockGetQueue.mockReset();
    mockIsMultiTenantMode.mockReset();
    mockGetAllTenantIds.mockReset();
    mockGetTenantDbClient.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("single-tenant mode: delegates to pollOnce against the singleton client", async () => {
    mockIsMultiTenantMode.mockReturnValue(false);
    mockClaim.mockResolvedValue([]);
    mockGetQueue.mockReturnValue({ add: vi.fn() });

    const n = await pollAllTenantsOnce();

    expect(n).toBe(0);
    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(mockClaim).toHaveBeenCalledWith({ __mock: "baseDb" }, 100);
    expect(mockGetTenantDbClient).not.toHaveBeenCalled();
  });

  it("multi-tenant mode: polls every tenant with its own baseDb client and stamps tenantId on each enqueued job", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue(["tenant-a", "tenant-b"]);
    const tenantADb = { __mock: "tenantA" };
    const tenantBDb = { __mock: "tenantB" };
    mockGetTenantDbClient.mockImplementation((id: string) =>
      id === "tenant-a" ? tenantADb : tenantBDb
    );
    // Each tenant claims one row
    mockClaim
      .mockResolvedValueOnce([{ ...sampleRow, id: "outbox-a" }])
      .mockResolvedValueOnce([{ ...sampleRow, id: "outbox-b" }]);
    mockFanout.mockResolvedValue(["c1"]);
    const addSpy = vi.fn();
    mockGetQueue.mockReturnValue({ add: addSpy });

    const n = await pollAllTenantsOnce();

    expect(n).toBe(2);
    expect(mockGetTenantDbClient).toHaveBeenCalledWith("tenant-a");
    expect(mockGetTenantDbClient).toHaveBeenCalledWith("tenant-b");
    // claim was called with each tenant's client
    expect(mockClaim).toHaveBeenNthCalledWith(1, tenantADb, 100);
    expect(mockClaim).toHaveBeenNthCalledWith(2, tenantBDb, 100);
    // dispatch jobs are stamped with the right tenantId
    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(addSpy.mock.calls[0][1]).toMatchObject({
      outboxEventId: "outbox-a",
      tenantId: "tenant-a",
    });
    expect(addSpy.mock.calls[1][1]).toMatchObject({
      outboxEventId: "outbox-b",
      tenantId: "tenant-b",
    });
  });

  it("multi-tenant mode: a tenant-level error does NOT abort other tenants", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue(["tenant-a", "tenant-b"]);
    mockGetTenantDbClient.mockImplementation((id: string) => {
      if (id === "tenant-a") {
        throw new Error("tenant-a config missing");
      }
      return { __mock: "tenantB" };
    });
    mockClaim.mockResolvedValueOnce([{ ...sampleRow, id: "outbox-b" }]);
    mockFanout.mockResolvedValue(["c1"]);
    const addSpy = vi.fn();
    mockGetQueue.mockReturnValue({ add: addSpy });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const n = await pollAllTenantsOnce();

    expect(n).toBe(1);
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls[0][1]).toMatchObject({
      outboxEventId: "outbox-b",
      tenantId: "tenant-b",
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("multi-tenant mode with zero tenants returns 0 without polling", async () => {
    mockIsMultiTenantMode.mockReturnValue(true);
    mockGetAllTenantIds.mockReturnValue([]);

    const n = await pollAllTenantsOnce();

    expect(n).toBe(0);
    expect(mockClaim).not.toHaveBeenCalled();
  });
});
