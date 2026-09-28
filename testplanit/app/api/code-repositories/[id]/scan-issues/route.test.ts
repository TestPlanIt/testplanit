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
import { JOB_SCAN_REPO_ISSUES } from "~/lib/queueNames";
import { getRepoCacheQueue } from "~/lib/queues";
import { POST } from "./route";

const session = { user: { id: "user-1" } };

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/code-repositories/8/scan-issues",
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

function makeQueue(existing: Record<string, unknown> | null = null) {
  return {
    getJob: vi.fn().mockResolvedValue(existing),
    add: vi.fn().mockResolvedValue({ id: "scan-issues-9" }),
  };
}

function liveJob(state: string) {
  return {
    id: "scan-issues-9",
    getState: vi.fn().mockResolvedValue(state),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

describe("POST /api/code-repositories/[id]/scan-issues", () => {
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
      issueScanReport: null,
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

  it("marks the config queued, not running, and adds a full-history scan under its own id", async () => {
    (getCurrentTenantId as any).mockReturnValue("tenant-a");
    queue.add.mockResolvedValue({ id: "scan-issues-tenant-a-9" });

    const res = await POST(
      request({ projectConfigId: 9, full: true }),
      makeParams()
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      queued: true,
      jobId: "scan-issues-tenant-a-9",
    });
    expect(db.projectCodeRepositoryConfig.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: {
        issueScanReport: {
          queued: true,
          full: true,
          requestedAt: expect.any(String),
        },
      },
    });
    expect(queue.getJob).toHaveBeenCalledWith("scan-issues-tenant-a-9");
    expect(queue.add).toHaveBeenCalledWith(
      JOB_SCAN_REPO_ISSUES,
      { configId: 9, full: true, tenantId: "tenant-a" },
      { jobId: "scan-issues-tenant-a-9" }
    );
    // The queued mark lands before the job exists, never after the worker's.
    expect(
      db.projectCodeRepositoryConfig.update.mock.invocationCallOrder[0]
    ).toBeLessThan(queue.add.mock.invocationCallOrder[0]);
  });

  it("queues a recent-window scan when full is not asked for", async () => {
    await POST(request({ projectConfigId: "9" }), makeParams());

    expect(queue.add).toHaveBeenCalledWith(
      JOB_SCAN_REPO_ISSUES,
      { configId: 9, full: false, tenantId: undefined },
      { jobId: "scan-issues-9" }
    );
  });

  it("joins a scan already queued or running for the same config instead of adding another", async () => {
    for (const state of ["waiting", "active", "delayed"]) {
      queue = makeQueue(liveJob(state));
      (getRepoCacheQueue as any).mockReturnValue(queue);

      const res = await POST(request({ projectConfigId: 9 }), makeParams());

      expect(await res.json()).toEqual({
        queued: true,
        jobId: "scan-issues-9",
      });
      expect(queue.add).not.toHaveBeenCalled();
      expect(db.projectCodeRepositoryConfig.update).not.toHaveBeenCalled();
    }
  });

  it("drops a finished job still held by retention so the new scan can take its id", async () => {
    const finished = liveJob("completed");
    queue = makeQueue(finished);
    (getRepoCacheQueue as any).mockReturnValue(queue);

    const res = await POST(request({ projectConfigId: 9 }), makeParams());

    expect(res.status).toBe(200);
    expect(finished.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalled();
  });
});
