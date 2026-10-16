import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  baseDb: {
    testRunExecution: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("~/lib/execution/runAccess", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/execution/runAccess")>();
  return { ...actual, authenticateRunRequest: vi.fn() };
});

vi.mock("~/lib/execution/dispatch", () => ({
  finalizeExecution: vi.fn(async () => undefined),
}));

vi.mock("~/lib/multiTenantDb", () => ({
  getCurrentTenantId: vi.fn(() => "tenant-1"),
}));

import { baseDb } from "~/lib/db";
import { finalizeExecution } from "~/lib/execution/dispatch";
import { authenticateRunRequest } from "~/lib/execution/runAccess";
import { POST } from "./route";

const ctx = {
  userId: "user-1",
  access: "USER",
  run: {
    id: 42,
    projectId: 3,
    isCompleted: false,
    testRunType: "JUNIT",
    compositionLockedAt: null,
  },
};

function call(body: unknown) {
  const request = { json: async () => body } as unknown as NextRequest;
  return POST(request, {
    params: Promise.resolve({ testRunId: "42", executionId: "7" }),
  });
}

describe("POST /api/test-runs/[testRunId]/executions/[executionId]/finish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRunRequest).mockResolvedValue(ctx);
    vi.mocked(baseDb.testRunExecution.findFirst).mockResolvedValue({
      id: 7,
      status: "RUNNING",
    } as never);
  });

  it("finalizes with the conclusion and no link when none was sent", async () => {
    const res = await call({ conclusion: "success" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, status: "SUCCEEDED" });
    expect(finalizeExecution).toHaveBeenCalledWith(
      baseDb,
      7,
      "SUCCEEDED",
      expect.objectContaining({
        error: null,
        actorUserId: "user-1",
        tenantId: "tenant-1",
        extra: {},
      })
    );
  });

  it("stores the job's own URL and build id when it sends them", async () => {
    const res = await call({
      conclusion: "failure",
      message: "Build 11 failed",
      externalUrl: "https://ci.example.com/job/x/11/",
      externalRunId: 11,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, status: "FAILED" });
    expect(finalizeExecution).toHaveBeenCalledWith(
      baseDb,
      7,
      "FAILED",
      expect.objectContaining({
        error: "Build 11 failed",
        extra: {
          externalUrl: "https://ci.example.com/job/x/11/",
          externalRunId: "11",
        },
      })
    );
  });

  it("rejects a non-http externalUrl", async () => {
    const res = await call({
      conclusion: "success",
      externalUrl: "javascript:alert(1)",
    });
    expect(res.status).toBe(400);
    expect(finalizeExecution).not.toHaveBeenCalled();
  });

  it("returns 409 on a finished execution", async () => {
    vi.mocked(baseDb.testRunExecution.findFirst).mockResolvedValue({
      id: 7,
      status: "CANCELLED",
    } as never);
    const res = await call({ conclusion: "success" });
    expect(res.status).toBe(409);
    expect(finalizeExecution).not.toHaveBeenCalled();
  });
});
