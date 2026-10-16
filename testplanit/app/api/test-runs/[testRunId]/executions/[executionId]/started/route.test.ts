import { NextResponse, type NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  baseDb: {
    testRunExecution: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("~/lib/execution/runAccess", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/execution/runAccess")>();
  return { ...actual, authenticateRunRequest: vi.fn() };
});

vi.mock("~/lib/execution/service", () => ({
  publishExecutionChanged: vi.fn(),
}));

import { baseDb } from "~/lib/db";
import { authenticateRunRequest } from "~/lib/execution/runAccess";
import { publishExecutionChanged } from "~/lib/execution/service";
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

function call(
  body: unknown,
  ids: { testRunId?: string; executionId?: string } = {}
) {
  const request = { json: async () => body } as unknown as NextRequest;
  return POST(request, {
    params: Promise.resolve({
      testRunId: ids.testRunId ?? "42",
      executionId: ids.executionId ?? "7",
    }),
  });
}

describe("POST /api/test-runs/[testRunId]/executions/[executionId]/started", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRunRequest).mockResolvedValue(ctx);
    vi.mocked(baseDb.testRunExecution.findFirst).mockResolvedValue({
      id: 7,
      status: "DISPATCHED",
    } as never);
    vi.mocked(baseDb.testRunExecution.update).mockImplementation((async (args: {
      data: Record<string, unknown>;
    }) => ({
      id: 7,
      testRunId: 42,
      projectId: 3,
      status: args.data.status ?? "RUNNING",
    })) as never);
  });

  it("returns 400 for a non-numeric execution id", async () => {
    const res = await call(
      { externalUrl: "https://ci.example.com/job/x/11/" },
      { executionId: "abc" }
    );
    expect(res.status).toBe(400);
    expect(authenticateRunRequest).not.toHaveBeenCalled();
  });

  it("returns the auth response when the caller may not write the run", async () => {
    vi.mocked(authenticateRunRequest).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );
    const res = await call({ externalUrl: "https://ci.example.com/job/x/11/" });
    expect(res.status).toBe(403);
    expect(baseDb.testRunExecution.findFirst).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-http URL", async () => {
    const res = await call({ externalUrl: "ftp://ci.example.com/job/x/11/" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid input" });
    expect(baseDb.testRunExecution.update).not.toHaveBeenCalled();
  });

  it("returns 400 when externalUrl is missing", async () => {
    const res = await call({ externalRunId: 11 });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the execution belongs to a different run", async () => {
    vi.mocked(baseDb.testRunExecution.findFirst).mockResolvedValue(null);
    const res = await call({ externalUrl: "https://ci.example.com/job/x/11/" });
    expect(res.status).toBe(404);
    expect(baseDb.testRunExecution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, testRunId: 42 } })
    );
    expect(baseDb.testRunExecution.update).not.toHaveBeenCalled();
  });

  it("returns 409 on a finished execution", async () => {
    vi.mocked(baseDb.testRunExecution.findFirst).mockResolvedValue({
      id: 7,
      status: "SUCCEEDED",
    } as never);
    const res = await call({ externalUrl: "https://ci.example.com/job/x/11/" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "EXECUTION_FINISHED" });
    expect(baseDb.testRunExecution.update).not.toHaveBeenCalled();
  });

  it("stores the URL and build id and moves DISPATCHED to RUNNING", async () => {
    const res = await call({
      externalUrl: "https://ci.example.com/job/x/11/",
      externalRunId: 11,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, status: "RUNNING" });
    expect(baseDb.testRunExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: {
          externalUrl: "https://ci.example.com/job/x/11/",
          externalRunId: "11",
          status: "RUNNING",
        },
      })
    );
    expect(publishExecutionChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, testRunId: 42, projectId: 3 })
    );
  });

  it("moves PENDING to RUNNING too", async () => {
    vi.mocked(baseDb.testRunExecution.findFirst).mockResolvedValue({
      id: 7,
      status: "PENDING",
    } as never);
    const res = await call({ externalUrl: "https://ci.example.com/job/x/11/" });
    expect(res.status).toBe(200);
    expect(baseDb.testRunExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          externalUrl: "https://ci.example.com/job/x/11/",
          status: "RUNNING",
        },
      })
    );
  });

  it("leaves a RUNNING execution RUNNING and only refreshes the link", async () => {
    vi.mocked(baseDb.testRunExecution.findFirst).mockResolvedValue({
      id: 7,
      status: "RUNNING",
    } as never);
    const res = await call({ externalUrl: "https://ci.example.com/job/x/12/" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, status: "RUNNING" });
    const { data } = vi.mocked(baseDb.testRunExecution.update).mock
      .calls[0][0] as { data: Record<string, unknown> };
    expect(data).toEqual({ externalUrl: "https://ci.example.com/job/x/12/" });
  });

  it("truncates a long build id to 200 characters", async () => {
    await call({
      externalUrl: "https://ci.example.com/job/x/11/",
      externalRunId: "x".repeat(250),
    });
    const { data } = vi.mocked(baseDb.testRunExecution.update).mock
      .calls[0][0] as { data: { externalRunId: string } };
    expect(data.externalRunId).toHaveLength(200);
  });
});
