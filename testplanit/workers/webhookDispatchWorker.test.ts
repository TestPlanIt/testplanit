import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks must be hoisted before the SUT import.
vi.mock("../lib/multiTenantPrisma", () => ({
  validateMultiTenantJobData: vi.fn(),
  getPrismaClientForJob: vi.fn().mockReturnValue({ __mock: "prisma" }),
  isMultiTenantMode: vi.fn().mockReturnValue(false),
  disconnectAllTenantClients: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/webhooks/dispatch", () => ({
  dispatchWebhook: vi.fn(),
}));

// Phase 2 / Plan 02-06 — daily auto-retire helper invoked when the cron
// schedules a job named "retire-expired-secrets" onto this worker's queue.
const mockRetireExpiredSecrets = vi.fn();
vi.mock("../lib/webhooks/secret-rotation", () => ({
  retireExpiredSecrets: (...args: unknown[]) =>
    mockRetireExpiredSecrets(...args),
}));

vi.mock("../lib/valkey", () => ({
  default: null,
}));

vi.mock("../lib/tenantContext", () => ({
  withTenantContext: <T>(fn: T) => fn,
}));

import {
  getPrismaClientForJob,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { dispatchWebhook } from "../lib/webhooks/dispatch";

import { processor } from "./webhookDispatchWorker";

const mockedValidate =
  validateMultiTenantJobData as unknown as ReturnType<typeof vi.fn>;
const mockedGetPrisma =
  getPrismaClientForJob as unknown as ReturnType<typeof vi.fn>;
const mockedDispatch = dispatchWebhook as unknown as ReturnType<typeof vi.fn>;

/**
 * Build a mock BullMQ Job with attemptsMade + data.
 */
function buildJob(opts: {
  attemptsMade: number;
  data: { outboxEventId: string; webhookConfigId: string; attempt: number; tenantId?: string | null };
  id?: string;
}) {
  return {
    id: opts.id ?? "job-1",
    attemptsMade: opts.attemptsMade,
    data: opts.data,
  } as any;
}

describe("webhookDispatchWorker.processor", () => {
  beforeEach(() => {
    mockedValidate.mockClear();
    mockedGetPrisma.mockClear();
    mockedDispatch.mockClear();
  });

  it("1. processor calls validateMultiTenantJobData(job.data)", async () => {
    mockedDispatch.mockResolvedValue({
      outcome: "success",
      statusCode: 200,
      deliveryId: "d1",
    });
    const job = buildJob({
      attemptsMade: 0,
      data: { outboxEventId: "ev1", webhookConfigId: "c1", attempt: 1 },
    });

    await processor(job);

    expect(mockedValidate).toHaveBeenCalledTimes(1);
    expect(mockedValidate).toHaveBeenCalledWith(job.data);
  });

  it("2. processor calls dispatchWebhook with the job data + multi-tenant Prisma client", async () => {
    mockedDispatch.mockResolvedValue({
      outcome: "success",
      statusCode: 200,
      deliveryId: "d1",
    });
    const job = buildJob({
      attemptsMade: 0,
      data: {
        outboxEventId: "ev1",
        webhookConfigId: "c1",
        attempt: 1,
        tenantId: "tenant-A",
      },
    });

    await processor(job);

    expect(mockedDispatch).toHaveBeenCalledTimes(1);
    const [calledData, calledPrisma] = mockedDispatch.mock.calls[0];
    expect(calledData.outboxEventId).toBe("ev1");
    expect(calledData.webhookConfigId).toBe("c1");
    expect(calledData.tenantId).toBe("tenant-A");
    expect(calledPrisma).toEqual({ __mock: "prisma" });
  });

  it("3. processor rethrows when dispatchWebhook rejects (BullMQ relies on the throw to retry)", async () => {
    const boom = new Error("upstream 500");
    mockedDispatch.mockRejectedValue(boom);
    const job = buildJob({
      attemptsMade: 0,
      data: { outboxEventId: "ev1", webhookConfigId: "c1", attempt: 1 },
    });

    await expect(processor(job)).rejects.toThrow("upstream 500");
  });

  it("4. processor resolves silently on success outcome (no rethrow)", async () => {
    mockedDispatch.mockResolvedValue({
      outcome: "success",
      statusCode: 200,
      deliveryId: "d1",
    });
    const job = buildJob({
      attemptsMade: 0,
      data: { outboxEventId: "ev1", webhookConfigId: "c1", attempt: 1 },
    });

    await expect(processor(job)).resolves.toBeUndefined();
  });

  it("5. processor is exported as a function", () => {
    expect(typeof processor).toBe("function");
  });

  it("6. Blocker 2 — first attempt: attemptsMade=0 → dispatchWebhook called with attempt:1", async () => {
    mockedDispatch.mockResolvedValue({
      outcome: "success",
      statusCode: 200,
      deliveryId: "d1",
    });
    const job = buildJob({
      attemptsMade: 0,
      data: { outboxEventId: "ev1", webhookConfigId: "c1", attempt: 1 },
    });

    await processor(job);

    const [calledData] = mockedDispatch.mock.calls[0];
    expect(calledData.attempt).toBe(1);
  });

  it("7. Blocker 2 — retry 1: attemptsMade=1 + stale data.attempt=1 → dispatchWebhook called with attempt:2", async () => {
    mockedDispatch.mockResolvedValue({
      outcome: "success",
      statusCode: 200,
      deliveryId: "d1",
    });
    const job = buildJob({
      attemptsMade: 1,
      data: { outboxEventId: "ev1", webhookConfigId: "c1", attempt: 1 },
    });

    await processor(job);

    const [calledData] = mockedDispatch.mock.calls[0];
    expect(calledData.attempt).toBe(2);
  });

  it("8. Blocker 2 — retry 2: attemptsMade=2 + stale data.attempt=1 → dispatchWebhook called with attempt:3", async () => {
    mockedDispatch.mockResolvedValue({
      outcome: "success",
      statusCode: 200,
      deliveryId: "d1",
    });
    const job = buildJob({
      attemptsMade: 2,
      data: { outboxEventId: "ev1", webhookConfigId: "c1", attempt: 1 },
    });

    await processor(job);

    const [calledData] = mockedDispatch.mock.calls[0];
    expect(calledData.attempt).toBe(3);
  });

  it("9. Blocker 2 — attempt threading does NOT mutate the original job.data (defensive: BullMQ persistence reads job.data on retries)", async () => {
    mockedDispatch.mockResolvedValue({
      outcome: "success",
      statusCode: 200,
      deliveryId: "d1",
    });
    const originalData = {
      outboxEventId: "ev1",
      webhookConfigId: "c1",
      attempt: 1,
    };
    const job = buildJob({
      attemptsMade: 5,
      data: originalData,
    });

    await processor(job);

    // The original job.data.attempt MUST remain 1 — we built a new object via spread.
    expect(job.data.attempt).toBe(1);
    expect(job.data).toBe(originalData); // reference identity preserved
  });

  // ──────────────────────────────────────────────────────────────────────
  // Plan 02-06 / Task 6.3 — daily auto-retire cron job dispatch
  // ──────────────────────────────────────────────────────────────────────

  it("10. Phase 2 — job.name='retire-expired-secrets' calls retireExpiredSecrets and skips dispatchWebhook", async () => {
    mockRetireExpiredSecrets.mockResolvedValue({ retiredCount: 3 });
    const job = {
      id: "cron-1",
      name: "retire-expired-secrets",
      attemptsMade: 0,
      data: { tenantId: undefined },
    } as any;

    await processor(job);

    expect(mockRetireExpiredSecrets).toHaveBeenCalledTimes(1);
    expect(mockedDispatch).not.toHaveBeenCalled();
    // The cron path bypasses tenant validation — multi-tenant single-job
    // semantics use the per-tenant jobId discriminator instead.
    expect(mockedValidate).not.toHaveBeenCalled();
  });

  it("11. Phase 2 — cron path passes the tenant-scoped prisma client", async () => {
    mockRetireExpiredSecrets.mockResolvedValue({ retiredCount: 0 });
    const job = {
      id: "cron-2",
      name: "retire-expired-secrets",
      attemptsMade: 0,
      data: { tenantId: "tenant-A" },
    } as any;

    await processor(job);

    expect(mockedGetPrisma).toHaveBeenCalledWith({ tenantId: "tenant-A" });
    const [calledPrisma] = mockRetireExpiredSecrets.mock.calls[0];
    expect(calledPrisma).toEqual({ __mock: "prisma" });
  });
});
