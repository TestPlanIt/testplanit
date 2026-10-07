import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequestExecution } = vi.hoisted(() => ({
  mockRequestExecution: vi.fn(),
}));
vi.mock("~/lib/execution/requestExecution", () => ({
  requestExecution: (...args: unknown[]) => mockRequestExecution(...args),
}));

import { executeAutoRun } from "./autoExecute";

function makeDb(hook: unknown, run: unknown = { createdById: "owner-1" }) {
  return {
    webhookConfig: { findFirst: vi.fn().mockResolvedValue(hook) },
    testRuns: { findUnique: vi.fn().mockResolvedValue(run) },
    webhookDelivery: { update: vi.fn().mockResolvedValue({}) },
  };
}

const configured = {
  autoExecuteEnabled: true,
  autoExecuteTargetId: 4,
  autoExecuteRef: "release",
  autoExecuteInputs: { browser: "chrome" },
};
const params = {
  webhookConfigId: "whc-1",
  testRunId: 300,
  projectId: 3,
  deliveryId: "del-1",
  tenantId: "t-1",
};

describe("executeAutoRun", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests execution on the saved target as the run's creator", async () => {
    mockRequestExecution.mockResolvedValue({
      ok: true,
      execution: { id: 55, status: "PENDING", selectionCount: 2 },
      queued: true,
    });
    const db = makeDb(configured);

    const result = await executeAutoRun(db as never, params);

    expect(result).toEqual({ requested: true, executionId: 55 });
    expect(db.webhookConfig.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "whc-1", projectId: 3 } })
    );
    expect(mockRequestExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 300,
        projectId: 3,
        requestedById: "owner-1",
        targetId: 4,
        ref: "release",
        inputs: { browser: "chrome" },
        env: expect.objectContaining({
          db,
          tenantId: "t-1",
          guc: expect.objectContaining({
            userId: "owner-1",
            source: "worker",
            tenantId: "t-1",
          }),
        }),
      })
    );
    expect(db.webhookDelivery.update).not.toHaveBeenCalled();
  });

  it("uses the target's default ref and no inputs when none are saved", async () => {
    mockRequestExecution.mockResolvedValue({
      ok: true,
      execution: { id: 56, status: "PENDING", selectionCount: 1 },
      queued: true,
    });
    const db = makeDb({
      ...configured,
      autoExecuteRef: null,
      autoExecuteInputs: {},
    });

    await executeAutoRun(db as never, params);

    const call = mockRequestExecution.mock.calls[0][0];
    expect(call.ref).toBeUndefined();
    expect(call.inputs).toBeUndefined();
  });

  it.each([
    ["no webhook", null],
    ["auto-execute off", { ...configured, autoExecuteEnabled: false }],
    ["no target chosen", { ...configured, autoExecuteTargetId: null }],
  ])("requests nothing with %s", async (_label, hook) => {
    const db = makeDb(hook);

    const result = await executeAutoRun(db as never, params);

    expect(result).toEqual({ requested: false, reason: "not_configured" });
    expect(mockRequestExecution).not.toHaveBeenCalled();
    expect(db.webhookDelivery.update).not.toHaveBeenCalled();
  });

  it("requests nothing for a run no webhook started", async () => {
    const db = makeDb(configured);

    const result = await executeAutoRun(db as never, {
      ...params,
      webhookConfigId: undefined,
    });

    expect(result).toEqual({ requested: false, reason: "not_configured" });
    expect(db.webhookConfig.findFirst).not.toHaveBeenCalled();
  });

  it.each(["TARGET_NOT_FOUND", "TARGET_DISABLED", "NO_AUTOMATED_CASES"])(
    "records %s on the delivery and requests nothing",
    async (code) => {
      mockRequestExecution.mockResolvedValue({
        ok: false,
        status: 409,
        code,
        error: "nope",
      });
      const db = makeDb(configured);

      const result = await executeAutoRun(db as never, params);

      expect(result).toEqual({ requested: false, reason: "failed", code });
      expect(db.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: "del-1" },
        data: { error: `execute:${code.toLowerCase()}` },
      });
    }
  );

  it("records a thrown error on the delivery instead of throwing", async () => {
    mockRequestExecution.mockRejectedValue(new Error("valkey down"));
    const db = makeDb(configured);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await executeAutoRun(db as never, params);

    expect(result).toEqual({ requested: false, reason: "failed", code: "error" });
    expect(db.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: { error: "execute:error" },
    });
    spy.mockRestore();
  });
});
