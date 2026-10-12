import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequestExecution } = vi.hoisted(() => ({
  mockRequestExecution: vi.fn(),
}));
vi.mock("~/lib/execution/requestExecution", () => ({
  requestExecution: (...args: unknown[]) => mockRequestExecution(...args),
}));

import { executeAutoRun } from "./autoExecute";

function makeDb(run: unknown = { createdById: "owner-1" }) {
  return {
    testRuns: { findUnique: vi.fn().mockResolvedValue(run) },
  };
}

const params = {
  autoExecute: { targetId: 4, ref: "release", inputs: { browser: "chrome" } },
  testRunId: 300,
  projectId: 3,
  tenantId: "t-1",
};

describe("executeAutoRun", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests execution on the rule's target as the run's creator", async () => {
    mockRequestExecution.mockResolvedValue({
      ok: true,
      execution: { id: 55, status: "PENDING", selectionCount: 2 },
      queued: true,
    });
    const db = makeDb();

    const result = await executeAutoRun(db as never, params);

    expect(result).toEqual({ requested: true, executionId: 55 });
    expect(db.testRuns.findUnique).toHaveBeenCalledWith({
      where: { id: 300 },
      select: { createdById: true },
    });
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
          systemReason: "webhook:auto-execute",
          guc: expect.objectContaining({
            userId: "owner-1",
            source: "worker",
            tenantId: "t-1",
          }),
        }),
      })
    );
  });

  it("uses the target's default ref and no inputs when the rule sets none", async () => {
    mockRequestExecution.mockResolvedValue({
      ok: true,
      execution: { id: 56, status: "PENDING", selectionCount: 1 },
      queued: true,
    });

    await executeAutoRun(makeDb() as never, {
      ...params,
      autoExecute: { targetId: 4, ref: "", inputs: {} },
    });

    const call = mockRequestExecution.mock.calls[0][0];
    expect(call.targetId).toBe(4);
    expect(call.ref).toBeUndefined();
    expect(call.inputs).toBeUndefined();
  });

  it("passes a null tenant into the audit context when there is none", async () => {
    mockRequestExecution.mockResolvedValue({
      ok: true,
      execution: { id: 57 },
      queued: true,
    });

    await executeAutoRun(makeDb() as never, {
      ...params,
      tenantId: undefined,
    });

    expect(mockRequestExecution.mock.calls[0][0].env.guc.tenantId).toBeNull();
  });

  it("requests nothing when the run is gone", async () => {
    const result = await executeAutoRun(makeDb(null) as never, params);

    expect(result).toEqual({ requested: false, code: "RUN_NOT_FOUND" });
    expect(mockRequestExecution).not.toHaveBeenCalled();
  });

  it.each(["TARGET_NOT_FOUND", "TARGET_DISABLED", "NO_AUTOMATED_CASES"])(
    "returns %s when the request is refused",
    async (code) => {
      mockRequestExecution.mockResolvedValue({
        ok: false,
        status: 409,
        code,
        error: "nope",
      });

      const result = await executeAutoRun(makeDb() as never, params);

      expect(result).toEqual({ requested: false, code });
    }
  );

  it("returns ERROR instead of throwing when the request throws", async () => {
    mockRequestExecution.mockRejectedValue(new Error("valkey down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await executeAutoRun(makeDb() as never, params);

    expect(result).toEqual({ requested: false, code: "ERROR" });
    spy.mockRestore();
  });
});
