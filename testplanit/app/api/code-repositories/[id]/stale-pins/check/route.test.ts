import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/multiTenantDb", () => ({
  getCurrentTenantId: vi.fn(),
}));

const { db } = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    projectCodeRepositoryConfig: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ baseDb: db }));

vi.mock("~/lib/queues", () => ({
  getRepoCacheQueue: vi.fn(),
}));

import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth/next";
import { JOB_CHECK_STALE_PINS } from "~/lib/queueNames";
import { getRepoCacheQueue } from "~/lib/queues";
import { POST } from "./route";

const session = { user: { id: "user-1" } };

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/code-repositories/8/stale-pins/check",
    {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

function makeParams() {
  return { params: Promise.resolve({ id: "8" }) };
}

function makeQueue(jobs: Array<Record<string, unknown>> = []) {
  return {
    getJobs: vi.fn().mockResolvedValue(jobs),
    add: vi.fn().mockResolvedValue({ id: "job-9" }),
  };
}

describe("POST /api/code-repositories/[id]/stale-pins/check", () => {
  let queue: ReturnType<typeof makeQueue>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue = makeQueue();
    (getServerSession as any).mockResolvedValue(session);
    (getCurrentTenantId as any).mockReturnValue(undefined);
    (getRepoCacheQueue as any).mockReturnValue(queue);
    db.user.findUnique.mockResolvedValue({ access: "PROJECTADMIN" });
    db.projectCodeRepositoryConfig.findUnique.mockResolvedValue({
      id: 9,
      purpose: "IMPACT",
    });
    db.projectCodeRepositoryConfig.update.mockResolvedValue({});
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await POST(request({ projectConfigId: 9 }), makeParams());

    expect(res.status).toBe(401);
  });

  it("returns 403 for a user who is not an admin or project admin", async () => {
    db.user.findUnique.mockResolvedValue({ access: "USER" });

    const res = await POST(request({ projectConfigId: 9 }), makeParams());

    expect(res.status).toBe(403);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("returns 400 without a config id or with a malformed body", async () => {
    expect((await POST(request({}), makeParams())).status).toBe(400);
    expect((await POST(request("{nope"), makeParams())).status).toBe(400);
  });

  it("returns 404 when the config does not exist", async () => {
    db.projectCodeRepositoryConfig.findUnique.mockResolvedValue(null);

    const res = await POST(request({ projectConfigId: 9 }), makeParams());

    expect(res.status).toBe(404);
  });

  it("refuses a QuickScript config", async () => {
    db.projectCodeRepositoryConfig.findUnique.mockResolvedValue({
      id: 9,
      purpose: "QUICKSCRIPT",
    });

    const res = await POST(request({ projectConfigId: 9 }), makeParams());

    expect(res.status).toBe(400);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("returns 503 when the queue is unavailable", async () => {
    (getRepoCacheQueue as any).mockReturnValue(null);

    const res = await POST(request({ projectConfigId: 9 }), makeParams());

    expect(res.status).toBe(503);
  });

  it("marks the config running and queues the check", async () => {
    (getCurrentTenantId as any).mockReturnValue("tenant-a");

    const res = await POST(request({ projectConfigId: "9" }), makeParams());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: true, jobId: "job-9" });
    expect(db.projectCodeRepositoryConfig.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        stalePinReport: expect.objectContaining({
          running: true,
          checkedFiles: 0,
          totalFiles: 0,
        }),
      },
    });
    expect(queue.add).toHaveBeenCalledWith(JOB_CHECK_STALE_PINS, {
      configId: 9,
      tenantId: "tenant-a",
    });
  });

  it("joins a check already queued for the same config instead of adding another", async () => {
    queue = makeQueue([
      { id: "job-3", name: JOB_CHECK_STALE_PINS, data: { configId: 9 } },
    ]);
    (getRepoCacheQueue as any).mockReturnValue(queue);

    const res = await POST(request({ projectConfigId: 9 }), makeParams());

    expect(await res.json()).toEqual({ queued: true, jobId: "job-3" });
    expect(queue.add).not.toHaveBeenCalled();
    expect(db.projectCodeRepositoryConfig.update).not.toHaveBeenCalled();
  });
});
