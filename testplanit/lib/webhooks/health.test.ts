import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/services/auditLog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/services/auditLog")>();
  return {
    ...actual,
    captureAuditEvent: vi.fn().mockResolvedValue(undefined),
  };
});

import { captureAuditEvent } from "~/lib/services/auditLog";
import { transition } from "./health";

const mockedCaptureAudit = captureAuditEvent as unknown as ReturnType<
  typeof vi.fn
>;

/**
 * Build a Prisma-shaped mock for the health state machine.
 *
 * The helper reads `endpointHealth + consecutiveFailureCount + projectId` via
 * `webhookConfig.findUnique` and writes the next state via `webhookConfig.update`.
 * We capture both calls' arguments to assert on the exact shape.
 */
function buildDbMock(opts: {
  config: {
    id?: string;
    projectId?: number;
    endpointHealth: "HEALTHY" | "DEGRADED" | "DISABLED";
    consecutiveFailureCount: number;
  };
}) {
  const findUniqueMock = vi.fn().mockResolvedValue({
    id: opts.config.id ?? "cfg-1",
    projectId: opts.config.projectId ?? 7,
    endpointHealth: opts.config.endpointHealth,
    consecutiveFailureCount: opts.config.consecutiveFailureCount,
  });
  const updateMock = vi.fn().mockImplementation(async (args: any) => ({
    id: args.where.id,
    ...args.data,
  }));
  return {
    webhookConfig: {
      findUnique: findUniqueMock,
      update: updateMock,
    },
  } as any;
}

describe("lib/webhooks/health.transition()", () => {
  beforeEach(() => {
    mockedCaptureAudit.mockClear();
  });

  it("failure-from-HEALTHY-counter-1: increments counter, no state flip, no audit", async () => {
    const db = buildDbMock({
      config: { endpointHealth: "HEALTHY", consecutiveFailureCount: 0 },
    });

    const result = await transition("cfg-1", "failure", db);

    expect(result).toEqual({ from: "HEALTHY", to: "HEALTHY", counter: 1 });

    const updateCall = db.webhookConfig.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: "cfg-1" });
    expect(updateCall.data.endpointHealth).toBe("HEALTHY");
    expect(updateCall.data.consecutiveFailureCount).toBe(1);
    expect(updateCall.data.lastFailureAt).toBeInstanceOf(Date);

    expect(mockedCaptureAudit).not.toHaveBeenCalled();
  });

  it("failure-crosses-DEGRADED-threshold-counter-5: HEALTHY → DEGRADED at counter==5, ONE audit", async () => {
    const db = buildDbMock({
      config: { endpointHealth: "HEALTHY", consecutiveFailureCount: 4 },
    });

    const result = await transition("cfg-1", "failure", db);

    expect(result).toEqual({ from: "HEALTHY", to: "DEGRADED", counter: 5 });

    const updateCall = db.webhookConfig.update.mock.calls[0][0];
    expect(updateCall.data.endpointHealth).toBe("DEGRADED");
    expect(updateCall.data.consecutiveFailureCount).toBe(5);
    expect(updateCall.data.lastFailureAt).toBeInstanceOf(Date);

    expect(mockedCaptureAudit).toHaveBeenCalledTimes(1);
    const auditArgs = mockedCaptureAudit.mock.calls[0][0];
    expect(auditArgs).toMatchObject({
      action: "WEBHOOK_HEALTH_CHANGED",
      entityType: "WebhookConfig",
      entityId: "cfg-1",
      projectId: 7,
      userId: "__system__",
      metadata: {
        webhookConfigId: "cfg-1",
        from: "HEALTHY",
        to: "DEGRADED",
        reason: "auto_threshold",
        consecutiveFailureCount: 5,
      },
    });
  });

  it("failure-stays-DEGRADED-counter-7: increments counter, no state flip, no audit", async () => {
    const db = buildDbMock({
      config: { endpointHealth: "DEGRADED", consecutiveFailureCount: 6 },
    });

    const result = await transition("cfg-1", "failure", db);

    expect(result).toEqual({ from: "DEGRADED", to: "DEGRADED", counter: 7 });

    const updateCall = db.webhookConfig.update.mock.calls[0][0];
    expect(updateCall.data.endpointHealth).toBe("DEGRADED");
    expect(updateCall.data.consecutiveFailureCount).toBe(7);
    expect(updateCall.data.lastFailureAt).toBeInstanceOf(Date);

    expect(mockedCaptureAudit).not.toHaveBeenCalled();
  });

  it("failure-crosses-DISABLED-threshold-counter-10: DEGRADED → DISABLED at counter==10, ONE audit", async () => {
    const db = buildDbMock({
      config: { endpointHealth: "DEGRADED", consecutiveFailureCount: 9 },
    });

    const result = await transition("cfg-1", "failure", db);

    expect(result).toEqual({ from: "DEGRADED", to: "DISABLED", counter: 10 });

    const updateCall = db.webhookConfig.update.mock.calls[0][0];
    expect(updateCall.data.endpointHealth).toBe("DISABLED");
    expect(updateCall.data.consecutiveFailureCount).toBe(10);
    expect(updateCall.data.lastFailureAt).toBeInstanceOf(Date);

    expect(mockedCaptureAudit).toHaveBeenCalledTimes(1);
    expect(mockedCaptureAudit.mock.calls[0][0]).toMatchObject({
      action: "WEBHOOK_HEALTH_CHANGED",
      entityType: "WebhookConfig",
      entityId: "cfg-1",
      userId: "__system__",
      metadata: {
        webhookConfigId: "cfg-1",
        from: "DEGRADED",
        to: "DISABLED",
        reason: "auto_threshold",
        consecutiveFailureCount: 10,
      },
    });
  });

  it("success-from-DEGRADED-resets-to-HEALTHY: counter→0, ONE audit", async () => {
    const db = buildDbMock({
      config: { endpointHealth: "DEGRADED", consecutiveFailureCount: 4 },
    });

    const result = await transition("cfg-1", "success", db);

    expect(result).toEqual({ from: "DEGRADED", to: "HEALTHY", counter: 0 });

    const updateCall = db.webhookConfig.update.mock.calls[0][0];
    expect(updateCall.data.endpointHealth).toBe("HEALTHY");
    expect(updateCall.data.consecutiveFailureCount).toBe(0);
    expect(updateCall.data.lastSuccessAt).toBeInstanceOf(Date);

    expect(mockedCaptureAudit).toHaveBeenCalledTimes(1);
    expect(mockedCaptureAudit.mock.calls[0][0]).toMatchObject({
      action: "WEBHOOK_HEALTH_CHANGED",
      entityType: "WebhookConfig",
      entityId: "cfg-1",
      userId: "__system__",
      metadata: {
        webhookConfigId: "cfg-1",
        from: "DEGRADED",
        to: "HEALTHY",
        reason: "auto_threshold",
        consecutiveFailureCount: 0,
      },
    });
  });

  it("success-from-HEALTHY-no-state-change: counter stays 0, no audit", async () => {
    const db = buildDbMock({
      config: { endpointHealth: "HEALTHY", consecutiveFailureCount: 0 },
    });

    const result = await transition("cfg-1", "success", db);

    expect(result).toEqual({ from: "HEALTHY", to: "HEALTHY", counter: 0 });

    const updateCall = db.webhookConfig.update.mock.calls[0][0];
    expect(updateCall.data.endpointHealth).toBe("HEALTHY");
    expect(updateCall.data.consecutiveFailureCount).toBe(0);

    expect(mockedCaptureAudit).not.toHaveBeenCalled();
  });

  it("success-from-HEALTHY-counter-already-zero-still-updates-lastSuccessAt", async () => {
    const db = buildDbMock({
      config: { endpointHealth: "HEALTHY", consecutiveFailureCount: 0 },
    });

    await transition("cfg-1", "success", db);

    const updateCall = db.webhookConfig.update.mock.calls[0][0];
    expect(updateCall.data.lastSuccessAt).toBeInstanceOf(Date);
  });

  it("transition-accepts-injected-tx-client: uses injected client, not the default module db", async () => {
    const injectedFindUnique = vi.fn().mockResolvedValue({
      id: "cfg-9",
      projectId: 42,
      endpointHealth: "HEALTHY",
      consecutiveFailureCount: 0,
    });
    const injectedUpdate = vi.fn().mockResolvedValue(undefined);
    const injected = {
      webhookConfig: {
        findUnique: injectedFindUnique,
        update: injectedUpdate,
      },
    } as any;

    const result = await transition("cfg-9", "success", injected);

    expect(injectedFindUnique).toHaveBeenCalledTimes(1);
    expect(injectedUpdate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ from: "HEALTHY", to: "HEALTHY", counter: 0 });
  });

  it("DISABLED-success-still-resets: DISABLED → HEALTHY, counter 0, ONE audit", async () => {
    const db = buildDbMock({
      config: { endpointHealth: "DISABLED", consecutiveFailureCount: 10 },
    });

    const result = await transition("cfg-1", "success", db);

    expect(result).toEqual({ from: "DISABLED", to: "HEALTHY", counter: 0 });

    const updateCall = db.webhookConfig.update.mock.calls[0][0];
    expect(updateCall.data.endpointHealth).toBe("HEALTHY");
    expect(updateCall.data.consecutiveFailureCount).toBe(0);
    expect(updateCall.data.lastSuccessAt).toBeInstanceOf(Date);

    expect(mockedCaptureAudit).toHaveBeenCalledTimes(1);
    expect(mockedCaptureAudit.mock.calls[0][0]).toMatchObject({
      metadata: {
        from: "DISABLED",
        to: "HEALTHY",
        reason: "auto_threshold",
        consecutiveFailureCount: 0,
      },
    });
  });

  it("failure-on-DISABLED-noop-via-counter-clamp: counter increments, stays DISABLED, no audit", async () => {
    const db = buildDbMock({
      config: { endpointHealth: "DISABLED", consecutiveFailureCount: 10 },
    });

    const result = await transition("cfg-1", "failure", db);

    expect(result).toEqual({ from: "DISABLED", to: "DISABLED", counter: 11 });

    const updateCall = db.webhookConfig.update.mock.calls[0][0];
    expect(updateCall.data.endpointHealth).toBe("DISABLED");
    expect(updateCall.data.consecutiveFailureCount).toBe(11);
    expect(updateCall.data.lastFailureAt).toBeInstanceOf(Date);

    expect(mockedCaptureAudit).not.toHaveBeenCalled();
  });
});
