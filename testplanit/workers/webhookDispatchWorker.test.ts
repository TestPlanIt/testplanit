import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks must be hoisted before the SUT import.
vi.mock("../lib/multiTenantDb", () => ({
  validateMultiTenantJobData: vi.fn(),
  getDbClientForJob: vi.fn().mockReturnValue({ __mock: "prisma" }),
  isMultiTenantMode: vi.fn().mockReturnValue(false),
  disconnectAllTenantClients: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/webhooks/dispatch", () => ({
  dispatchWebhook: vi.fn(),
}));

// health state machine seam invoked from BullMQ
// worker hooks. The dispatcher does NOT increment the failure counter
// (locked seam); the worker is responsible for calling health.transition()
// on completed (success) and on terminal failure (per).
const mockHealthTransition = vi.fn().mockResolvedValue({
  from: "HEALTHY",
  to: "HEALTHY",
  counter: 0,
});
vi.mock("../lib/webhooks/health", () => ({
  transition: (...args: unknown[]) => mockHealthTransition(...args),
}));

// daily auto-retire helper invoked when the cron
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
  getDbClientForJob,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import { dispatchWebhook } from "../lib/webhooks/dispatch";

import {
  handleCompleted,
  handleFailed,
  processor,
} from "./webhookDispatchWorker";

const mockedValidate = validateMultiTenantJobData as unknown as ReturnType<
  typeof vi.fn
>;
const mockedGetPrisma = getDbClientForJob as unknown as ReturnType<
  typeof vi.fn
>;
const mockedDispatch = dispatchWebhook as unknown as ReturnType<typeof vi.fn>;

/**
 * Build a mock BullMQ Job with attemptsMade + data.
 */
function buildJob(opts: {
  attemptsMade: number;
  data: {
    outboxEventId: string;
    webhookConfigId: string;
    attempt: number;
    tenantId?: string | null;
  };
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

  it("4. processor returns the dispatch outcome on success (so worker.on('completed', (job, result) => ...) can distinguish real 2xx from short-circuit gates)", async () => {
    mockedDispatch.mockResolvedValue({
      outcome: "success",
      statusCode: 200,
      deliveryId: "d1",
    });
    const job = buildJob({
      attemptsMade: 0,
      data: { outboxEventId: "ev1", webhookConfigId: "c1", attempt: 1 },
    });

    await expect(processor(job)).resolves.toMatchObject({
      outcome: "success",
    });
  });

  it("5. processor is exported as a function", () => {
    expect(typeof processor).toBe("function");
  });

  it("6. — first attempt: attemptsMade=0 → dispatchWebhook called with attempt:1", async () => {
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

  it("7. — retry 1: attemptsMade=1 + stale data.attempt=1 → dispatchWebhook called with attempt:2", async () => {
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

  it("8. — retry 2: attemptsMade=2 + stale data.attempt=1 → dispatchWebhook called with attempt:3", async () => {
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

  it("9. — attempt threading does NOT mutate the original job.data (defensive: BullMQ persistence reads job.data on retries)", async () => {
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
  // daily auto-retire cron job dispatch
  // ──────────────────────────────────────────────────────────────────────

  it("10. job.name='retire-expired-secrets' calls retireExpiredSecrets and skips dispatchWebhook", async () => {
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

  it("11. cron path passes the tenant-scoped prisma client", async () => {
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

// ──────────────────────────────────────────────────────────────────────────
// BullMQ worker hook → health.transition() seam
//
// The dispatcher writes per-attempt timestamps + DISABLED gate stub rows but
// does NOT touch the failure counter. The worker hook is the event-level
// seam: on('completed') always calls transition(success); on('failed') calls
// transition(failure) ONLY when BullMQ has exhausted all retries (terminal
// failure: job.attemptsMade + 1 >= job.opts.attempts). Per the
// 10-distinct-event auto-disable threshold only fires on terminal
// failure — transient retries don't tick the counter.
// ──────────────────────────────────────────────────────────────────────────

describe("webhookDispatchWorker — health hooks (/)", () => {
  beforeEach(() => {
    mockHealthTransition.mockClear();
  });

  it("H1. on('failed') terminal — attemptsMade=6 + maxAttempts=7 → calls health.transition(configId, 'failure')", async () => {
    const job = {
      id: "job-fail-terminal",
      attemptsMade: 6, // 7th attempt just finished (1-indexed: this was the 7th)
      data: {
        outboxEventId: "ev1",
        webhookConfigId: "cfg-terminal",
        attempt: 7,
      },
      opts: { attempts: 7 },
    } as any;

    await handleFailed(job, new Error("upstream 500"));

    expect(mockHealthTransition).toHaveBeenCalledTimes(1);
    expect(mockHealthTransition).toHaveBeenCalledWith(
      "cfg-terminal",
      "failure"
    );
  });

  it("H2. on('failed') non-terminal — attemptsMade=3 + maxAttempts=7 → does NOT call health.transition (retry pending; event-level only)", async () => {
    const job = {
      id: "job-fail-retry",
      attemptsMade: 3,
      data: {
        outboxEventId: "ev1",
        webhookConfigId: "cfg-retry",
        attempt: 4,
      },
      opts: { attempts: 7 },
    } as any;

    await handleFailed(job, new Error("transient 503"));

    expect(mockHealthTransition).not.toHaveBeenCalled();
  });

  it("H3. on('completed') with result.outcome='success' — calls health.transition(configId, 'success')", async () => {
    const job = {
      id: "job-completed",
      attemptsMade: 0,
      data: {
        outboxEventId: "ev1",
        webhookConfigId: "cfg-success",
        attempt: 1,
      },
      opts: { attempts: 7 },
    } as any;

    await handleCompleted(job, { outcome: "success" });

    expect(mockHealthTransition).toHaveBeenCalledTimes(1);
    expect(mockHealthTransition).toHaveBeenCalledWith("cfg-success", "success");
  });

  it("H3a. on('completed') with result.outcome='failure' (DISABLED gate) — does NOT call health.transition; otherwise the gate would be undone immediately", async () => {
    const job = {
      id: "job-disabled-gate",
      attemptsMade: 0,
      data: {
        outboxEventId: "ev1",
        webhookConfigId: "cfg-disabled",
        attempt: 1,
      },
      opts: { attempts: 7 },
    } as any;

    await handleCompleted(job, {
      outcome: "failure",
      error: "endpoint_disabled",
    } as any);

    expect(mockHealthTransition).not.toHaveBeenCalled();
  });

  it("H3b. on('completed') with result.outcome='skipped_inactive' / 'skipped_unsubscribed' — does NOT call health.transition", async () => {
    const job = {
      id: "job-skipped",
      attemptsMade: 0,
      data: {
        outboxEventId: "ev1",
        webhookConfigId: "cfg-skipped",
        attempt: 1,
      },
      opts: { attempts: 7 },
    } as any;

    await handleCompleted(job, { outcome: "skipped_inactive" });
    await handleCompleted(job, { outcome: "skipped_unsubscribed" });

    expect(mockHealthTransition).not.toHaveBeenCalled();
  });

  it("H3c. on('completed') with no result — does NOT call health.transition (defensive)", async () => {
    const job = {
      id: "job-no-result",
      attemptsMade: 0,
      data: {
        outboxEventId: "ev1",
        webhookConfigId: "cfg-no-result",
        attempt: 1,
      },
      opts: { attempts: 7 },
    } as any;

    await handleCompleted(job);

    expect(mockHealthTransition).not.toHaveBeenCalled();
  });

  it("H4. on('failed') terminal but webhookConfigId missing — defensive skip; no transition call", async () => {
    const job = {
      id: "job-missing-config",
      attemptsMade: 6,
      data: {
        // webhookConfigId deliberately absent — defensive guard
        outboxEventId: "ev1",
        attempt: 7,
      },
      opts: { attempts: 7 },
    } as any;

    await handleFailed(job, new Error("terminal but malformed jobData"));

    expect(mockHealthTransition).not.toHaveBeenCalled();
  });
});
